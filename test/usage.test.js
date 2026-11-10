import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, EventError } from '../src/core/events.js';
import { reduce } from '../src/core/reducer.js';
import { agentMetrics, globalMetrics } from '../src/core/metrics.js';
import { createSessionParser } from '../adapters/transcript-watch.mjs';
import { generateDemo } from '../src/core/demo.js';

let n = 0;
const T0 = 1_700_000_000_000;
const mk = (sec, agent, usage, kind = 'usage') =>
  normalizeEvent({ id: `u${n++}`, ts: T0 + sec * 1000, source: 'test', synthetic: false, agent, kind, usage });
const rep = (costUsd, extra = {}) => ({ source: 'reported', sourceLabel: 'runtime cost field', costUsd, ...extra });
const est = (costUsd, extra = {}) => ({ source: 'estimate', sourceLabel: 'tokens x price table v1', costUsd, ...extra });

test('no usage events: overlay data is absent, never zero', () => {
  const s = reduce([normalizeEvent({ id: 'x1', ts: T0, source: 't', synthetic: false, agent: 'a', kind: 'agent.hello' })]);
  assert.equal(globalMetrics(s).usage, null);
  assert.equal(agentMetrics(s.agents.get('a')).usage, null);
});

test('token counts without cost do not produce an overlay', () => {
  const s = reduce([mk(0, 'a', { source: 'reported', sourceLabel: 'runtime', tokens: { input: 10, output: 5 } })]);
  assert.equal(globalMetrics(s).usage, null);
});

test('reported only', () => {
  const s = reduce([mk(0, 'a', rep(0.5, { durationMs: 2000 })), mk(10, 'a', rep(0.25))]);
  const u = agentMetrics(s.agents.get('a')).usage;
  assert.equal(u.reported.costUsd, 0.75);
  assert.equal(u.reported.durationMs, 2000);
  assert.equal(u.estimate, null);
  assert.equal(u.spanMs, 10_000);
});

test('estimate only is kept as an estimate', () => {
  const g = globalMetrics(reduce([mk(0, 'a', est(1.2))])).usage;
  assert.equal(g.reported, null);
  assert.equal(g.estimate.costUsd, 1.2);
  assert.deepEqual(g.estimate.labels, ['tokens x price table v1']);
});

test('mixed reported and estimate stay separate, per agent and in the rollup', () => {
  const s = reduce([mk(0, 'a', rep(1)), mk(1, 'a', est(2)), mk(2, 'b', rep(4)), mk(3, 'b', est(8))]);
  const a = agentMetrics(s.agents.get('a')).usage;
  assert.equal(a.reported.costUsd, 1);
  assert.equal(a.estimate.costUsd, 2);
  const g = globalMetrics(s).usage;
  assert.equal(g.reported.costUsd, 5);
  assert.equal(g.estimate.costUsd, 10);
  assert.equal('costUsd' in g, false, 'no combined number');
});

test('usage may ride on another event kind', () => {
  const e = normalizeEvent({ id: 'r1', ts: T0, source: 't', synthetic: false, agent: 'a', kind: 'activity', data: { activity: 'edit' }, usage: rep(0.1) });
  assert.equal(reduce([e]).agents.get('a').usage.reported.costUsd, 0.1);
});

test('invalid usage payloads are rejected', () => {
  const bad = [
    { source: 'guess', sourceLabel: 'x', costUsd: 1 },
    { sourceLabel: 'x', costUsd: 1 },
    { source: 'estimate', costUsd: 1 },
    { source: 'reported', sourceLabel: 'x', costUsd: -1 },
    { source: 'reported', sourceLabel: 'x', costUsd: '3' },
    { source: 'reported', sourceLabel: 'x', costUsd: Infinity },
    { source: 'reported', sourceLabel: 'x' },
    { source: 'reported', sourceLabel: 'x', costUsd: 1, tokens: { input: 1.5 } },
    { source: 'reported', sourceLabel: 'x', costUsd: 1, tokens: { bogus: 1 } },
    { source: 'reported', sourceLabel: 'x', costUsd: 1, extra: true },
    'cost',
  ];
  for (const usage of bad) assert.throws(() => mk(0, 'a', usage), EventError, JSON.stringify(usage));
  assert.throws(() => normalizeEvent({ id: 'k', ts: T0, source: 't', synthetic: false, agent: 'a', kind: 'usage' }), EventError);
});

test('transcript parser maps only a real costUSD field as reported', () => {
  const p = createSessionParser({ source: 'claude', fileKey: 'f' });
  const rec = (extra) => ({ type: 'assistant', timestamp: new Date(T0).toISOString(), sessionId: 's1', uuid: 'm1', message: { content: [], usage: { input_tokens: 10, output_tokens: 4 } }, ...extra });
  const none = p.feed(rec({}));
  assert.equal(none.some((e) => e.usage), false, 'tokens alone produce no usage event');
  const withCost = p.feed(rec({ uuid: 'm2', costUSD: 0.0123 })).find((e) => e.usage);
  assert.equal(withCost.usage.source, 'reported');
  assert.equal(withCost.usage.costUsd, 0.0123);
  assert.deepEqual(withCost.usage.tokens, { input: 10, output: 4 });
  assert.doesNotThrow(() => normalizeEvent(withCost));
});

test('seeded demo carries no cost', () => {
  assert.equal(globalMetrics(reduce(generateDemo(1).map(normalizeEvent))).usage, null);
});
