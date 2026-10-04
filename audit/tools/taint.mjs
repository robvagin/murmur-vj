// A dropped SVG that taints the canvas while the WebGL post pass (aberration / hue) is on.
//   node audit/tools/taint.mjs      (fixtures from make_fixtures.py in MURMUR_FIXTURES)
// Prints whether the stage keeps changing on screen and which canvas is shown.
import path from 'node:path';
import crypto from 'node:crypto';
import { launch, startServer, openMurmur, sleep, OUT, REPO } from './lib.mjs';

const FIX = process.env.MURMUR_FIXTURES || path.join(REPO, 'audit', 'fixtures');
const port = +(process.env.PORT || 9031);
const srv = await startServer(port);
const { browser, page, log } = await launch({ fakeMedia: false, viewport: { width: 1280, height: 800 } });
const shot = async () => crypto.createHash('md5').update(await page.screenshot({ clip: { x: 300, y: 100, width: 600, height: 600 } })).digest('hex').slice(0, 10);
const state = () => page.evaluate(() => ({ gl: getComputedStyle(document.getElementById('glcv')).display, cv: getComputedStyle(document.getElementById('cv')).visibility, frames: window.__murmur.frame(), post: window.__murmur.preflight().post }));
try {
  await openMurmur(page, port);
  await page.evaluate(() => { window.__murmur.state.post.chroma = .5; });
  await sleep(1500);
  console.log('post on      ', JSON.stringify(await state()), 'screen', await shot(), await shot());
  await page.setInputFiles('#fileIn', path.join(FIX, process.env.SVG || 'xss_foreign.svg'));
  await sleep(800);
  await page.evaluate(() => { const L = window.__murmur.activeLayer(); L.look.assetShare = 1; window.__murmur.rebuildTex(); });
  await sleep(1500);
  const a = await state(); const s1 = await shot(); await sleep(1500); const s2 = await shot(); const b = await state();
  console.log('svg dropped ', JSON.stringify(a), '->', JSON.stringify(b), 'screen', s1, s2, s1 === s2 ? 'FROZEN' : 'moving');
  console.log('errors', log.errors.length, (log.errors[0] || '').slice(0, 160));
  await page.screenshot({ path: path.join(OUT, 'taint_after_svg.png') });
} finally { await browser.close(); srv.kill(); }
