"use client";

import { useCatalog } from "@/lib/client/catalog";
import { upcomingFromContext, usePlayer } from "@/lib/client/player/store";
import type { CatalogTrack } from "@/lib/types";
import { CloseIcon, Equalizer } from "../icons";
import { Cover } from "../ui/cover";

function Row({ t, active, onClick, onRemove }: { t: CatalogTrack; active?: boolean; onClick?: () => void; onRemove?: () => void }) {
  const playing = usePlayer((s) => s.playing);
  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-white/10">
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Cover image={t.cover} className="h-11 w-11 shrink-0" />
        <div className="min-w-0">
          <div className={`flex items-center gap-2 truncate text-[15px] ${active ? "text-accent" : "text-white"}`}>
            {active && <Equalizer playing={playing} />}
            <span className="truncate">{t.title}</span>
          </div>
          <div className="truncate text-[13px] text-subdued">{t.artists.map((a) => a.name).join(", ")}</div>
        </div>
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${t.title} from queue`} className="p-2 text-subdued hover:text-white md:opacity-0 md:group-hover:opacity-100">
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
}

export function QueuePanel() {
  const view = usePlayer((s) => s.view);
  const currentId = usePlayer((s) => s.currentId);
  const upNext = usePlayer((s) => s.upNext);
  const order = usePlayer((s) => s.order);
  const pos = usePlayer((s) => s.pos);
  const context = usePlayer((s) => s.context);
  const prefetch = usePlayer((s) => s.prefetch);
  const autoplay = usePlayer((s) => s.autoplay);
  const { catalog } = useCatalog();
  if (view !== "queue") return null;
  const st = usePlayer.getState;
  const current = currentId ? catalog?.byId.get(currentId) : undefined;
  const upcoming = upcomingFromContext({ order, pos }, 80);
  // Autoplay songs already picked for after this one (shown like Spotify's "Autoplay" section).
  const autoNext = autoplay && !upNext.length && !upcoming.length && prefetch?.after === currentId ? prefetch.ids.slice(0, 30) : [];

  return (
    <div className="fixed inset-0 z-[65] flex justify-end md:bottom-[var(--player-bar-h)] md:top-2" role="dialog" aria-label="Queue">
      <button type="button" aria-label="Close queue" className="absolute inset-0 hidden bg-transparent md:block" onClick={() => st().setView("none")} />
      <div className="relative flex h-full w-full animate-slide-up flex-col bg-surface md:mr-2 md:w-[380px] md:animate-fade-in md:rounded-lg md:shadow-float">
        <div className="flex items-center justify-between px-4 pb-2 pt-[max(16px,env(safe-area-inset-top))] md:pt-4">
          <h2 className="text-lg font-bold">Queue</h2>
          <button type="button" onClick={() => st().setView("none")} aria-label="Close" className="p-2 text-subdued hover:text-white">
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="scroll-area flex-1 overflow-y-auto px-2 pb-8">
          {current && (
            <>
              <h3 className="px-2 pb-2 pt-2 text-base font-bold">Now playing</h3>
              <Row t={current} active />
            </>
          )}
          {upNext.length > 0 && (
            <>
              <div className="flex items-center justify-between px-2 pb-2 pt-6">
                <h3 className="text-base font-bold">Next in queue</h3>
                <button type="button" onClick={() => st().clearQueue()} className="text-sm font-bold text-subdued hover:text-white">
                  Clear queue
                </button>
              </div>
              {upNext.map((q) => {
                const t = catalog?.byId.get(q.id);
                return t ? <Row key={q.key} t={t} onClick={() => st().jumpToQueue(q.key)} onRemove={() => st().removeFromQueue(q.key)} /> : null;
              })}
            </>
          )}
          {upcoming.length > 0 && (
            <>
              <h3 className="px-2 pb-2 pt-6 text-base font-bold">
                Next from: <span className="text-subdued">{context?.name ?? "your queue"}</span>
              </h3>
              {upcoming.map((u) => {
                const t = catalog?.byId.get(u.id);
                return t ? <Row key={`${u.index}-${u.id}`} t={t} onClick={() => st().jumpToContext(u.index)} /> : null;
              })}
            </>
          )}
          {autoNext.length > 0 && (
            <>
              <h3 className="px-2 pb-1 pt-6 text-base font-bold">Next: similar songs</h3>
              <p className="px-2 pb-2 text-[13px] text-subdued">Autoplay picks songs like this one</p>
              {autoNext.map((id, i) => {
                const t = catalog?.byId.get(id);
                return t ? (
                  <Row
                    key={id}
                    t={t}
                    onClick={() => {
                      usePlayer.setState({ lastAction: "jump" });
                      st().appendAutoplay(autoNext.slice(i), true);
                    }}
                  />
                ) : null;
              })}
            </>
          )}
          {!current && !upNext.length && <p className="px-4 pt-10 text-center text-subdued">Your queue is empty. Play something!</p>}
          {current && !upNext.length && !upcoming.length && !autoNext.length && (
            <p className="px-4 pt-8 text-center text-sm text-subdued">
              {usePlayer.getState().autoplay ? "Autoplay will keep the music going with similar songs." : "Nothing queued after this song."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
