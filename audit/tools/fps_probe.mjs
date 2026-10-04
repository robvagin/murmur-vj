// fps under different browser/viewport settings and loads.
//   node audit/tools/fps_probe.mjs
// Env FLAGS="--disable-accelerated-2d-canvas" W=1920 H=1080 DPR=1 COUNT=520 LAYERS=1
import { launch, startServer, openMurmur, sleep } from './lib.mjs';

const port = +(process.env.PORT || 8961);
const srv = await startServer(port);
const extra = (process.env.FLAGS || '').split(' ').filter(Boolean);
const { browser, page, log } = await launch({ fakeMedia: false, extra, viewport: { width: +(process.env.W || 1920), height: +(process.env.H || 1080) }, dpr: +(process.env.DPR || 1) });
try {
  await openMurmur(page, port);
  const r = await page.evaluate(async ({ count, nl, noui }) => {
    const M = window.__murmur;
    for (let i = 1; i < nl; i++) M.addLayer(i % 2 ? 'word' : 'pat-form');
    if (count) M.setCount(count);
    if (noui) M.setUI(true);
    await new Promise(r => setTimeout(r, 3000));
    const f0 = M.frame(), p0 = performance.now();
    await new Promise(r => setTimeout(r, 6000));
    return { fps: +((M.frame() - f0) / ((performance.now() - p0) / 1000)).toFixed(1), bodies: M.pool().length, frame: M.preflight().frame };
  }, { count: +(process.env.COUNT || 0), nl: +(process.env.LAYERS || 1), noui: !!process.env.NOUI });
  console.log(JSON.stringify({ flags: extra.join(' '), W: process.env.W || 1920, H: process.env.H || 1080, ...r, errors: log.errors.length }));
} finally { await browser.close(); srv.kill(); }
