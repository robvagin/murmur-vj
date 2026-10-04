// Microphone and camera failure paths.
//   node audit/tools/media.mjs
// Writes media.json into MURMUR_OUT.
import path from 'node:path';
import { launch, startServer, openMurmur, armMic, sleep, writeJSON, TRACKS } from './lib.mjs';

const port = +(process.env.PORT || 9001);
const srv = await startServer(port);
const res = [];
let B;
const ui = () => B.page.evaluate(() => ({
  status: document.getElementById('statusText').textContent,
  arm: document.getElementById('arm').textContent,
  armNote: document.getElementById('armNote').textContent,
  camNote: document.getElementById('camNote').textContent,
  camBtn: document.getElementById('camBtn').textContent,
  audio: window.__murmur.audioHealth(), cam: window.__murmur.camHealth(), input: window.__murmur.input(),
  bpm: +window.__murmur.features().beat.bpm.toFixed(1), badge: document.getElementById('alertBadge').hidden ? '' : document.getElementById('alertBadge').textContent,
  verdict: window.__murmur.preflight().verdict,
  xss: window.__xss || null,
}));
const framesIn = (ms = 1000) => B.page.evaluate(async ms => { const f = window.__murmur.frame(); await new Promise(r => setTimeout(r, ms)); return window.__murmur.frame() - f; }, ms);
async function rec(name, fn) {
  const e0 = B ? B.log.errors.length : 0;
  let threw = null;
  try { await fn(); } catch (e) { threw = String(e).slice(0, 200); }
  const row = { name, threw, ...(await ui().catch(e => ({ uiError: String(e).slice(0, 200) }))), frames1s: await framesIn().catch(() => -1), errors: B.log.errors.slice(e0).map(s => s.slice(0, 200)) };
  res.push(row);
  console.log(JSON.stringify(row).slice(0, 500));
}
async function boot(opts) {
  if (B) await B.browser.close();
  B = await launch({ extra: ['--disable-accelerated-2d-canvas'], viewport: { width: 1280, height: 800 }, ...opts });
  if (opts && opts.init) await B.page.addInitScript(opts.init);
  if (opts && opts.permissions) await B.context.grantPermissions(opts.permissions);
  await openMurmur(B.page, port);
}
try {
  // 1. permission refused (no fake UI: the prompt is dismissed)
  await boot({ fakeMedia: false, extra: ['--use-fake-device-for-media-stream', '--deny-permission-prompts', '--disable-accelerated-2d-canvas'] });
  await rec('mic-denied', async () => { await B.page.selectOption('#inSel', 'mic'); await B.page.click('#arm'); await sleep(1500); });
  await rec('cam-denied', async () => { await B.page.click('#camBtn'); await sleep(1500); });

  // 2. no devices at all
  await boot({ init: () => {
    const md = navigator.mediaDevices;
    md.enumerateDevices = () => Promise.resolve([]);
    md.getUserMedia = () => Promise.reject(Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }));
  } });
  await rec('mic-none', async () => { await B.page.selectOption('#inSel', 'mic'); await B.page.click('#arm'); await sleep(1000); });
  await rec('cam-none', async () => { await B.page.click('#camBtn'); await sleep(1000); });

  // 3. live mic, then the device goes away mid-set (track "ended"), then is muted, then context suspends
  await boot({ track: path.join(TRACKS, 'click_128.wav') });
  await rec('mic-live', async () => { await armMic(B.page); await sleep(4000); });
  await rec('mic-track-muted', () => B.page.evaluate(() => window.__murmur.audioStream().getAudioTracks()[0].dispatchEvent(new Event('mute'))));
  await rec('mic-track-unmuted', () => B.page.evaluate(() => window.__murmur.audioStream().getAudioTracks()[0].dispatchEvent(new Event('unmute'))));
  await rec('ctx-suspended', async () => { await B.page.evaluate(() => window.__murmur.ac().suspend()); await sleep(500); });
  await rec('arm-resumes', async () => { await B.page.click('#arm'); await sleep(800); });
  await rec('mic-track-ended', async () => { await B.page.evaluate(() => { const t = window.__murmur.audioStream().getAudioTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')); }); await sleep(800); });
  await rec('re-arm-after-loss', async () => { await B.page.selectOption('#inSel', 'mic'); await B.page.click('#arm'); await sleep(2500); });
  await rec('ctx-closed', async () => { await B.page.evaluate(() => window.__murmur.ac().close()); await sleep(800); });
  await rec('re-arm-after-close', async () => { await B.page.selectOption('#inSel', 'mic'); await B.page.click('#arm'); await sleep(2500); });

  // 4. camera: open, then the camera is unplugged (track ended), then muted
  await boot({});
  await rec('cam-open', async () => { await B.page.click('#camBtn'); await sleep(2500); });
  await rec('cam-ended', async () => { await B.page.evaluate(() => { const t = window.__murmur.cam().stream.getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')); }); await sleep(2500); });
  await rec('cam-muted', () => B.page.evaluate(() => window.__murmur.cam().stream && window.__murmur.cam().stream.getVideoTracks()[0].dispatchEvent(new Event('mute'))));
  await rec('cam-stop', async () => { await B.page.click('#camBtn'); await sleep(500); });

  // 5. a device whose name is markup (names come from the OS / Bluetooth)
  await boot({ init: () => {
    const md = navigator.mediaDevices, real = md.enumerateDevices.bind(md);
    md.enumerateDevices = () => real().then(d => d.concat([{ kind: 'audioinput', deviceId: 'evil', groupId: 'g', label: '<img src=x onerror="window.__xss=\'device-label\'">USB Audio', toJSON() { return this; } }]));
  } });
  await rec('device-label-markup', async () => { await B.page.dispatchEvent('#inSel', 'mousedown'); await sleep(800); });
} finally {
  writeJSON('media.json', res);
  await B.browser.close();
  srv.kill();
}
