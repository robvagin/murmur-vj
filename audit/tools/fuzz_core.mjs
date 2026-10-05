// Fuzz audio-core.js in Node: hostile spectra, frame times and API arguments.
//   node audit/tools/fuzz_core.mjs
// Reports which inputs leave non-finite values in the features, and whether the core recovers.
import { loadCore } from './node_bpm.mjs';

const C = loadCore();
const finite = f => {
  const bad = [];
  const walk = (o, p) => { for (const k in o) { const v = o[k]; if (typeof v === 'number' && !Number.isFinite(v)) bad.push(p + k); else if (v && typeof v === 'object' && !Array.isArray(v) && k[0] !== '_') walk(v, p + k + '.'); } };
  walk(f, '');
  return bad;
};
let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const clickFrame = (core, t, bpm = 128) => {
  const fx = C.makeFixture(bpm, { fftSize: 2048 });
  return fx.frame(t);
};
const results = [];
function run(name, setup) {
  const core = C.makeAudioCore({ sampleRate: 48000, fftSize: 2048 });
  const freq = new Uint8Array(1024), time = new Uint8Array(2048).fill(128);
  let t = 0, firstBad = null, lastBad = [];
  const ctx = { core, freq, time };
  for (let i = 0; i < 1200; i++) {
    const step = setup(ctx, i, t) || {};
    const dt = step.dt !== undefined ? step.dt : 1 / 60;
    t = step.now !== undefined ? step.now : t + (Number.isFinite(dt) && dt > 0 ? dt : 1 / 60);
    let f;
    try { f = core.process(step.freq || freq, step.time === null ? null : (step.time || time), dt, t); }
    catch (e) { results.push({ name, threw: String(e).slice(0, 120), at: i }); return; }
    const bad = finite(f);
    if (bad.length && firstBad == null) firstBad = { at: i, bad: bad.slice(0, 6) };
    lastBad = bad;
  }
  // recovery: 10 s of a clean 128 BPM click
  for (let i = 0; i < 600; i++) { t += 1 / 60; core.process(clickFrame(core, t), null, 1 / 60, t); }
  const f = core.features;
  results.push({ name, firstBad, badAtEndOfFuzz: lastBad.slice(0, 6), afterRecovery: { bad: finite(f).slice(0, 6), bpm: +f.beat.bpm.toFixed(2), phase: f.beat.phase } });
}
run('random spectra', (c) => { for (let k = 0; k < 1024; k++) c.freq[k] = rnd() * 256; for (let k = 0; k < 2048; k++) c.time[k] = rnd() * 256; });
run('all 255 (clipping)', (c) => { c.freq.fill(255); c.time.fill(255); });
run('all zero incl. time domain', (c) => { c.freq.fill(0); c.time.fill(0); });
run('dt = 0', () => ({ dt: 0 }));
run('dt = NaN', () => ({ dt: NaN }));
run('dt = -1', () => ({ dt: -1 }));
run('dt = 1e-9', () => ({ dt: 1e-9 }));
run('dt = 60 s every 100 frames', (c, i) => ({ dt: i % 100 === 0 ? 60 : 1 / 60 }));
run('dt = Infinity once', (c, i) => ({ dt: i === 300 ? Infinity : 1 / 60 }));
run('now goes backwards', (c, i, t) => ({ now: i % 50 === 0 ? t - 5 : undefined }));
run('now = NaN', (c, i) => ({ now: i === 300 ? NaN : undefined }));
run('time = null (no time domain)', () => ({ time: null }));
run('short freq array (512 bins)', () => ({ freq: new Uint8Array(512).fill(100) }));
run('Float32 spectrum in dB (negative)', () => ({ freq: new Float32Array(1024).fill(-80) }));
run('setBPM(NaN) once', (c, i) => { if (i === 300) c.core.setBPM(NaN); });
run('setBPM(Infinity) once', (c, i) => { if (i === 300) c.core.setBPM(Infinity); });
run('shift(NaN) once', (c, i) => { if (i === 300) c.core.shift(NaN); });
run('nudge(Infinity) once', (c, i) => { if (i === 300) c.core.nudge(Infinity); });
run('setTrim("abc") once', (c, i) => { if (i === 300) c.core.setTrim('abc'); });
run('tap with NaN times', (c, i) => { if (i >= 300 && i < 306) c.core.tap(NaN); });
run('tap 4x at 0.05 s (too fast)', (c, i, t) => { if (i >= 300 && i < 304) c.core.tap(300 * 0.05 + (i - 300) * 0.05); });
for (const r of results) console.log(JSON.stringify(r));
