import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { refreshUserToken } from "@/lib/spotify-server";

export const dynamic = "force-dynamic";

/**
 * §31 — hands the browser a short-lived access token for the Web Playback SDK.
 *
 * The refresh token stays in its httpOnly cookie and is never part of the
 * response (§30). The SDK calls this again whenever its token expires.
 */
export async function GET() {
  const jar = await cookies();
  const refresh = jar.get("mw_refresh")?.value;

  if (!refresh) {
    return NextResponse.json(
      { error: "not_authenticated" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const token = await refreshUserToken(refresh);

    const res = NextResponse.json(
      { accessToken: token.access_token, expiresIn: token.expires_in },
      { headers: { "cache-control": "no-store" } },
    );

    // Spotify may rotate the refresh token; persist the new one when it does.
    if (token.refresh_token) {
      res.cookies.set("mw_refresh", token.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return res;
  } catch {
    // Revoked or expired grant — clear it so the UI can prompt a fresh connect.
    const res = NextResponse.json(
      { error: "refresh_failed" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
    res.cookies.delete("mw_refresh");
    return res;
  }
}
