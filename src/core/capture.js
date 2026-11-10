// Deterministic capture support: a virtual clock, scoped seeded PRNGs, and the
// pure mapping (seed, t) -> scene-driving state. Shared by the browser and Node.
//
// In capture mode every animation time in the page comes from one virtual
// clock and every random draw from a seeded stream, so a frame is a pure
// function of (seed, t). No platform clocks are read here except the optional
// wall-clock fallback of createClock() when capture is off.

import { fnv1a, hashHex, mulberry32 } from './hash.js';
import { createStore } from './store.js';
import { DEFAULTS } from './reducer.js';
import { generateDemo, DEMO_BASE_TS, DEMO_DURATION_S } from './demo.js';
import { normalizeEvent } from './events.js';
import { captionTimeline } from './captions.js';

/** Simulation grid for history-dependent motion (walking, turning). */
export const CAPTURE_STEP_MS = 50;
/** Director shot length; keep in sync with web/director.js SHOT_MS. */
export const SHOT_MS = 6500;
export const CAPTURE_SEED_MAX = 99999;

/** Parse the capture URL parameters. `tms` is milliseconds from the start of the demo. */
export function parseCaptureParams(search) {
  const p = new URLSearchParams(search);
  const seed = Math.max(1, Math.min(CAPTURE_SEED_MAX, Math.trunc(Number(p.get('seed'))) || 7));
  const tms = p.has('tms') ? Number(p.get('tms')) : null;
  return {
    capture: p.get('capture') === '1',
    seed,
    tMs: tms !== null && Number.isFinite(tms) ? tms : null,
  };
}

/**
 * One clock for everything. In capture mode time only moves when set() or
 * advance() is called. Otherwise now() is the wall clock (live mode).
 */
export function createClock({ capture = false, wall = () => Date.now() } = {}) {
  let t = 0;
  return {
    capture,
    now: () => (capture ? t : wall()),
    set(ms) {
      t = ms;
    },
    advance(ms) {
      t += ms;
    },
  };
}

/** Independent, reproducible random stream per (seed, scope). */
export function captureRng(seed, scope = '') {
  return mulberry32(fnv1a(`${seed}:${scope}`));
}

export function captureDurationMs() {
  return DEMO_DURATION_S * 1000 + 4000;
}

/** Clamp and round an incoming seek time to whole milliseconds inside the timeline. */
export function normalizeSeek(tMs) {
  const n = Number(tMs);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(captureDurationMs(), Math.round(n)));
}

/** Index of the last simulation grid step at or before t. */
export function gridIndex(tMs, stepMs = CAPTURE_STEP_MS) {
  return Math.floor(tMs / stepMs);
}

/** Director shot index and progress inside it, as a pure function of t. */
export function shotAt(tMs) {
  return { index: Math.floor(tMs / SHOT_MS), u: (tMs % SHOT_MS) / SHOT_MS };
}

/**
 * Pure scene-driving state for (seed, t): the playhead, the sim grid position,
 * the director shot, the active captions and a digest of the reducer state at
 * that playhead (agents, totals). Equal inputs give equal output; the digest
 * changes whenever the visible workout changes.
 */
export function captureFrame(seed, tMs) {
  const t = normalizeSeek(tMs);
  const playhead = DEMO_BASE_TS + t;
  const store = createStore(DEFAULTS);
  store.add(generateDemo(seed).map(normalizeEvent));
  const state = store.stateAt(playhead);
  const agents = [...state.agents.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => [a.id, a.lastTs, a.unique.size, ...Object.keys(a.totals).sort().map((k) => a.totals[k])]);
  const captions = captionTimeline(store.all(), DEMO_BASE_TS + captureDurationMs(), DEFAULTS)
    .filter((c) => c.ts <= playhead && playhead < c.until)
    .map((c) => c.text);
  return {
    seed,
    tMs: t,
    playhead,
    gridIndex: gridIndex(t),
    shot: shotAt(t),
    agentCount: agents.length,
    captions,
    stateHash: hashHex(JSON.stringify(agents)),
  };
}
