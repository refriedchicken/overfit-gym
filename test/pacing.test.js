import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paceEvents, pacingLag, PACING_DEFAULTS } from '../src/core/pacing.js';
import { reduce } from '../src/core/reducer.js';
import { globalMetrics } from '../src/core/metrics.js';
import { normalizeEvent, compareEvents } from '../src/core/events.js';

const T = 1_700_000_000_000;
let n = 0;
const ev = (agent, ms, kind, extra = {}) => normalizeEvent({ id: `p${n++}`, ts: T + ms, source: 't', synthetic: false, agent, kind, ...extra });
const burst = (agent, at, count) => [
  ev(agent, at, 'run.start', { run: `${agent}r${at}`, data: { target: 'x' } }),
  ...Array.from({ length: count }, (_, i) => ev(agent, at + 1 + i * 2, 'test.result', { run: `${agent}r${at}`, test: { name: `t${i}` }, status: 'pass' })),
  ev(agent, at + 2 + count * 2, 'run.end', { run: `${agent}r${at}`, status: 'pass' }),
];

test('spreads a fast burst so each rep is visible, keeps order and observed time', () => {
  const evs = burst('a', 0, 13).sort(compareEvents);
  const paced = paceEvents(evs);
  for (let i = 1; i < paced.length; i++) assert.ok(paced[i].ts >= paced[i - 1].ts);
  const results = paced.filter((e) => e.kind === 'test.result');
  for (let i = 1; i < results.length; i++) assert.ok(results[i].ts - results[i - 1].ts >= PACING_DEFAULTS.gaps['test.result']);
  paced.forEach((p, i) => assert.equal(p.observedTs, evs[i].ts));
  assert.ok(paced.every((p, i) => p.ts >= evs[i].ts), 'never earlier than observed');
});

test('lag is capped at maxLagMs', () => {
  const evs = burst('a', 0, 400).sort(compareEvents);
  const paced = paceEvents(evs);
  assert.ok(paced.every((p) => p.ts - p.observedTs <= PACING_DEFAULTS.maxLagMs));
});

test('agents are paced independently', () => {
  const evs = [...burst('a', 0, 5), ...burst('b', 0, 5)].sort(compareEvents);
  const paced = paceEvents(evs);
  const firstB = paced.find((e) => e.agent === 'b' && e.kind === 'test.result');
  assert.ok(firstB.ts < T + 1000, 'b is not queued behind a');
});

test('pacing never changes counts', () => {
  const evs = [...burst('a', 0, 13), ...burst('a', 50, 13), ...burst('b', 10, 7)].sort(compareEvents);
  const end = T + 60_000;
  assert.deepEqual(globalMetrics(reduce(paceEvents(evs).filter((e) => e.ts <= end))), globalMetrics(reduce(evs)));
});

test('deterministic and reports current lag', () => {
  const evs = burst('a', 0, 20).sort(compareEvents);
  assert.deepEqual(paceEvents(evs), paceEvents(evs));
  const paced = paceEvents(evs);
  assert.ok(pacingLag(paced, T + 100) > 0);
  assert.equal(pacingLag(paced, T + 60_000), 0);
});
