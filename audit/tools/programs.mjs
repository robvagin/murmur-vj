// Every layer program (behaviours, patterns, axis, layouts, forms) under live audio,
// then that program's own card knobs: min, max, 10 spans above, 10 spans below.
//   node audit/tools/programs.mjs        Env: ONLY=id1,id2  SKIP_KNOBS=1
// Writes programs.json into MURMUR_OUT.
import path from 'node:path';
import { launch, startServer, openMurmur, armMic, sleep, writeJSON, TRACKS } from './lib.mjs';

const port = +(process.env.PORT || 9101);
const srv = await startServer(port);
const { browser, page, log } = await launch({ track: path.join(TRACKS, 'click_128.wav'), extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 900 } });
const out = { programs: [], knobIssues: [], errors: [] };
const probe = (ms = 1500) => page.evaluate(async ms => {
  const M = window.__murmur, f0 = M.frame(), t0 = performance.now();
  await new Promise(r => setTimeout(r, ms));
  const L = M.activeLayer();
  const bodies = L ? L.bodies : [];
  return {
    fps: +((M.frame() - f0) / ((performance.now() - t0) / 1000)).toFixed(1),
    ink: M.frameSig(16).filter(v => v > 0).length,
    nan: bodies.filter(b => !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)).length,
    mpNan: bodies.filter(b => b.mx != null && (!Number.isFinite(b.mx) || !Number.isFinite(b.my))).length,
    bodies: bodies.length,
    spread: (() => { if (!bodies.length) return 0; let x0 = 1e9, x1 = -1e9; for (const b of bodies) { if (b.x < x0) x0 = b.x; if (b.x > x1) x1 = b.x; } return +(x1 - x0).toFixed(2); })(),
  };
}, ms);
const typeInto = (label, v) => page.evaluate(([label, v]) => {
  const el = [...document.querySelectorAll('#focusBody .scrub')].find(e => e.getAttribute('aria-label') === label);
  if (!el) return null;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10 }));
  const ed = el.querySelector('.sedit'); ed.value = String(v);
  ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return el.getAttribute('aria-valuenow');
}, [label, v]);
try {
  await openMurmur(page, port);
  await armMic(page);
  await page.evaluate(() => document.querySelectorAll('details.more').forEach(d => d.open = true));
  let ids = await page.evaluate(() => window.__murmur.presetsAll().map(P => [P.id, P.group, P.label]));
  if (process.env.ONLY) ids = ids.filter(([id]) => process.env.ONLY.split(',').includes(id));
  console.log('programs', ids.length);
  for (const [id, group, label] of ids) {
    const e0 = log.errors.length;
    await page.evaluate(id => { const M = window.__murmur; for (const L of M.layers().slice()) M.removeLayer(L.id); M.addLayer(id); }, id);
    await page.evaluate(() => document.querySelectorAll('details.more').forEach(d => d.open = true));
    const p = await probe(2500);
    const row = { id, group, label, ...p, errors: log.errors.slice(e0).map(s => s.slice(0, 200)) };
    out.programs.push(row);
    console.log(JSON.stringify(row));
    if (process.env.SKIP_KNOBS) continue;
    // the program's own card knobs
    // FULL=id1,id2: every card knob for these programs; the rest get only their own program knobs.
    const full = (process.env.FULL || '').split(',').includes(id);
    const own = await page.evaluate(id => { const M = window.__murmur, L = M.activeLayer(), P = M.programs()[id]; return P.params.map(d => L.label + ' ' + d.label); }, id);
    const knobs = (await page.evaluate(() => [...document.querySelectorAll('#focusBody .scrub')].map(e => ({ label: e.getAttribute('aria-label'), min: +e.getAttribute('aria-valuemin'), max: +e.getAttribute('aria-valuemax'), now: +e.getAttribute('aria-valuenow') })))).filter(k => full || own.includes(k.label));
    row.knobsTested = knobs.length;
    for (const k of knobs) {
      const span = k.max - k.min || 1;
      for (const [tag, v] of [['min', k.min], ['max', k.max], ['above', k.max + 10 * span], ['below', k.min - 10 * span]]) {
        const e1 = log.errors.length;
        if ((await typeInto(k.label, v)) == null) break;
        let q = await probe(500);
        if (q.fps < 2) q = { ...(await probe(2000)), reprobed: true };
        const bad = q.nan > 0 || q.mpNan > 0 || log.errors.length > e1 || q.fps < 2 || (q.ink === 0 && !/opacity|presence|layer presence/.test(k.label));
        if (bad) { const r = { id, knob: k.label, tag, v, ...q, errors: log.errors.slice(e1).map(s => s.slice(0, 200)) }; out.knobIssues.push(r); console.log('ISSUE', JSON.stringify(r)); }
        await typeInto(k.label, k.now);
        if (q.nan > 0) { await page.evaluate(id => { const M = window.__murmur; for (const L of M.layers().slice()) M.removeLayer(L.id); M.addLayer(id); }, id); break; }
      }
    }
  }
} finally {
  out.errors = log.errors.slice(0, 50);
  writeJSON(process.env.OUTNAME || 'programs.json', out);
  await browser.close();
  srv.kill();
}
