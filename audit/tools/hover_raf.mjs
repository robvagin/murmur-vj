// rAF loops left behind when a layer card re-renders under a resting pointer.
//   node audit/tools/hover_raf.mjs   (prints rAF callbacks per frame; 2 is the healthy value)
import { launch, startServer, openMurmur, sleep, RAF_COUNTER } from './lib.mjs';
const srv = await startServer(8972);
const { browser, page, cdp } = await launch({ fakeMedia: false, viewport: { width: 1280, height: 720 } });
await page.addInitScript(RAF_COUNTER);
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'hover' }, { name: 'pointer', value: 'fine' }] }).catch(e => console.log('emul fail', e.message));
await openMurmur(page, 8972);
console.log('hover mq', await page.evaluate(() => matchMedia('(hover:hover) and (pointer:fine)').matches));
await page.evaluate(() => window.__murmur.renderFocus());
const rate = async () => page.evaluate(async () => { const r0 = window.__rafCalls, f0 = window.__murmur.frame(); await new Promise(r => setTimeout(r, 2000)); return +((window.__rafCalls - r0) / (window.__murmur.frame() - f0)).toFixed(2); });
console.log('before', await rate());
await page.evaluate(() => { const r = document.querySelector("#focusBody .row .scrub").closest(".row"); r.scrollIntoView(); });
const box = await (await page.$("#focusBody .row .scrub")).boundingBox(); console.log("box", JSON.stringify(box), await page.evaluate(([x,y]) => document.elementFromPoint(x,y)?.className, [box.x+8, box.y+6]));
await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.move(box.x + 8, box.y + 6);
await sleep(200);
console.log('hover 1 row', await rate());
for (let i = 0; i < 20; i++) { await page.evaluate(() => window.__murmur.renderFocus()); await page.mouse.move(box.x + 6 + (i % 2), box.y + 6); }
console.log('after 20 rerenders while hovering', await rate());
await page.mouse.move(1200, 700); await sleep(300);
console.log('pointer gone', await rate());
await page.evaluate(() => { for (let i = 0; i < 10; i++) { document.querySelector('#focusBody .row .scrub').closest('.row').dispatchEvent(new PointerEvent('pointerenter')); window.__murmur.renderFocus(); } });
console.log('10x synthetic pointerenter + rerender, no pointerleave', await rate());
await browser.close(); srv.kill();
