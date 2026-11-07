"use client";

import { useCatalog } from "@/lib/client/catalog";
import { useLibraryActions } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";
import { shade } from "@/lib/util";
import { HeartIcon, PauseIcon, PlayIcon } from "../icons";
import { Cover } from "../ui/cover";
import { Marquee } from "./controls";

/** Phone mini player docked above the tab bar (tap to expand). */
export function MiniPlayer() {
  const { catalog } = useCatalog();
  const id = usePlayer((s) => s.currentId);
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const setView = usePlayer((s) => s.setView);
  const { isLiked, toggleLike } = useLibraryActions();
  const t = id ? catalog?.byId.get(id) : undefined;
  if (!t) return null;
  const pct = duration > 0 ? (position / duration) * 100 : 0;
  const bg = shade(t.cover?.color ?? "#535353", 0.45);
  return (
    <div className="px-2 md:hidden">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Now playing: ${t.title}. Open player`}
        onClick={() => setView("now")}
        onKeyDown={(e) => e.key === "Enter" && setView("now")}
        className="relative flex h-[var(--mini-player-h)] items-center gap-2.5 overflow-hidden rounded-md px-2 shadow-float transition-colors"
        style={{ backgroundColor: bg }}
      >
        <Cover image={t.cover} className="h-10 w-10 shrink-0" rounded="rounded" />
        <div className="min-w-0 flex-1">
          <Marquee text={t.subtitle ? `${t.title} · ${t.subtitle}` : t.title} className="text-[13px] font-bold leading-tight text-white" />
          <div className="truncate text-[13px] leading-tight text-white/70">{t.artists.map((a) => a.name).join(", ")}</div>
        </div>
        <button
          type="button"
          aria-label={isLiked(t.id) ? "Remove from Liked Songs" : "Save to Liked Songs"}
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(t.id);
          }}
          className={`flex h-10 w-10 items-center justify-center ${isLiked(t.id) ? "text-accent" : "text-white"}`}
        >
          <HeartIcon filled={isLiked(t.id)} size={22} />
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={(e) => {
            e.stopPropagation();
            usePlayer.getState().toggle();
          }}
          className="flex h-10 w-10 items-center justify-center text-white"
        >
          {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </button>
        <div className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-white/25">
          <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
