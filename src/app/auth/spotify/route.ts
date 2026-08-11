import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { spotifyConfig, USER_SCOPES } from "@/lib/spotify-server";

export const dynamic = "force-dynamic";

/** §15 step 1–2 — start the Spotify authorization flow. */
export async function GET(req: Request) {
  const { clientId, redirectUri, configured } = spotifyConfig();

  if (!configured) {
    return NextResponse.redirect(new URL("/?error=not_configured", req.url));
  }

  /**
   * Start the flow on the SAME host the callback will land on.
   *
   * Cookies are scoped per origin, and a browser treats localhost and 127.0.0.1
   * as different origins even though they are the same machine. Beginning at
   * localhost:3000 while the registered redirect URI points at 127.0.0.1:3000
   * writes the CSRF state cookie to an origin the callback never sees, so the
   * state check fails every time with no obvious cause. Bouncing first makes
   * that mismatch impossible.
   */
  const target = new URL(redirectUri);
  // The Host HEADER, not req.url: Next's dev server reports req.url with its own
  // internal origin regardless of what the browser asked for, so comparing
  // against it never matches and the redirect loops forever.
  const requestHost = req.headers.get("host");
  if (requestHost && requestHost !== target.host) {
    return NextResponse.redirect(new URL("/auth/spotify", target.origin));
  }

  // CSRF protection: the callback rejects anything whose state does not match.
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: USER_SCOPES,
    state,
    // Force the consent screen only when we have no session; Spotify otherwise
    // silently reuses the previous grant, which is what we want.
    show_dialog: "false",
  });

  const res = NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`,
  );

  res.cookies.set("mw_auth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // must survive the cross-site redirect back from Spotify
    path: "/",
    maxAge: 600,
  });

  return res;
}
