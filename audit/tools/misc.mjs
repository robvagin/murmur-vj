// Two code-reading suspicions checked at runtime.
//   node audit/tools/misc.mjs
// 1. applyScene() merges into DEFAULT_SCENE objects, so a scene without a block inherits the previous one.
// 2. Speed typed to 0: does a new layer ever fade in?
import { launch, startServer, openMurmur, sleep } from './lib.mjs';
const srv = await startServer(+(process.env.PORT || 9091));
const { browser, page } = await launch({ fakeMedia: false, viewport: { width: 1280, height: 800 } });
try {
  await openMurmur(page, +(process.env.PORT || 9091));
  const r1 = await page.evaluate(() => {
    const M = window.__murmur;
    M.scene.apply({ v: 2, post: { chroma: 0.5, hue: 40 } });
    const after1 = { ...M.state.post };
    M.scene.apply({ v: 2 }); // no post block: should fall back to defaults (chroma 0, hue 0)
    return { afterSceneWithPost: after1, afterSceneWithoutPost: { ...M.state.post } };
  });
  console.log('defaults', JSON.stringify(r1));
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.scrub')].find(e => e.getAttribute('aria-label') === 'Speed');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10 })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10 }));
    const ed = el.querySelector('.sedit'); ed.value = '0'; ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    window.__L = window.__murmur.addLayer('pat-form');
  });
  await sleep(3000);
  console.log('speed0', JSON.stringify(await page.evaluate(() => ({ speed: window.__murmur.motionSpeed(), newLayerLife: window.__L.life.k }))));
} finally { await browser.close(); srv.kill(); }
