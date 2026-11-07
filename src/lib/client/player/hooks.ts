"use client";

import { useCatalog } from "../catalog";
import { usePlayer, type PlayContext } from "./store";

export function isCollectionCurrent(s: Pick<ReturnType<typeof usePlayer.getState>, "context" | "currentFrom" | "currentId">, ctx: PlayContext, ids: string[]) {
  return s.context?.type === ctx.type && (s.context?.id ?? "") === (ctx.id ?? "")
    && s.currentFrom === "context" && s.currentId !== null && ids.includes(s.currentId);
}

/** Play / pause state for a collection (album, playlist, mix…) shown on screen. */
export function useCollectionPlayback(ctx: PlayContext, ids: string[]) {
  const { catalog } = useCatalog();
  const available = catalog ? ids.filter((id) => catalog.byId.has(id)) : [];
  const isCurrent = usePlayer((s) => isCollectionCurrent(s, ctx, available));
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  return {
    isCurrent,
    isPlaying: isCurrent && playing,
    shuffle,
    toggle() {
      const st = usePlayer.getState();
      if (isCollectionCurrent(st, ctx, available)) st.toggle();
      else st.playList(available, 0, ctx, { randomStart: true });
    },
    playAt(id: string) {
      const st = usePlayer.getState();
      if (st.currentId === id && isCollectionCurrent(st, ctx, available)) st.toggle();
      else if (available.includes(id)) st.playList(available, id, ctx);
    },
  };
}

export function useIsCurrentTrack(id: string) {
  return usePlayer((s) => s.currentId === id);
}
