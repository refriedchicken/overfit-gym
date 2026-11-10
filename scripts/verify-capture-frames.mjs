// Pixel proof for deterministic capture: the same (seed, t) must render byte-identical
// frames, different t must differ. Starts the local server on a free port, drives
// an installed Chrome-family browser (headless, software GL) over the DevTools protocol,
// hashes PNG screenshots, then kills Chrome and the server. Installs nothing.
//
//   node scripts/verify-capture-frames.mjs [--seed 7] [--a 12000] [--b 61500] [--dump DIR]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createGymServer } from '../server/server.mjs';
import { findChrome } from './chrome-path.mjs';

const CHROME = findChrome();
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? Number(process.argv[i + 1]) : d;
};
const SEED = arg('--seed', 7);
const A = arg('--a', 12_000);
const B = arg('--b', 61_500);
const DUMP = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null; // keep PNGs for inspection
let shots = 0;
const log = (lvl, msg) => console.log(`${new Date().toISOString()} | ${lvl} | ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

if (!CHROME) {
  log('SKIP', 'no Chrome-family browser found; set CHROME_PATH to run the pixel check');
  process.exit(0);
}

const gym = createGymServer({ persist: false });
const addr = await gym.listen(0);
const base = `http://127.0.0.1:${addr.port}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'overfit-capture-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-accelerated-2d-canvas', '--disable-gpu-rasterization', '--disable-lcd-text', '--font-render-hinting=none', '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1', '--window-size=1280,720', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
  { stdio: 'ignore' },
);

async function cleanup() {
  chrome.kill('SIGKILL');
  await gym.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

let failures = 0;
const check = (ok, msg) => {
  log(ok ? 'PASS' : 'FAIL', msg);
  if (!ok) failures++;
};

try {
  // find the DevTools port Chrome picked
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  const shot = async () => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(data, 'base64');
    if (DUMP) fs.writeFileSync(path.join(DUMP, `${String(++shots).padStart(2, '0')}-${sha(buf)}.png`), buf);
    return { hash: sha(buf), bytes: buf.length };
  };
  // fresh page load that seeks on load (?tms=) and signals readiness
  const loadAt = async (t) => {
    await send('Page.navigate', { url: `${base}/?capture=1&seed=${SEED}&tms=${t}&content=1` });
    for (let i = 0; i < 300; i++) {
      if (await evaluate("document.documentElement.dataset.captureReady === '1'").catch(() => false)) break;
      await sleep(100);
    }
    await evaluate('window.__overfit.ready');
    return shot();
  };

  const webgl = await (async () => {
    await send('Page.navigate', { url: `${base}/?capture=1&seed=${SEED}&tms=0` });
    await sleep(1500);
    return evaluate("(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (!g) return 'none'; const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'webgl2'; })()");
  })();
  log('INFO', `chrome webgl renderer: ${webgl}; seed ${SEED}; A=${A}ms B=${B}ms`);

  const a1 = await loadAt(A);
  const b1 = await loadAt(B);
  const a2 = await loadAt(A);
  const b2 = await loadAt(B);
  log('INFO', `fresh loads: A ${a1.hash} ${a2.hash}  B ${b1.hash} ${b2.hash}  (png bytes ${a1.bytes}/${b1.bytes})`);
  check(a1.hash === a2.hash, `same (seed ${SEED}, t ${A}) twice -> identical frames`);
  check(b1.hash === b2.hash, `same (seed ${SEED}, t ${B}) twice -> identical frames`);
  check(a1.hash !== b1.hash, 'different t -> different frames');

  // seek API on one loaded page: forwards, backwards, forwards to the same times
  const dur = await evaluate('window.__overfit.duration()');
  const inPage = [];
  for (const t of [A, B, A, B, 30_000, A]) {
    await evaluate(`window.__overfit.seek(${t})`);
    inPage.push([t, (await shot()).hash]);
  }
  log('INFO', `in-page seek sequence: ${inPage.map(([t, h]) => `${t}:${h}`).join(' ')}  duration ${dur}ms`);
  check(inPage[0][1] === inPage[2][1] && inPage[2][1] === inPage[5][1], 'seek A, B, A, ..., A in one page -> identical frames at A');
  check(inPage[1][1] === inPage[3][1], 'seek B, A, B in one page -> identical frames at B');
  check(inPage[0][1] === a1.hash && inPage[1][1] === b1.hash, 'in-page seek frames equal fresh-load frames');
  check(new Set(inPage.map((p) => p[1])).size === 3, 'three distinct times -> three distinct frames');

  // a time off the 50 ms simulation grid (the zero-length evaluation path): fresh load vs. reached by seeking around
  const C = 33_333;
  const c1 = await loadAt(C);
  await evaluate(`window.__overfit.seek(${B})`);
  await evaluate(`window.__overfit.seek(${C})`);
  const c2 = (await shot()).hash;
  await evaluate(`window.__overfit.seek(${A})`);
  await evaluate(`window.__overfit.seek(${C})`);
  const c3 = (await shot()).hash;
  log('INFO', `off-grid t=${C}: fresh ${c1.hash} after-B ${c2} after-A ${c3}`);
  check(c1.hash === c2 && c2 === c3, `off-grid t ${C} -> identical frames however it is reached`);
  check(c1.hash !== a1.hash && c1.hash !== b1.hash, 'off-grid time differs from A and B');

  // hf-seek event (seconds), the assumed HyperFrames adapter contract: move away to A first so the
  // event alone must bring the frame to B, then wait for the seek queue to drain.
  await evaluate(`window.__overfit.seek(${A})`);
  await evaluate(`window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time: ${B / 1000} } })); window.__overfit.idle()`);
  check((await shot()).hash === b1.hash, 'hf-seek event at B seconds -> same frame as seek(B ms)');
  ws.close();
} catch (err) {
  failures++;
  log('ERROR', err.stack ?? String(err));
} finally {
  await cleanup();
}
log(failures ? 'FAIL' : 'DONE', failures ? `${failures} check(s) failed` : 'all capture checks passed');
process.exit(failures ? 1 : 0);
