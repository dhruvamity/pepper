/**
 * Audio fingerprints from Chromaprint's `fpcalc -raw` (the AcoustID fingerprinter): about eight
 * 32-bit values per second of audio. Two copies of the same recording (different bitrates,
 * re-encodes, different tags) give nearly identical values; different songs differ in about half
 * of the bits. Used by the import to find the same song saved twice under different files.
 */

export interface Fingerprint {
  /** Seconds, as fpcalc reports it. */
  duration: number;
  values: Uint32Array;
}

export function parseFpcalc(output: string): Fingerprint | null {
  const duration = Number(output.match(/^DURATION=(\d+(?:\.\d+)?)/m)?.[1]);
  const raw = output.match(/^FINGERPRINT=([\d,]+)/m)?.[1];
  if (!raw || !Number.isFinite(duration)) return null;
  const values = Uint32Array.from(raw.split(",").map((v) => Number(v) >>> 0));
  return values.length ? { duration, values } : null;
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Share of differing bits at the best alignment (shifted up to `maxShift` values, about a second):
 * ~0.0–0.1 for the same recording, ~0.5 for unrelated audio. Needs ~5 s of overlap.
 */
export function fingerprintDistance(a: ArrayLike<number>, b: ArrayLike<number>, maxShift = 8): number {
  const minOverlap = 40;
  let best = 1;
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    const start = Math.max(0, -shift);
    const end = Math.min(a.length, b.length - shift);
    const n = end - start;
    if (n < minOverlap) continue;
    let bits = 0;
    for (let i = start; i < end; i++) bits += popcount((a[i] ^ b[i + shift]) >>> 0);
    const ber = bits / (32 * n);
    if (ber < best) best = ber;
  }
  return best;
}

/** Below this distance two files hold the same recording. */
export const SAME_RECORDING = 0.2;

export function encodeFingerprint(values: Uint32Array): string {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64");
}

export function decodeFingerprint(s: string): Uint32Array {
  const buf = Buffer.from(s, "base64");
  const out = new Uint32Array(Math.floor(buf.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = buf.readUInt32LE(i * 4);
  return out;
}
