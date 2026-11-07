"use client";

/**
 * Browser side of the audio analysis (runs during admin upload): decodes the file with Web Audio
 * and hands ~90 s of mono samples to the shared analyser in lib/audio/features.
 */
import type { AudioFeatures } from "@/lib/types";
import { analyzeSamples, ANALYSIS_SAMPLE_RATE as SR } from "@/lib/audio/features";

export { analyzeSamples };

/** Decode an audio file and analyse ~90 s from its middle (skipping intros/outros). */
export async function analyzeAudioFile(file: Blob): Promise<AudioFeatures | null> {
  const OfflineCtx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineCtx) return null;
  try {
    const buf = await file.arrayBuffer();
    const ctx = new OfflineCtx(1, SR, SR);
    const audio = await ctx.decodeAudioData(buf);
    const len = audio.length;
    const segLen = Math.min(len, Math.round(audio.sampleRate * 90));
    const start = Math.min(Math.max(0, len - segLen), Math.floor(len * 0.2));
    const ratio = audio.sampleRate / SR;
    const outLen = Math.floor(segLen / ratio);
    const mono = new Float32Array(outLen);
    const chans = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    for (let i = 0; i < outLen; i++) {
      const src = start + Math.floor(i * ratio);
      let s = 0;
      for (const ch of chans) s += ch[src] ?? 0;
      mono[i] = s / chans.length;
    }
    // Yield to keep the UI responsive before the heavy part.
    await new Promise((r) => setTimeout(r, 0));
    return analyzeSamples(mono, SR);
  } catch (err) {
    console.warn("[pepper] audio analysis failed", err);
    return null;
  }
}
