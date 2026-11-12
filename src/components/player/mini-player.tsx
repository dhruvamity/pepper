"use client";

import { Moon } from "lucide-react";
import { useRef, useState } from "react";
import { useCatalog } from "@/lib/client/catalog";
import { useLibraryActions } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";
import { shade } from "@/lib/util";
import { HeartIcon, PauseIcon, PlayIcon } from "../icons";
import { Cover } from "../ui/cover";
import { Marquee } from "./controls";

const SWIPE = 72;

/** Phone mini player docked above the tab bar (tap to expand, swipe left/right to skip). */
export function MiniPlayer() {
  const { catalog } = useCatalog();
  const id = usePlayer((s) => s.currentId);
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const sleeping = usePlayer((s) => s.sleepAt !== null || s.sleepAfterTrack);
  const setView = usePlayer((s) => s.setView);
  const { isLiked, toggleLike } = useLibraryActions();
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const drag = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);
  const t = id ? catalog?.byId.get(id) : undefined;
  if (!t) return null;
  const pct = duration > 0 ? (position / duration) * 100 : 0;
  const bg = shade(t.cover?.color ?? "#535353", 0.45);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null };
    setSettling(false);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const x = e.clientX - d.x;
    const y = e.clientY - d.y;
    if (d.horizontal === null) {
      if (Math.abs(x) < 6 && Math.abs(y) < 6) return;
      d.horizontal = Math.abs(x) > Math.abs(y);
      if (d.horizontal) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (d.horizontal) setDx(Math.max(-140, Math.min(140, x)));
  };
  const finish = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const swiped = d.horizontal && Math.abs(dx) >= SWIPE;
    if (swiped) {
      if (dx < 0) usePlayer.getState().next();
      else usePlayer.getState().prev();
    } else if (!d.horizontal && e.type === "pointerup") setView("now");
    setSettling(true);
    setDx(0);
  };

  return (
    <div className="px-2 md:hidden">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Now playing: ${t.title}. Open player, or swipe to skip`}
        onKeyDown={(e) => e.key === "Enter" && setView("now")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className="relative flex h-[var(--mini-player-h)] touch-pan-y select-none items-center gap-2.5 overflow-hidden rounded-md px-2 shadow-float"
        style={{ backgroundColor: bg }}
      >
        <div className={`flex min-w-0 flex-1 items-center gap-2.5 ${settling ? "transition-transform duration-200" : ""}`} style={{ transform: `translateX(${dx}px)`, opacity: 1 - Math.min(0.6, Math.abs(dx) / 220) }}>
          <Cover image={t.cover} className="h-10 w-10 shrink-0" rounded="rounded" />
          <div className="min-w-0 flex-1">
            <Marquee text={t.subtitle ? `${t.title} · ${t.subtitle}` : t.title} className="text-[13px] font-bold leading-tight text-white" />
            <div className="flex items-center gap-1.5 truncate text-[13px] leading-tight text-white/70">
              {sleeping && <Moon size={12} className="shrink-0 text-accent" aria-label="Sleep timer on" />}
              <span className="truncate">{t.artists.map((a) => a.name).join(", ")}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label={isLiked(t.id) ? "Remove from Liked Songs" : "Save to Liked Songs"}
          onPointerDown={(e) => e.stopPropagation()}
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
          onPointerDown={(e) => e.stopPropagation()}
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
