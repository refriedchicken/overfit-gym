import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDemo, DEMO_DURATION_S, DEMO_BASE_TS } from '../src/core/demo.js';
import { normalizeEvent, compareEvents } from '../src/core/events.js';
import { reduce, activityAt } from '../src/core/reducer.js';
import { lookFor, BOUNDS } from '../src/core/evolution.js';
import { captionTimeline, createCaptionGate } from '../src/core/captions.js';
import { globalMetrics } from '../src/core/metrics.js';

test('demo: same seed is byte-identical, different seed differs', () => {
  assert.equal(JSON.stringify(generateDemo(42)), JSON.stringify(generateDemo(42)));
  assert.notEqual(JSON.stringify(generateDemo(42)), JSON.stringify(generateDemo(43)));
});

test('demo: every event validates and is labelled synthetic', () => {
  const evs = generateDemo(1);
  for (const e of evs) {
    const n = normalizeEvent(e);
    assert.equal(n.synthetic, true);
    assert.equal(n.source, 'demo');
  }
  assert.equal(new Set(evs.map((e) => e.id)).size, evs.length, 'ids unique');
});

test('demo: covers every beat at least once', () => {
  const evs = generateDemo(1).map(normalizeEvent).sort(compareEvents);
  const s = reduce(evs);
  const g = globalMetrics(s);
  assert.ok(g.fail > 0, 'fails');
  assert.ok(g.flaky > 0, 'flaky retries');
  assert.ok(g.treadmill > 0, 'treadmill reruns');
  assert.ok(g.reruns > g.treadmill, 'some reruns after a code change');
  assert.ok(s.agents.get('demo-coach').children.length === 3, 'fan-out');
  const kinds = new Set();
  for (let t = DEMO_BASE_TS; t < DEMO_BASE_TS + DEMO_DURATION_S * 1000; t += 250) {
    const st = reduce(evs.filter((e) => e.ts <= t));
    for (const a of st.agents.values()) kinds.add(activityAt(st, a, t).kind);
  }
  for (const k of ['bench', 'fail', 'wobble', 'treadmill', 'coordinated', 'stalled', 'celebrate', 'spotting', 'idle', 'lint', 'push', 'commit', 'pr', 'merge', 'ci', 'diff', 'build', 'install', 'typecheck', 'format', 'grep', 'read', 'write-tests']) {
    assert.ok(kinds.has(k), `beat ${k} appears`);
  }
});

test('evolution: deterministic and bounded', () => {
  const evs = generateDemo(3).map(normalizeEvent);
  const s = reduce(evs);
  const now = DEMO_BASE_TS + DEMO_DURATION_S * 1000;
  for (const a of s.agents.values()) {
    const l1 = lookFor(s, a, now);
    const l2 = lookFor(reduce(evs), a, now);
    assert.deepEqual(JSON.parse(JSON.stringify(l1)), JSON.parse(JSON.stringify(l2)));
    assert.ok(l1.muscle >= 0 && l1.muscle <= 1);
    assert.ok(l1.fatigue >= 0 && l1.fatigue <= 1);
    assert.ok(l1.bicep >= BOUNDS.bicep[0] && l1.bicep <= BOUNDS.bicep[1]);
    assert.ok(l1.gear.length <= BOUNDS.gearSlots);
  }
});

test('evolution: fatigue decays when idle', () => {
  const evs = generateDemo(3).map(normalizeEvent);
  const s = reduce(evs);
  const a = s.agents.get('demo-machine');
  const end = DEMO_BASE_TS + DEMO_DURATION_S * 1000;
  assert.ok(lookFor(s, a, end + 600_000).fatigue < lookFor(s, a, end).fatigue);
});

test('captions: deterministic and rate limited per agent and globally', () => {
  const evs = generateDemo(5).map(normalizeEvent).sort(compareEvents);
  const end = DEMO_BASE_TS + DEMO_DURATION_S * 1000;
  const a = captionTimeline(evs, end);
  const b = captionTimeline(evs, end);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 5, `enough captions (${a.length})`);
  const sorted = [...a].sort((x, y) => x.ts - y.ts);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].ts - sorted[i - 1].ts >= 3500, 'global gap');
  const kinds = new Set(a.map((c) => c.kind));
  assert.ok(kinds.has('treadmill') && kinds.has('stall'), [...kinds].join(','));
  for (const c of a.filter((x) => x.kind === 'ceremony')) assert.equal(c.heuristic, true);
});

test('caption gate drops bursts', () => {
  const gate = createCaptionGate({ perAgentGapMs: 1000, globalGapMs: 500, ttlMs: 100 });
  const cand = { kind: 'x', text: 'y' };
  assert.ok(gate.offer('a', 0, cand));
  assert.equal(gate.offer('a', 600, cand), null);
  assert.ok(gate.offer('b', 600, cand));
  assert.equal(gate.offer('c', 700, cand), null);
  assert.ok(gate.offer('a', 1200, cand));
});
