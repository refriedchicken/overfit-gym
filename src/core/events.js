// Normalized event schema v1.
//
// Every adapter (node:test reporter, JUnit importer, agent hooks, the seeded
// demo) emits these. The reducer only ever sees normalized events.
//
// {
//   v: 1,
//   id: string            unique, stable; duplicates are dropped by the reducer
//   ts: number            epoch milliseconds (ISO strings are accepted and converted)
//   seq: number           tie-breaker for events sharing a ts within one source
//   source: string        adapter name, e.g. "node-test", "junit", "agent-hook", "demo"
//   synthetic: boolean    true for demo/fabricated data, false for observed telemetry
//   agent: string         pseudonymous agent id
//   kind: one of KINDS
//   run?: string          one test-runner invocation (a command attempt)
//   suite?: string        suite name/path within a run (a "set")
//   test?: { id, name, file? }   one test case (a "rep")
//   status?: pass | fail | skip | todo | cancelled
//   duration_ms?: number
//   attempt?: number      1-based attempt, only when the runner reports retries
//   assertions?: number   non-negative integer, test.result only. Assertions the runner reported for
//                         this test. Absent means UNKNOWN (never 0): most runners expose no count.
//   tags?: string[]       e.g. "integration"; `data.tag_basis` says how it was derived
//   data?: object         small kind-specific payload (see KINDS below)
//   usage?: object        sourced cost/time/token figures with provenance (see normalizeUsage)
// }

import { SPEC_RE } from './identity.js';

export const SCHEMA_VERSION = 1;

/**
 * Kinds and what they mean. Keep this list short; the mapping table in
 * docs/PRIMITIVES.md documents each one.
 */
export const KINDS = Object.freeze({
  'agent.hello': 'An agent appeared. data.label is an optional display name (pseudonymous); data.model an optional "vendor:version" spec; data.model_name and data.project optional real names for live views.',
  'agent.say': 'A line of dialogue, shown as a caption. data.text is the line; data.to an optional agent id it is aimed at.',
  'agent.spawn': 'Fan-out: this agent started a helper. data.child is the helper agent id.',
  'run.start': 'A test-runner invocation began. data.target fingerprints what was run.',
  'run.end': 'A test-runner invocation finished. status is the overall outcome; data.counts optional.',
  'suite.end': 'A suite (describe block or file) finished, with status and duration.',
  'test.result': 'One test case execution finished. This is the only kind counted as an execution.',
  'diff.snapshot': 'Working-tree change size at a moment, split by category. Cumulative, not incremental.',
  usage: 'A usage record. Carries only the top-level usage payload: cost/time/tokens with provenance.',
  activity: 'A non-test action (lint, git push, build, edit, ...). data.activity names it; see docs/EXERCISES.md.',
});

export const STATUSES = Object.freeze(['pass', 'fail', 'skip', 'todo', 'cancelled']);

export const DIFF_CATEGORIES = Object.freeze(['production', 'test', 'docs', 'generated', 'unknown']);

export const LIMITS = Object.freeze({
  idLength: 200,
  stringLength: 300,
  tags: 8,
  dataBytes: 4096,
  batch: 500,
});

export const USAGE_SOURCES = Object.freeze(['reported', 'estimate']);

export class EventError extends Error {
  constructor(message, index) {
    super(index === undefined ? message : `event[${index}]: ${message}`);
    this.name = 'EventError';
  }
}

function str(value, field, { required = false, max = LIMITS.stringLength } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new EventError(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new EventError(`${field} must be a string`);
  if (value.length > max) throw new EventError(`${field} exceeds ${max} chars`);
  return value;
}

function num(value, field, { min = -Infinity, int = false } = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new EventError(`${field} must be a finite number`);
  if (value < min) throw new EventError(`${field} must be >= ${min}`);
  if (int && !Number.isInteger(value)) throw new EventError(`${field} must be an integer`);
  return value;
}

/**
 * usage: { costUsd?, durationMs?, tokens?: {input?,output?,cacheRead?,cacheWrite?}, source, sourceLabel }
 *   source "reported"  the agent/runtime itself reported the figure (a real cost field)
 *   source "estimate"  derived by us or an adapter (e.g. tokens x a price table); sourceLabel
 *                      must name the basis. Estimates are always badged EST in the UI.
 * Nothing is defaulted: a missing costUsd stays missing and is never shown as $0.00.
 */
function normalizeUsage(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) throw new EventError('usage must be an object');
  const source = u.source;
  if (!USAGE_SOURCES.includes(source)) throw new EventError(`usage.source must be one of ${USAGE_SOURCES.join(', ')}`);
  const sourceLabel = str(u.sourceLabel, 'usage.sourceLabel', { required: true, max: 80 });
  const out = { source, sourceLabel };
  const costUsd = num(u.costUsd, 'usage.costUsd', { min: 0 });
  if (costUsd !== undefined) out.costUsd = costUsd;
  const durationMs = num(u.durationMs, 'usage.durationMs', { min: 0 });
  if (durationMs !== undefined) out.durationMs = durationMs;
  if (u.tokens !== undefined && u.tokens !== null) {
    if (typeof u.tokens !== 'object' || Array.isArray(u.tokens)) throw new EventError('usage.tokens must be an object');
    const tokens = {};
    for (const k of Object.keys(u.tokens)) {
      if (!['input', 'output', 'cacheRead', 'cacheWrite'].includes(k)) throw new EventError(`unknown usage.tokens field "${k}"`);
      const n = num(u.tokens[k], `usage.tokens.${k}`, { min: 0, int: true });
      if (n !== undefined) tokens[k] = n;
    }
    if (Object.keys(tokens).length) out.tokens = tokens;
  }
  for (const k of Object.keys(u)) {
    if (!['source', 'sourceLabel', 'costUsd', 'durationMs', 'tokens'].includes(k)) throw new EventError(`unknown usage field "${k}"`);
  }
  if (out.costUsd === undefined && out.durationMs === undefined && !out.tokens) throw new EventError('usage needs costUsd, durationMs or tokens');
  return out;
}

function toTs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  throw new EventError('ts must be epoch ms or an ISO-8601 string');
}

function normalizeData(kind, data) {
  if (data === undefined || data === null) return undefined;
  if (typeof data !== 'object' || Array.isArray(data)) throw new EventError('data must be an object');
  const json = JSON.stringify(data);
  if (json.length > LIMITS.dataBytes) throw new EventError(`data exceeds ${LIMITS.dataBytes} bytes`);
  const out = JSON.parse(json);
  if (kind === 'diff.snapshot') {
    const cats = out.categories;
    if (!cats || typeof cats !== 'object') throw new EventError('diff.snapshot requires data.categories');
    for (const key of Object.keys(cats)) {
      if (!DIFF_CATEGORIES.includes(key)) throw new EventError(`unknown diff category "${key}"`);
      const c = cats[key];
      if (!c || typeof c !== 'object') throw new EventError(`diff category ${key} must be an object`);
      for (const f of ['added', 'deleted', 'files']) {
        if (typeof c[f] !== 'number' || c[f] < 0 || !Number.isFinite(c[f])) {
          throw new EventError(`diff category ${key}.${f} must be a non-negative number`);
        }
      }
    }
  }
  if (kind === 'agent.spawn') str(out.child, 'data.child', { required: true, max: LIMITS.idLength });
  if (out.model !== undefined && (kind === 'agent.hello' || kind === 'agent.spawn')) {
    if (typeof out.model !== 'string' || !SPEC_RE.test(out.model)) throw new EventError('data.model must look like "vendor:version"');
  }
  if (kind === 'agent.hello') {
    // Optional, for usefulness in live views: the real model id and the project folder name.
    for (const f of ['model_name', 'project']) {
      if (out[f] === undefined) continue;
      if (typeof out[f] !== 'string' || !/^[\w .:@+\-\[\]/]{1,60}$/.test(out[f])) throw new EventError(`data.${f} must be a short plain name`);
    }
  }
  if (kind === 'agent.say') {
    str(out.text, 'data.text', { required: true, max: 160 });
    str(out.to, 'data.to', { max: LIMITS.idLength });
  }
  if (kind === 'activity') {
    const a = str(out.activity, 'data.activity', { required: true, max: 40 });
    if (!/^[a-z][a-z0-9-]*$/.test(a)) throw new EventError('data.activity must be a lowercase id');
  }
  if (out.counts !== undefined) {
    const c = out.counts;
    if (!c || typeof c !== 'object') throw new EventError('data.counts must be an object');
    for (const f of ['total', 'pass', 'fail', 'skip']) {
      if (c[f] !== undefined && (typeof c[f] !== 'number' || !Number.isInteger(c[f]) || c[f] < 0 || c[f] > 1e6)) {
        throw new EventError(`data.counts.${f} must be a non-negative integer`);
      }
    }
  }
  return out;
}

/**
 * Validate and normalize one raw event. Throws EventError on invalid input.
 * The returned object is a fresh plain object containing only known fields.
 */
export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new EventError('event must be an object');
  const v = raw.v ?? SCHEMA_VERSION;
  if (v !== SCHEMA_VERSION) throw new EventError(`unsupported schema version ${v}`);
  const kind = str(raw.kind, 'kind', { required: true, max: 40 });
  if (!Object.hasOwn(KINDS, kind)) throw new EventError(`unknown kind "${kind}"`);
  if (typeof raw.synthetic !== 'boolean') throw new EventError('synthetic must be true or false');

  const ev = {
    v: SCHEMA_VERSION,
    id: str(raw.id, 'id', { required: true, max: LIMITS.idLength }),
    ts: toTs(raw.ts),
    seq: num(raw.seq, 'seq', { min: 0, int: true }) ?? 0,
    source: str(raw.source, 'source', { required: true, max: 40 }),
    synthetic: raw.synthetic,
    agent: str(raw.agent, 'agent', { required: true, max: LIMITS.idLength }),
    kind,
  };

  const run = str(raw.run, 'run', { max: LIMITS.idLength });
  if (run) ev.run = run;
  const suite = str(raw.suite, 'suite');
  if (suite) ev.suite = suite;

  if (raw.test !== undefined) {
    if (!raw.test || typeof raw.test !== 'object') throw new EventError('test must be an object');
    const name = str(raw.test.name, 'test.name', { required: true });
    const file = str(raw.test.file, 'test.file');
    const id = str(raw.test.id, 'test.id', { max: LIMITS.idLength }) ?? `${file ?? ''}::${suite ?? ''}::${name}`;
    ev.test = file ? { id, name, file } : { id, name };
  }
  if (kind === 'test.result' && !ev.test) throw new EventError('test.result requires test');

  if (raw.status !== undefined) {
    if (!STATUSES.includes(raw.status)) throw new EventError(`status must be one of ${STATUSES.join(', ')}`);
    ev.status = raw.status;
  }
  if ((kind === 'test.result' || kind === 'suite.end') && !ev.status) throw new EventError(`${kind} requires status`);

  const duration = num(raw.duration_ms, 'duration_ms', { min: 0 });
  if (duration !== undefined) ev.duration_ms = duration;
  const attempt = num(raw.attempt, 'attempt', { min: 1, int: true });
  if (attempt !== undefined) ev.attempt = attempt;

  if (raw.assertions !== undefined && raw.assertions !== null) {
    if (kind !== 'test.result') throw new EventError('assertions is only valid on test.result');
    ev.assertions = num(raw.assertions, 'assertions', { min: 0, int: true });
  }

  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > LIMITS.tags) throw new EventError(`tags must be an array of <= ${LIMITS.tags}`);
    ev.tags = raw.tags.map((t, i) => str(t, `tags[${i}]`, { required: true, max: 40 }));
  }

  const data = normalizeData(kind, raw.data);
  if (data) ev.data = data;
  if (kind === 'diff.snapshot' && !ev.data) throw new EventError('diff.snapshot requires data.categories');
  if (kind === 'agent.spawn' && !ev.data) throw new EventError('agent.spawn requires data.child');
  if (raw.usage !== undefined) ev.usage = normalizeUsage(raw.usage);
  if (kind === 'usage' && !ev.usage) throw new EventError('usage requires the usage payload');
  if (kind === 'activity' && !ev.data) throw new EventError('activity requires data.activity');
  if (kind === 'agent.say' && !ev.data) throw new EventError('agent.say requires data.text');
  return ev;
}

/**
 * Normalize a batch. Accepts a single event, an array, or { events: [...] }.
 * Returns { events, errors } so one bad event does not drop a whole batch.
 */
export function normalizeBatch(input) {
  const list = Array.isArray(input) ? input : input && Array.isArray(input.events) ? input.events : [input];
  if (list.length > LIMITS.batch) throw new EventError(`batch exceeds ${LIMITS.batch} events`);
  const events = [];
  const errors = [];
  list.forEach((raw, i) => {
    try {
      events.push(normalizeEvent(raw));
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  });
  return { events, errors };
}

/** Total order used everywhere: ts, then seq, then id. */
export function compareEvents(a, b) {
  return a.ts - b.ts || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Heuristic integration tag from file or name. Returned basis is always "heuristic:path-or-name". */
export function looksIntegration(test) {
  if (!test) return false;
  return /(integration|e2e|end[-_ ]to[-_ ]end|contract)/i.test(`${test.file ?? ''} ${test.name ?? ''}`);
}
