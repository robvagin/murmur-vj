// Hostile inputs: formation text, dropped SVG/PNG, scene JSON import, storage.
//   node audit/tools/inputs.mjs        (fixtures from make_fixtures.py in MURMUR_FIXTURES)
// Writes inputs.json and screenshots into MURMUR_OUT.
import path from 'node:path';
import { launch, startServer, openMurmur, sleep, writeJSON, OUT, REPO } from './lib.mjs';

const FIX = process.env.MURMUR_FIXTURES || path.join(REPO, 'audit', 'fixtures');
const port = +(process.env.PORT || 8991);
const srv = await startServer(port);
const res = {};
// ONLY=word,files,import,storage runs a subset.
const want = g => !process.env.ONLY || process.env.ONLY.split(',').includes(g);
let B;
async function boot(opts = {}) {
  if (B) await B.browser.close();
  B = await launch({ fakeMedia: false, extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 800 }, ...opts });
  if (opts.init) await B.page.addInitScript(opts.init);
  await openMurmur(B.page, port);
  return B;
}
const probe = (ms = 800) => B.page.evaluate(async ms => {
  const M = window.__murmur, f0 = M.frame();
  await new Promise(r => setTimeout(r, ms));
  let ink = -1, tainted = false;
  try { ink = M.frameSig(16).filter(v => v > 0).length; } catch (e) { tainted = String(e.name); }
  return {
    frames: M.frame() - f0, ink, tainted,
    nan: M.pool().filter(b => !Number.isFinite(b.x) || !Number.isFinite(b.y)).length,
    bodies: M.pool().length, layers: M.layers().length,
    status: document.getElementById('statusText').textContent,
    xss: window.__xss || null,
  };
}, ms);
const step = async (group, name, fn, ms) => {
  const e0 = B.log.errors.length;
  let threw = null;
  try { await fn(); } catch (e) { threw = String(e).slice(0, 200); }
  const p = await probe(ms).catch(e => ({ probeError: String(e).slice(0, 200) }));
  const row = { name, threw, ...p, errors: B.log.errors.slice(e0).map(s => s.slice(0, 300)) };
  (res[group] = res[group] || []).push(row);
  console.log(group, JSON.stringify(row).slice(0, 400));
  return row;
};

try {
  // ---------- formation text
  if (want('word')) {
  await boot();
  await B.page.keyboard.press('w'); // adds the text layer
  await sleep(400);
  for (const [name, txt] of [['empty', ''], ['spaces', '   '], ['long500', 'MURMUR'.repeat(84)], ['emoji', '🔥🎧🔥'], ['cyrillic', 'МУРМУР'], ['rtl', 'שלום עולם'], ['rlo-override', '‮MURMUR'], ['zero-width', '​​'], ['combining', 'Z͓͔͕͑͒'.repeat(20)]]) {
    await step('word', name, () => B.page.evaluate(t => { const i = document.getElementById('fText'); i.value = t; i.dispatchEvent(new Event('input')); }, txt), 900);
    res.word[res.word.length - 1].formPts = await B.page.evaluate(() => window.__murmur.formationPoints().length);
  }
  await B.page.screenshot({ path: path.join(OUT, 'word_combining.png') });
  }

  // ---------- dropped files
  if (want('files')) {
  await boot();
  // make every body wear an asset so a dropped picture is certainly drawn
  const assetsAll = () => B.page.evaluate(() => { const L = window.__murmur.activeLayer(); L.look.assetShare = 1; L.look.tint = 0; window.__murmur.rebuildTex(); });
  for (const f of ['xss_script.svg', 'xss_onload.svg', 'xss_foreign.svg', 'xss_href.svg', 'nosize.svg', 'huge_dims.svg', 'broken.png', 'empty.png']) {
    await step('files', f, async () => { await B.page.setInputFiles('#fileIn', path.join(FIX, f)); await sleep(700); await assetsAll(); }, 900);
  }
  await step('files', 'chroma-on-with-assets', () => B.page.evaluate(() => { window.__murmur.state.post.chroma = .5; }), 900);
  res.files.push({ note: 'assets', count: await B.page.evaluate(() => document.getElementById('assetNote').textContent) });
  await B.page.screenshot({ path: path.join(OUT, 'files_svg.png') });
  await step('files', 'huge_12000.png', async () => { await B.page.setInputFiles('#fileIn', path.join(FIX, 'huge_12000.png')); await sleep(4000); await assetsAll(); }, 1500);
  }

  // ---------- scene JSON import
  if (want('import')) for (const f of ['scene_not_json.json', 'scene_null.json', 'scene_array.json', 'scene_number.json', 'scene_foreign.json', 'scene_unknown_prog.json', 'scene_count_string.json', 'scene_damp_negative.json', 'scene_look_strings.json', 'scene_bad_stops.json', 'scene_v99.json', 'scene_huge.json', 'scene_count_huge.json'].filter(f => !(process.env.SKIP || '').split(',').includes(f))) {
    await boot();
    const t0 = Date.now();
    const r = await step('import', f, async () => { await B.page.setInputFiles('#sceneFile', path.join(FIX, f)); await sleep(f === 'scene_huge.json' || f === 'scene_count_huge.json' ? 6000 : 800); }, 1200);
    r.wallMs = Date.now() - t0;
    if (f === 'scene_damp_negative.json') {
      // put damp back to a sane value: do the bodies come back?
      await step('import', 'damp-reset-after-negative', () => B.page.evaluate(() => { const L = window.__murmur.activeLayer(); L.phys.damp = .93; }), 1200);
      await step('import', 'redeal-after-negative', () => B.page.click('#focusBody .seg .btn'), 1200);
    }
  }

  // ---------- storage
  if (want('storage')) {
  await boot({ init: () => { try { if (!sessionStorage.__x) { sessionStorage.__x = 1; localStorage.setItem('murmur_scenes_v1', JSON.stringify({ v: 3, slots: [] })); } } catch (_) {} } });
  res.storage = [{ name: 'banks-stored-as-object', booted: true, errors: B.log.errors.slice(0, 5) }];
  }
} catch (e) {
  console.log('boot failure', String(e).slice(0, 300));
  (res.storage = res.storage || []).push({ name: 'banks-stored-as-object', booted: false, error: String(e).slice(0, 300), pageErrors: B && B.log.errors.slice(0, 5) });
}
try {
  if (want('storage')) {
  await boot();
  await step('storage', 'quota-full-then-save', async () => {
    await B.page.evaluate(() => { const s = 'x'.repeat(1 << 20); let i = 0; try { for (; i < 20; i++) localStorage.setItem('junk' + i, s); } catch (_) {} try { for (let j = 0; j < 1024; j++) localStorage.setItem('junkb' + j, 'x'.repeat(1 << 10)); } catch (_) {} });
    await B.page.click('#saveBtn'); await B.page.click('#banks .btn:nth-child(1)');
  }, 600);
  res.storage.push({ name: 'preflight-when-full', verdict: await B.page.evaluate(() => window.__murmur.preflight().verdict) });
  // session saved by an older build with a different layout, then RESTORE
  await B.page.evaluate(() => { localStorage.clear(); localStorage.setItem('murmur.session', JSON.stringify({ at: Date.now(), v: 1, scene: { v: 1, layers: [{ prog: 'pat-burst', count: 'many', look: { size: 'big' } }] } })); });
  await B.page.reload(); await B.page.waitForFunction(() => window.__murmur && window.__murmur.frame() > 5);
  await step('storage', 'restore-old-format-session', () => B.page.evaluate(() => document.getElementById('restoreBtn').click()), 1500);
  }
} finally {
  writeJSON('inputs' + (process.env.ONLY ? '_' + process.env.ONLY.replace(/,/g, '_') : '') + '.json', res);
  await B.browser.close();
  srv.kill();
}
