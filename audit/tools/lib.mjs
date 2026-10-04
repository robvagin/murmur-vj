// Shared helpers for the Murmur audit scripts.
// Requires Playwright (npm i playwright, or the copy under /opt/node22/lib/node_modules).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (_) {}
  }
  throw new Error('playwright not found: npm i playwright');
}
export const { chromium } = loadPlaywright();

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
// Directory that is served (default: the repo). Point it at a clean copy of main to test the original.
export const ROOT = process.env.MURMUR_ROOT || REPO;
export const TRACKS = process.env.MURMUR_TRACKS || path.join(REPO, 'audit', 'tracks');
export const OUT = process.env.MURMUR_OUT || path.join(REPO, 'audit', 'out');
fs.mkdirSync(OUT, { recursive: true });

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Static server on 127.0.0.1, same as serve.sh but without opening a browser.
export async function startServer(port) {
  const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/index.html`); if (r.ok) return p; } catch (_) {}
    await sleep(100);
  }
  p.kill();
  throw new Error('server did not start');
}

export const GL_FLAGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export async function launch({ track = null, fakeMedia = true, extra = [], viewport = { width: 1920, height: 1080 }, dpr = 1, reducedMotion, headless = true } = {}) {
  const args = [...GL_FLAGS, '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required', ...extra];
  if (fakeMedia) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
  if (track) args.push('--use-file-for-fake-audio-capture=' + track);
  const browser = await chromium.launch({ headless, args, executablePath: process.env.CHROME_PATH || undefined });
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion });
  const page = await context.newPage();
  const log = { errors: [], warnings: [], console: [] };
  page.on('console', m => {
    const t = m.type(), s = m.text();
    log.console.push(`[${t}] ${s}`);
    if (t === 'error') log.errors.push(s);
    if (t === 'warning') log.warnings.push(s);
  });
  page.on('pageerror', e => log.errors.push('pageerror: ' + (e && e.stack || e)));
  const cdp = await context.newCDPSession(page);
  return { browser, context, page, log, cdp };
}

// Count requestAnimationFrame callbacks per second, installed before page scripts run.
export const RAF_COUNTER = `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__rafCalls = 0;
  window.requestAnimationFrame = cb => raf(t => { window.__rafCalls++; cb(t); });
})();`;

export async function openMurmur(page, port, q = '') {
  await page.goto(`http://127.0.0.1:${port}/index.html${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__murmur && window.__murmur.frame() > 5, null, { timeout: 30000 });
}

// Pick the microphone in the input menu and press ARM, as a user would.
export async function armMic(page) {
  await page.selectOption('#inSel', 'mic').catch(() => {});
  await page.click('#arm');
  await page.waitForFunction(() => window.__murmur.armed(), null, { timeout: 15000 });
}

// Non-empty frame check: share of 32x32 cells with any ink, on the 2D canvas.
export async function frameInk(page) {
  return page.evaluate(() => {
    const s = window.__murmur.frameSig(32);
    let cells = 0, px = 0;
    for (const v of s) { if (v > 0) cells++; px += v; }
    return { cells, px };
  });
}

// Count bodies whose position is not finite.
export async function nanBodies(page) {
  return page.evaluate(() => window.__murmur.pool().filter(b => !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)).length);
}

export async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o = {};
  for (const m of metrics) o[m.name] = m.value;
  return o;
}

export function writeJSON(name, data) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}
