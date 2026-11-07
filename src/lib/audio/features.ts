/**
 * Lightweight music-information-retrieval: tempo (onset autocorrelation), energy & loudness
 * (RMS), dynamics (RMS spread), brightness (spectral centroid), rhythmic density (onset rate)
 * and danceability (pulse clarity). Pure functions on mono samples, so the admin's browser
 * (upload page) and the import command share them. These feed the content-based part of the
 * recommender, so recommendations are sensible before anyone has listened to a new song.
 */
import type { AudioFeatures } from "@/lib/types";

export const ANALYSIS_SAMPLE_RATE = 22050;
const SR = ANALYSIS_SAMPLE_RATE;
const FFT = 1024;
const HOP = 512;

function fftMagnitudes(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j];
        const ai = im[i + j];
        const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function analyzeSamples(mono: Float32Array, sampleRate = SR): AudioFeatures {
  const frames = Math.max(1, Math.floor((mono.length - FFT) / HOP));
  const hann = new Float32Array(FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const re = new Float32Array(FFT);
  const im = new Float32Array(FFT);
  const prevMag = new Float32Array(FFT / 2);
  const flux = new Float32Array(frames);
  const rmsDb: number[] = [];
  let sumSq = 0;
  let peak = 0;
  let centroidSum = 0;
  let centroidW = 0;
  const binHz = sampleRate / FFT;

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < FFT; i++) {
      const s = mono[off + i];
      e += s * s;
      re[i] = s * hann[i];
      im[i] = 0;
    }
    const rms = Math.sqrt(e / FFT);
    rmsDb.push(20 * Math.log10(rms + 1e-9));
    fftMagnitudes(re, im);
    let num = 0;
    let den = 0;
    let fl = 0;
    for (let k = 1; k < FFT / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      num += mag * k * binHz;
      den += mag;
      const lm = Math.log1p(mag * 10);
      const d = lm - prevMag[k];
      if (d > 0) fl += d;
      prevMag[k] = lm;
    }
    flux[f] = fl;
    if (den > 0 && rms > 0.005) {
      centroidSum += (num / den) * rms;
      centroidW += rms;
    }
  }
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    sumSq += mono[i] * mono[i];
    if (a > peak) peak = a;
  }

  const totalRms = Math.sqrt(sumSq / Math.max(1, mono.length));
  const loudness = 20 * Math.log10(totalRms + 1e-9);
  const voiced = rmsDb.filter((d) => d > -60);
  const mean = voiced.reduce((a, b) => a + b, 0) / Math.max(1, voiced.length);
  const std = Math.sqrt(voiced.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, voiced.length));
  const centroid = centroidW ? centroidSum / centroidW : 1000;

  // Onset envelope: normalise, remove local mean, half-wave rectify.
  const env = new Float32Array(frames);
  const win = 16;
  for (let i = 0; i < frames; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - win); j < Math.min(frames, i + win); j++) {
      s += flux[j];
      c++;
    }
    env[i] = Math.max(0, flux[i] - s / c);
  }
  const fps = sampleRate / HOP;
  // Onset rate (peaks above an adaptive threshold)
  let onsets = 0;
  const envMean = env.reduce((a, b) => a + b, 0) / frames;
  for (let i = 1; i < frames - 1; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > envMean * 1.5) onsets++;
  const onsetRate = onsets / (frames / fps);

  // Tempo by autocorrelation with a log-normal prior around 120 BPM.
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.ceil((fps * 60) / 60);
  let best = -1;
  let bestLag = 0;
  const ac: number[] = [];
  let acMean = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += env[i] * env[i + lag];
    s /= frames - lag;
    ac.push(s);
    acMean += s;
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (s * prior > best) {
      best = s * prior;
      bestLag = lag;
    }
  }
  acMean /= ac.length;
  const i0 = bestLag - minLag;
  let lagRefined = bestLag;
  if (i0 > 0 && i0 < ac.length - 1) {
    const [a, b, c] = [ac[i0 - 1], ac[i0], ac[i0 + 1]];
    const denom = a - 2 * b + c;
    if (denom !== 0) lagRefined = bestLag + (0.5 * (a - c)) / denom;
  }
  const peakAc = ac[i0] ?? 0;
  const fluxMean = flux.reduce((a, b) => a + b, 0) / frames;
  // No real rhythmic content (drones, ambient pads, silence) → no tempo.
  const rhythmic = fluxMean > 1 && onsetRate > 0.3;
  const clarity = rhythmic && acMean > 0 ? peakAc / acMean : 0;
  const bpm = clarity > 1.25 ? Math.round((60 * fps) / lagRefined) : null;

  return {
    bpm,
    energy: Number(clamp01((loudness + 30) / 22 * 0.7 + clamp01(onsetRate / 5) * 0.3).toFixed(3)),
    loudness: Number(loudness.toFixed(2)),
    brightness: Number(clamp01(Math.log2(centroid / 300) / Math.log2(5000 / 300)).toFixed(3)),
    dynamics: Number(clamp01(std / 12).toFixed(3)),
    rhythm: Number(clamp01(onsetRate / 6).toFixed(3)),
    // Saturating curves keep strongly rhythmic songs distinguishable instead of all hitting 1.0.
    danceability: Number(clamp01((1 - Math.exp(-(clarity - 1) / 3)) * 0.6 + (1 - Math.exp(-onsetRate / 4)) * 0.4).toFixed(3)),
  };
}
