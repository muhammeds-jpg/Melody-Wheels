import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, getUserProduct, spotifyConfig } from "@/lib/spotify-server";

export const dynamic = "force-dynamic";

/**
 * Always land back on the host the session cookie was written for. Using
 * req.url here would bounce the visitor to whatever host Spotify happened to
 * call, which may not be the one holding the cookie.
 */
function homeUrl(path: string): string {
  const { redirectUri } = spotifyConfig();
  try {
    return new URL(path, new URL(redirectUri).origin).toString();
  } catch {
    return path;
  }
}

/**
 * §15 steps 3–6 — exchange the code for tokens on the server and keep the
 * refresh token in an httpOnly cookie. The browser never receives it (§30); it
 * only ever gets short-lived access tokens from /api/spotify/token.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();

  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(homeUrl("/?error=auth_denied"));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = jar.get("mw_auth_state")?.value;

  if (!code || !state || !expected || state !== expected) {
    // Almost always an origin mismatch rather than an actual CSRF attempt: the
    // flow began on a different host than the one this callback runs on, so the
    // state cookie was never sent. /auth/spotify now normalises the host first.
    return NextResponse.redirect(homeUrl("/?error=auth_state"));
  }

  try {
    const token = await exchangeCode(code);

    // §12 — the SDK silently fails for free accounts. Catching it here turns a
    // confusing account_error into a clear message before the player ever loads.
    const product = await getUserProduct(token.access_token);
    const destination = product && product !== "premium" ? "/?error=premium" : "/?connected=1";

    const res = NextResponse.redirect(homeUrl(destination));

    if (token.refresh_token) {
      res.cookies.set("mw_refresh", token.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    res.cookies.delete("mw_auth_state");
    return res;
  } catch {
    // Never surface the raw API error.
    return NextResponse.redirect(homeUrl("/?error=auth_failed"));
  }
}
