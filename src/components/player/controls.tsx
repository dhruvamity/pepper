"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "@/lib/client/player/store";
import { formatDuration } from "@/lib/util";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon } from "../icons";
import { IconButton } from "../ui/play-button";

export function SeekBar({ compact, thumb }: { compact?: boolean; thumb?: boolean }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? position;
  const pct = duration > 0 ? Math.min(100, (value / duration) * 100) : 0;
  return (
    <div className={`flex w-full items-center gap-2 ${compact ? "" : "flex-col"}`}>
      {compact && <span className="w-10 text-right text-xs tabular-nums text-subdued">{formatDuration(value)}</span>}
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={Math.max(1, duration)}
        step={250}
        value={value}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag != null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag != null) seek(drag);
          setDrag(null);
        }}
        onBlur={() => setDrag(null)}
        className={`range ${thumb ? "always-thumb" : ""}`}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
      />
      {compact ? (
        <span className="w-10 text-xs tabular-nums text-subdued">{formatDuration(duration)}</span>
      ) : (
        <div className="flex w-full justify-between text-xs tabular-nums text-subdued">
          <span>{formatDuration(value)}</span>
          <span>{duration > 0 ? `-${formatDuration(Math.max(0, duration - value))}` : "0:00"}</span>
        </div>
      )}
    </div>
  );
}

export function TransportControls({ size = "md" }: { size?: "md" | "lg" }) {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const hasTrack = usePlayer((s) => Boolean(s.currentId));
  const st = usePlayer.getState;
  const big = size === "lg";
  return (
    <div className={`flex items-center ${big ? "w-full justify-between" : "gap-4"}`}>
      <IconButton label={shuffle ? "Disable shuffle" : "Enable shuffle"} active={shuffle} onClick={() => st().setShuffle(!shuffle)}>
        <ShuffleIcon size={big ? 26 : 16} />
      </IconButton>
      <IconButton label="Previous" onClick={() => st().prev()} className="text-white">
        <PrevIcon size={big ? 34 : 16} className="text-white" />
      </IconButton>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        disabled={!hasTrack}
        onClick={() => st().toggle()}
        className={`relative flex items-center justify-center rounded-full bg-white text-black transition hover:scale-105 active:scale-95 disabled:opacity-50 ${
          big ? "h-16 w-16" : "h-8 w-8"
        }`}
      >
        {playing ? <PauseIcon size={big ? 26 : 16} /> : <PlayIcon size={big ? 26 : 16} />}
        {buffering && playing && <span className="absolute inset-0 animate-spin rounded-full border-2 border-black/10 border-t-accent" />}
      </button>
      <IconButton label="Next" onClick={() => st().next()}>
        <NextIcon size={big ? 34 : 16} className="text-white" />
      </IconButton>
      <IconButton label={repeat === "off" ? "Enable repeat" : repeat === "all" ? "Enable repeat one" : "Disable repeat"} active={repeat !== "off"} onClick={() => st().cycleRepeat()}>
        <RepeatIcon one={repeat === "one"} size={big ? 26 : 16} />
      </IconButton>
    </div>
  );
}

/** Horizontally scrolling text for long titles (pauses at both ends). */
export function Marquee({ text, className = "" }: { text: string; className?: string }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    if (!el) return;
    const measure = () => setOverflow(Math.max(0, el.scrollWidth - el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, text]);
  return (
    <div ref={setEl} className={`overflow-hidden whitespace-nowrap ${className}`}>
      <span
        className="inline-block"
        style={
          overflow > 0
            ? { animation: `marquee ${Math.max(6, overflow / 20)}s ease-in-out 1.5s infinite alternate`, ["--marquee-x" as string]: `-${overflow + 8}px` }
            : undefined
        }
      >
        {text}
      </span>
      <style>{`@keyframes marquee { 0%, 15% { transform: translateX(0) } 85%, 100% { transform: translateX(var(--marquee-x)) } }`}</style>
    </div>
  );
}
