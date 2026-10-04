// Long run: one looping track, a scene change every 20 s, metrics once a minute.
//   node audit/tools/long_run.mjs [minutes=32] [track]
// Env: MURMUR_ROOT (served dir), MURMUR_TRACKS, MURMUR_OUT, PORT.
// Writes long_run.json / long_run.csv into MURMUR_OUT.
import path from 'node:path';
import fs from 'node:fs';
import { launch, startServer, openMurmur, armMic, frameInk, nanBodies, metrics, sleep, TRACKS, OUT, RAF_COUNTER, writeJSON } from './lib.mjs';

const minutes = +(process.argv[2] || 32);
const track = process.argv[3] || path.join(TRACKS, 'click_128.wav');
const port = +(process.env.PORT || 8951);
const srv = await startServer(port);
// Software 2D canvas and 720p give headless SwiftShader more frames per minute (more chances to leak).
const { browser, page, log, cdp } = await launch({ track, extra: (process.env.FLAGS ?? '--disable-accelerated-2d-canvas').split(' ').filter(Boolean), viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
await page.addInitScript(RAF_COUNTER);
await cdp.send('Performance.enable');
const rows = [];
const t0 = Date.now();
const el = () => (Date.now() - t0) / 1000;

async function sample(minute) {
  await cdp.send('HeapProfiler.collectGarbage');
  const m = await metrics(cdp);
  const a = await page.evaluate(async () => {
    const M = window.__murmur;
    const f0 = M.frame(), r0 = window.__rafCalls, p0 = performance.now();
    await new Promise(r => setTimeout(r, 5000));
    const dtS = (performance.now() - p0) / 1000;
    const b = M.features().beat;
    return {
      fps: +((M.frame() - f0) / dtS).toFixed(1),
      rafPerSec: +((window.__rafCalls - r0) / dtS).toFixed(1),
      scrubs: Object.keys(M.scrubs).length,
      layers: M.layers().length,
      bodies: M.pool().length,
      bpm: +b.bpm.toFixed(1),
      audio: M.audioHealth(),
      heapPerfMem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null,
      domNodes: document.getElementsByTagName('*').length,
    };
  });
  const ink = await frameInk(page);
  const row = {
    minute, t: Math.round(el()),
    heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1),
    heapTotalMB: +(m.JSHeapTotalSize / 1048576).toFixed(1),
    nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents,
    ...a, inkCells: ink.cells, nan: await nanBodies(page), errors: log.errors.length,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  writeJSON('long_run.json', { minutes, track: path.basename(track), rows, errors: log.errors.slice(0, 50) });
  const cols = Object.keys(row);
  fs.writeFileSync(path.join(OUT, 'long_run.csv'), [cols.join(',')].concat(rows.map(r => cols.map(c => r[c]).join(','))).join('\n'));
}

try {
  await openMurmur(page, port);
  await armMic(page);
  // Three scenes: the default, + a text layer, + palette and a 'pat-form' layer.
  const save = async slot => { await page.click('#saveBtn'); await page.click(`#banks .btn:nth-child(${slot})`); };
  await save(1);
  await page.evaluate(() => window.__murmur.addLayer('word'));
  await save(2);
  await page.evaluate(() => window.__murmur.addLayer('pat-form'));
  await page.keyboard.press('p');
  await save(3);
  await page.mouse.move(960, 540); // pointer rests on the stage
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await sample(0);
  let scene = 3, nextSceneAt = 20, nextSample = 60;
  while (el() < minutes * 60) {
    await sleep(1000);
    if (el() >= nextSceneAt) {
      scene = scene % 3 + 1;
      await page.keyboard.press(String(scene));
      nextSceneAt += 20;
    }
    if (el() >= nextSample) {
      await sample(Math.round(nextSample / 60));
      nextSample += 60;
    }
  }
  await page.screenshot({ path: path.join(OUT, 'long_run_end.png') });
} finally {
  console.log('errors', log.errors.length, JSON.stringify(log.errors.slice(0, 10)));
  await browser.close();
  srv.kill();
}
