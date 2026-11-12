import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let store: typeof import("@/lib/client/player/store");
beforeAll(async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  store = await import("@/lib/client/player/store");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  store.usePlayer.getState().stop();
  store.usePlayer.setState({ shuffle: false, repeat: "off", autoplay: false, sleepAt: null, sleepAfterTrack: false, crossfade: 0, speed: 1 });
});

describe("what plays next (crossfade and queue saving)", () => {
  it("prefers the manual queue, then the context, then prefetched autoplay", () => {
    const { usePlayer, nextTrackId, queueTrackIds } = store;
    usePlayer.getState().playList(["a", "b", "c"]);
    expect(nextTrackId(usePlayer.getState())).toBe("b");
    usePlayer.getState().addToQueue(["x"]);
    expect(nextTrackId(usePlayer.getState())).toBe("x");
    expect(queueTrackIds(usePlayer.getState())).toEqual(["a", "x", "b", "c"]);
    usePlayer.getState().clearQueue();
    usePlayer.getState().next();
    usePlayer.getState().next();
    expect(nextTrackId(usePlayer.getState())).toBeNull();
    usePlayer.setState({ prefetch: { after: "c", ids: ["r1", "r2"] } });
    expect(nextTrackId(usePlayer.getState())).toBe("r1");
    expect(queueTrackIds(usePlayer.getState())).toEqual(["c", "r1", "r2"]);
  });

  it("matches next() for repeat-all without shuffle", () => {
    const { usePlayer, nextTrackId } = store;
    usePlayer.getState().playList(["a", "b"]);
    usePlayer.setState({ repeat: "all" });
    usePlayer.getState().next();
    expect(nextTrackId(usePlayer.getState())).toBe("a");
    usePlayer.getState().next();
    expect(usePlayer.getState().currentId).toBe("a");
  });
});

describe("sleep timer and playback settings", () => {
  it("pauses at the end of the song instead of advancing", () => {
    const { usePlayer } = store;
    usePlayer.getState().playList(["a", "b"]);
    usePlayer.getState().setSleep("track");
    expect(usePlayer.getState().sleepAfterTrack).toBe(true);
    usePlayer.getState().ended();
    expect(usePlayer.getState().currentId).toBe("a");
    expect(usePlayer.getState().playing).toBe(false);
    expect(usePlayer.getState().sleepAfterTrack).toBe(false);
  });

  it("schedules a timed sleep and clears it", () => {
    const { usePlayer } = store;
    const before = Date.now();
    usePlayer.getState().setSleep(30);
    expect(usePlayer.getState().sleepAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    usePlayer.getState().setSleep(null);
    expect(usePlayer.getState().sleepAt).toBeNull();
  });

  it("clamps crossfade and speed to sensible ranges", () => {
    const { usePlayer } = store;
    usePlayer.getState().setCrossfade(40);
    expect(usePlayer.getState().crossfade).toBe(12);
    usePlayer.getState().setCrossfade(-3);
    expect(usePlayer.getState().crossfade).toBe(0);
    usePlayer.getState().setSpeed(5);
    expect(usePlayer.getState().speed).toBe(2);
    usePlayer.getState().setSpeed(0.1);
    expect(usePlayer.getState().speed).toBe(0.5);
  });
});
