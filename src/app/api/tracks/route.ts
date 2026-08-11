import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCatalogue } from "@/lib/catalogue";
import { refreshUserToken } from "@/lib/spotify-server";

export const dynamic = "force-dynamic";

/**
 * The catalogue the player runs on. Nothing about it is baked into the build.
 *
 * If the visitor has connected Spotify, their token is used to read the actual
 * playlist — an app token now answers 401 on `/items`, even for a public list.
 */
export async function GET() {
  let userToken: string | undefined;

  try {
    const refresh = (await cookies()).get("mw_refresh")?.value;
    if (refresh) {
      const token = await refreshUserToken(refresh);
      userToken = token.access_token;
    }
  } catch {
    // Not connected, or the grant was revoked. The seed list still serves.
  }

  try {
    const catalogue = await getCatalogue(userToken);

    if (catalogue.tracks.length === 0) {
      return NextResponse.json({ error: "catalogue_unavailable", ...catalogue }, { status: 503 });
    }
    return NextResponse.json(catalogue);
  } catch {
    return NextResponse.json({ error: "catalogue_unavailable", tracks: [] }, { status: 502 });
  }
}
