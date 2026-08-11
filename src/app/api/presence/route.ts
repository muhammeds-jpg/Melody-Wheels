import { NextResponse } from "next/server";
import { heartbeat } from "@/lib/presence";

// Must never be cached: every request is a liveness signal and the count moves.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let sid: unknown;
  try {
    ({ sid } = (await req.json()) as { sid?: unknown });
  } catch {
    return NextResponse.json(
      { error: "bad_body" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  // Validate before it reaches any store — an unbounded id is a memory leak.
  if (typeof sid !== "string" || sid.length === 0 || sid.length > 64) {
    return NextResponse.json(
      { error: "bad_sid" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const { count } = await heartbeat(sid);
    return NextResponse.json({ count }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
