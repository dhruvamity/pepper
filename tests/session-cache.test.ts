import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { persistentCache, saveSessionHint } from "@/lib/client/persist";

const entries = new Map<string, string>();
beforeEach(() => {
  entries.clear();
  vi.useFakeTimers();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  }, addEventListener: () => {} });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("never persists a late response from the previous account under the next account", () => {
  saveSessionHint({ uid: "first", name: "First" });
  const first = persistentCache("first");
  first.set("/api/me", { data: { private: "first" } });
  saveSessionHint({ uid: "second", name: "Second" });
  vi.advanceTimersByTime(2000);
  expect(persistentCache("second").get("/api/me")).toBeUndefined();
  const second = persistentCache("second");
  second.set("/api/me", { data: { private: "second" } });
  vi.advanceTimersByTime(2000);
  expect(persistentCache("second").get("/api/me")?.data).toEqual({ private: "second" });
});
