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
