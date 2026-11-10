// Local replay bundle: a JSONL file that reproduces a replay.
//
// Line 1 is a header record, every following line is one normalized event:
//
//   {"kind":"overfit-replay","version":1,"seed":7,"source":"synthetic",
//    "createdAt":"...","eventCount":123,"stateHash":"xxxxxxxx-xxxxxxxx"}
//
// `stateHash` is computed by re-reducing the events, so a tampered, truncated
// or reordered file fails import. It is an integrity check, not a signature.
// Pure and browser-safe: no Node APIs. createdAt is injectable so exports are
// byte-identical for the same input.

import { normalizeEvent, compareEvents, EventError } from './events.js';
import { reduce } from './reducer.js';
import { globalMetrics, agentMetrics } from './metrics.js';
import { hashHex } from './hash.js';

export const REPLAY_KIND = 'overfit-replay';
export const REPLAY_VERSION = 1;
export const REPLAY_SOURCES = Object.freeze(['synthetic', 'live']);
export const MAX_REPLAY_EVENTS = 50_000;

export class ReplayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReplayError';
  }
}

// Absolute or home-relative paths, Windows drive paths, file: URLs, and well-known
// system roots appearing anywhere inside a string.
const ABS_PATH = /^(?:\/(?!\/)[\w.~-]+\/|~[\\/]|[A-Za-z]:[\\/]|\\\\|file:)|(?:^|[\s"'(=:])\/(?:Users|home|var|tmp|private|etc|opt|root|mnt|usr|Volumes)\/|[A-Za-z]:\\\\?[\w.-]+/;

function findAbsolutePath(value, where = 'event') {
  if (typeof value === 'string') {
    if (ABS_PATH.test(value)) throw new ReplayError(`${where} contains an absolute path`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findAbsolutePath(v, `${where}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findAbsolutePath(v, `${where}.${k}`);
  }
}

/** Normalize, reject absolute paths, dedupe by id and sort into replay order. */
function prepareEvents(events) {
  if (!Array.isArray(events)) throw new ReplayError('events must be an array');
  if (events.length > MAX_REPLAY_EVENTS) throw new ReplayError(`replay exceeds ${MAX_REPLAY_EVENTS} events`);
  const seen = new Set();
  const out = [];
  events.forEach((raw, i) => {
    let ev;
    try {
      ev = normalizeEvent(raw);
    } catch (err) {
      throw new ReplayError(err instanceof EventError ? `event[${i}] invalid: ${err.message}` : String(err.message));
    }
    findAbsolutePath(ev, `event[${i}]`);
    if (seen.has(ev.id)) return;
    seen.add(ev.id);
    out.push(ev);
  });
  return out.sort(compareEvents);
}

/** Canonical, order-stable digest of the reduced state, plus the event lines themselves. */
export function stateHash(events) {
  const state = reduce(events);
  const agents = [...state.agents.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, parent: a.parent, totals: a.totals, metrics: agentMetrics(a), bestStreak: a.bestStreak, activities: a.activityCounts }));
  const digest = JSON.stringify({ count: state.count, firstTs: state.firstTs, lastTs: state.lastTs, sources: state.sources, global: globalMetrics(state), agents });
  const lines = events.map((e) => JSON.stringify(e)).join('\n');
  return `${hashHex(digest)}-${hashHex(lines)}`;
}

function checkSource(source, events) {
  if (!REPLAY_SOURCES.includes(source)) throw new ReplayError(`source must be one of ${REPLAY_SOURCES.join(', ')}`);
  const synthetic = events.filter((e) => e.synthetic).length;
  if (source === 'synthetic' && synthetic !== events.length) throw new ReplayError('source "synthetic" but some events are marked synthetic: false');
  if (source === 'live' && synthetic !== 0) throw new ReplayError('source "live" but some events are marked synthetic: true');
}

/**
 * Serialize events to a replay bundle (JSONL text, trailing newline).
 * @param {object[]} events raw or normalized events
 * @param {{seed?: number|null, source?: 'synthetic'|'live', createdAt?: string}} opts
 */
export function exportReplay(events, { seed = null, source, createdAt } = {}) {
  const list = prepareEvents(events);
  const src = source ?? (list.length && list.every((e) => e.synthetic) ? 'synthetic' : 'live');
  checkSource(src, list);
  if (seed !== null && !(Number.isInteger(seed) && seed >= 0)) throw new ReplayError('seed must be a non-negative integer or null');
  const header = {
    kind: REPLAY_KIND,
    version: REPLAY_VERSION,
    seed,
    source: src,
    createdAt: createdAt ?? new Date().toISOString(),
    eventCount: list.length,
    stateHash: stateHash(list),
  };
  return [header, ...list].map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/** Parse and verify a replay bundle. Throws ReplayError on any problem. */
export function importReplay(text) {
  if (typeof text !== 'string') throw new ReplayError('replay must be text');
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) throw new ReplayError('replay is empty');
  if (lines.length - 1 > MAX_REPLAY_EVENTS) throw new ReplayError(`replay exceeds ${MAX_REPLAY_EVENTS} events`);
  const parse = (line, n) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new ReplayError(`line ${n} is not valid JSON`);
    }
  };
  const h = parse(lines[0], 1);
  if (!h || h.kind !== REPLAY_KIND) throw new ReplayError('first line is not an overfit-replay header');
  if (h.version !== REPLAY_VERSION) throw new ReplayError(`unsupported replay version ${h.version}`);
  if (!REPLAY_SOURCES.includes(h.source)) throw new ReplayError('header source must be "synthetic" or "live"');
  if (h.seed !== null && !(Number.isInteger(h.seed) && h.seed >= 0)) throw new ReplayError('header seed must be a non-negative integer or null');
  if (typeof h.createdAt !== 'string' || typeof h.stateHash !== 'string' || !Number.isInteger(h.eventCount)) throw new ReplayError('header is incomplete');
  const raw = lines.slice(1).map((l, i) => parse(l, i + 2));
  if (raw.length !== h.eventCount) throw new ReplayError(`header says ${h.eventCount} events, file has ${raw.length}`);
  const events = prepareEvents(raw);
  if (events.length !== raw.length) throw new ReplayError('replay contains duplicate event ids');
  checkSource(h.source, events);
  const actual = stateHash(events);
  if (actual !== h.stateHash) throw new ReplayError('state hash mismatch: replay was modified or is corrupt');
  const header = { kind: h.kind, version: h.version, seed: h.seed, source: h.source, createdAt: h.createdAt, eventCount: h.eventCount, stateHash: h.stateHash };
  return { header, events };
}

// ---------- recap card ----------

/** Compact weekly-recap numbers computed from a verified replay. */
export function computeRecap({ header, events }) {
  const state = reduce(events);
  const g = globalMetrics(state);
  let top = null;
  for (const a of state.agents.values()) {
    const m = agentMetrics(a);
    if (!top || m.executions > top.executions || (m.executions === top.executions && a.id < top.id)) top = { id: a.id, label: a.label, executions: m.executions };
  }
  return {
    label: header.source === 'synthetic' ? 'SYNTHETIC' : 'LIVE',
    seed: header.seed,
    runs: g.runs,
    reruns: g.reruns,
    executions: g.executions,
    pass: g.pass,
    fail: g.fail,
    passRate: g.passRate,
    flaky: g.flaky,
    retries: g.retries,
    agents: g.agents,
    topAgent: top && top.executions > 0 ? top : null,
    durationMs: state.firstTs === null ? 0 : state.lastTs - state.firstTs,
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Self-contained static HTML for the recap card (no scripts, no external requests). */
export function renderRecapHtml(recap) {
  const rate = recap.passRate === null ? 'n/a' : `${Math.round(recap.passRate * 100)}%`;
  const cells = [
    ['Runs', recap.runs],
    ['Passed', recap.pass],
    ['Failed', recap.fail],
    ['Pass rate', rate],
    ['Flaky tests', recap.flaky],
    ['Reruns', recap.reruns],
    ['Top agent', recap.topAgent ? `${recap.topAgent.label} (${recap.topAgent.executions})` : 'none'],
    ['Duration', formatDuration(recap.durationMs)],
  ];
  const seed = recap.seed === null ? '' : ` &middot; seed ${esc(recap.seed)}`;
  const color = recap.label === 'SYNTHETIC' ? '#b26a00' : '#148a4b';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Overfit Gym recap</title>
<style>
body{margin:0;padding:24px;background:#f2e9d8;font:15px/1.4 system-ui,sans-serif;color:#1d1a16}
.card{max-width:420px;margin:auto;background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
h1{margin:0 0 4px;font-size:18px}.badge{display:inline-block;padding:2px 8px;border:2px solid ${color};color:${color};font-weight:700;font-size:12px;letter-spacing:.06em}
dl{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin:16px 0 0}dt{font-size:12px;color:#6b6258}dd{margin:0;font-size:18px;font-weight:600}
</style></head><body><div class="card">
<h1>Overfit Gym weekly recap</h1>
<span class="badge">${esc(recap.label)}${seed}</span>
<dl>${cells.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
</div></body></html>
`;
}
