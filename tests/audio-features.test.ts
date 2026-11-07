import { describe, expect, it } from "vitest";
import { analyzeSamples } from "@/lib/client/upload/audio-features";

const SR = 22050;

/** Synthetic "song": kick drum clicks at a given BPM over a quiet pad. */
function synth(bpm: number, seconds = 30, loud = 0.6) {
  const out = new Float32Array(SR * seconds);
  const beat = (60 / bpm) * SR;
  for (let i = 0; i < out.length; i++) out[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR);
  for (let b = 0; b * beat < out.length; b++) {
    const start = Math.round(b * beat);
    for (let k = 0; k < 2000 && start + k < out.length; k++) {
      out[start + k] += loud * Math.exp(-k / 300) * Math.sin((2 * Math.PI * 60 * k) / SR) + loud * 0.3 * (Math.random() - 0.5) * Math.exp(-k / 80);
    }
  }
  return out;
}

describe("audio feature extraction", () => {
  it.each([90, 120, 128, 150])("detects %i BPM", (bpm) => {
    const f = analyzeSamples(synth(bpm));
    expect(f.bpm).not.toBeNull();
    // allow octave errors only within ±3%
    const candidates = [f.bpm!, f.bpm! * 2, f.bpm! / 2];
    expect(candidates.some((c) => Math.abs(c - bpm) / bpm < 0.03)).toBe(true);
  });

  it("ranks loud busy audio as more energetic than a quiet pad", () => {
    const loud = analyzeSamples(synth(128, 20, 0.9));
    const quiet = new Float32Array(SR * 20).map((_, i) => 0.03 * Math.sin((2 * Math.PI * 220 * i) / SR));
    const calm = analyzeSamples(quiet);
    expect(loud.energy).toBeGreaterThan(calm.energy);
    expect(loud.rhythm).toBeGreaterThan(calm.rhythm);
    expect(loud.loudness).toBeGreaterThan(calm.loudness);
    expect(calm.bpm).toBeNull();
  });
});
