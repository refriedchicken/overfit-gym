import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClock, captureRng, captureFrame, normalizeSeek, gridIndex, shotAt, parseCaptureParams, captureDurationMs, CAPTURE_STEP_MS } from '../src/core/capture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('virtual clock only moves when told to, and ignores the wall clock in capture mode', () => {
  const wall = () => {
    throw new Error('wall clock must not be read');
  };
  const c = createClock({ capture: true, wall });
  assert.equal(c.now(), 0);
  c.set(1234);
  assert.equal(c.now(), 1234);
  c.advance(16);
  assert.equal(c.now(), 1250);
  c.set(1234);
  assert.equal(c.now(), 1234, 'setting back is exact');
  let w = 5;
  const live = createClock({ wall: () => w });
  assert.equal(live.now(), 5);
  w = 9;
  assert.equal(live.now(), 9);
});

test('seeded streams repeat per (seed, scope) and differ across seeds and scopes', () => {
  const draw = (seed, scope) => {
    const r = captureRng(seed, scope);
    return [r(), r(), r(), r()];
  };
  assert.deepEqual(draw(7, 'scene'), draw(7, 'scene'));
  assert.notDeepEqual(draw(7, 'scene'), draw(8, 'scene'));
  assert.notDeepEqual(draw(7, 'scene'), draw(7, 'camera'));
  for (const v of draw(7, 'scene')) assert.ok(v >= 0 && v < 1);
});

test('seek times are normalized to whole ms inside the timeline', () => {
  assert.equal(normalizeSeek(-5), 0);
  assert.equal(normalizeSeek(NaN), 0);
  assert.equal(normalizeSeek(1234.4), 1234);
  assert.equal(normalizeSeek(1e12), captureDurationMs());
  assert.equal(gridIndex(CAPTURE_STEP_MS * 3 + 1), 3);
  assert.deepEqual(shotAt(6500 * 2 + 3250), { index: 2, u: 0.5 });
});

test('captureFrame: same (seed, t) gives identical state, different t gives different state', () => {
  const a = captureFrame(7, 62_000);
  const b = captureFrame(7, 62_000);
  assert.deepEqual(a, b);
  const early = captureFrame(7, 4_000);
  const late = captureFrame(7, 90_000);
  assert.notEqual(early.stateHash, late.stateHash);
  assert.notEqual(late.stateHash, a.stateHash);
  assert.notDeepEqual(early, late);
  assert.notEqual(captureFrame(7, 62_000).stateHash, captureFrame(8, 62_000).stateHash);
});

test('captureFrame does not depend on seek order (forwards, backwards, forwards)', () => {
  const order = [10_000, 80_000, 30_000, 80_000, 10_000];
  const first = new Map();
  for (const t of order) {
    const f = captureFrame(7, t);
    if (first.has(t)) assert.deepEqual(f, first.get(t));
    else first.set(t, f);
  }
});

test('capture URL parameters', () => {
  assert.deepEqual(parseCaptureParams('?capture=1&seed=7&tms=1234'), { capture: true, seed: 7, tMs: 1234 });
  assert.deepEqual(parseCaptureParams('?seed=0'), { capture: false, seed: 7, tMs: null });
  assert.equal(parseCaptureParams('?capture=1&seed=999999').seed, 99999);
});

// Guard: nothing that draws a frame may read a platform clock or unseeded randomness.
// Wall-clock use is routed through createClock() in src/core/capture.js.
const FORBIDDEN = /\b(Math\.random|performance\.now|Date\.now)\b/;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

test('scene, director, app and HUD use no raw clocks or Math.random', () => {
  const files = [...fs.readdirSync(path.join(ROOT, 'web/scene')).filter((f) => f.endsWith('.js')).map((f) => `web/scene/${f}`), 'web/director.js', 'web/app.js', 'web/hud.js'];
  assert.ok(files.length >= 8);
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const hit = code.match(FORBIDDEN);
    assert.equal(hit, null, `${f} uses ${hit?.[0]}; route it through the capture clock or a seeded PRNG`);
  }
});

test('the guard itself catches violations', () => {
  assert.match(stripComments('const t = performance.now();'), FORBIDDEN);
  assert.doesNotMatch(stripComments('// Date.now() is banned\nconst x = 1;'), FORBIDDEN);
});

test('capture page contract is present in app.js', () => {
  const app = fs.readFileSync(path.join(ROOT, 'web/app.js'), 'utf8');
  for (const needle of ["params.get('capture') === '1'", 'window.__overfit', "'hf-seek'", 'duration:', 'seek: captureSeek']) assert.ok(app.includes(needle), needle);
});
