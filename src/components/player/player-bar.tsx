"use client";

import Link from "next/link";
import { useCatalog } from "@/lib/client/catalog";
import { useLibraryActions } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";
import { HeartIcon, LyricsIcon, QueueIcon, VolumeIcon } from "../icons";
import { Cover } from "../ui/cover";
import { IconButton } from "../ui/play-button";
import { ArtistLinks } from "../ui/track-row";
import { SeekBar, TransportControls } from "./controls";

/** Desktop "Now playing" bar along the bottom (Figma: 90px bar with controls & volume). */
export function PlayerBar() {
  const { catalog } = useCatalog();
  const id = usePlayer((s) => s.currentId);
  const view = usePlayer((s) => s.view);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const { isLiked, toggleLike } = useLibraryActions();
  const t = id ? catalog?.byId.get(id) : undefined;
  const st = usePlayer.getState;

  return (
    <div className="hidden h-[var(--player-bar-h)] grid-cols-[minmax(180px,1fr)_minmax(320px,2fr)_minmax(180px,1fr)] items-center gap-4 bg-black px-4 md:grid">
      <div className="flex min-w-0 items-center gap-3">
        {t ? (
          <>
            <button type="button" onClick={() => st().setView("now")} aria-label="Open now playing" className="shrink-0">
              <Cover image={t.cover} className="h-14 w-14" />
            </button>
            <div className="min-w-0">
              <Link href={`/album/${t.album.id}`} className="block truncate text-sm font-semibold text-white hover:underline">
                {t.title}
              </Link>
              <ArtistLinks artists={t.artists} className="block truncate text-xs text-subdued" />
            </div>
            <IconButton label={isLiked(t.id) ? "Remove from Liked Songs" : "Save to Liked Songs"} active={false} onClick={() => toggleLike(t.id)} className={isLiked(t.id) ? "text-accent!" : ""}>
              <HeartIcon filled={isLiked(t.id)} size={16} />
            </IconButton>
          </>
        ) : (
          <span className="text-sm text-subdued">Pick something to play</span>
        )}
      </div>
      <div className="flex max-w-[720px] flex-col items-center gap-1 justify-self-center sm:w-full">
        <TransportControls />
        <SeekBar compact />
      </div>
      <div className="flex items-center justify-end gap-3">
        <IconButton label="Lyrics & now playing" active={view === "now"} onClick={() => st().setView(view === "now" ? "none" : "now")} disabled={!t}>
          <LyricsIcon size={16} />
        </IconButton>
        <IconButton label="Queue" active={view === "queue"} onClick={() => st().setView(view === "queue" ? "none" : "queue")}>
          <QueueIcon size={16} />
        </IconButton>
        <IconButton label={muted ? "Unmute" : "Mute"} onClick={() => st().toggleMute()}>
          <VolumeIcon size={16} level={muted ? 0 : volume} />
        </IconButton>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => {
            st().setVolume(Number(e.target.value));
            if (muted) usePlayer.setState({ muted: false });
          }}
          className="range w-24"
          style={{ "--pct": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
