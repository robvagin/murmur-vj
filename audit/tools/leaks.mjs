// Targeted leak probes.
//   node audit/tools/leaks.mjs
// 1. scene-cycle: 3 scenes, N recalls, heap after GC + SCRUBS size + retained layers.
// 2. hover-raf: pointer resting on a layer-card row while the card re-renders.
// 3. jog-blur: hold ] then lose window focus — does the jog stop?
import { launch, startServer, openMurmur, metrics, sleep, RAF_COUNTER, writeJSON } from './lib.mjs';

const port = +(process.env.PORT || 8971);
const srv = await startServer(port);
const { browser, page, log, cdp } = await launch({ fakeMedia: false, extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 720 } });
await page.addInitScript(RAF_COUNTER);
await cdp.send('Performance.enable');
const out = {};
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const m = await metrics(cdp); return +(m.JSHeapUsedSize / 1048576).toFixed(2); };
try {
  await openMurmur(page, port);
  // --- 1. scene cycling
  const save = async slot => { await page.click('#saveBtn'); await page.click(`#banks .btn:nth-child(${slot})`); };
  await save(1);
  await page.evaluate(() => window.__murmur.addLayer('word'));
  await save(2);
  await page.evaluate(() => window.__murmur.addLayer('pat-form'));
  await save(3);
  await page.evaluate(() => document.activeElement.blur());
  const cyc = [];
  const N = +(process.env.CYCLES || 150);
  for (let i = 0; i <= N; i++) {
    if (i % 25 === 0) {
      await sleep(1600); // let the last crossfade finish
      cyc.push({ recalls: i, heapMB: await heap(), ...(await page.evaluate(() => ({ scrubs: Object.keys(window.__murmur.scrubs).length, layers: window.__murmur.layers().length }))) });
      console.log(JSON.stringify(cyc[cyc.length - 1]));
    }
    await page.keyboard.press(String(i % 3 + 1));
    await sleep(120);
  }
  out.sceneCycle = cyc;

  // --- 2. rAF loops while the pointer sits on a card row that re-renders.
  // NOTE: without hover/pointer media emulation the card never installs its hover loop,
  // so this probe always reads 2 here; hover_raf.mjs is the real test.
  const rate = async () => page.evaluate(async () => { const r0 = window.__rafCalls, f0 = window.__murmur.frame(); await new Promise(r => setTimeout(r, 2000)); return +((window.__rafCalls - r0) / (window.__murmur.frame() - f0)).toFixed(2); });
  await page.mouse.move(900, 700);
  const before = await rate();
  const row = await page.$('#focusBody .row .scrub');
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.__murmur.renderFocus()); // e.g. a scene change re-renders the card under a resting pointer
  await sleep(300);
  const during = await rate();
  await page.mouse.move(900, 700);
  await sleep(300);
  const after = await rate();
  out.hoverRaf = { rafPerFrameBefore: before, rafPerFrameHovering: during, rafPerFrameAfterLeaving: after };
  console.log('hoverRaf', JSON.stringify(out.hoverRaf));

  // --- 3. jog held, then the window loses focus (keyup never arrives)
  await page.evaluate(() => document.activeElement.blur());
  const ph0 = await page.evaluate(() => window.__murmur.jogMul());
  await page.keyboard.down(']');
  await sleep(400);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(1500);
  const mulStuck = await page.evaluate(() => window.__murmur.jogMul());
  await page.keyboard.up(']');
  await sleep(500);
  out.jogBlur = { jogMulIdle: ph0, jogMulAfterBlurWithoutKeyup: +mulStuck.toFixed(3) };
  console.log('jogBlur', JSON.stringify(out.jogBlur));
} finally {
  out.errors = log.errors;
  writeJSON('leaks.json', out);
  await browser.close();
  srv.kill();
}
