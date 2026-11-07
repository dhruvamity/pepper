/**
 * Dominant, reasonably vivid colour of a cover (Spotify-style page gradients), from RGBA pixels of
 * a small (e.g. 48×48) thumbnail. Shared by the browser upload (canvas) and the import (sharp).
 */
import { rgbToHex } from "@/lib/util";

export function dominantColorFromPixels(data: ArrayLike<number>): string {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number; score: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (light < 0.08 || light > 0.92) continue;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, score: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    e.score += 1 + sat * 2;
    buckets.set(key, e);
  }
  const best = [...buckets.values()].sort((a, b) => b.score - a.score)[0];
  if (!best) return "#535353";
  let [r, g, b] = [best.r / best.n, best.g / best.n, best.b / best.n];
  // Keep white text readable: cap brightness.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > 150) {
    const k = 150 / lum;
    r *= k;
    g *= k;
    b *= k;
  }
  return rgbToHex(r, g, b);
}
