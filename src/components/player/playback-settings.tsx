"use client";

import { Moon } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { usePlayer } from "@/lib/client/player/store";
import { useUI } from "@/lib/client/ui";
import { formatDuration } from "@/lib/util";
import { RadioIcon } from "../icons";
import { Sheet } from "../ui/sheet";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEP = [15, 30, 45, 60] as const;

function Row({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{title}</div>
        {body && <div className="text-xs text-subdued">{body}</div>}
      </div>
      {children}
    </div>
  );
}

/** Live countdown for the sleep timer in whole seconds (null when off). */
export function useSleepRemaining() {
  const sleepAt = usePlayer((s) => s.sleepAt);
  const subscribe = useCallback((onChange: () => void) => {
    if (sleepAt === null) return () => {};
    const timer = setInterval(onChange, 1000);
    return () => clearInterval(timer);
  }, [sleepAt]);
  const snapshot = useCallback(() => (sleepAt === null ? null : Math.max(0, Math.ceil((sleepAt - Date.now()) / 1000))), [sleepAt]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Autoplay, crossfade, loudness normalisation, playback speed and the sleep timer. */
export function PlaybackSettingsSheet() {
  const open = useUI((s) => s.playbackSettingsOpen);
  const setOpen = useUI((s) => s.setPlaybackSettingsOpen);
  const autoplay = usePlayer((s) => s.autoplay);
  const crossfade = usePlayer((s) => s.crossfade);
  const normalize = usePlayer((s) => s.normalize);
  const speed = usePlayer((s) => s.speed);
  const sleepAfterTrack = usePlayer((s) => s.sleepAfterTrack);
  const remaining = useSleepRemaining();
  const st = usePlayer.getState;
  return (
    <Sheet open={open} onClose={() => setOpen(false)} label="Playback settings">
      <h2 className="px-5 pb-1 pt-5 text-xl font-bold">Playback</h2>
      <div className="py-2">
        <Row title="Autoplay" body="Keep playing similar songs when your music ends">
          <span className="flex w-6 justify-center text-subdued"><RadioIcon /></span>
          <input type="checkbox" aria-label="Autoplay" className="h-5 w-5 accent-[#1ed760]" checked={autoplay} onChange={(e) => st().setAutoplay(e.target.checked)} />
        </Row>
        <div className="px-5 py-3">
          <div className="text-[15px] font-medium">Crossfade</div>
          <div className="text-xs text-subdued">{crossfade ? `${crossfade} s overlap between songs` : "Off: songs hand over without a gap"}</div>
          <input type="range" aria-label="Crossfade seconds" min={0} max={12} step={1} value={crossfade} onChange={(e) => st().setCrossfade(e.target.valueAsNumber)} className="range mt-2 w-full max-w-xs always-thumb" style={{ "--pct": `${(crossfade / 12) * 100}%` } as React.CSSProperties} />
        </div>
        <Row title="Normalise volume" body="Even out loud and quiet songs (uses each song's analysed loudness)">
          <input type="checkbox" aria-label="Normalise volume" className="h-5 w-5 accent-[#1ed760]" checked={normalize} onChange={(e) => st().setNormalize(e.target.checked)} />
        </Row>
        <Row title="Speed" body="Pitch stays the same">
          <div className="flex gap-1" role="radiogroup" aria-label="Playback speed">
            {SPEEDS.map((rate) => (
              <button key={rate} type="button" role="radio" aria-checked={speed === rate} onClick={() => st().setSpeed(rate)} className={`rounded-full px-2.5 py-1 text-xs font-bold ${speed === rate ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"}`}>
                {rate}×
              </button>
            ))}
          </div>
        </Row>
        <div className="px-5 py-3">
          <div className="flex items-center gap-2 text-[15px] font-medium"><Moon size={18} className="text-subdued" /> Sleep timer</div>
          <div className="mt-1 text-xs text-subdued" aria-live="polite">
            {remaining !== null ? `Pausing in ${formatDuration(remaining * 1000)}` : sleepAfterTrack ? "Pausing when this song ends" : "Off"}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SLEEP.map((minutes) => (
              <button key={minutes} type="button" onClick={() => st().setSleep(minutes)} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20">{minutes} min</button>
            ))}
            <button type="button" aria-pressed={sleepAfterTrack} onClick={() => st().setSleep("track")} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${sleepAfterTrack ? "bg-white text-black" : "bg-white/10 hover:bg-white/20"}`}>End of song</button>
            {(remaining !== null || sleepAfterTrack) && (
              <button type="button" onClick={() => st().setSleep(null)} className="rounded-full px-3 py-1.5 text-sm font-semibold text-subdued hover:text-white">Turn off</button>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["⌘ / Ctrl + →", "Next song"],
  ["⌘ / Ctrl + ←", "Previous song"],
  ["Shift + →", "Seek forward 10 s"],
  ["Shift + ←", "Seek back 10 s"],
  ["M", "Mute / unmute"],
  ["Esc", "Close the player or a sheet"],
  ["?", "Show this list"],
];

export function ShortcutsSheet() {
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcutsOpen);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} label="Keyboard shortcuts">
      <h2 className="px-5 pb-2 pt-5 text-xl font-bold">Keyboard shortcuts</h2>
      <dl className="px-5 pb-4">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="flex items-center justify-between gap-4 border-b border-white/10 py-2.5 text-sm last:border-0">
            <dt className="text-subdued">{what}</dt>
            <dd><kbd className="rounded bg-white/10 px-2 py-1 font-mono text-xs">{keys}</kbd></dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
