// Live-operation scenarios, round 2.
//   node audit/tools/ops.mjs        Env: ONLY=gl,mixer,quant,rack,maxfx,spam,dpr,tab
// Writes ops.json into MURMUR_OUT.
import path from 'node:path';
import crypto from 'node:crypto';
import { launch, startServer, openMurmur, armMic, sleep, writeJSON, metrics, TRACKS } from './lib.mjs';

const port = +(process.env.PORT || 9111);
const srv = await startServer(port);
const want = g => !process.env.ONLY || process.env.ONLY.split(',').includes(g);
const res = {};
let B;
const add = (k, row) => { (res[k] = res[k] || []).push(row); console.log(k, JSON.stringify(row).slice(0, 500)); };
async function boot(opts = {}) {
  if (B) await B.browser.close();
  B = await launch({ fakeMedia: true, extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 800 }, ...opts });
  if (opts.init) await B.page.addInitScript(opts.init);
  await openMurmur(B.page, port);
}
const st = (ms = 1000) => B.page.evaluate(async ms => {
  const M = window.__murmur, f0 = M.frame(), t0 = performance.now();
  await new Promise(r => setTimeout(r, ms));
  let ink = -1; try { ink = M.frameSig(16).filter(v => v > 0).length; } catch (e) { ink = e.name; }
  return { fps: +((M.frame() - f0) / ((performance.now() - t0) / 1000)).toFixed(1), ink, nan: M.pool().filter(b => !Number.isFinite(b.x)).length, layers: M.layers().length, bodies: M.pool().length, status: document.getElementById('statusText').textContent, verdict: M.preflight().verdict };
}, ms);
const shot = async () => crypto.createHash('md5').update(await B.page.screenshot({ clip: { x: 300, y: 100, width: 600, height: 500 } })).digest('hex').slice(0, 8);
const heap = async () => { await B.cdp.send('HeapProfiler.collectGarbage'); const m = await metrics(B.cdp); return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners }; };
const save = async slot => { await B.page.click('#saveBtn'); await B.page.click(`#banks .btn:nth-child(${slot})`); };
const errs = () => B.log.errors.length;

try {
  if (want('gl')) {
    await boot();
    await B.cdp.send('Performance.enable');
    await B.page.evaluate(() => { window.__murmur.state.post.chroma = .5; });
    await sleep(1500);
    add('gl', { phase: 'post on', ...(await st()), post: await B.page.evaluate(() => window.__murmur.preflight().post), s1: await shot(), s2: await shot() });
    const e0 = errs();
    await B.page.evaluate(() => { window.__lc = document.getElementById('glcv').getContext('webgl').getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
    await sleep(1500);
    add('gl', { phase: 'context lost', ...(await st()), post: await B.page.evaluate(() => window.__murmur.preflight().post), glcv: await B.page.evaluate(() => getComputedStyle(document.getElementById('glcv')).display), badge: await B.page.evaluate(() => document.getElementById('alertBadge').textContent), s1: await shot(), s2: await shot(), errors: B.log.errors.slice(e0, e0 + 3) });
    await B.page.evaluate(() => window.__lc.restoreContext());
    await sleep(2000);
    add('gl', { phase: 'context restored', ...(await st()), post: await B.page.evaluate(() => window.__murmur.preflight().post), glAlive: await B.page.evaluate(() => window.__murmur.glAlive()), glcv: await B.page.evaluate(() => getComputedStyle(document.getElementById('glcv')).display), s1: await shot(), s2: await shot(), errors: B.log.errors.slice(e0, e0 + 3) });
  }

  if (want('mixer')) {
    await boot();
    await save(1);
    await B.page.evaluate(() => window.__murmur.addLayer('word'));
    await save(2);
    await B.page.evaluate(() => window.__murmur.addLayer('pat-form'));
    await save(3);
    await B.page.click('#mixSw');
    await B.page.evaluate(() => document.activeElement.blur());
    const e0 = errs();
    await B.page.keyboard.press('1');
    await sleep(1500);
    await B.page.keyboard.press('2');
    await sleep(300);
    add('mixer', { phase: 'cued 2', decks: await B.page.evaluate(() => window.__murmur.decks()), ...(await st(500)) });
    await B.page.focus('#xfade'); await B.page.keyboard.press('ArrowRight'); await B.page.keyboard.press('ArrowRight'); await sleep(200);
    add('mixer', { phase: 'fader 0.10', decks: await B.page.evaluate(() => window.__murmur.decks()), t: await B.page.evaluate(() => window.__murmur.sceneTween() && window.__murmur.sceneTween().t) });
    await B.page.keyboard.press('End'); await sleep(500);
    add('mixer', { phase: 'fader end', decks: await B.page.evaluate(() => window.__murmur.decks()), ...(await st(500)) });
    await B.page.evaluate(() => document.activeElement.blur());
    for (let i = 0; i < 60; i++) await B.page.keyboard.press(String(1 + (i % 3)));
    await sleep(2500);
    const after = await B.page.evaluate(() => ({ decks: window.__murmur.decks(), xfOut: window.__murmur.layers().filter(L => L._xfOut).length, xfIn: window.__murmur.layers().filter(L => L._xfIn).length, tween: !!window.__murmur.sceneTween() }));
    add('mixer', { phase: '60 fast cue/play presses', ...after, ...(await st()), errors: B.log.errors.slice(e0).slice(0, 5) });
    // drag the fader with the mouse to the far end and let go
    const xb = await (await B.page.$('#xfade')).boundingBox();
    if (after.decks.next >= 0) {
      await B.page.mouse.move(xb.x + 2, xb.y + xb.height / 2); await B.page.mouse.down();
      for (let k = 0; k <= 10; k++) await B.page.mouse.move(xb.x + xb.width * k / 10, xb.y + xb.height / 2);
      await B.page.mouse.up(); await sleep(500);
      add('mixer', { phase: 'mouse drag to end', decks: await B.page.evaluate(() => window.__murmur.decks()), ...(await st(500)) });
    }
    // mixer off while a cue is live, delete the on-screen slot, save during a cue
    await B.page.keyboard.press('2'); await sleep(200);
    await B.page.click('#mixSw'); await sleep(300);
    add('mixer', { phase: 'mixer off with cue', decks: await B.page.evaluate(() => window.__murmur.decks()), xfIn: await B.page.evaluate(() => window.__murmur.layers().filter(L => L._xfIn).length), ...(await st(500)) });
    await B.page.click('#delBtn'); await B.page.click('#banks .btn:nth-child(1)'); await B.page.click('#banks .btn:nth-child(2)'); await B.page.click('#banks .btn:nth-child(3)');
    await B.page.click('#delBtn');
    add('mixer', { phase: 'all slots deleted', banks: await B.page.evaluate(() => window.__murmur.banks().filter(Boolean).length), stored: await B.page.evaluate(() => JSON.parse(localStorage.getItem('murmur_scenes_v1')).filter(Boolean).length), ...(await st(500)), errors: B.log.errors.slice(e0).slice(0, 5) });
  }

  if (want('quant')) {
    await boot({ track: path.join(TRACKS, 'silence.wav') });
    await armMic(B.page);
    await B.page.evaluate(() => document.activeElement.blur());
    for (let i = 0; i < 30; i++) await B.page.keyboard.press(['q', 'g', 'e', 'r'][i % 4]);
    await B.page.keyboard.press('Shift+1');
    await sleep(4000);
    add('quant', { phase: 'silence armed, 31 moves pressed, 4 s later', pending: await B.page.evaluate(() => window.__murmur.pending()), moving: await B.page.evaluate(() => window.__murmur.moving()), bpm: await B.page.evaluate(() => window.__murmur.features().beat.bpm), ...(await st(500)) });
    await B.page.click('#tap'); // tap tempo should give the queue a clock
    for (let i = 0; i < 4; i++) { await B.page.click('#tap'); await sleep(500); }
    await sleep(4500);
    add('quant', { phase: 'after TAP x5 at 120', pending: await B.page.evaluate(() => window.__murmur.pending()), moving: await B.page.evaluate(() => window.__murmur.moving()), bpm: await B.page.evaluate(() => window.__murmur.features().beat.bpm), persp: await B.page.evaluate(() => window.__murmur.activeLayer().cam.persp), chaos: await B.page.evaluate(() => window.__murmur.state.motion.chaos), ...(await st(500)) });
    await sleep(8000);
    add('quant', { phase: '8 s later (all moves done)', moving: await B.page.evaluate(() => window.__murmur.moving()), persp: await B.page.evaluate(() => window.__murmur.activeLayer().cam.persp), chaos: await B.page.evaluate(() => window.__murmur.state.motion.chaos), attract: await B.page.evaluate(() => window.__murmur.activeLayer().phys.attract) });
  }

  if (want('rack')) {
    await boot({ track: path.join(TRACKS, 'click_128.wav') });
    await armMic(B.page);
    await B.cdp.send('Performance.enable');
    const h0 = await heap();
    await B.page.evaluate(() => { const M = window.__murmur; M.matrix().push({ feat: 'beat.pulse', path: 'count', mode: 'up', depth: 1, curve: 'gate' }); M.buildMatrix(); });
    await sleep(8000);
    add('rack', { phase: 'count driven by beat.pulse, gate, depth 1 (8 s)', ...(await st(2000)), ...(await heap()), heapBefore: h0.heapMB });
    await B.page.evaluate(() => { const M = window.__murmur; M.matrix().length = 0; for (const p of ['cam.zoom', 'cam.persp', 'size', 'spread', 'dance', 'phys.swirl', 'echo.amount', 'post.hue', 'bgL', 'w']) M.matrix().push({ feat: 'env.bassFast', path: p, mode: 'bi', depth: 1000, curve: 'lin' }); M.buildMatrix(); });
    await sleep(3000);
    add('rack', { phase: '10 rows at depth 1000', ...(await st(1500)), cam: await B.page.evaluate(() => { const c = window.__murmur.activeLayer().cam; return { zoom: c.zoom, persp: c.persp }; }) });
    await B.page.evaluate(() => { const M = window.__murmur; M.matrix().length = 0; M.buildMatrix(); });
    await sleep(1500);
    add('rack', { phase: 'rows removed: values back to base?', cam: await B.page.evaluate(() => { const c = window.__murmur.activeLayer().cam; return { zoom: c.zoom, persp: c.persp }; }), echo: await B.page.evaluate(() => window.__murmur.state.echo.amount), hue: await B.page.evaluate(() => window.__murmur.state.post.hue), opacity: await B.page.evaluate(() => window.__murmur.activeLayer().opacity) });
  }

  if (want('maxfx')) {
    await boot({ viewport: { width: 1920, height: 1080 } });
    add('maxfx', { phase: 'baseline 1080p', ...(await st(3000)) });
    await B.page.evaluate(() => {
      const M = window.__murmur, S = M.state, L = M.activeLayer();
      Object.assign(S.echo, { amount: 1, decay: .995, zoom: 1.03, rot: .06, hue: 12 });
      Object.assign(S.kaleido, { sectors: 16, rate: 1 });
      Object.assign(S.dup, { copies: 8, scale: 1.15, fade: 1, ring: .8, spin: 1 });
      Object.assign(S.post, { chroma: 1, hue: 180, chromaAng: 45 });
      Object.assign(L.look, { links: 1, linkDist: 1.2, streak: 8, smear: 4, wave: .5, waveFreq: 6, face: 1 });
    });
    await sleep(1500);
    add('maxfx', { phase: 'every effect at max', ...(await st(4000)), errors: B.log.errors.slice(0, 3) });
    await B.page.evaluate(() => { const M = window.__murmur; M.onlyProg('mark'); M.state.logoAvoid = 2; });
    await sleep(1500);
    add('maxfx', { phase: '+ symbol, logo-as-void 2', ...(await st(3000)) });
  }

  if (want('spam')) {
    await boot();
    await B.cdp.send('Performance.enable');
    await B.page.evaluate(() => document.activeElement.blur());
    const base = await heap();
    add('spam', { phase: 'baseline', ...base });
    for (let i = 0; i < 300; i++) await B.page.keyboard.press('p');
    await sleep(1000);
    add('spam', { phase: 'palette x300', ...(await heap()), ...(await st(500)) });
    for (let i = 0; i < 200; i++) await B.page.evaluate(i => { const M = window.__murmur; const L = M.addLayer(['word', 'pat-form', 'mark', 'swarm'][i % 4]); M.removeLayer(L.id); }, i);
    await sleep(1000);
    add('spam', { phase: 'add+remove layer x200', ...(await heap()), ...(await st(500)), scrubs: await B.page.evaluate(() => Object.keys(window.__murmur.scrubs).length) });
    for (let i = 0; i < 50; i++) await B.page.evaluate(() => { const M = window.__murmur; M.duplicateLayer(M.activeLayer().id); });
    await B.page.evaluate(() => { const M = window.__murmur; for (const L of M.layers().slice(1)) M.removeLayer(L.id); });
    await sleep(1000);
    add('spam', { phase: 'duplicate x50 then remove', ...(await heap()), ...(await st(500)) });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#fff"/></svg>');
    for (let i = 0; i < 30; i++) { await B.page.setInputFiles('#fileIn', { name: 'dot' + i + '.svg', mimeType: 'image/svg+xml', buffer: svg }); await sleep(150); await B.page.click('#clearAssets'); }
    await sleep(1000);
    add('spam', { phase: 'add asset + CLEAR x30', ...(await heap()), ...(await st(500)) });
    for (let i = 0; i < 100; i++) await B.page.evaluate(() => window.__murmur.setUI(true)), await B.page.evaluate(() => window.__murmur.setUI(false));
    await sleep(1000);
    add('spam', { phase: 'hide/show UI x100', ...(await heap()), ...(await st(500)) });
  }

  if (want('dpr')) {
    await boot();
    const fr = () => B.page.evaluate(() => ({ dpr: devicePixelRatio, frame: window.__murmur.preflight().frame }));
    add('dpr', { phase: 'start', ...(await fr()) });
    await B.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
    await sleep(800);
    add('dpr', { phase: 'DPR 1 -> 2, same window size (laptop screen)', ...(await fr()) });
    await B.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    add('dpr', { phase: 'DPR 2 -> 1 (dragged to projector)', ...(await fr()) });
  }

  if (want('tab')) {
    await boot({ init: () => {
      let mode = 'video-only';
      window.__setTabMode = m => { mode = m; };
      navigator.mediaDevices.getDisplayMedia = async () => {
        if (mode === 'cancel') throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
        const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0, 0, 16, 16);
        return c.captureStream(5);
      };
    } });
    const ui = () => B.page.evaluate(() => ({ status: document.getElementById('statusText').textContent, arm: document.getElementById('arm').textContent, input: window.__murmur.input(), armed: window.__murmur.armed(), audio: window.__murmur.audioHealth() }));
    await B.page.selectOption('#inSel', 'tab'); await B.page.click('#arm'); await sleep(1000);
    add('tab', { phase: 'tab share without audio', ...(await ui()), ...(await st(500)) });
    await B.page.evaluate(() => window.__setTabMode('cancel'));
    await B.page.selectOption('#inSel', 'sys'); await B.page.click('#arm'); await sleep(1000);
    add('tab', { phase: 'system share cancelled', ...(await ui()) });
  }
} finally {
  res.errors = B ? B.log.errors.slice(0, 30) : [];
  writeJSON(process.env.OUTNAME || 'ops.json', res);
  if (B) await B.browser.close();
  srv.kill();
}
