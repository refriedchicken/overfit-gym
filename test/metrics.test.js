import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testsPerProdLine, formatRatio, ceremonyHeuristic, globalMetrics } from '../src/core/metrics.js';
import { reduce } from '../src/core/reducer.js';
import { normalizeEvent } from '../src/core/events.js';

const d = (cats) => ({ categories: cats });
const c = (added, deleted, files) => ({ added, deleted, files });

test('ok ratio uses production churn (added + deleted) as denominator', () => {
  const r = testsPerProdLine({ executions: 100, unique: 20, diffs: [d({ production: c(8, 2, 1), test: c(50, 0, 1) })] });
  assert.equal(r.state, 'ok');
  assert.equal(r.denominator, 10);
  assert.equal(r.value, 10);
  assert.equal(r.breakdown.test, 50);
  const u = testsPerProdLine({ executions: 100, unique: 20, diffs: [d({ production: c(8, 2, 1) })] }, { numerator: 'unique' });
  assert.equal(u.value, 2);
});

test('deletion-only production changes count as churn', () => {
  const r = testsPerProdLine({ executions: 30, unique: 30, diffs: [d({ production: c(0, 15, 2) })] });
  assert.equal(r.denominator, 15);
  assert.equal(r.value, 2);
});

test('test, docs, generated and unknown lines never enter the denominator', () => {
  const r = testsPerProdLine({
    executions: 10,
    unique: 10,
    diffs: [d({ production: c(0, 0, 0), test: c(90, 0, 3), docs: c(40, 1, 2), generated: c(5000, 0, 1), unknown: c(7, 0, 1) })],
  });
  assert.equal(r.state, 'no-prod-change');
  assert.equal(r.value, null);
  assert.equal(r.denominator, 0);
  assert.deepEqual(r.breakdown, { production: 0, test: 90, docs: 41, generated: 5000, unknown: 7 });
  assert.equal(formatRatio(r), 'n/a (0 production lines changed)');
});

test('no diff observed is unknown, not zero', () => {
  const r = testsPerProdLine({ executions: 10, unique: 3, diffs: [] });
  assert.equal(r.state, 'unknown');
  assert.equal(r.value, null);
  assert.equal(formatRatio(r), 'n/a (no diff observed)');
});

test('global rollup dedupes diffs by repo key using the latest snapshot', () => {
  let i = 0;
  const mk = (agent, sec, kind, fields) => normalizeEvent({ id: `m${i++}`, ts: 1e12 + sec * 1000, source: 't', synthetic: true, agent, kind, ...fields });
  const snap = (prod) => ({ repo: 'r1', categories: { production: c(prod, 0, 1) } });
  const s = reduce([
    mk('a', 0, 'diff.snapshot', { data: snap(10) }),
    mk('b', 1, 'diff.snapshot', { data: snap(20) }),
    mk('a', 2, 'test.result', { test: { name: 'x' }, status: 'pass' }),
    mk('b', 3, 'test.result', { test: { name: 'y' }, status: 'pass' }),
  ]);
  const g = globalMetrics(s);
  assert.equal(g.ratio.denominator, 20, 'latest snapshot for repo r1 wins, not 10 + 20');
  assert.equal(g.executions, 2);
});

test('ceremony heuristic flags spread-thin or test-heavy diffs only', () => {
  assert.equal(ceremonyHeuristic(d({ production: c(40, 0, 2), test: c(30, 0, 1) })), null);
  assert.match(ceremonyHeuristic(d({ production: c(7, 2, 6) })).basis, /many-files-few-lines/);
  assert.match(ceremonyHeuristic(d({ production: c(5, 0, 1), test: c(60, 0, 1) })).basis, /test-churn/);
  assert.equal(ceremonyHeuristic(d({ production: c(0, 0, 0), test: c(60, 0, 1) })), null, 'zero production lines is not a machine, it is n/a');
});
