import type { SyncedLine } from "../types";

const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parse LRC text ("[mm:ss.xx] line") into sorted synced lines. Returns [] when not LRC. */
export function parseLrc(text: string): SyncedLine[] {
  let offset = 0;
  const out: SyncedLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
    if (off) {
      offset = Number(off[1]) || 0;
      continue;
    }
    const stamps: number[] = [];
    let lastIndex = 0;
    TIME_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_RE.exec(line)) && m.index === lastIndex) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) : 0;
      stamps.push(min * 60_000 + sec * 1000 + frac);
      lastIndex = TIME_RE.lastIndex;
    }
    if (!stamps.length) continue;
    const words = line
      .slice(lastIndex)
      .replace(/<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?>/g, "") // enhanced LRC word timestamps
      .trim();
    for (const t of stamps) out.push({ t: Math.max(0, t - offset), text: words });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function looksLikeLrc(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) return false;
  const timed = lines.filter((l) => /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(l)).length;
  return timed / lines.length > 0.5;
}

export function syncedToPlain(lines: SyncedLine[]): string {
  return lines
    .map((l) => l.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
