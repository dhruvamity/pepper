export type JamRepeat = "off" | "all" | "one";

export interface JamMember {
  uid: string;
  name: string;
}

export interface JamTrack {
  key: string;
  id: string;
  durationMs: number;
  addedBy: string;
  addedByName: string;
}

export interface JamPlayback {
  track: JamTrack | null;
  positionMs: number;
  anchoredAt: number;
  playing: boolean;
  sequence: number;
  reason: "play" | "next" | "prev" | "jump" | "ended";
}

export interface Jam {
  id: string;
  hostUid: string;
  members: JamMember[];
  queue: JamTrack[];
  playback: JamPlayback;
  guestsControlPlayback: boolean;
  guestsControlVolume: boolean;
  volume: number;
  repeat: JamRepeat;
  shuffle: boolean;
  version: number;
  expiresAt: number;
}

export interface JamDocument extends Jam {
  history: JamTrack[];
  removed: string[];
  closed: boolean;
}

export interface JamSnapshot {
  jam: Jam | null;
  serverTime: number;
}

export function jamPosition(playback: JamPlayback, serverTime: number) {
  const elapsed = playback.playing ? Math.max(0, serverTime - playback.anchoredAt) : 0;
  return Math.min(playback.track?.durationMs ?? 0, playback.positionMs + elapsed);
}
