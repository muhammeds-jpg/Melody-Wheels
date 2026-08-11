"use client";

import { useActionState } from "react";
import { usePlaylist, type SwitchResult } from "./actions";

export function SwitchButton({ id, active }: { id: string; active: boolean }) {
  const [result, formAction, pending] = useActionState<SwitchResult | null, FormData>(
    usePlaylist,
    null,
  );

  return (
    <form action={formAction} style={{ marginTop: "0.7rem" }}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending || active}
        style={{
          background: active ? "transparent" : "#1db954",
          color: active ? "#8d8377" : "#08080a",
          border: active ? "1px solid #26262e" : "none",
          borderRadius: 999,
          padding: "0.45rem 1rem",
          fontSize: 13,
          fontWeight: 600,
          cursor: active || pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {active ? "Currently playing" : pending ? "Switching…" : "Use this playlist"}
      </button>

      {result && (
        <p
          style={{
            marginTop: "0.6rem",
            fontSize: 12.5,
            lineHeight: 1.6,
            color: result.ok ? "#1db954" : "#e0785e",
          }}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
