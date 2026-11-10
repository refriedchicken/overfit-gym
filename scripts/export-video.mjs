// Export the seeded demo as an MP4, frame by frame.
//
//   npm start                                   # the gym must be running
//   node scripts/export-video.mjs --out captures/demo.mp4
//
// It drives an installed Chrome-family browser over the DevTools protocol in capture
// mode (?capture=1): every frame is drawn by an explicit seek, so the video is
// exactly 24 fps with no dropped frames however slow the machine is. Frames are
// piped to ffmpeg, which can mux an audio track.
//
// Needs: a Chrome-family browser (or CHROME_PATH) and ffmpeg on PATH. Nothing is installed.
//
// Flags:
//   --seed N              demo seed (default 7)
//   --out FILE            output .mp4 (default captures/overfit-gym-demo.mp4)
//   --audio FILE          optional audio file to mux
//   --size WxH            frame size (default 1920x1080)
//   --fps N               frame rate (default 24, which matches the film grain cadence)
//   --from S --to S       render only part of the timeline (seconds)
//   --look NAME           film80 (default) or default
//   --quality NAME        high (default), medium, low
//   --crf N               x264 quality, lower is better and bigger (default 18; film grain is costly)
//   --software            use software GL (slow, but pixel-deterministic)
//   --url BASE            gym address (default http://127.0.0.1:4377)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from './chrome-path.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(name);
const log = (lvl, msg) => console.log(`${new Date().toISOString()} | ${lvl} | ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mode = 'demo';
const out = path.resolve(arg('--out', path.join(ROOT, 'captures', `overfit-gym-${mode}.mp4`)));
const [W, H] = arg('--size', '1920x1080').split('x').map(Number);
const fps = Math.max(1, Math.min(60, Number(arg('--fps', 24))));
const base = arg('--url', `http://127.0.0.1:${process.env.OVERFIT_PORT || 4377}`);
const look = arg('--look', 'film80');
const quality = arg('--quality', 'high');
const audio = arg('--audio', null);
const CHROME = findChrome();

if (!CHROME) {
  log('ERROR', 'no Chrome-family browser found (set CHROME_PATH)');
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
// Render to a partial file and rename at the end, so a finished name always means a finished, playable file.
const partial = `${out}.partial`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'overfit-export-'));
const gl = flag('--software') ? ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'] : ['--enable-gpu'];
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, ...gl, '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1', `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
  { stdio: 'ignore' },
);
let ffmpeg = null;
const cleanup = () => {
  chrome.kill('SIGKILL');
  fs.rmSync(profile, { recursive: true, force: true });
};
process.on('SIGINT', () => {
  cleanup();
  ffmpeg?.kill('SIGKILL');
  process.exit(130);
});

try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => (pending.set(++id, { res, rej }), ws.send(JSON.stringify({ id, method, params }))));
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page error');
    return r.result.value;
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const q = new URLSearchParams({ capture: '1', mode, clean: '1', look, quality, content: '1' });
  q.set('seed', arg('--seed', '7'));
  await send('Page.navigate', { url: `${base}/?${q}` });
  for (let i = 0; i < 600; i++) {
    if (await evaluate("document.documentElement.dataset.captureReady === '1'").catch(() => false)) break;
    await sleep(100);
  }
  await evaluate('window.__overfit.ready');
  const durationMs = await evaluate('window.__overfit.duration()');
  const renderer = await evaluate("(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()");
  const from = Math.max(0, Number(arg('--from', 0)));
  const to = Math.min(durationMs / 1000, Number(arg('--to', durationMs / 1000)));
  const frames = Math.round((to - from) * fps);
  log('INFO', `${mode} ${W}x${H} @ ${fps} fps, ${from.toFixed(1)}s to ${to.toFixed(1)}s = ${frames} frames, look ${look}, GL: ${renderer}`);

  const ffArgs = ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
  if (audio) ffArgs.push('-ss', String(from), '-i', audio);
  ffArgs.push('-map', '0:v:0');
  if (audio) ffArgs.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k');
  ffArgs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(Math.max(0, Math.min(40, Number(arg('--crf', 18))))), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(to - from), '-f', 'mp4', partial);
  ffmpeg = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res) => ffmpeg.on('close', res));

  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    const tMs = Math.round((from + f / fps) * 1000);
    await evaluate(`window.__overfit.seek(${tMs})`);
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
    const buf = Buffer.from(data, 'base64');
    if (!ffmpeg.stdin.write(buf)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    if (f % (fps * 10) === 0 && f > 0) {
      const per = (Date.now() - started) / f;
      log('INFO', `frame ${f}/${frames} (${(tMs / 1000).toFixed(0)}s), ${per.toFixed(0)} ms/frame, about ${Math.round(((frames - f) * per) / 60000)} min left`);
    }
  }
  ffmpeg.stdin.end();
  const code = await ffDone;
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
  fs.renameSync(partial, out);
  log('INFO', `wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB) in ${Math.round((Date.now() - started) / 60000)} min${audio ? '' : ', no audio'}`);
} catch (err) {
  log('ERROR', err.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
