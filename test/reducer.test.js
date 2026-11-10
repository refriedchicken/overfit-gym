import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../src/core/events.js';
import { reduce, activityAt, DEFAULTS } from '../src/core/reducer.js';
import { createStore } from '../src/core/store.js';
import { generateDemo } from '../src/core/demo.js';
import { agentMetrics, globalMetrics } from '../src/core/metrics.js';

let n = 0;
const T0 = 1_700_000_000_000;
function ev(sec, kind, fields = {}) {
  return normalizeEvent({ id: `t${n++}`, ts: T0 + sec * 1000, source: 'test', synthetic: false, agent: 'a', kind, ...fields });
}
const diff = (prod) => ({ categories: { production: { added: prod, deleted: 0, files: 1 }, test: { added: 5, deleted: 0, files: 1 } } });
const result = (sec, run, name, status, extra = {}) => ev(sec, 'test.result', { run, test: { name, file: 'x.test.js' }, status, ...extra });

test('duplicate ids are applied once', () => {
  const e = result(1, 'r1', 'one', 'pass');
  const s = reduce([e, e, { ...e }]);
  assert.equal(s.agents.get('a').totals.executions, 1);
  assert.equal(s.count, 1);
});

test('out-of-order arrival gives the same state as in-order', () => {
  const evs = [ev(0, 'run.start', { run: 'r1', data: { target: 't' } }), result(1, 'r1', 'one', 'fail'), result(2, 'r1', 'one', 'pass'), ev(3, 'run.end', { run: 'r1', status: 'pass' })];
  const a = agentMetrics(reduce(evs).agents.get('a'));
  const b = agentMetrics(reduce([...evs].reverse()).agents.get('a'));
  assert.deepEqual(a, b);
  assert.equal(a.flaky, 1, 'fail then pass in one run is a flaky retry');
});

test('reruns vs treadmill depend on observed diff changes', () => {
  const evs = [
    ev(0, 'diff.snapshot', { data: diff(10) }),
    ev(1, 'run.start', { run: 'r1', data: { target: 'unit' } }),
    ev(2, 'run.end', { run: 'r1', status: 'pass' }),
    ev(3, 'run.start', { run: 'r2', data: { target: 'unit' } }), // same diff: treadmill
    ev(4, 'run.end', { run: 'r2', status: 'pass' }),
    ev(5, 'diff.snapshot', { data: diff(11) }),
    ev(6, 'run.start', { run: 'r3', data: { target: 'unit' } }), // diff changed: rerun only
    ev(7, 'run.end', { run: 'r3', status: 'pass' }),
    ev(8, 'run.start', { run: 'r4', data: { target: 'other' } }), // different target
  ];
  const t = reduce(evs).agents.get('a').totals;
  assert.equal(t.runs, 4);
  assert.equal(t.reruns, 2);
  assert.equal(t.treadmill, 1);
});

test('without any diff snapshot a rerun is never called a treadmill', () => {
  const evs = [ev(0, 'run.start', { run: 'r1', data: { target: 'u' } }), ev(1, 'run.end', { run: 'r1', status: 'pass' }), ev(2, 'run.start', { run: 'r2', data: { target: 'u' } })];
  const t = reduce(evs).agents.get('a').totals;
  assert.equal(t.reruns, 1);
  assert.equal(t.treadmill, 0);
});

test('retries: attempt > 1 and duplicate test in one run both count', () => {
  const evs = [result(1, 'r1', 'x', 'pass', { attempt: 2 }), result(2, 'r2', 'y', 'pass'), result(3, 'r2', 'y', 'pass')];
  const t = reduce(evs).agents.get('a').totals;
  assert.equal(t.retries, 2);
  assert.equal(t.flaky, 0);
});

test('partial telemetry: run.end without start and results without start', () => {
  const s = reduce([ev(1, 'run.end', { run: 'lonely', status: 'fail' }), result(2, 'r9', 'z', 'pass')]);
  const t = s.agents.get('a').totals;
  assert.equal(t.runs, 2);
  assert.equal(t.runsFinished, 1);
  assert.equal(t.runsFailed, 1);
  assert.equal(t.executions, 1);
});

test('stalled after the threshold with no events, not before', () => {
  const s = reduce([ev(0, 'run.start', { run: 'r1', data: { target: 'u' } }), result(1, 'r1', 'one', 'pass')]);
  const a = s.agents.get('a');
  assert.notEqual(activityAt(s, a, T0 + 1000 + DEFAULTS.stallMs - 1).kind, 'stalled');
  assert.equal(activityAt(s, a, T0 + 1000 + DEFAULTS.stallMs + 1).kind, 'stalled');
});

test('activity beats are distinct for pass, fail, retry and run end', () => {
  const s = reduce([ev(0, 'run.start', { run: 'r1', data: { target: 'u' } }), result(1, 'r1', 'one', 'fail')]);
  const a = s.agents.get('a');
  assert.equal(activityAt(s, a, T0 + 1200).kind, 'fail');
  assert.equal(activityAt(s, a, T0 + 3000).kind, 'bench');
  const s2 = reduce([ev(0, 'run.start', { run: 'r1', data: { target: 'u' } }), result(1, 'r1', 'one', 'pass', { attempt: 2 })]);
  assert.equal(activityAt(s2, s2.agents.get('a'), T0 + 1500).kind, 'wobble');
  const s3 = reduce([ev(0, 'run.start', { run: 'r1', data: { target: 'u' } }), ev(1, 'run.end', { run: 'r1', status: 'pass' })]);
  assert.equal(activityAt(s3, s3.agents.get('a'), T0 + 2000).kind, 'celebrate');
});

test('fan-out links helpers to their parent', () => {
  const s = reduce([ev(0, 'agent.spawn', { data: { child: 'h1' } }), ev(0.5, 'run.start', { run: 'r', data: { target: 'u' } })]);
  assert.deepEqual(s.agents.get('a').children, ['h1']);
  assert.equal(activityAt(s, s.agents.get('h1'), T0 + 1000).kind, 'spotting');
});

test('store: incremental replay equals full reduce, including scrub back and late inserts', () => {
  const demo = generateDemo(7).map(normalizeEvent);
  const store = createStore();
  const half = Math.floor(demo.length / 2);
  store.add(demo.slice(half));
  const end = demo.reduce((m, e) => Math.max(m, e.ts), 0);
  store.stateAt(end);
  store.add(demo.slice(0, half)); // late arrivals earlier than the cursor
  const viaStore = globalMetrics(store.stateAt(end));
  const full = globalMetrics(reduce(demo));
  assert.deepEqual(viaStore, full);
  const mid = demo[0].ts + 60_000;
  const back = globalMetrics(store.stateAt(mid));
  const fullMid = globalMetrics(reduce(demo.filter((e) => e.ts <= mid)));
  assert.deepEqual(back, fullMid);
});

test('a finished treadmill run keeps jogging instead of flexing', () => {
  const d = { categories: { production: { added: 1, deleted: 0, files: 1 } } };
  const s = reduce([
    ev(0, 'diff.snapshot', { data: d }),
    ev(1, 'run.start', { run: 'q1', data: { target: 'u' } }),
    ev(2, 'run.end', { run: 'q1', status: 'pass' }),
    ev(3, 'run.start', { run: 'q2', data: { target: 'u' } }),
    ev(4, 'run.end', { run: 'q2', status: 'pass' }),
  ]);
  assert.equal(activityAt(s, s.agents.get('a'), T0 + 5000).kind, 'treadmill');
});
