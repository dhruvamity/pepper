"use client";

/**
 * Instant start: remembers who was signed in and the last answers of the few requests every
 * screen needs (profile, catalog, home, popularity), so a returning listener sees the app
 * immediately while fresh data loads in the background. Everything is per account, best
 * effort (private windows or a full quota just skip it) and wiped on sign-out.
 */
import type { Cache, State } from "swr";

const SESSION_KEY = "pepper.session";
const PREFIX = "pepper.cache:";
/** Requests worth keeping across visits (exact SWR keys). */
const PERSISTED = new Set(["/api/me", "/api/catalog", "/api/home", "/api/popularity"]);

export interface SessionHint {
  uid: string;
  name: string;
  email?: string;
  photoURL?: string;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSessionHint(): SessionHint | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    const v = raw ? (JSON.parse(raw) as SessionHint) : null;
    return v?.uid ? v : null;
  } catch {
    return null;
  }
}

export function saveSessionHint(user: SessionHint) {
  try {
    const prev = readSessionHint();
    // A different account on this browser: forget the previous account's data.
    if (prev && prev.uid !== user.uid) clearPersisted();
    storage()?.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

/** Forget the signed-in account and its saved data (sign-out). */
export function clearSession() {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  clearPersisted();
}

function clearPersisted() {
  const s = storage();
  if (!s) return;
  try {
    for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) s.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * SWR cache that starts from the saved answers of the current account and saves new answers
 * of the persisted requests (debounced, so a burst of updates writes once).
 */
export function persistentCache(): Cache {
  const map = new Map<string, State>();
  const s = storage();
  const uid = readSessionHint()?.uid;
  if (s && uid) {
    for (const key of PERSISTED) {
      try {
        const raw = s.getItem(PREFIX + key);
        if (!raw) continue;
        const saved = JSON.parse(raw) as { uid: string; data: unknown };
        if (saved.uid === uid) map.set(key, { data: saved.data });
      } catch {
        /* ignore a corrupt entry */
      }
    }
  }
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const owner = readSessionHint()?.uid;
    if (!s || !owner) return dirty.clear();
    for (const key of dirty) {
      const data = map.get(key)?.data;
      try {
        if (data === undefined) s.removeItem(PREFIX + key);
        else s.setItem(PREFIX + key, JSON.stringify({ uid: owner, data }));
      } catch {
        // Quota full: drop this entry rather than keep a stale one.
        try {
          s.removeItem(PREFIX + key);
        } catch {
          /* ignore */
        }
      }
    }
    dirty.clear();
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", () => timer && (clearTimeout(timer), flush()));

  return {
    keys: () => map.keys(),
    get: (key) => map.get(key),
    set: (key, value) => {
      const before = map.get(key)?.data;
      map.set(key, value);
      if (PERSISTED.has(key) && value.data !== undefined && value.data !== before) {
        dirty.add(key);
        timer ??= setTimeout(flush, 1500);
      }
    },
    delete: (key) => {
      map.delete(key);
      if (PERSISTED.has(key)) {
        dirty.add(key);
        timer ??= setTimeout(flush, 1500);
      }
    },
  };
}
