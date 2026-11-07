"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { GripVertical, Users } from "lucide-react";
import { useCatalog } from "@/lib/client/catalog";
import { setJamOpen, useJam } from "@/lib/client/jam";
import { upcomingFromContext, usePlayer, type UpcomingItem } from "@/lib/client/player/store";
import type { CatalogTrack } from "@/lib/types";
import { CloseIcon, Equalizer, NextIcon } from "../icons";
import { Cover } from "../ui/cover";

interface Entry {
  key: string;
  item: UpcomingItem;
  track: CatalogTrack;
  play(): void;
  addedBy?: string;
}

function Track({ track, playing, addedBy }: { track: CatalogTrack; playing?: boolean; addedBy?: string }) {
  return (
    <>
      <Cover image={track.cover} className="h-11 w-11 shrink-0" />
      <span className="min-w-0">
        <span className={`flex items-center gap-2 text-[15px] ${playing === undefined ? "text-white" : "text-accent"}`}>
          {playing !== undefined && <Equalizer playing={playing} />}
          <span className="truncate">{track.title}</span>
        </span>
        <span className="block truncate text-[13px] text-subdued">{track.artists.map((a) => a.name).join(", ")}{addedBy && ` · Added by ${addedBy}`}</span>
      </span>
    </>
  );
}

const actionClass = "flex h-10 w-9 shrink-0 items-center justify-center rounded text-subdued hover:bg-white/10 hover:text-white";

export function QueuePanel() {
  const view = usePlayer((s) => s.view);
  const playing = usePlayer((s) => s.playing);
  const currentId = usePlayer((s) => s.currentId);
  const upNext = usePlayer((s) => s.upNext);
  const order = usePlayer((s) => s.order);
  const pos = usePlayer((s) => s.pos);
  const context = usePlayer((s) => s.context);
  const prefetch = usePlayer((s) => s.prefetch);
  const autoplay = usePlayer((s) => s.autoplay);
  const { catalog } = useCatalog();
  const jam = useJam((s) => s.room);
  const uid = useJam((s) => s.uid);
  const canControl = !jam || jam.hostUid === uid || jam.guestsControlPlayback;
  const scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<{ entry: Entry; x: number; y: number; frame: number } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => () => {
    if (drag.current) cancelAnimationFrame(drag.current.frame);
    drag.current = null;
  }, [view]);
  if (view !== "queue") return null;

  const st = usePlayer.getState;
  const current = currentId ? catalog?.byId.get(currentId) : undefined;
  const upcoming = upcomingFromContext({ order, pos }, order.length);
  const autoNext = autoplay && !upNext.length && !upcoming.length && prefetch?.after === currentId ? prefetch.ids : [];
  function entry(key: string, id: string, item: UpcomingItem, play: () => void): Entry[] {
    const track = catalog?.byId.get(id);
    return track ? [{ key, item, track, play, addedBy: jamQueue.get(key) }] : [];
  }
  const jamQueue = new Map(jam?.queue.map((track) => [track.key, track.addedByName]));
  const queued = upNext.flatMap((q) => entry(q.key, q.id, { kind: "queue", key: q.key }, () => st().jumpToQueue(q.key)));
  const contextual = upcoming.flatMap(({ index, id }) =>
    entry(`context-${index}-${id}`, id, { kind: "context", index, id }, () => st().jumpToContext(index)),
  );
  const suggested = autoNext.flatMap((id, index) =>
    entry(`auto-${id}-${index}`, id, { kind: "autoplay", index, id }, () => {
      usePlayer.setState({ lastAction: "jump" });
      st().appendAutoplay(autoNext.slice(index), true);
    }),
  );
  const entries = [...queued, ...contextual, ...suggested];
  const targetKey = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-queue-entry]")?.dataset.queueEntry;
  function startDrag(event: PointerEvent<HTMLButtonElement>, item: Entry) {
    if (event.button !== 0 || drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const tick = () => {
      const active = drag.current;
      const list = scroll.current;
      if (!active || !list) return;
      const { top, bottom, left, right } = list.getBoundingClientRect();
      if (active.x >= left && active.x <= right) {
        if (active.y < top + 44 && active.y >= top - 16) list.scrollTop -= 9;
        if (active.y > bottom - 44 && active.y <= bottom + 16) list.scrollTop += 9;
      }
      setTarget(targetKey(active.x, active.y) ?? null);
      active.frame = requestAnimationFrame(tick);
    };
    drag.current = { entry: item, x: event.clientX, y: event.clientY, frame: requestAnimationFrame(tick) };
  }

  function stopDrag(event?: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active) return;
    cancelAnimationFrame(active.frame);
    drag.current = null;
    setTarget(null);
    if (!event) return;
    const key = targetKey(event.clientX, event.clientY);
    const drop = entries.find((item) => item.key === key);
    if (drop) st().moveUpcoming(active.entry.item, drop.item);
  }

  function rows(items: Entry[]) {
    return items.map((item) => (
      <div key={item.key} data-queue-entry={item.key} className={`flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-white/5 ${target === item.key ? "bg-accent/15 ring-1 ring-inset ring-accent" : ""}`}>
        <button type="button" onClick={item.play} disabled={!canControl} title="Play this song" className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Track track={item.track} addedBy={item.addedBy} />
        </button>
        {canControl && <button type="button" onClick={() => st().skipUpcoming(item.item)} title="Skip this queued song" aria-label={`Skip ${item.track.title} in queue`} className={actionClass}>
          <CloseIcon size={16} />
        </button>}
        {canControl && <button
          type="button"
          aria-label={`Reorder ${item.track.title}`}
          title="Drag to reorder or use the Up and Down arrow keys"
          className={`${actionClass} touch-none cursor-grab select-none active:cursor-grabbing`}
          onPointerDown={(event) => startDrag(event, item)}
          onPointerMove={(event) => {
            if (drag.current) {
              drag.current.x = event.clientX;
              drag.current.y = event.clientY;
            }
          }}
          onPointerUp={stopDrag}
          onPointerCancel={() => stopDrag()}
          onLostPointerCapture={() => stopDrag()}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const next = entries[entries.indexOf(item) + (event.key === "ArrowUp" ? -1 : 1)];
            if (next) {
              st().moveUpcoming(item.item, next.item);
              const name = event.currentTarget.getAttribute("aria-label");
              requestAnimationFrame(() => {
                const buttons = [...(scroll.current?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])];
                buttons.find((button) => button.getAttribute("aria-label") === name)?.focus();
              });
            }
          }}
        >
          <GripVertical size={18} />
        </button>}
      </div>
    ));
  }

  return (
    <div className="fixed inset-0 z-[65] flex justify-end md:bottom-[var(--player-bar-h)] md:top-2" role="dialog" aria-label="Queue">
      <button type="button" aria-label="Close queue" className="absolute inset-0 hidden bg-transparent md:block" onClick={() => st().setView("none")} />
      <div className="relative flex h-full w-full animate-slide-up flex-col bg-surface md:mr-2 md:w-[380px] md:animate-fade-in md:rounded-lg md:shadow-float">
        <div className="flex items-center justify-between px-4 pb-2 pt-[max(16px,env(safe-area-inset-top))] md:pt-4">
          <h2 className="flex flex-1 items-center gap-3 text-lg font-bold">{jam ? "Jam queue" : "Queue"}
            {jam && <button type="button" aria-label="Jam details" className={actionClass} onClick={() => setJamOpen(true)}><Users size={18} /></button>}
          </h2>
          <button type="button" onClick={() => st().setView("none")} aria-label="Close" className={actionClass}>
            <CloseIcon size={18} />
          </button>
        </div>
        <div ref={scroll} className="scroll-area flex-1 overflow-y-auto px-2 pb-8">
          {current && (
            <>
              <h3 className="px-2 pb-2 pt-2 text-base font-bold">Now playing</h3>
              <div className="flex items-center gap-3 px-2 py-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-3"><Track track={current} playing={playing} /></div>
                {canControl && <button type="button" onClick={() => st().next()} title="Skip to next song" aria-label="Skip to next song" className={actionClass}>
                  <NextIcon size={18} />
                </button>}
              </div>
            </>
          )}
          {queued.length > 0 && (
            <>
              <div className="flex items-center justify-between px-2 pb-2 pt-6">
                <h3 className="text-base font-bold">Next in queue</h3>
                {canControl && <button type="button" onClick={() => st().clearQueue()} className="text-sm font-bold text-subdued hover:text-white">
                  Clear queue
                </button>}
              </div>
              {rows(queued)}
            </>
          )}
          {contextual.length > 0 && (
            <>
              <h3 className="px-2 pb-2 pt-6 text-base font-bold">
                Next from: <span className="text-subdued">{context?.name ?? "your queue"}</span>
              </h3>
              {rows(contextual)}
            </>
          )}
          {suggested.length > 0 && (
            <>
              <h3 className="px-2 pb-1 pt-6 text-base font-bold">Next: similar songs</h3>
              <p className="px-2 pb-2 text-[13px] text-subdued">Autoplay picks songs like this one</p>
              {rows(suggested)}
            </>
          )}
          {!entries.length && (
            <p className="px-4 pt-8 text-center text-sm text-subdued">
              {!current ? "Your queue is empty. Play something!" : !jam && autoplay && !prefetch ? "Autoplay will keep the music going with similar songs." : "Nothing queued after this song."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
