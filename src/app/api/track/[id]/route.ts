import { NextResponse } from "next/server";
import { getCatalogue } from "@/lib/catalogue";

export const revalidate = 300;

/**
 * GET /api/track/:id — normalized information for one track.
 *
 * Served from the already-resolved catalogue, which needs no credentials and is
 * held in memory, so this costs no upstream call. It carries the artwork, the
 * real duration, the YouTube id and the preview url.
 *
 * The status codes are kept honest: 400 for a malformed id, 404 for an id that
 * is simply not in this site's playlist, and 502 reserved for an actual
 * unexpected failure. A 5xx for a known, permanent state is noise — it hides
 * real failures in logs and tells the caller the server broke when it did not.
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
