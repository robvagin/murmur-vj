// Offline BPM accuracy check: runs audio-core.js in Node on a WAV file through a
// model of Chrome's AnalyserNode (fft 2048, Blackman window, smoothing 0.5,
// -100..-30 dB to bytes), sampled at a fixed frame rate like requestAnimationFrame.
//   node audit/tools/node_bpm.mjs <file.wav> [fps=60] [truthBpm]
// Prints a JSON summary: BPM trace, time to lock (±1.5 BPM held for 5 s), final value.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO } from './lib.mjs';

// CORE=<path> runs a variant of audio-core.js instead of the repo copy.
export function loadCore() {
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(process.env.CORE || path.join(REPO, 'audio-core.js'), 'utf8'), ctx);
  return ctx;
}

export function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12, sr = 48000, ch = 1, bits = 16, data = null;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') data = b.subarray(o + 8, o + 8 + sz);
    o += 8 + sz + (sz & 1);
  }
  if (bits !== 16) throw new Error('16-bit only');
  const n = data.length / 2 / ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2 * ch) / 32768;
  return { sr, x };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export function makeAnalyser(N = 2048, smoothing = 0.5, minDb = -100, maxDb = -30) {
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = 2 * Math.PI * i / N; win[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a); }
  const sm = new Float32Array(N / 2), re = new Float32Array(N), im = new Float32Array(N);
  const freq = new Uint8Array(N / 2), time = new Uint8Array(N);
  return function analyse(x, end) {
    for (let i = 0; i < N; i++) {
      const s = end - N + i >= 0 && end - N + i < x.length ? x[end - N + i] : 0;
      re[i] = s * win[i]; im[i] = 0;
      time[i] = Math.max(0, Math.min(255, Math.round(128 * (1 + s))));
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]) / N;
      sm[k] = smoothing * sm[k] + (1 - smoothing) * mag;
      const db = sm[k] > 0 ? 20 * Math.log10(sm[k]) : -Infinity;
      freq[k] = Math.max(0, Math.min(255, Math.floor(255 / (maxDb - minDb) * (db - minDb))));
    }
    return { freq, time };
  };
}

// Feed a whole signal through the core. jitter adds rAF-like timing noise (fraction of dt).
export function runCore(x, sr, fps, { jitter = 0, seed = 1, clampDt = 0 } = {}) {
  const C = loadCore();
  const core = C.makeAudioCore({ sampleRate: sr, fftSize: 2048 });
  const an = makeAnalyser();
  let rnd = seed;
  const rand = () => (rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296;
  const trace = [], dur = x.length / sr;
  let t = 0, lastLog = -1, nanSeen = false;
  while (t < dur) {
    const dt = (1 / fps) * (1 + (rand() * 2 - 1) * jitter);
    t += dt;
    const { freq, time } = an(x, Math.floor(t * sr));
    // clampDt mimics index.html frame(): dt = Math.min(.05, t - last)
    const f = core.process(freq, time, clampDt ? Math.min(clampDt, dt) : dt, t);
    for (const k in f.bands) if (!Number.isFinite(f.bands[k])) nanSeen = true;
    if (!Number.isFinite(f.rms) || !Number.isFinite(f.beat.phase)) nanSeen = true;
    if (t - lastLog >= 0.5) { lastLog = t; trace.push([+t.toFixed(2), +f.beat.bpm.toFixed(2), +f.beat.conf.toFixed(2)]); }
  }
  return { trace, nanSeen, features: core.features };
}

export function lockTime(trace, truth, tol = 1.5, hold = 5) {
  if (!truth) return null;
  let start = null;
  for (const [t, b] of trace) {
    if (Math.abs(b - truth) <= tol) { if (start == null) start = t; if (t - start >= hold) return start; }
    else start = null;
  }
  return null;
}

export function summarize(trace, truth) {
  const tail = trace.filter(([t]) => t >= trace[trace.length - 1][0] - 30).map(r => r[1]).sort((a, b) => a - b);
  const med = tail.length ? tail[tail.length >> 1] : 0;
  const inTol = truth ? trace.filter(([t, b]) => t > 10 && Math.abs(b - truth) <= 1.5).length / Math.max(1, trace.filter(([t]) => t > 10).length) : null;
  const first = trace.find(r => r[1] > 0);
  return { truth, firstEstimateAt: first ? first[0] : null, lockAt: lockTime(trace, truth), medianLast30s: med, min: tail[0], max: tail[tail.length - 1], shareInTolAfter10s: inTol == null ? null : +inTol.toFixed(2), final: trace[trace.length - 1][1] };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const file = process.argv[2], fps = +(process.argv[3] || 60);
  const truth = +(process.argv[4] || (path.basename(file).match(/(\d+)/) || [])[1] || 0);
  const { sr, x } = readWav(file);
  const r = runCore(x, sr, fps, { jitter: +(process.env.JITTER || 0), clampDt: +(process.env.CLAMP_DT || 0) });
  console.log(JSON.stringify({ file: path.basename(file), fps, nanSeen: r.nanSeen, ...summarize(r.trace, truth), trace: process.env.TRACE ? r.trace : undefined }));
}
