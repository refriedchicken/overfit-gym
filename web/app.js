// Overfit Gym app: event source -> store -> reducer state at playhead -> scene + HUD.
import { LOOK } from './look.js';
import { normalizeEvent, normalizeBatch, compareEvents, LIMITS } from '/core/events.js';
import { paceOne, pacingLag } from '/core/pacing.js';
import { createStore } from '/core/store.js';
import { DEFAULTS, BURST_REP_MS } from '/core/reducer.js';
import { lookFor } from '/core/evolution.js';
import { captionTimeline } from '/core/captions.js';
import { generateDemo, DEMO_BASE_TS, DEMO_DURATION_S } from '/core/demo.js';
import { createClock, normalizeSeek, gridIndex, captureFrame, captureDurationMs, CAPTURE_STEP_MS } from '/core/capture.js';
import { hashHex } from '/core/hash.js';
import { formatRatio } from '/core/metrics.js';
import { importReplay, computeRecap, formatDuration } from '/core/replay-export.js';
import { createWorld } from './scene/world.js';
import { createDirector } from './director.js';
import { renderRoster, renderGlobal, renderInspector, renderFeed, renderLabels, fmtDur } from './hud.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?capture=1 puts the page under a single virtual clock for frame-stepped export
// (scripts/export-video.mjs): no wall-clock animation, no rAF loop, frames only on seek.
const CAPTURE = params.get('capture') === '1';
const clock = createClock({ capture: CAPTURE });
const app = $('app');
const canvas = $('gym');

const world = createWorld(canvas);
const director = createDirector(world, canvas);
const store = createStore(DEFAULTS);

const S = {
  mode: params.get('mode') === 'live' && !CAPTURE ? 'live' : 'demo',
  seed: Math.max(1, Math.min(99999, Number(params.get('seed')) || 7)),
  playing: true,
  speed: [0.5, 1, 2, 4].includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 1,
  playhead: 0,
  start: 0,
  end: 0,
  followLive: true,
  content: params.get('content') === '1',
  selected: null,
  captions: [],
  snap: true,
  conn: { state: 'idle', lastEventAt: null, events: 0 },
  replay: null, // header of a loaded replay bundle; playback uses the 'demo' timeline
};

let es = null;
let healthTimer = null;
let captionsDirty = false;

// ---------- sources ----------

function resetScene() {
  store.clear();
  $('recap').hidden = true;
  S.recap = null;
  live.raw = [];
  live.ids.clear();
  live.lastByAgent = new Map();
  live.last = null;
  world.reset();
  S.selected = null;
  director.follow(null);
  S.captions = [];
  S.snap = true;
}

function loadDemo(seed) {
  stopLive();
  resetScene();
  S.mode = 'demo';
  S.replay = null;
  S.seed = seed;
  store.add(generateDemo(seed).map(normalizeEvent));
  S.start = DEMO_BASE_TS;
  S.end = DEMO_BASE_TS + DEMO_DURATION_S * 1000 + 4000;
  S.playhead = S.start;
  S.captions = captionTimeline(store.all(), S.end, DEFAULTS);
  S.playing = true;
  syncUrl();
  syncControls();
}

/** Load a verified replay bundle (text). Throws ReplayError if it fails validation or the hash check. */
function loadReplayText(text, name) {
  const bundle = importReplay(text);
  stopLive();
  resetScene();
  S.mode = 'demo';
  S.replay = bundle.header;
  S.seed = bundle.header.seed ?? S.seed;
  store.add(bundle.events);
  S.start = store.firstTs ?? clock.now();
  S.end = (store.lastTs ?? S.start) + 4000;
  S.playhead = S.start;
  S.captions = captionTimeline(store.all(), S.end, DEFAULTS);
  S.playing = true;
  S.recap = computeRecap(bundle);
  S.replayName = name;
  syncUrl();
  syncControls();
  showRecap();
}

function showRecap() {
  const r = S.recap;
  const el = $('recap');
  if (!S.replay || !r) return void (el.hidden = true);
  const rate = r.passRate === null ? 'n/a' : `${Math.round(r.passRate * 100)}%`;
  el.hidden = false;
  el.textContent = `${r.label} RECAP: ${r.runs} runs, ${r.pass} pass / ${r.fail} fail (${rate}), ${r.flaky} flaky, ${r.reruns} reruns, top agent ${r.topAgent ? r.topAgent.label : 'none'}, ${formatDuration(r.durationMs)}`;
}

function replayFailed(err) {
  const el = $('recap');
  el.hidden = false;
  el.textContent = `Replay rejected: ${err.message}`;
}

function stopLive() {
  es?.close();
  es = null;
  clearInterval(healthTimer);
  healthTimer = null;
}

async function startLive() {
  stopLive();
  resetScene();
  S.mode = 'live';
  S.followLive = true;
  S.playing = true;
  S.conn = { state: 'connecting', lastEventAt: null, events: 0 };
  S.start = S.end = S.playhead = clock.now(); // sane timeline while the log loads
  syncUrl();
  syncControls();
  try {
    const r = await fetch('/api/events', { cache: 'no-store' });
    const { events } = await r.json();
    ingest(events);
  } catch {
    S.conn.state = 'offline';
  }
  const now = clock.now();
  S.start = Math.max(store.firstTs ?? now, now - LIVE_HISTORY_MS);
  S.end = now;
  S.playhead = now;
  es = new EventSource('/api/stream');
  let connectedOnce = false;
  es.addEventListener('hello', async () => {
    S.conn.state = 'ok';
    // After a reconnect (or server restart) refetch the log: events accepted
    // during the gap never came over SSE. ingest() dedupes by id.
    if (connectedOnce) {
      try {
        ingest((await (await fetch('/api/events', { cache: 'no-store' })).json()).events);
      } catch {
        S.conn.state = 'reconnecting';
      }
    }
    connectedOnce = true;
  });
  es.addEventListener('events', (m) => {
    S.conn.state = 'ok';
    ingest(JSON.parse(m.data));
    S.conn.lastEventAt = clock.now();
  });
  es.addEventListener('ping', () => (S.conn.state = 'ok'));
  es.onerror = () => (S.conn.state = es.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
  const poll = async () => {
    try {
      const h = await (await fetch('/api/health', { cache: 'no-store' })).json();
      S.conn.events = h.events;
      if (h.lastEventAt) S.conn.lastEventAt = h.lastEventAt;
    } catch {
      S.conn.state = 'offline';
    }
  };
  poll();
  healthTimer = setInterval(poll, 4000);
}

// Live events are paced for display (see core/pacing.js): a 50 ms test run is
// spread out so each rep is visible. Order and counts are untouched.
const live = { raw: [], ids: new Set(), lastByAgent: new Map(), last: null };

function ingest(raw) {
  // The server already validated these; validate again so the client never trusts input blindly.
  // Validate in schema-sized chunks: the initial log can hold thousands of events.
  const events = [];
  for (let i = 0; i < raw.length; i += LIMITS.batch) events.push(...normalizeBatch({ events: raw.slice(i, i + LIMITS.batch) }).events);
  const fresh = events.filter((e) => !live.ids.has(e.id)).sort(compareEvents);
  if (!fresh.length) return;
  for (const e of fresh) live.ids.add(e.id);
  const inOrder = !live.last || compareEvents(fresh[0], live.last) > 0;
  live.raw.push(...fresh);
  if (inOrder) store.add(fresh.map((e) => paceOne(e, live.lastByAgent)));
  else {
    // A late event: rebuild pacing from scratch so the result stays deterministic.
    live.raw.sort(compareEvents);
    live.lastByAgent = new Map();
    store.clear();
    store.add(live.raw.map((e) => paceOne(e, live.lastByAgent)));
    S.snap = true;
  }
  live.last = live.raw[live.raw.length - 1];
  captionsDirty = true;
  if (S.start === 0 || (store.firstTs && store.firstTs < S.start)) S.start = Math.max(store.firstTs, clock.now() - LIVE_HISTORY_MS);
}

setInterval(() => {
  if (!captionsDirty || S.mode !== 'live') return;
  captionsDirty = false;
  S.captions = captionTimeline(store.all(), clock.now(), DEFAULTS);
}, 1000);

// ---------- controls ----------

function syncUrl() {
  if (CAPTURE) return; // keep the capture parameters (seed, tms) stable
  const p = new URLSearchParams();
  p.set('mode', S.mode);
  if (S.mode === 'demo' && !S.replay) p.set('seed', S.seed);
  if (S.replay && S.replayPath) p.set('replay', S.replayPath);
  if (S.speed !== 1) p.set('speed', S.speed);
  if (S.content) p.set('content', '1');
  // keep explicit rendering choices across URL rewrites
  for (const k of ['look', 'quality', 'clean']) if (params.has(k)) p.set(k, params.get(k));
  history.replaceState(null, '', `?${p}`);
}

const PLAY = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

function syncControls() {
  $('srcDemo').setAttribute('aria-selected', S.mode === 'demo');
  $('srcLive').setAttribute('aria-selected', S.mode === 'live');
  $('seedWrap').style.display = S.mode === 'demo' && !S.replay ? '' : 'none';
  $('seed').value = S.seed;
  const badge = $('sourceBadge');
  badge.className = `badge ${S.mode === 'demo' ? 'synthetic' : 'live'}`;
  const rsyn = S.replay?.source === 'synthetic';
  if (S.replay) {
    badge.className = `badge ${rsyn ? 'synthetic' : 'live'}`;
    badge.textContent = `${rsyn ? 'Synthetic' : 'Live'} replay${S.replay.seed === null ? '' : ` · seed ${S.replay.seed}`}`;
  } else badge.textContent = S.mode === 'demo' ? `Synthetic demo · seed ${S.seed}` : 'Live · local telemetry';
  $('btnPlay').innerHTML = S.playing ? PAUSE : PLAY;
  document.querySelectorAll('.speed button').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.speed) === S.speed));
  $('btnContent').setAttribute('aria-pressed', S.content);
  app.classList.toggle('content', S.content);
  $('camOrbit').setAttribute('aria-pressed', director.mode === 'orbit');
  $('camDirector').setAttribute('aria-pressed', director.mode === 'director');
  $('btnLiveEdge').hidden = !(S.mode === 'live' && !S.followLive);
  $('health').style.display = S.mode === 'live' ? '' : 'none';
}

function setContent(on) {
  S.content = on;
  director.setMode(on ? 'director' : 'orbit');
  syncUrl();
  syncControls();
}

function seek(t) {
  S.playhead = Math.max(S.start, Math.min(S.end, t));
  S.snap = true;
  if (S.mode === 'live') S.followLive = S.playhead >= clock.now() - 1500;
  syncControls();
}

function select(id) {
  S.selected = id;
  director.follow(id);
}

$('replayFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    S.replayPath = null; // a picked file has no served path; the URL stays shareable only for ?replay= loads
    loadReplayText(await file.text(), file.name);
  } catch (err) {
    replayFailed(err);
  }
};
$('btnReplay').onclick = () => $('replayFile').click();
$('srcDemo').onclick = () => loadDemo(Number($('seed').value) || 7);
$('srcLive').onclick = () => startLive();
$('seed').onchange = () => loadDemo(Math.max(1, Math.min(99999, Number($('seed').value) || 7)));
$('btnPlay').onclick = () => {
  if (S.mode === 'demo' && !S.playing && S.playhead >= S.end) seek(S.start);
  S.playing = !S.playing;
  syncControls();
};
$('btnRestart').onclick = () => {
  if (S.mode === 'live') S.followLive = false;
  seek(S.start);
  S.playing = true;
  syncControls();
};
document.querySelectorAll('.speed button').forEach(
  (b) =>
    (b.onclick = () => {
      S.speed = Number(b.dataset.speed);
      syncUrl();
      syncControls();
    }),
);
$('scrub').oninput = (e) => seek(S.start + (Number(e.target.value) / 1000) * (S.end - S.start));
$('btnLiveEdge').onclick = () => {
  S.followLive = true;
  S.snap = true;
  syncControls();
};
$('btnContent').onclick = () => setContent(!S.content);
$('camOrbit').onclick = () => {
  director.setMode('orbit');
  syncControls();
};
$('camDirector').onclick = () => {
  director.setMode('director');
  syncControls();
};
$('btnHelp').onclick = () => $('help').showModal();
// Side panels collapse to their title so the whole floor is visible; remembered per browser.
document.querySelectorAll('.collapse').forEach((h) => {
  const panel = $(h.dataset.panel);
  const key = `overfit.collapsed.${h.dataset.panel}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved === '1' || (saved === null && h.dataset.panel === 'left' && window.innerWidth < 1600)) panel.classList.add('collapsed');
  } catch {
    /* storage unavailable: default expanded */
  }
  h.addEventListener('click', () => {
    const on = panel.classList.toggle('collapsed');
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
});
$('btnPanels').onclick = () => app.classList.toggle('panels-open');
$('btnCapture').onclick = capture;
canvas.addEventListener('gym-click', (e) => {
  const r = canvas.getBoundingClientRect();
  const id = world.pick((e.detail.x / r.width) * 2 - 1, -(e.detail.y / r.height) * 2 + 1);
  select(id);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === ' ') (e.preventDefault(), $('btnPlay').click());
  else if (k === 'r') $('btnRestart').click();
  else if (k === 'c') setContent(!S.content);
  else if (k === 'd') (director.setMode(director.mode === 'director' ? 'orbit' : 'director'), syncControls());
  else if (['1', '2', '3', '4'].includes(k)) document.querySelectorAll('.speed button')[Number(k) - 1].click();
  else if (k === 'arrowleft') seek(S.playhead - 5000);
  else if (k === 'arrowright') seek(S.playhead + 5000);
  else if (k === 'escape') select(null);
});

/** Save a PNG of the current frame with the source label burned in. */
function capture() {
  world.render();
  const src = world.renderer.domElement;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const scale = c.width / canvas.clientWidth;
  const label = S.replay ? `${S.replay.source.toUpperCase()} REPLAY · ${fmtDur(S.playhead - S.start)}` : S.mode === 'demo' ? `SYNTHETIC DEMO · seed ${S.seed} · ${fmtDur(S.playhead - S.start)}` : `${$('sourceBadge').textContent.toUpperCase()} · ${new Date(S.playhead).toISOString()}`;
  g.font = `700 ${14 * scale}px 'JetBrains Mono', ui-monospace, monospace`;
  const w = g.measureText(label).width + 20 * scale;
  g.fillStyle = 'rgba(12,13,17,0.85)';
  g.fillRect(16 * scale, 16 * scale, w, 30 * scale);
  g.fillStyle = S.replay ? (S.replay.source === 'synthetic' ? '#ffb238' : '#7cf29a') : S.mode === 'demo' ? '#ffb238' : '#7cf29a';
  g.fillText(label, 26 * scale, 36 * scale);
  const cap = activeCaptions()[0];
  if (cap) {
    g.font = `800 ${26 * scale}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = '#f2e9d8';
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 10 * scale;
    g.fillText(cap.text, c.width / 2, c.height - 90 * scale, c.width - 60 * scale);
  }
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `overfit-gym-${S.mode}${S.mode === 'demo' ? `-seed${S.seed}` : ''}-${Math.round((S.playhead - S.start) / 1000)}s.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

function activeCaptions() {
  return S.captions.filter((c) => c.ts <= S.playhead && S.playhead < c.until).sort((a, b) => b.ts - a.ts);
}

// ---------- frame ----------

// With real sessions there can be dozens of agents. The floor shows the ones
// active recently (plus anyone selected); the rest are "in the locker room".
const FLOOR_WINDOW_MS = 15 * 60_000;
const FLOOR_MAX = 18;
const FLOOR_MIN = 8; // always show the most recent agents, resting in the locker room if idle
const LIVE_HISTORY_MS = 6 * 3600_000; // live timeline starts at most this far back

function buildViews(state, now) {
  const views = [];
  for (const a of state.agents.values()) {
    const look = lookFor(state, a, now, DEFAULTS);
    const act = look.activity;
    const d = act.detail ?? {};
    const run = d.run;
    const parent = a.parent ? state.agents.get(a.parent) : null;
    let repAge = a.lastRep ? now - a.lastRep.ts : null;
    let repStatus = a.lastRep?.status ?? null;
    let runReps = run?.reps ?? 0;
    const runFails = run?.fails ?? d.burst?.fail ?? 0;
    if (d.burst) {
      // Counted reps from a runner summary, replayed one per BURST_REP_MS. Fails come last.
      const i = Math.floor(d.burstAge / BURST_REP_MS);
      repAge = d.burstAge % BURST_REP_MS;
      repStatus = i >= d.burst.total - d.burst.fail ? 'fail' : 'pass';
      runReps = Math.min(i + 1, d.burst.total);
    }
    const la = a.lastActivity;
    const testLines = a.diff ? (a.diff.categories.test?.added ?? 0) + (a.diff.categories.test?.deleted ?? 0) : 0;
    views.push({
      id: a.id,
      label: a.label,
      look,
      kind: act.kind,
      helper: !!a.parent,
      parentId: a.parent,
      helperIndex: parent ? parent.children.indexOf(a.id) : 0,
      repAge,
      repStatus,
      runReps,
      runFails,
      quietMs: d.quietMs ?? 0,
      activity: la ? { id: la.id, ageMs: now - la.ts, count: la.count, status: la.status, force: la.force } : null,
      whiteboard: act.kind === 'treadmill' ? { testLines, writing: !!d.writing } : null,
      selected: a.id === S.selected,
      metrics: null,
      agent: a,
    });
  }
  return views;
}

/** Agents on the floor: recently active, most recent first, capped; selected always included. */
function floorViews(views, now) {
  const active = views
    .filter((v) => v.id === S.selected || v.kind !== 'idle' || now - v.agent.lastTs < FLOOR_WINDOW_MS)
    .sort((a, b) => b.agent.lastTs - a.agent.lastTs);
  const recent = [...views].sort((a, b) => b.agent.lastTs - a.agent.lastTs).slice(0, FLOOR_MIN);
  const keep = new Set([...active.slice(0, FLOOR_MAX), ...recent].map((v) => v.id));
  if (S.selected) keep.add(S.selected);
  // keep parents of helpers on the floor so spotters have someone to spot
  for (const v of views) if (keep.has(v.id) && v.parentId) keep.add(v.parentId);
  return views.filter((v) => keep.has(v.id));
}

let last = null;
let hudAt = 0;
let lastFocus = null;

function frame(t) {
  const dt = Math.min(100, t - (last ?? t));
  last = t;
  if (S.mode === 'live') {
    S.end = clock.now();
    if (S.followLive && S.playing) S.playhead = clock.now() - 300;
    else if (S.playing) S.playhead = Math.min(S.end, S.playhead + dt * S.speed);
  } else if (S.playing) {
    S.playhead += dt * S.speed;
    if (S.playhead >= S.end) {
      S.playhead = S.end;
      S.playing = false;
      syncControls();
    }
  }
  draw(t, dt);
  requestAnimationFrame(frame);
}

/**
 * Compute and draw one frame at S.playhead.
 * o.snap: override S.snap; o.commit=false: leave lastFocus untouched;
 * o.render=false: advance the simulation only; o.hud: force a HUD refresh.
 */
function draw(t, dt, o = {}) {
  const snap = o.snap ?? S.snap;
  const state = store.stateAt(S.playhead);
  const allViews = buildViews(state, S.playhead);
  const views = floorViews(allViews, S.playhead);
  const caps = activeCaptions();
  const g = state.agents.size ? (CAPTURE ? renderGlobal(state) : renderGlobalCached(state, t)) : null;
  world.update(S.playhead, S.playing ? dt * Math.max(1, S.speed) : dt, views, {
    snap,
    global: g
      ? { value: formatRatio(g.ratio), sub: `executions per production line · ${g.executions} reps, ${g.unique} unique`, testLines: g.ratio.state === 'unknown' ? undefined : g.ratio.testLines, prodLines: g.ratio.state === 'unknown' ? undefined : g.ratio.denominator }
      : { value: '--', sub: 'waiting for the first rep' },
  });
  if (o.snap === undefined) S.snap = false;

  // director focus: latest caption's agent, else selected, else busiest
  const focus = caps[0]?.agent ?? S.selected ?? lastFocus ?? views.reduce((b, v) => (!b || v.agent.totals.executions > b.agent.totals.executions ? v : b), null)?.id ?? null;
  if (o.commit !== false) lastFocus = focus;
  director.update(S.playhead, S.start, dt, focus);
  if (o.render === false) return;
  world.render();

  const viewsById = new Map(views.map((v) => [v.id, v]));
  renderLabels(world.anchors(canvas.clientWidth, canvas.clientHeight), viewsById, caps, S.selected, select);

  if (o.hud || t - hudAt > 150) {
    hudAt = t;
    for (const v of allViews) v.metrics = { executions: v.agent.totals.executions, unique: v.agent.unique.size, reruns: v.agent.totals.reruns };
    renderRoster(allViews, S.selected, select, new Set(views.map((v) => v.id)));
    renderInspector(viewsById.get(S.selected), state);
    renderFeed(state);
    const lt = $('lowerThird');
    const cap = caps[0];
    const ltHtml = cap ? `<span class="who">${escapeHtml(state.agents.get(cap.agent)?.label ?? '')}</span>${escapeHtml(cap.text)}` : '';
    if (lt.dataset.html !== ltHtml) lt.innerHTML = lt.dataset.html = ltHtml;
    const span = Math.max(1, S.end - S.start);
    if (document.activeElement !== $('scrub')) $('scrub').value = Math.round(((S.playhead - S.start) / span) * 1000);
    $('tNow').textContent = fmtDur(S.playhead - S.start);
    $('tEnd').textContent = S.mode === 'live' ? 'live' : fmtDur(S.end - S.start);
    renderHealth();
    renderEmpty(state);
  }
}

// ---------- capture (deterministic frame-stepped export) ----------
//
// A frame at time T is a pure function of (seed, T). History-dependent motion
// (walking, turning) is advanced on a fixed grid of CAPTURE_STEP_MS steps from
// t=0 and only ever moves forward; a seek backwards resets and replays the grid.
// The exact time T is then drawn as a zero-length evaluation whose side effects
// on the simulation are rolled back, so the order of seeks never changes a frame.

const sim = { idx: -1 };
let seekQueue = Promise.resolve();

function resetSim() {
  world.reset();
  director.reset();
  lastFocus = null;
  sim.idx = -1;
}

function captureDraw(msFromStart) {
  const T = normalizeSeek(msFromStart);
  const target = gridIndex(T);
  if (sim.idx < 0 || target < sim.idx) resetSim();
  while (sim.idx < target) {
    sim.idx++;
    S.playhead = S.start + sim.idx * CAPTURE_STEP_MS;
    draw(S.playhead, sim.idx === 0 ? 0 : CAPTURE_STEP_MS, { snap: sim.idx === 0, render: false });
  }
  const snapshot = world.snapshot();
  S.playhead = S.start + T;
  clock.set(S.playhead);
  S.playing = false;
  draw(S.playhead, 0, { snap: false, commit: false, hud: true });
  world.restore(snapshot);
  return T;
}

function settle() {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => done || ((done = true), resolve());
    requestAnimationFrame(() => requestAnimationFrame(fin));
    setTimeout(fin, 100); // hidden tabs throttle rAF; this is not a source of scene state
  });
}

/** One line per scene object (transform, visibility, light intensity): a GPU-independent fingerprint of the drawn frame. */
function sceneDump() {
  const out = [];
  world.scene.updateMatrixWorld(true);
  world.scene.traverse((o) => out.push(`${o.type}|${o.visible ? 1 : 0}|${o.matrixWorld.elements.join(',')}|${o.intensity ?? ''}`));
  out.push(`camera|${world.camera.matrixWorld.elements.join(',')}`);
  return out;
}

/** Seek to msFromStart; resolves once state is recomputed and one frame has been drawn. */
function captureSeek(msFromStart) {
  const run = seekQueue.then(async () => {
    const T = captureDraw(msFromStart);
    await settle();
    return T;
  });
  seekQueue = run.catch(() => {});
  return run;
}

let globalCache = { t: 0, g: null };
function renderGlobalCached(state, t) {
  if (t - globalCache.t > 150 || !globalCache.g) globalCache = { t, g: renderGlobal(state) };
  return globalCache.g;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderHealth() {
  if (S.mode !== 'live') return;
  // Live mode shows whatever the server accepted. If any of it is marked
  // synthetic, the badge must say so rather than claim pure live telemetry.
  const synth = live.raw.reduce((n, e) => n + (e.synthetic ? 1 : 0), 0);
  const badge = $('sourceBadge');
  const label = synth ? `Live + ${synth} synthetic events` : 'Live · local telemetry';
  if (badge.textContent !== label) {
    badge.textContent = label;
    badge.className = `badge ${synth ? 'synthetic' : 'live'}`;
  }
  const el = $('health');
  const c = S.conn;
  const age = c.lastEventAt ? Math.round((clock.now() - c.lastEventAt) / 1000) : null;
  const cls = c.state === 'ok' ? 'ok' : c.state === 'offline' ? 'bad' : 'warn';
  const lag = pacingLag(store.all(), S.playhead);
  const text = `${c.state === 'ok' ? 'connected' : c.state} · ${store.size} events${age !== null ? ` · last ${age}s ago` : ''}${lag > 500 ? ` · paced +${(lag / 1000).toFixed(1)}s` : ''}`;
  const html = `<span class="dot"></span><span>${text}</span>`;
  if (el.dataset.html !== html) {
    el.className = `health ${cls}`;
    el.innerHTML = el.dataset.html = html;
  }
}

function renderEmpty(state) {
  const el = $('empty');
  const show = S.mode === 'live' && state.agents.size === 0;
  el.hidden = !show;
  if (show && !el.dataset.ready) {
    el.dataset.ready = '1';
    el.innerHTML = `<h3>The gym is open. Nobody is lifting.</h3>
      <p>Live mode shows only real test telemetry sent to this server. Nothing has arrived yet${store.size ? ' in the current time window' : ''}.</p>
      <p>To see your real Claude Code and Codex sessions, start the read-only transcript watcher:</p>
      <pre>npm run watch</pre>
      <p>Or push the bundled sample project's real <code>node:test</code> results:</p>
      <pre>npm run fixture</pre>
      <p class="muted">Or add the reporter to your own Node project; see the README. Switch to Demo for a labelled synthetic workout.</p>`;
  }
}

function resize() {
  world.resize(canvas.clientWidth, canvas.clientHeight);
}
window.addEventListener('resize', resize);
resize();

// automation hooks for reproducible capture (frame-stepping, screenshots)
window.overfit = {
  seek: (msFromStart) => seek(S.start + msFromStart),
  play: () => ((S.playing = true), syncControls()),
  pause: () => ((S.playing = false), syncControls()),
  get state() {
    return { mode: S.mode, seed: S.seed, playhead: S.playhead, start: S.start, end: S.end, events: store.size, captions: S.captions.length };
  },
};

// ?replay=replays/name.jsonl loads a local bundle served from ./replays/ (relative paths only).
async function loadReplayParam(rel) {
  try {
    if (!/^replays\/[\w.-]+\.jsonl$/.test(rel)) throw new Error('replay must look like replays/name.jsonl');
    S.replayPath = rel;
    loadReplayText(await (await fetch(`/${rel}`, { cache: 'no-store' })).text(), rel);
  } catch (err) {
    S.replayPath = null;
    loadDemo(S.seed);
    replayFailed(err);
  }
}

if (params.get('clean') === '1') app.classList.add('clean');
if (S.content) director.setMode('director');
if (CAPTURE) {
  // Frame-stepped export mode (scripts/export-video.mjs drives it). The root declares
  // data-composition-id + data-duration (seconds); a seek arrives via
  // window.__overfit.seek(ms), or as an `hf-seek` event with detail.time in seconds
  // for HyperFrames-style frame steppers (that adapter contract is unverified).
  app.classList.add('capture');
  app.dataset.compositionId = 'overfit-gym';
  loadDemo(S.seed);
  S.playing = false;
  {
    // build the whole roster once, in a fixed order, so seeking never creates objects
    const end = store.stateAt(S.end);
    world.prewarm([...end.agents.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((a) => ({ id: a.id, look: lookFor(end, a, S.end, DEFAULTS), helper: !!a.parent })));
  }
  app.dataset.duration = String((S.end - S.start) / 1000);
  window.addEventListener('hf-seek', (e) => void captureSeek(Number(e.detail?.time) * 1000));
  window.__overfit = {
    seek: captureSeek,
    /** Resolves once every queued seek (including hf-seek events) has drawn. */
    idle: () => seekQueue,
    duration: () => captureDurationMs(),
    describe: (ms) => captureFrame(S.seed, ms),
    sceneDump,
    get scene() {
      return world.scene;
    },
    sceneDigest: () => hashHex(sceneDump().join('\n')),
    get seed() {
      return S.seed;
    },
  };
  const t0 = params.has('tms') ? Number(params.get('tms')) : 0;
  window.__overfit.ready = captureSeek(Number.isFinite(t0) ? t0 : 0).then(() => {
    document.documentElement.dataset.captureReady = '1';
  });
} else {
  if (params.has('replay')) await loadReplayParam(params.get('replay'));
  else if (S.mode === 'live') startLive();
  else {
    loadDemo(S.seed);
    // ?t=SECONDS opens the demo paused at that moment: reproducible stills for content.
    const t = Number(params.get('t'));
    if (Number.isFinite(t) && params.has('t')) {
      S.playing = false;
      seek(S.start + t * 1000);
    }
  }
  requestAnimationFrame(frame);
}
