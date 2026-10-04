// Knob sweep through the DOM, the way a user types a value into a scrub.
//   node audit/tools/knobs.mjs
// For every scrub on both panels: min, max, 10 spans above max, 10 spans below min,
// then random combinations. After each step: frame advances (no freeze), ink on the
// canvas, bodies with non-finite positions, console errors. Writes knobs.json.
import { launch, startServer, openMurmur, sleep, writeJSON } from './lib.mjs';

const port = +(process.env.PORT || 8981);
const srv = await startServer(port);
const { browser, page, log } = await launch({ fakeMedia: false, extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 900 } });

// In-page helpers: list scrubs, type a value into one, probe health.
const HELPERS = () => {
  window.__knobs = {
    list() {
      return [...document.querySelectorAll('#panel .scrub, #rightcol .scrub')].filter(e => e.offsetParent !== null || e.closest('details')).map(e => ({
        label: e.getAttribute('aria-label'), min: +e.getAttribute('aria-valuemin'), max: +e.getAttribute('aria-valuemax'), now: +e.getAttribute('aria-valuenow'),
        disabled: e.classList.contains('is-disabled'),
      }));
    },
    find(label) { return [...document.querySelectorAll('#panel .scrub, #rightcol .scrub')].find(e => e.getAttribute('aria-label') === label); },
    type(label, v) {
      const el = this.find(label);
      if (!el) return 'missing';
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, pointerId: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, pointerId: 1 }));
      const ed = el.querySelector('.sedit');
      ed.value = String(v);
      ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return 'ok';
    },
    async probe(ms = 900) {
      const M = window.__murmur, f0 = M.frame(), t0 = performance.now();
      await new Promise(r => setTimeout(r, ms));
      const s = M.frameSig(16);
      const nan = M.pool().filter(b => !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)).length;
      return { frames: M.frame() - f0, ms: Math.round(performance.now() - t0), ink: s.filter(v => v > 0).length, nan, bodies: M.pool().length };
    },
  };
};

const results = [], issues = [];
async function fresh() {
  await openMurmur(page, port);
  await page.evaluate(HELPERS);
  await page.evaluate(() => document.querySelectorAll('details.more').forEach(d => d.open = true));
  await sleep(500);
}
try {
  await fresh();
  const base = await page.evaluate(() => window.__knobs.probe());
  console.log('baseline', JSON.stringify(base));
  const knobs = await page.evaluate(() => window.__knobs.list());
  console.log('scrubs', knobs.length);
  for (const k of process.env.COMBOS_ONLY ? [] : knobs) {
    if (k.disabled) { results.push({ label: k.label, skipped: 'disabled' }); continue; }
    const span = k.max - k.min || 1;
    for (const [tag, v] of [['min', k.min], ['max', k.max], ['above', k.max + 10 * span], ['below', k.min - 10 * span]]) {
      const errs0 = log.errors.length;
      const r = await page.evaluate(([l, v]) => window.__knobs.type(l, v), [k.label, v]);
      if (r === 'missing') { results.push({ label: k.label, tag, missing: true }); break; }
      let p = await page.evaluate(() => window.__knobs.probe(700)).catch(e => ({ error: String(e) }));
      // A single slow probe can be a GC pause or CPU contention: re-probe before calling it a freeze.
      if (!p.error && p.frames < 2) p = { ...(await page.evaluate(() => window.__knobs.probe(2500)).catch(e => ({ error: String(e) }))), reprobed: true };
      const row = { label: k.label, tag, v, ...p, newErrors: log.errors.slice(errs0) };
      results.push(row);
      const bad = p.error || p.frames < 2 || p.nan > 0 || row.newErrors.length || p.ink === 0;
      if (bad) { issues.push(row); console.log('ISSUE', JSON.stringify(row)); }
      if (p.error || p.frames < 2 || p.nan > 0) { await fresh(); break; } // poisoned: start over
      await page.evaluate(([l, v]) => window.__knobs.type(l, v), [k.label, k.now]);
    }
  }
  // Random combinations inside the slider ranges.
  await fresh();
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const combos = [];
  for (let round = 0; round < 40; round++) {
    const ks = await page.evaluate(() => window.__knobs.list().filter(k => !k.disabled));
    const set = [];
    for (let j = 0; j < 8; j++) {
      const k = ks[Math.floor(rnd() * ks.length)];
      const v = +(k.min + rnd() * (k.max - k.min)).toFixed(3);
      await page.evaluate(([l, v]) => window.__knobs.type(l, v), [k.label, v]);
      set.push([k.label, v]);
    }
    const errs0 = log.errors.length;
    let p = await page.evaluate(() => window.__knobs.probe(700));
    if (p.frames < 2) p = { ...(await page.evaluate(() => window.__knobs.probe(2500))), reprobed: true };
    const row = { round, set, ...p, newErrors: log.errors.slice(errs0) };
    combos.push(row);
    if (p.frames < 2 || p.nan > 0 || row.newErrors.length || p.ink === 0) { issues.push(row); console.log('COMBO ISSUE', JSON.stringify(row)); await fresh(); }
  }
  writeJSON('knobs.json', { baseline: base, scrubs: knobs.length, issues, results, combos, errors: log.errors });
  console.log('done: scrubs', knobs.length, 'issues', issues.length, 'errors', log.errors.length);
} finally {
  await browser.close();
  srv.kill();
}
