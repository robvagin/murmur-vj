// BPM accuracy through the real browser pipeline (fake mic fed from a WAV file).
//   node audit/tools/bpm_browser.mjs [seconds=40] [track names...]
// Writes bpm_browser.json into MURMUR_OUT. Uses summarize() from node_bpm.mjs.
import path from 'node:path';
import { launch, startServer, openMurmur, armMic, sleep, writeJSON, TRACKS } from './lib.mjs';
import { summarize } from './node_bpm.mjs';

const secs = +(process.argv[2] || 40);
const names = process.argv.slice(3).length ? process.argv.slice(3) : ['click_120', 'click_128', 'click_140', 'click_174', 'silence', 'noise', 'sweep'];
const port = +(process.env.PORT || 9051);
const srv = await startServer(port);
const out = [];
try {
  for (const n of names) {
    const truth = +((n.match(/(\d+)/) || [])[1] || 0);
    const { browser, page, log } = await launch({ track: path.join(TRACKS, n + '.wav'), extra: ['--disable-accelerated-2d-canvas'], viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
    try {
      await openMurmur(page, port);
      await armMic(page);
      const t0 = Date.now(), trace = [];
      let nan = false, f0 = await page.evaluate(() => window.__murmur.frame());
      while (Date.now() - t0 < secs * 1000) {
        await sleep(500);
        const s = await page.evaluate(() => {
          const F = window.__murmur.features();
          const vals = [F.rms, F.flux, F.onset, F.centroid, F.beat.phase, ...Object.values(F.bands), ...Object.values(F.env)];
          return { bpm: F.beat.bpm, conf: F.beat.conf, nan: vals.some(v => !Number.isFinite(v)) };
        });
        nan = nan || s.nan;
        trace.push([+((Date.now() - t0) / 1000).toFixed(2), +s.bpm.toFixed(2), +s.conf.toFixed(2)]);
      }
      const fps = +(((await page.evaluate(() => window.__murmur.frame())) - f0) / secs).toFixed(1);
      const row = { track: n, fps, nanSeen: nan, errors: log.errors.length, ...summarize(trace, truth), trace };
      out.push(row);
      const { trace: _, ...brief } = row;
      console.log(JSON.stringify(brief));
    } finally { await browser.close(); }
  }
} finally {
  writeJSON(process.env.OUTNAME || 'bpm_browser.json', out);
  srv.kill();
}
