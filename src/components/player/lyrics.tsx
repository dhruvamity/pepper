"use client";

import { useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/client/api";
import { usePlayer } from "@/lib/client/player/store";
import type { Lyrics } from "@/lib/types";

export function useLyrics(trackId: string | null | undefined, enabled = true) {
  return useSWR<{ lyrics: Lyrics | null }>(trackId && enabled ? `/api/tracks/${trackId}` : null, fetcher, { revalidateOnFocus: false });
}

/** Synced lyrics follow playback (tap a line to jump there); plain lyrics just scroll. */
export function LyricsView({ trackId, lyrics, compact, color }: { trackId: string; lyrics: Lyrics; compact?: boolean; color?: string }) {
  const isCurrent = usePlayer((s) => s.currentId === trackId);
  const position = usePlayer((s) => (s.currentId === trackId ? s.position : -1));
  const lines = lyrics.synced;
  const active = useMemo(() => {
    if (!lines?.length || position < 0) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= position + 250) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }, [lines, position]);

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active < 0 || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!el) return;
    const parent = box.current;
    const top = el.offsetTop - parent.clientHeight / 3;
    parent.scrollTo({ top, behavior: "smooth" });
  }, [active]);

  if (!lines?.length) {
    return (
      <div className={`whitespace-pre-line font-bold leading-relaxed text-white ${compact ? "max-h-72 overflow-hidden text-xl" : "text-2xl"}`}>{lyrics.plain}</div>
    );
  }
  return (
    <div ref={box} className={`no-scrollbar relative overflow-y-auto ${compact ? "max-h-80" : "h-full"}`} style={{ maskImage: compact ? "linear-gradient(#000 80%, transparent)" : undefined }}>
      <div className="space-y-3 py-2">
        {lines.map((l, i) => (
          <button
            key={i}
            type="button"
            data-line={i}
            onClick={() => isCurrent && usePlayer.getState().seek(l.t)}
            className={`block w-full text-left font-bold leading-snug transition-colors ${compact ? "text-xl" : "text-2xl sm:text-3xl"} ${
              i === active ? "text-white" : i < active ? "text-white/60" : ""
            }`}
            style={i > active ? { color: color ? "rgb(0 0 0 / 0.55)" : "rgb(255 255 255 / 0.35)" } : undefined}
          >
            {l.text || "♪"}
          </button>
        ))}
      </div>
      <p className="pt-6 text-xs text-white/60">Lyrics {lyrics.source === "lrclib" ? "provided by LRCLIB" : "from the file tags"}</p>
    </div>
  );
}
