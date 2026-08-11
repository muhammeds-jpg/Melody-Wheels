import { NextResponse } from "next/server";
import { getCatalogue } from "@/lib/catalogue";

export const dynamic = "force-dynamic";

/**
 * The catalogue the player runs on.
 *
 * No authentication of any kind: the list is baked by `npm run sync` and served
 * straight from memory, so an anonymous visitor gets playable music on the first
 * request with nothing to sign in to.
 */
export async function GET() {
  try {
    const catalogue = await getCatalogue();

    if (catalogue.tracks.length === 0) {
      return NextResponse.json({ error: "catalogue_unavailable", ...catalogue }, { status: 503 });
    }
    return NextResponse.json(catalogue);
  } catch (err) {
    return NextResponse.json(
      {
        error: "catalogue_unavailable",
        tracks: [],
        warning: err instanceof Error ? err.message : "Could not resolve the playlist.",
      },
      { status: 502 },
    );
  }
}
