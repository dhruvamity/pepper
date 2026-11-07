/** Isomorphic helpers (safe for server, browser and tests). */
import type { MediaRef } from "./types";

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function fold(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`"“”]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** URL/ID friendly slug that keeps non-Latin letters (e.g. Devanagari). */
export function slugify(input: string, max = 80): string {
  const s = fold(input).replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, max).replace(/-$/, "");
}

/** FNV-1a 32-bit hash, base36 encoded. Deterministic and fast; not cryptographic. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function artistIdFor(name: string): string {
  const slug = slugify(name, 64);
  return slug || `artist-${fnv1a(name)}`;
}

export function albumIdFor(artistName: string, title: string): string {
  const key = `${fold(artistName)}|${fold(title)}`;
  const slug = slugify(`${title}`, 48) || "album";
  return `${slug}-${fnv1a(key)}`;
}

export function genreKey(genre: string): string {
  return slugify(genre, 48);
}

export function mediaUrl(ref: MediaRef | undefined | null): string | undefined {
  if (!ref) return undefined;
  if (ref.startsWith("http") || ref.startsWith("/")) return ref;
  const i = ref.indexOf(":");
  if (i < 0) return undefined;
  return `/api/media/${ref.slice(0, i)}/${ref.slice(i + 1)}`;
}

/** Valid storage provider ids: "r2", "b2", "b2_2", "b2_3", … */
export const PROVIDER_ID = /^(r2|b2(_\d{1,3})?)$/;

/** Human name for a storage provider id. */
export function providerName(id: string): string {
  if (id === "r2") return "Cloudflare R2";
  if (id === "b2") return "Backblaze B2";
  const n = id.match(/^b2_(\d+)$/)?.[1];
  return n ? `Backblaze B2 · account ${n}` : id;
}

export function toMediaRef(provider: string, key: string): MediaRef {
  return `${provider}:${key}`;
}

export function parseMediaRef(ref: MediaRef): { provider: string; key: string } | null {
  const i = ref.indexOf(":");
  if (i < 0) return null;
  return { provider: ref.slice(0, i), key: ref.slice(i + 1) };
}

export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function lastNDays(n: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(now - i * 86_400_000));
  return out;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "3 min 31 sec" under an hour, "1 hr 12 min" above (Spotify style). */
export function formatLongDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 3600) {
    const m = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return m ? `${m} min${sec ? ` ${sec} sec` : ""}` : `${sec} sec`;
  }
  const totalMin = Math.round(totalSec / 60);
  return `${Math.floor(totalMin / 60)} hr ${totalMin % 60} min`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return n.toLocaleString("en-US");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[u]}`;
}

export function joinNames(list: { name: string }[], max = 3): string {
  const names = list.map((a) => a.name);
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

export function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function shuffleInPlace<T>(arr: T[], rand: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Small deterministic PRNG (mulberry32) for reproducible shuffles/tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m.padEnd(6, "0");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix a colour towards black so white text stays readable on it. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
