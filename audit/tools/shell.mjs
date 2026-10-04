// Shell: file://, hotkeys, reduced motion, resize/DPR, frozen tab, heavy loads, extreme typed values.
//   node audit/tools/shell.mjs
// Writes shell.json and screenshots into MURMUR_OUT.
import path from 'node:path';
import { launch, startServer, openMurmur, sleep, writeJSON, OUT, ROOT } from './lib.mjs';

const port = +(process.env.PORT || 9011);
const srv = await startServer(port);
const res = {};
let B;
const add = (k, row) => { (res[k] = res[k] || []).push(row); console.log(k, JSON.stringify(row).slice(0, 420)); };
const fpsOver = (ms = 4000) => B.page.evaluate(async ms => { const M = window.__murmur, f = M.frame(), t = performance.now(); await new Promise(r => setTimeout(r, ms)); return +((M.frame() - f) / ((performance.now() - t) / 1000)).toFixed(1); }, ms);
const health = () => B.page.evaluate(() => {
  const M = window.__murmur;
  let ink = -1; try { ink = M.frameSig(16).filter(v => v > 0).length; } catch (e) { ink = String(e.name); }
  return { ink, nan: M.pool().filter(b => !Number.isFinite(b.x)).length, layers: M.layers().length, bodies: M.pool().length, frame: M.preflight().frame, noui: document.body.classList.contains('noui'), blackout: document.body.classList.contains('blackout'), status: document.getElementById('statusText').textContent };
});
async function boot(opts = {}) {
  if (B) await B.browser.close();
  B = await launch({ fakeMedia: false, extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 800 }, ...opts });
}
try {
  // ---------- file://
  await boot({ fakeMedia: true });
  await B.page.goto('file://' + path.join(ROOT, 'index.html'));
  await B.page.waitForFunction(() => window.__murmur && window.__murmur.frame() > 5, null, { timeout: 30000 });
  await sleep(3500);
  add('file', { ...(await health()), armNote: await B.page.textContent('#armNote'), camNote: await B.page.textContent('#camNote'), armDisabled: await B.page.evaluate(() => document.getElementById('arm').classList.contains('is-disabled')), verdict: await B.page.evaluate(() => window.__murmur.preflight().verdict), badge: await B.page.evaluate(() => { const b = document.getElementById('alertBadge'); return b.hidden ? '' : b.textContent; }), errors: B.log.errors.slice(0, 5) });
  await B.page.evaluate(() => document.getElementById('arm').click()); // the button is aria-disabled on file://
  await sleep(800);
  add('file', { afterArmClick: true, armed: await B.page.evaluate(() => window.__murmur.armed()), status: await B.page.textContent('#statusText') });
  await B.page.evaluate(() => { const L = window.__murmur.onlyProg('mark'); });
  await sleep(1500);
  add('file', { symbolFormation: true, ...(await health()), logoReady: await B.page.evaluate(() => window.__murmur.logo().ready) });
  await B.page.screenshot({ path: path.join(OUT, 'file_protocol.png') });

  // ---------- hotkeys, every key in the tray, three times fast, then random mashing
  await boot();
  await openMurmur(B.page, port);
  await B.page.click('#saveBtn'); await B.page.click('#banks .btn:nth-child(1)');
  await B.page.evaluate(() => window.__murmur.addLayer('word'));
  await B.page.click('#saveBtn'); await B.page.click('#banks .btn:nth-child(2)');
  await B.page.evaluate(() => document.activeElement.blur());
  const e0 = B.log.errors.length;
  const keys = ['h', 'b', 'p', 'w', '1', '2', '3', '8', 'Shift+1', 'Shift+2', 'q', 'g', 'e', 'r', 'ArrowLeft', 'ArrowRight', '[', ']', 't', 'Delete', 'h', 'b'];
  for (let round = 0; round < 3; round++) for (const k of keys) await B.page.keyboard.press(k);
  await sleep(1500);
  add('keys', { phase: 'tray keys x3', ...(await health()), errors: B.log.errors.slice(e0) });
  let s = 99;
  const pool = 'hbpwqgert[]123456789'.split('').concat(['ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Shift+3', 'Shift+4']);
  for (let i = 0; i < 400; i++) { s = (s * 1103515245 + 12345) >>> 0; await B.page.keyboard.press(pool[s % pool.length]); }
  await sleep(2500);
  add('keys', { phase: 'random mash x400', fps: await fpsOver(3000), ...(await health()), pendingMoves: await B.page.evaluate(() => window.__murmur.pending()), jog: await B.page.evaluate(() => window.__murmur.jogMul()), errors: B.log.errors.slice(e0).slice(0, 10) });
  await B.page.screenshot({ path: path.join(OUT, 'after_mash.png') });

  // ---------- prefers-reduced-motion
  await boot({ reducedMotion: 'reduce' });
  await openMurmur(B.page, port);
  const a = await B.page.evaluate(() => window.__murmur.frameSig(16).join());
  await sleep(1000);
  const b = await B.page.evaluate(() => window.__murmur.frameSig(16).join());
  add('reducedMotion', { matches: await B.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), canvasStillMoves: a !== b, trayTransition: await B.page.evaluate(() => getComputedStyle(document.getElementById('tray')).transitionProperty) });

  // ---------- resize / DPR / fullscreen-like sizes, UI hidden
  for (const [w, h, dpr] of [[1920, 1080, 1], [800, 600, 1], [3840, 2160, 1], [1920, 1080, 2], [1280, 720, 1]]) {
    await boot({ viewport: { width: w, height: h }, dpr });
    await openMurmur(B.page, port);
    await B.page.evaluate(() => window.__murmur.setUI(true));
    await sleep(800);
    add('size', { w, h, dpr, fpsNoUI: await fpsOver(), ...(await health()) });
  }
  // live resize of the same window
  await boot();
  await openMurmur(B.page, port);
  for (const [w, h] of [[1920, 1080], [600, 400], [2560, 1440], [1280, 800]]) {
    await B.page.setViewportSize({ width: w, height: h });
    await sleep(500);
    add('resize', { w, h, ...(await health()) });
  }

  // ---------- frozen tab (laptop lid, background tab), then back
  await B.page.evaluate(() => window.__murmur.setUI(false));
  const cdp = B.cdp;
  const before = await B.page.evaluate(() => ({ phase: window.__murmur.features().beat.phase, beatN: window.__murmur.features().beat.beatN, bpm: window.__murmur.features().beat.bpm }));
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(10000);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await sleep(1500);
  add('frozen', { before, after: await B.page.evaluate(() => ({ phase: window.__murmur.features().beat.phase, beatN: window.__murmur.features().beat.beatN, bpm: window.__murmur.features().beat.bpm })), ...(await health()), fps: await fpsOver(2000), errors: B.log.errors.slice(-5) });

  // ---------- heavy: max bodies and layers
  for (const [layers, count] of [[1, 2000], [4, 2000], [8, 2000]]) {
    await boot({ viewport: { width: 1920, height: 1080 } });
    await openMurmur(B.page, port);
    await B.page.evaluate(([n, c]) => { const M = window.__murmur; for (let i = 1; i < n; i++) M.addLayer(['word', 'pat-form', 'pat-burst', 'mark'][i % 4]); M.setCount(c); M.setUI(true); }, [layers, count]);
    await sleep(1500);
    add('heavy', { layers, count, fps: await fpsOver(5000), ...(await health()) });
  }

  // ---------- extreme typed values on "hard" knobs (allowExtend:false)
  await boot();
  await openMurmur(B.page, port);
  const typeInto = (label, v) => B.page.evaluate(([label, v]) => {
    const el = [...document.querySelectorAll('.scrub')].find(e => e.getAttribute('aria-label') === label);
    if (!el) return 'missing';
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10 }));
    const ed = el.querySelector('.sedit'); ed.value = String(v);
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return el.getAttribute('aria-valuenow');
  }, [label, v]);
  for (const [label, v] of [['mirrors', 400], ['copies', 400], ['copy scale', 1], ['copy fade', 1]]) {
    const shown = await typeInto(label, v);
    await sleep(600);
    add('extreme', { label, typed: v, shownAfter: shown, state: await B.page.evaluate(() => ({ sectors: window.__murmur.state.kaleido.sectors, copies: window.__murmur.state.dup.copies })), fps: await fpsOver(3000) });
  }
  await typeInto('mirrors', 0); await typeInto('copies', 0);
  const shown = await typeInto('Pulse burst density · bodies', 30000);
  await sleep(1000);
  add('extreme', { label: 'density', typed: 30000, shownAfter: shown, fps: await fpsOver(4000), ...(await health()) });
} finally {
  writeJSON('shell.json', res);
  if (B) await B.browser.close();
  srv.kill();
}
