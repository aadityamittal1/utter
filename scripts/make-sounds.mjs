// Synthesizes Utter's three UI sounds as 16-bit mono 44.1 kHz WAV. No dependencies.
// Usage: node scripts/make-sounds.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const PEAK = Math.pow(10, -12 / 20); // -12 dBFS
const FADE = 0.005; // 5 ms
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop", "src-tauri", "resources", "sounds");

/** Soft tone: sine plus a quiet octave for warmth, exponential decay envelope. */
function tone(buf, startSec, durSec, freqFn, decay) {
  const s0 = Math.round(startSec * RATE);
  const n = Math.round(durSec * RATE);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * freqFn(t / durSec)) / RATE;
    const env = Math.exp(-decay * t) * Math.min(1, t / 0.004);
    const v = (Math.sin(phase) + 0.18 * Math.sin(2 * phase)) * env;
    if (s0 + i < buf.length) buf[s0 + i] += v;
  }
}

function finish(buf) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const g = PEAK / (max || 1);
  const fade = Math.round(FADE * RATE);
  const pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + buf.length * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); // PCM
  pcm.writeUInt16LE(1, 22); // mono
  pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) {
    const f = Math.min(1, i / fade, (buf.length - 1 - i) / fade);
    pcm.writeInt16LE(Math.round(buf[i] * g * f * 32767), 44 + i * 2);
  }
  return pcm;
}

const make = (ms, fn) => {
  const buf = new Float32Array(Math.round((ms / 1000) * RATE));
  fn(buf);
  return finish(buf);
};

const sounds = {
  // two-tone rise, ~120 ms: C5 -> G5
  start: make(120, (b) => {
    tone(b, 0, 0.065, () => 523.25, 18);
    tone(b, 0.055, 0.065, () => 783.99, 22);
  }),
  // single soft pop, ~90 ms: quick downward pitch glide
  stop: make(90, (b) => tone(b, 0, 0.09, (p) => 460 - 170 * p, 38)),
  // low double blip, ~200 ms: two short A3 blips
  error: make(200, (b) => {
    tone(b, 0, 0.075, () => 220, 30);
    tone(b, 0.115, 0.085, () => 196, 30);
  }),
};

mkdirSync(outDir, { recursive: true });
for (const [name, data] of Object.entries(sounds)) {
  writeFileSync(join(outDir, `${name}.wav`), data);
  console.log(`${name}.wav  ${data.length - 44} bytes of PCM  ${(((data.length - 44) / 2 / RATE) * 1000).toFixed(0)} ms`);
}
