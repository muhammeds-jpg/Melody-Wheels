import { NextResponse } from "next/server";
import { getCatalogue } from "@/lib/catalogue";

export const revalidate = 300;

/**
 * GET /api/track/:id — normalized information for one track.
 *
 * Served from the already-resolved catalogue rather than by calling Spotify
 * directly. Going straight to the Web API meant this route returned 502 for a
 * condition that is neither unexpected nor a fault: Spotify answers 403 for the
 * whole API until the app owner holds Premium. A 5xx for a known, permanent
 * state is noise — it hides real failures in logs and tells the caller the
 * server broke when it did not.
 *
 * The catalogue already carries the artwork, duration and playable preview, so
 * this now answers with real data.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Validate before touching anything upstream. Spotify ids are base62, 22 chars.
  if (!/^[A-Za-z0-9]{22}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    const { tracks } = await getCatalogue();
    const track = tracks.find((t) => t.id === id);

    if (!track) {
      // Genuinely not in this site's playlist — the honest answer is 404.
      return NextResponse.json({ error: "track_not_found" }, { status: 404 });
    }

    return NextResponse.json(track);
  } catch {
    // Reserved for an actual unexpected failure.
    return NextResponse.json({ error: "catalogue_unavailable" }, { status: 502 });
  }
}
