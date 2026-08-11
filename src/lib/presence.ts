/**
 * SERVER ONLY. Live listener count.
 *
 * Two backends behind one interface:
 *
 *  - **Redis** (Upstash) when the env vars are present. Correct on Vercel and
 *    anywhere else that runs more than one instance, because the count has to
 *    be shared across them.
 *  - **In-memory** otherwise, so the counter works out of the box with zero
 *    configuration. This is accurate ONLY for a single server process — each
 *    serverless instance would keep its own tally and under-report.
 *
 * A listener is "online" if they have sent a heartbeat within TTL_MS.
 */
import { Redis } from "@upstash/redis";

const KEY = "presence";
const TTL_MS = 30_000;

/* ── In-memory backend ───────────────────────────────────────────────────── */

const seen = new Map<string, number>();

function memoryBeat(sid: string): number {
  const now = Date.now();
  seen.set(sid, now);
  // Prune on write; with a handful of listeners this is cheaper than a timer,
  // and it keeps the map from growing without bound.
  for (const [id, at] of seen) {
    if (now - at > TTL_MS) seen.delete(id);
  }
  return seen.size;
}

/* ── Redis backend ───────────────────────────────────────────────────────── */

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Checked by hand rather than via Redis.fromEnv(): fromEnv() does not throw
  // on missing vars, it returns a client that only fails once you issue a
  // command — which would turn a normal unconfigured setup into a 500 per beat.
  if (!url || !token) {
    redis = null;
    return redis;
  }

  try {
    redis = new Redis({ url, token });
  } catch {
    redis = null;
  }
  return redis;
}

async function redisBeat(client: Redis, sid: string): Promise<number> {
  const now = Date.now();
  // Sorted set scored by timestamp: add me, drop everyone stale, count.
  await client.zadd(KEY, { score: now, member: sid });
  await client.zremrangebyscore(KEY, 0, now - TTL_MS);
  return client.zcard(KEY);
}

/* ── Public ──────────────────────────────────────────────────────────────── */

export type PresenceResult = { count: number; backend: "redis" | "memory" };

export async function heartbeat(sid: string): Promise<PresenceResult> {
  const client = getRedis();
  if (!client) return { count: memoryBeat(sid), backend: "memory" };

  try {
    return { count: await redisBeat(client, sid), backend: "redis" };
  } catch {
    // An Upstash blip must not take the counter down with it.
    return { count: memoryBeat(sid), backend: "memory" };
  }
}
