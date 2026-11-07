import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let player: typeof import("@/lib/client/player/store").usePlayer;
beforeAll(async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  player = (await import("@/lib/client/player/store")).usePlayer;
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  player.getState().stop();
  player.setState({ shuffle: false, repeat: "off", autoplay: false });
});

describe("reordering the player queue", () => {
  it("reorders future context tracks and skips only the chosen occurrence", () => {
    player.getState().playList(["a", "b", "c", "b"]);
    player.getState().moveUpcoming({ kind: "context", id: "c", index: 2 }, { kind: "context", id: "b", index: 1 });
    player.getState().skipUpcoming({ kind: "context", id: "b", index: 2 });
    expect(player.getState().order).toEqual(["a", "c", "b"]);
    player.getState().next();
    expect(player.getState().currentId).toBe("c");
  });

  it("moves manual entries across the upcoming playlist without replaying earlier songs", () => {
    player.getState().playList(["a", "b", "c", "d"]);
    player.getState().addToQueue(["x", "y"]);
    const [x] = player.getState().upNext;
    player.getState().moveUpcoming({ kind: "queue", key: x.key }, { kind: "context", index: 2, id: "c" });
    expect(player.getState().upNext.map((q) => q.id)).toEqual(["y", "b", "c", "x"]);
    expect(player.getState().order).toEqual(["a", "d"]);
  });

  it("preserves reordered autoplay suggestions until the next song starts", () => {
    player.getState().playList(["a"]);
    player.setState({ autoplay: true, prefetch: { after: "a", ids: ["b", "c", "d"] } });
    player.getState().moveUpcoming({ kind: "autoplay", id: "d", index: 2 }, { kind: "autoplay", id: "b", index: 0 });
    player.getState().skipUpcoming({ kind: "autoplay", id: "c", index: 2 });
    player.getState().next();
    expect(player.getState().currentId).toBe("d");
    expect(player.getState().order).toEqual(["a", "d", "b"]);
  });
});

describe("playback transitions", () => {
  it("selects a different playlist instead of resuming the previous track", () => {
    player.getState().playList(["a", "b"], 1, { type: "playlist", id: "first" });
    player.getState().seek(12000);
    player.getState().setPlaying(false);
    player.getState().playList(["x", "y"], 0, { type: "playlist", id: "second" });
    expect(player.getState()).toMatchObject({ currentId: "x", position: 0, playing: true, seekTo: null, context: { id: "second" } });
    player.getState().next();
    expect(player.getState().currentId).toBe("y");
  });

  it("cancels pending autoplay and seeks when stopped or another track is selected", () => {
    player.getState().playList(["a", "b"]);
    player.setState({ needsAutoplay: true, seekTo: 10000, buffering: true });
    player.getState().jumpToContext(1);
    expect(player.getState()).toMatchObject({ currentId: "b", needsAutoplay: false, seekTo: null });
    player.setState({ needsAutoplay: true, seekTo: 10000 });
    player.getState().stop();
    expect(player.getState()).toMatchObject({ needsAutoplay: false, seekTo: null, buffering: false, currentId: null });
  });

  it("keeps duplicate occurrences when shuffle is toggled", () => {
    player.getState().playList(["a", "b", "a"]);
    player.getState().setShuffle(true);
    expect(player.getState().order.filter((id) => id === "a")).toHaveLength(2);
    player.getState().setShuffle(false);
    expect(player.getState().order).toEqual(["a", "b", "a"]);
  });

  it("restores the current position in playlists longer than 1,000 songs", () => {
    const ids = Array.from({ length: 1700 }, (_, i) => `t${i}`);
    player.getState().playList(ids, 1500);
    const saved = player.persist.getOptions().partialize!(player.getState()) as { order: string[]; pos: number; currentId: string };
    expect(saved.order[saved.pos]).toBe(saved.currentId);
    expect(saved.order.slice(saved.pos + 1)).toHaveLength(199);
  });
});
