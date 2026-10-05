// A behaviour layer given a negative speed for one second, then speed put back to 1.
//   node audit/tools/behaviour_speed.mjs [behaviour=jelly]
// Prints how far the bodies flew and how long the layer stays empty after the fix.
import path from 'node:path';
import { launch, startServer, openMurmur, armMic, sleep, TRACKS } from './lib.mjs';

const prog = process.argv[2] || 'jelly';
const port = +(process.env.PORT || 9151);
const srv = await startServer(port);
const { browser, page } = await launch({ track: path.join(TRACKS, 'click_128.wav'), extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 800 } });
const st = () => page.evaluate(() => { const L = window.__murmur.activeLayer(); let m = 0; for (const b of L.bodies) m = Math.max(m, Math.abs(b.mx - 720), Math.abs(b.my - 450)); return { ink: window.__murmur.frameSig(16).filter(v => v > 0).length, farthest: +m.toExponential(2) }; });
try {
  await openMurmur(page, port);
  await armMic(page);
  await page.evaluate(p => { const M = window.__murmur; for (const L of M.layers().slice()) M.removeLayer(L.id); M.addLayer(p); }, prog);
  await sleep(2500);
  console.log(prog, 'speed 1      ', JSON.stringify(await st()));
  await page.evaluate(() => { window.__murmur.activeLayer().params.speed = -30; });
  await sleep(1000);
  console.log(prog, 'speed -30 1 s', JSON.stringify(await st()));
  await page.evaluate(() => { window.__murmur.activeLayer().params.speed = 1; });
  const t0 = Date.now();
  let back = null;
  for (let i = 0; i < +(process.env.WAIT || 60); i++) { await sleep(1000); const s = await st(); if (s.ink > 20 && back == null) { back = (Date.now() - t0) / 1000; console.log(prog, 'speed back to 1, picture returns after', back, 's', JSON.stringify(s)); break; } }
  if (back == null) console.log(prog, 'speed back to 1: still empty after ' + (process.env.WAIT || 60) + ' s', JSON.stringify(await st()));
} finally { await browser.close(); srv.kill(); }
