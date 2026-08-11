import Link from "next/link";
import { cookies } from "next/headers";
import { refreshUserToken } from "@/lib/spotify-server";
import { SPOTIFY_PLAYLIST_ID } from "@/config/playlist";
import { SwitchButton } from "./SwitchButton";

export const dynamic = "force-dynamic";

/**
 * A helper page for choosing which playlist the site plays.
 *
 * It exists as a PAGE rather than a CLI command because the Spotify session is
 * an httpOnly cookie: only the browser can present it. A script running in Node
 * has no cookie jar, so it always looked signed-out.
 */
/**
 * Everything past `id` is optional on purpose. /v1/me/playlists can return
 * entries with no `tracks` object at all — and one `p.tracks.total` on such an
 * entry takes down the whole page with a 500.
 */
type SpotifyPlaylist = {
  id?: string;
  name?: string;
  public?: boolean | null;
  tracks?: { total?: number } | null;
  owner?: { display_name?: string } | null;
};

async function loadPlaylists(): Promise<
  { ok: true; items: SpotifyPlaylist[] } | { ok: false; reason: string }
> {
  const refresh = (await cookies()).get("mw_refresh")?.value;
  if (!refresh) return { ok: false, reason: "not_connected" };

  try {
    const { access_token } = await refreshUserToken(refresh);
    const res = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
      headers: { Authorization: `Bearer ${access_token}` },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `spotify_${res.status}` };
    const json = (await res.json()) as { items?: (SpotifyPlaylist | null)[] };
    // Spotify occasionally includes null entries; drop anything without an id.
    const items = (json.items ?? []).filter(
      (p): p is SpotifyPlaylist => Boolean(p?.id),
    );
    return { ok: true, items };
  } catch {
    return { ok: false, reason: "request_failed" };
  }
}

export default async function PlaylistsPage() {
  const result = await loadPlaylists();

  return (
    <main
      className="page"
      style={{
        background: "#0b0908",
        color: "#f4efe6",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <p
          style={{
            fontSize: 11,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#8d8377",
          }}
        >
          Melody Wheels
        </p>
        <h1 style={{ fontSize: 34, margin: "0.5rem 0 1.5rem", fontWeight: 600 }}>
          Choose a playlist
        </h1>

        {!result.ok ? (
          <div style={{ lineHeight: 1.7, color: "#cdc3b6" }}>
            {result.reason === "not_connected" ? (
              <>
                <p>You are not connected to Spotify in this browser.</p>
                <p style={{ marginTop: "1rem" }}>
                  <a href="/auth/spotify" style={{ color: "#1db954" }}>
                    Connect Spotify
                  </a>{" "}
                  and come back to this page.
                </p>
              </>
            ) : (
              <p>Could not reach Spotify ({result.reason}). Try connecting again.</p>
            )}
          </div>
        ) : result.items.length === 0 ? (
          <p style={{ color: "#cdc3b6" }}>This account has no playlists.</p>
        ) : (
          <>
            <p style={{ color: "#cdc3b6", lineHeight: 1.7, marginBottom: "2rem" }}>
              Pick one and restart the dev server. Switching from here also rebuilds
              the fallback list that visitors who have not connected Spotify see —
              which a terminal command cannot do, because reading a private playlist
              needs the session cookie only this browser holds.
            </p>

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {result.items.map((p) => {
                const active = p.id === SPOTIFY_PLAYLIST_ID;
                return (
                  <li
                    key={p.id}
                    style={{
                      border: "1px solid #26262e",
                      borderRadius: 12,
                      padding: "1rem 1.15rem",
                      marginBottom: "0.75rem",
                      background: active ? "rgba(29,185,84,0.08)" : "transparent",
                      borderColor: active ? "rgba(29,185,84,0.45)" : "#26262e",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "1rem",
                        flexWrap: "wrap",
                        alignItems: "baseline",
                      }}
                    >
                      <strong style={{ fontSize: 17 }}>{p.name ?? "Untitled playlist"}</strong>
                      <span style={{ fontSize: 12, color: "#8d8377" }}>
                        {p.tracks?.total ?? "?"} tracks
                        {active ? "  ·  currently playing on the site" : ""}
                      </span>
                    </div>

                    <SwitchButton id={p.id!} active={active} />
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <p style={{ marginTop: "2.5rem" }}>
          <Link href="/" style={{ color: "#8d8377", fontSize: 13 }}>
            &larr; Back to the player
          </Link>
        </p>
      </div>
    </main>
  );
}
