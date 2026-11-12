"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/client/auth";
import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";

export function ListeningActivityPublisher() {
  const { status } = useAuth();
  const { data: me } = useMe();
  const uid = status === "signedIn" ? me?.user.uid : undefined;
  const enabled = Boolean(me?.user.activitySharing);

  useEffect(() => {
    if (!uid || !enabled) {
      if (uid) api("/api/listening-activity", { method: "DELETE" }).catch(() => {});
      return;
    }
    // Only a tab that has actually been playing clears the shared status: an idle tab must not
    // erase what another device (or a just-finished session) reported.
    let announced = false;
    const publish = () => {
      const state = usePlayer.getState();
      if (!state.currentId && !announced) return;
      announced = Boolean(state.currentId);
      api("/api/listening-activity", {
        body: { trackId: state.currentId, playing: state.playing, positionMs: Math.floor(state.position) },
        keepalive: true,
      }).catch(() => {});
    };
    publish();
    const unsubscribe = usePlayer.subscribe((next, previous) => {
      if (next.currentId !== previous.currentId || next.playing !== previous.playing) publish();
    });
    const timer = setInterval(publish, 20_000);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [uid, enabled]);

  return null;
}
