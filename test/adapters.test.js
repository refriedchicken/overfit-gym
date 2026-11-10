import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPath, parseNumstat, snapshotData } from '../adapters/git-diff.mjs';
import { mapNodeTestEvent } from '../adapters/node-test-reporter.mjs';
import { normalizeEvent } from '../src/core/events.js';
import { reduce } from '../src/core/reducer.js';
import { agentMetrics } from '../src/core/metrics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'examples/sample-project');
const REPORTER = path.join(ROOT, 'adapters/node-test-reporter.mjs');

test('classifyPath buckets files', () => {
  const cases = {
    'src/app.ts': 'production',
    'lib/x.py': 'production',
    'test/app.test.ts': 'test',
    'src/__tests__/a.js': 'test',
    'pkg/foo_test.go': 'test',
    'tests/test_api.py': 'test',
    'README.md': 'docs',
    'docs/guide.txt': 'docs',
    'package-lock.json': 'generated',
    'dist/bundle.js': 'generated',
    'web/vendor/three/three.module.min.js': 'generated',
    'src/__snapshots__/a.snap': 'generated',
    'config.yaml': 'unknown',
    'logo.png': 'unknown',
  };
  for (const [p, want] of Object.entries(cases)) assert.equal(classifyPath(p), want, p);
});

test('parseNumstat + snapshotData: binary files count as unknown with 0 lines, no paths leak', () => {
  const files = parseNumstat('3\t1\tsrc/a.js\n-\t-\timg.png\n10\t0\ttest/a.test.js\n0\t7\tsrc/old.js\n');
  const data = snapshotData(files, { repo: 'r' });
  assert.deepEqual(data.categories.production, { added: 3, deleted: 8, files: 2 });
  assert.deepEqual(data.categories.unknown, { added: 0, deleted: 0, files: 1 });
  assert.deepEqual(data.categories.test, { added: 10, deleted: 0, files: 1 });
  assert.ok(!JSON.stringify(data).includes('src/a.js'));
  normalizeEvent({ id: 'x', ts: 1, source: 'git-diff', synthetic: false, agent: 'a', kind: 'diff.snapshot', data });
});

test('mapNodeTestEvent maps pass/fail/skip/todo/suite and skips the file wrapper', () => {
  const cwd = '/work/proj';
  const t = (type, data) => mapNodeTestEvent({ type, data: { nesting: 1, file: '/work/proj/test/a.test.js', ...data } }, cwd);
  assert.deepEqual(t('test:pass', { name: 'x', details: { type: 'test', duration_ms: 1.234 } }), {
    kind: 'test.result',
    test: { name: 'x', file: 'test/a.test.js' },
    status: 'pass',
    duration_ms: 1.23,
  });
  assert.equal(t('test:fail', { name: 'x', details: { type: 'test' } }).status, 'fail');
  assert.equal(t('test:pass', { name: 'x', skip: true, details: { type: 'test' } }).status, 'skip');
  assert.equal(t('test:pass', { name: 'x', todo: true, details: { type: 'test' } }).status, 'todo');
  assert.equal(t('test:pass', { name: 's', details: { type: 'suite' } }).kind, 'suite.end');
  assert.equal(t('test:start', { name: 'x' }), null);
  // --test-rerun-failures: attempt is 0-based; carried-over passes were not executed
  assert.equal(t('test:fail', { name: 'x', details: { type: 'test', attempt: 1 } }).attempt, 2);
  assert.equal(t('test:pass', { name: 'x', details: { type: 'test', attempt: 1, passed_on_attempt: 0 } }), null);
  assert.equal(mapNodeTestEvent({ type: 'test:pass', data: { nesting: 0, name: 'test/a.test.js', file: '/work/proj/test/a.test.js', details: { type: 'test' } } }, cwd), null);
  assert.equal(t('test:pass', { name: 'x', file: '/elsewhere/secret/b.test.js', details: { type: 'test' } }).test.file, 'b.test.js', 'files outside cwd reduce to basename');
});

function withoutTestContext(env) {
  const { NODE_TEST_CONTEXT, ...rest } = env;
  return rest;
}

function runSample(env) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'overfit-')), 'events.jsonl');
  try {
    execFileSync(process.execPath, ['--test', `--test-reporter=${REPORTER}`, '--test-reporter-destination=stdout'], {
      cwd: SAMPLE,
      // NODE_TEST_CONTEXT would make the nested runner report to us instead of using the reporter.
      env: { ...withoutTestContext(process.env), OVERFIT_URL: 'off', OVERFIT_OUT: out, OVERFIT_AGENT: 'sample-agent', ...env },
      stdio: 'pipe',
    });
  } catch {
    // a failing test run exits non-zero; the events are what we check
  }
  return fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

test('end to end: real node --test run of the sample project produces valid events', () => {
  const events = runSample({ SAMPLE_STRICT: '0' });
  const norm = events.map(normalizeEvent);
  const kinds = norm.map((e) => e.kind);
  assert.equal(kinds[kinds.length - 1], 'run.end');
  assert.ok(kinds.includes('run.start'));
  assert.ok(kinds.includes('suite.end'));
  const results = norm.filter((e) => e.kind === 'test.result');
  assert.equal(results.length, 13, '11 unit + 2 integration cases');
  assert.equal(results.filter((e) => e.status === 'skip').length, 1);
  assert.ok(norm.every((e) => e.synthetic === false && e.source === 'node-test'));
  assert.ok(!JSON.stringify(events).includes(ROOT), 'no absolute paths in events');
  const m = agentMetrics(reduce(norm).agents.get('sample-agent'));
  assert.equal(m.executions, 13);
  assert.equal(m.integration, 2, 'integration tag from path heuristic');
});

test('end to end: opt-in failing case shows up as a fail and a failed run', () => {
  const norm = runSample({ SAMPLE_STRICT: '1' }).map(normalizeEvent);
  assert.equal(norm.filter((e) => e.kind === 'test.result' && e.status === 'fail').length, 1);
  assert.equal(norm.at(-1).status, 'fail');
});

test('two runs of the same command are a rerun of the same target', () => {
  const a = runSample({ OVERFIT_DIFF: '0' });
  const b = runSample({ OVERFIT_DIFF: '0' });
  const t = reduce([...a, ...b].map(normalizeEvent)).agents.get('sample-agent').totals;
  assert.equal(t.runs, 2);
  assert.equal(t.reruns, 1);
});

test('diff key changes when content changes but line counts do not', () => {
  const files = parseNumstat('1\t1\tsrc/a.js\n');
  const a = snapshotData(files, { repo: 'r', contentKey: 'edit-one' });
  const b = snapshotData(files, { repo: 'r', contentKey: 'edit-two' });
  assert.notEqual(a.key, b.key);
  assert.deepEqual(a.categories, b.categories);
});
