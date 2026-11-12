"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/**
 * A small per-device preference kept in localStorage (e.g. list vs grid in the library).
 * The server snapshot is the default, so prerendered pages hydrate without a mismatch.
 */
export function useLocalSetting<T extends string>(key: string, fallback: T): [T, (next: T) => void] {
  const read = useCallback(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback]);
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, next);
      } catch {
        /* ignore */
      }
      for (const fn of listeners) fn();
    },
    [key],
  );
  return [value, set];
}
