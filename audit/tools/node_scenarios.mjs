// Beat detector on the harder scenario tracks (gen_scenarios.py), in Node.
//   node audit/tools/node_scenarios.mjs [fps=60]
// Per track: tempo per segment, time to (re)lock, and the phase error of onBeat
// against the true beat grid (signed ms; + means the flash comes late).
import fs from 'node:fs';
import path from 'node:path';
import { readWav, makeAnalyser, loadCore, lockTime } from './node_bpm.mjs';
import { TRACKS } from './lib.mjs';

const fps = +(process.argv[2] || 60);
const names = (process.env.NAMES || 'tempo_change,breakdown,swing,quiet,clipped,halftime,dnb,drift').split(',');
// OFFSET=<s>: drop the first s seconds of audio so the clock does not start on a kick.
const OFFSET = +(process.env.OFFSET || 0);
const C = loadCore();
const out = [];
for (const n of names) {
  const meta = JSON.parse(fs.readFileSync(path.join(TRACKS, n + '.json'), 'utf8'));
  const w = readWav(path.join(TRACKS, n + '.wav')), sr = w.sr, x = w.x.subarray(Math.round(OFFSET * sr));
  const core = C.makeAudioCore({ sampleRate: sr, fftSize: 2048 });
  const an = makeAnalyser();
  const trace = [], beats = [];
  let t = 0, last = -1;
  while (t < x.length / sr) {
    t += 1 / fps;
    const { freq, time } = an(x, Math.floor(t * sr));
    const f = core.process(freq, time, 1 / fps, t);
    if (f.beat.onBeat) beats.push(t);
    if (t - last >= .5) { last = t; trace.push([+t.toFixed(2), +f.beat.bpm.toFixed(2), +f.beat.conf.toFixed(2)]); }
  }
  // true beat grid: every kick for four-on-the-floor; a fixed grid for halftime / dnb
  let grid = meta.kicks.map(k => k - OFFSET);
  if (n === 'halftime' || n === 'dnb') { const per = 60 / meta.segments[0][2]; grid = []; for (let g = -OFFSET; g < x.length / sr; g += per) grid.push(g); }
  const segs = meta.segments.map(([a0, b0, bpm]) => {
    const a = Math.max(0, a0 - OFFSET), b = b0 - OFFSET;
    const tr = trace.filter(r => r[0] >= a && r[0] < b);
    const late = tr.filter(r => r[0] >= a + (b - a) / 2).map(r => r[1]).sort((p, q) => p - q);
    const relock = typeof bpm === 'number' && bpm > 0 ? lockTime(tr.map(r => [r[0] - a, r[1]]), bpm) : null;
    const errs = [];
    if (typeof bpm === 'number' && bpm > 0 || typeof bpm === 'string') {
      for (const tb of beats) if (tb >= a + (b - a) / 2 && tb < b) {
        let best = 1e9; for (const g of grid) if (Math.abs(tb - g) < Math.abs(best)) best = tb - g;
        errs.push(best * 1000);
      }
    }
    const abs = errs.map(Math.abs).sort((p, q) => p - q);
    return {
      seg: `${a0}-${b0}s`, truth: bpm,
      medianBpm2ndHalf: late.length ? late[late.length >> 1] : null,
      range2ndHalf: late.length ? [late[0], late[late.length - 1]] : null,
      lockFromSegStart: relock,
      phase: abs.length ? { medianAbsMs: +abs[abs.length >> 1].toFixed(1), medianSignedMs: +errs.slice().sort((p, q) => p - q)[errs.length >> 1].toFixed(1), within40ms: +(abs.filter(v => v <= 40).length / abs.length).toFixed(2), beats: abs.length } : null,
    };
  });
  const row = { track: n, fps, segs };
  out.push(row);
  console.log(JSON.stringify(row));
}
if (process.env.MURMUR_OUT) fs.writeFileSync(path.join(process.env.MURMUR_OUT, `node_scenarios_${fps}${process.env.TAG ? '_' + process.env.TAG : ''}.json`), JSON.stringify(out, null, 2));
