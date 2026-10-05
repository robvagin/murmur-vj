// Where the beat clock ticks relative to the kick, inside the browser pipeline.
//   node audit/tools/phase_browser.mjs [track=click_128] [seconds=40]
// Every frame: record when beat.beatN increments (the 'on beat' moment) and when the
// analysed bass band jumps (the kick as the analyser sees it). Prints the offset
// of each beat tick from the nearest kick, in ms and in fractions of a beat.
import path from 'node:path';
import { launch, startServer, openMurmur, armMic, sleep, TRACKS, writeJSON } from './lib.mjs';

const track = process.argv[2] || 'click_128';
const secs = +(process.argv[3] || 40);
const port = +(process.env.PORT || 9161);
const srv = await startServer(port);
const { browser, page } = await launch({ track: path.join(TRACKS, track + '.wav'), extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 960, height: 600 } });
try {
  await openMurmur(page, port);
  await armMic(page);
  await page.evaluate(() => window.__murmur.setUI(true));
  const r = await page.evaluate(async secs => {
    const M = window.__murmur, ticks = [], kicks = [];
    let lastN = -1, lastBass = 0;
    await new Promise(done => {
      const t0 = performance.now();
      const loop = () => {
        const f = M.features(), t = performance.now() / 1000;
        if (f.beat.beatN !== lastN) { if (lastN >= 0) ticks.push(t); lastN = f.beat.beatN; }
        const b = f.bands.bass;
        if (b > .7 && lastBass < .45) kicks.push(t);
        lastBass = b;
        if (performance.now() - t0 < secs * 1000) requestAnimationFrame(loop); else done();
      };
      requestAnimationFrame(loop);
    });
    return { ticks, kicks, bpm: M.features().beat.bpm };
  }, secs);
  const per = 60 / (r.bpm || 128), half = r.ticks.filter(t => t > r.ticks[0] + secs / 2);
  const offs = half.map(t => { let best = 1e9; for (const k of r.kicks) if (Math.abs(t - k) < Math.abs(best)) best = t - k; return best; }).filter(v => Math.abs(v) < per);
  const ms = offs.map(v => v * 1000).sort((a, b) => a - b), abs = ms.map(Math.abs).sort((a, b) => a - b);
  const res = { track, bpm: +(r.bpm || 0).toFixed(2), kicksSeen: r.kicks.length, ticks2ndHalf: half.length, medianOffsetMs: +ms[ms.length >> 1].toFixed(1), medianAbsMs: +abs[abs.length >> 1].toFixed(1), within40ms: +(abs.filter(v => v <= 40).length / abs.length).toFixed(2), medianOffsetBeats: +(ms[ms.length >> 1] / 1000 / per).toFixed(2) };
  console.log(JSON.stringify(res));
  writeJSON('phase_browser_' + track + '.json', res);
} finally { await browser.close(); srv.kill(); }
