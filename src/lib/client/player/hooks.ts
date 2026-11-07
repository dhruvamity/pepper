"use client";

import { usePlayer, type PlayContext } from "./store";

/** Play / pause state for a collection (album, playlist, mix…) shown on screen. */
export function useCollectionPlayback(ctx: PlayContext, ids: string[]) {
  const isCurrent = usePlayer((s) => s.context?.type === ctx.type && (s.context?.id ?? "") === (ctx.id ?? "") && s.currentFrom === "context");
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  return {
    isCurrent,
    isPlaying: isCurrent && playing,
    shuffle,
    toggle() {
      const st = usePlayer.getState();
      if (isCurrent && st.currentId) st.toggle();
      else st.playList(ids, 0, ctx, { randomStart: true });
    },
    playAt(id: string) {
      const st = usePlayer.getState();
      if (st.currentId === id && isCurrent) st.toggle();
      else st.playList(ids, id, ctx);
    },
  };
}

export function useIsCurrentTrack(id: string) {
  return usePlayer((s) => s.currentId === id);
}
