// Footer hint shown when hovering the camera Tilt (Space · view) and the body tilt (layer card).
//   node audit/tools/hints.mjs
import { launch, startServer, openMurmur, sleep } from './lib.mjs';
const port = +(process.env.PORT || 9131);
const srv = await startServer(port);
const { browser, page } = await launch({ fakeMedia: false, viewport: { width: 1280, height: 1000 } });
try {
  await openMurmur(page, port);
  await page.evaluate(() => document.querySelectorAll('details.more').forEach(d => d.open = true));
  const hint = async sel => { await page.hover(sel); await sleep(100); return page.textContent('#footText'); };
  console.log('Space · view Tilt scrub :', await hint('[data-mnt="tilt"] .scrub'));
  console.log('Space · view Tilt label :', await hint('#gSpace .row:nth-of-type(3) label'));
  const body = await page.evaluate(() => { const e = [...document.querySelectorAll('#focusBody .scrub')].find(x => /tilt · base/.test(x.getAttribute('aria-label'))); e.scrollIntoView(); return e.getAttribute('aria-label'); });
  console.log('card body tilt scrub    :', await hint(`#focusBody .scrub[aria-label="${body}"]`));
} finally { await browser.close(); srv.kill(); }
