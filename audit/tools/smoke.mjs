// Smoke test: load, arm the fake mic, watch BPM/fps/ink for N seconds.
// node audit/tools/smoke.mjs [track.wav] [seconds]
import path from 'node:path';
import { launch, startServer, openMurmur, armMic, frameInk, nanBodies, sleep, TRACKS, OUT, RAF_COUNTER } from './lib.mjs';

const track = process.argv[2] || path.join(TRACKS, 'click_128.wav');
const secs = +(process.argv[3] || 20);
const port = 8941;
const srv = await startServer(port);
const { browser, page, log } = await launch({ track });
await page.addInitScript(RAF_COUNTER);
try {
  await openMurmur(page, port);
  await armMic(page);
  for (let i = 0; i < secs; i += 2) {
    await sleep(2000);
    const s = await page.evaluate(() => {
      const b = window.__murmur.features().beat;
      return { bpm: +b.bpm.toFixed(2), conf: +b.conf.toFixed(2), src: b.source, fps: window.__murmur.fps(), health: window.__murmur.audioHealth(), raf: window.__rafCalls };
    });
    console.log(i + 2 + 's', JSON.stringify(s), JSON.stringify(await frameInk(page)), 'nan', await nanBodies(page));
  }
  await page.screenshot({ path: path.join(OUT, 'smoke.png') });
  console.log('preflight', JSON.stringify(await page.evaluate(() => window.__murmur.preflight().verdict)));
} finally {
  console.log('errors', JSON.stringify(log.errors, null, 1));
  await browser.close();
  srv.kill();
}
