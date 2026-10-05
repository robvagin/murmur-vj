// Moves (Q magnet, G gather, E crowd, R snap) started on top of one another.
//   node audit/tools/moves.mjs
// A move that is replaced before it ends never runs its done(): whatever it pushed stays pushed.
import { launch, startServer, openMurmur, sleep } from './lib.mjs';

const port = +(process.env.PORT || 9121);
const srv = await startServer(port);
const { browser, page } = await launch({ fakeMedia: false, extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 800 } });
const snap = () => page.evaluate(() => { const M = window.__murmur, L = M.activeLayer(); return { attract: +L.phys.attract.toFixed(3), collide: +L.phys.collide.toFixed(3), persp: +L.cam.persp.toFixed(3), chaos: +M.state.motion.chaos.toFixed(3), moving: M.moving(), spread: (() => { let s = 0; for (const b of L.bodies) s += Math.hypot(b.x, b.y); return +(s / L.bodies.length).toFixed(3); })() }; });
const waitIdle = async () => { for (let i = 0; i < 80 && (await page.evaluate(() => window.__murmur.moving() || window.__murmur.pending())); i++) await sleep(250); };
try {
  await openMurmur(page, port);
  await page.evaluate(() => { window.__murmur.quant('off'); document.activeElement.blur(); });
  await sleep(1500);
  const base = await snap();
  console.log('base                       ', JSON.stringify(base));
  await page.evaluate(() => window.__murmur.move('magnet'));
  await sleep(2500);
  console.log('magnet running (2.5 s)     ', JSON.stringify(await snap()));
  await page.evaluate(() => window.__murmur.move('gather'));
  await waitIdle(); await sleep(1500);
  console.log('gather replaced magnet, end', JSON.stringify(await snap()));
  await page.evaluate(() => window.__murmur.move('gather'));
  await sleep(1500);
  await page.evaluate(() => window.__murmur.move('snap'));
  await waitIdle(); await sleep(500);
  console.log('snap replaced gather, end  ', JSON.stringify(await snap()));
} finally { await browser.close(); srv.kill(); }
