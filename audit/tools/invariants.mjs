// Brief invariants and basic accessibility.
//   node audit/tools/invariants.mjs
// - which font families the interface actually renders with
// - every network request the page makes after load (should be none beyond its own files)
// - interactive elements without an accessible name; keyboard reach (Tab stops)
import { launch, startServer, openMurmur, sleep, writeJSON } from './lib.mjs';

const port = +(process.env.PORT || 9171);
const srv = await startServer(port);
const { browser, page, cdp } = await launch({ fakeMedia: true, viewport: { width: 1280, height: 900 } });
const reqs = [];
page.on('request', r => reqs.push(r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, '')));
try {
  await openMurmur(page, port);
  await sleep(2500);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const fonts = {};
  for (const sel of ['.ptitle', 'legend', '.row > label', '.btn', '.scrub .sval', '.tinSelect', '#footText', '#bpmOut', '.note', '.navItem', 'kbd']) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
    if (!nodeId) continue;
    const { fonts: f } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    fonts[sel] = f.map(x => x.familyName + (x.isCustomFont ? ' (embedded)' : ' (system)')).join(', ');
  }
  const a11y = await page.evaluate(() => {
    const name = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() || (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || '';
    const els = [...document.querySelectorAll('button, input, select, [role=slider], [role=button], [tabindex="0"]')].filter(e => e.offsetParent !== null && e.type !== 'hidden' && e.type !== 'file');
    const unnamed = els.filter(e => !name(e)).map(e => e.outerHTML.slice(0, 90));
    return { interactive: els.length, unnamed: unnamed.length, examples: unnamed.slice(0, 8) };
  });
  let stops = 0, seen = new Set();
  for (let i = 0; i < 400; i++) { await page.keyboard.press('Tab'); const id = await page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute('aria-label') || a.className || a.tagName) + '|' + [...a.parentNode.children].indexOf(a) : ''; }); if (seen.has(id)) break; seen.add(id); stops++; }
  const after = reqs.filter(u => !/^\/(index\.html|audio-core\.js|assets\/symbol\.svg|favicon\.ico)$/.test(u.split('?')[0]) && !u.startsWith('data:') && !u.startsWith('blob:'));
  const res = { fonts, requests: [...new Set(reqs.filter(u => !u.startsWith('data:')))], unexpectedRequests: after, a11y, tabStops: stops };
  console.log(JSON.stringify(res, null, 1));
  writeJSON('invariants.json', res);
} finally { await browser.close(); srv.kill(); }
