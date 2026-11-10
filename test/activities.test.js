import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand } from '../src/core/activities.js';
import { parseTestSummary } from '../src/core/test-summary.js';
import { normalizeEvent } from '../src/core/events.js';
import { reduce, activityAt } from '../src/core/reducer.js';
import { agentMetrics } from '../src/core/metrics.js';

test('classifies test runners through wrappers, env vars and chains', () => {
  const cases = {
    'npm test': 'npm test',
    'pnpm run test:unit': 'npm test',
    'CI=1 npx vitest run': 'vitest',
    'cd app && python -m pytest -q tests/': 'pytest',
    'uv run pytest -x': 'pytest',
    'go test ./...': 'go test',
    'xcodebuild -scheme App test': 'xcodebuild test',
    "bash -lc 'swift test --parallel'": 'swift test',
    'npm run lint && npm test': 'npm test',
  };
  for (const [cmd, runner] of Object.entries(cases)) assert.equal(classifyCommand(cmd)?.runner, runner, cmd);
  // the rerun fingerprint ignores cd, pipes and redirects
  assert.equal(classifyCommand('cd app && npm test 2>&1 | tail -5').segment, classifyCommand('npm test | grep fail').segment);
});

test('classifies dev activities into gym stations', () => {
  const cases = {
    'npx eslint src': 'lint',
    'ruff check .': 'lint',
    'cargo clippy -- -D warnings': 'lint',
    'npm run lint': 'lint',
    'prettier --write .': 'format',
    'ruff format': 'format',
    'npx tsc --noEmit': 'typecheck',
    'mypy src': 'typecheck',
    'npm run build': 'build',
    'cargo build --release': 'build',
    'git push origin main': 'push',
    'git pull --rebase': 'pull',
    'git commit -m "x"': 'commit',
    'git commit --amend --no-edit': 'rebase',
    'git rebase main': 'rebase',
    'git revert HEAD': 'revert',
    'git diff --stat': 'diff',
    'gh pr create --fill': 'pr',
    'gh pr merge 12 --squash': 'merge',
    'gh pr checks 12 --watch': 'ci',
    'gh run watch': 'ci',
    'npm install': 'install',
    'pip install -r requirements.txt': 'install',
    'hyperfine "node a.js"': 'benchmark',
    'go test -bench . ./...': 'benchmark',
    'c8 report': 'coverage',
    'docker compose up -d': 'docker',
    'rg -n foo src': 'grep',
    'sed -n 1,20p file.js': 'read',
  };
  for (const [cmd, activity] of Object.entries(cases)) assert.equal(classifyCommand(cmd)?.activity, activity, cmd);
  assert.equal(classifyCommand('git push --force origin x').force, true);
  for (const cmd of ['ls -la', 'echo npm test', 'mkdir test', 'node script.js', '']) assert.equal(classifyCommand(cmd), null, cmd);
  // quoted text is never a command: these are searches and messages, not test runs
  assert.equal(classifyCommand("ps -A | rg 'vitest|npm test|thumbs'")?.activity, 'grep');
  assert.equal(classifyCommand('git commit -m "fix && npm test flake"')?.activity, 'commit');
});

test('parses runner summaries', () => {
  const cases = [
    ['ℹ tests 13\nℹ suites 2\nℹ pass 11\nℹ fail 1\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\n', { total: 13, pass: 11, fail: 1, skip: 1, parser: 'node:test' }],
    ['lint ok\nℹ pass 1822\nℹ fail 0\n', { total: 1822, pass: 1822, fail: 0, skip: 0, parser: 'node:test' }],
    ['\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m16 passed\x1b[39m\x1b[22m\x1b[90m (16)\x1b[39m', { total: 16, pass: 16, fail: 0, skip: 0, parser: 'vitest' }],
    ['===== 2 failed, 40 passed, 3 skipped in 1.52s =====', { total: 45, pass: 40, fail: 2, skip: 3, parser: 'pytest' }],
    ['......\n12 passed in 0.31s\n', { total: 12, pass: 12, fail: 0, skip: 0, parser: 'pytest' }],
    [' Test Files  3 passed (3)\n      Tests  21 passed | 1 failed (22)\n', { total: 22, pass: 21, fail: 1, skip: 0, parser: 'vitest' }],
    ['Tests:       1 failed, 2 skipped, 10 passed, 13 total\n', { total: 13, pass: 10, fail: 1, skip: 2, parser: 'jest' }],
    ['test result: ok. 5 passed; 0 failed; 1 ignored\ntest result: ok. 3 passed; 1 failed; 0 ignored', { total: 10, pass: 8, fail: 1, skip: 1, parser: 'cargo' }],
    ['Executed 4 tests, with 0 failures\nExecuted 30 tests, with 2 failures (0 unexpected) in 1.2 seconds', { total: 30, pass: 28, fail: 2, skip: 0, parser: 'xctest' }],
    ['--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\n--- PASS: TestC (0.00s)', { total: 3, pass: 2, fail: 1, skip: 0, parser: 'go test -v' }],
  ];
  for (const [text, want] of cases) assert.deepEqual(parseTestSummary(text), want, want.parser);
  assert.equal(parseTestSummary('ok  \tgithub.com/x/y\t0.2s'), null, 'go without -v has no per-test counts');
  assert.equal(parseTestSummary('all good'), null);
});

let n = 0;
const T = 1_700_000_000_000;
const ev = (ms, kind, fields = {}) => normalizeEvent({ id: `a${n++}`, ts: T + ms, source: 't', synthetic: false, agent: 'x', kind, ...fields });

test('summary counts become executions once, never on top of per-test results', () => {
  const s = reduce([
    ev(0, 'run.start', { run: 'r1', data: { target: 't' } }),
    ev(500, 'run.end', { run: 'r1', status: 'fail', data: { counts: { total: 13, pass: 11, fail: 1, skip: 1 } } }),
    ev(1000, 'run.start', { run: 'r2', data: { target: 't' } }),
    ev(1100, 'test.result', { run: 'r2', test: { name: 'a' }, status: 'pass' }),
    ev(1200, 'run.end', { run: 'r2', status: 'pass', data: { counts: { total: 1, pass: 1, fail: 0, skip: 0 } } }),
  ]);
  const m = agentMetrics(s.agents.get('x'));
  assert.equal(m.executions, 14);
  assert.equal(m.fail, 1);
  assert.equal(m.unique, 1, 'summary counts have no test ids, so unique only counts named results');
  assert.equal(s.agents.get('x').totals.summaryExecutions, 13);
});

test('activities show at their station for a hold window, then idle', () => {
  const s = reduce([ev(0, 'activity', { data: { activity: 'lint' } })]);
  const a = s.agents.get('x');
  assert.equal(activityAt(s, a, T + 1000).kind, 'lint');
  assert.equal(activityAt(s, a, T + 60_000).kind, 'idle');
  assert.equal(a.activityCounts.lint, 1);
  assert.throws(() => ev(0, 'activity', { data: { activity: 'Rm -rf' } }), /lowercase id/);
});

test('summary run replays as a burst of reps, then celebrates', () => {
  const s = reduce([ev(0, 'run.start', { run: 'r', data: { target: 't' } }), ev(100, 'run.end', { run: 'r', status: 'pass', data: { counts: { total: 10, pass: 10, fail: 0, skip: 0 } } })]);
  const a = s.agents.get('x');
  assert.equal(activityAt(s, a, T + 600).kind, 'bench');
  assert.equal(activityAt(s, a, T + 100 + 2600 + 500).kind, 'celebrate');
});

test('editing test files during treadmill reruns writes on the whiteboard', () => {
  const d = { categories: { production: { added: 0, deleted: 0, files: 0 } }, key: 'k0' };
  const s = reduce([
    ev(0, 'diff.snapshot', { data: d }),
    ev(1, 'run.start', { run: 'r1', data: { target: 't' } }),
    ev(2, 'run.end', { run: 'r1', status: 'pass' }),
    ev(3, 'run.start', { run: 'r2', data: { target: 't' } }),
    ev(4, 'run.end', { run: 'r2', status: 'pass' }),
    ev(5000, 'activity', { data: { activity: 'edit-test' } }),
  ]);
  const act = activityAt(s, s.agents.get('x'), T + 6000);
  assert.equal(act.kind, 'treadmill');
  assert.equal(act.detail.writing, true);
});

test('editing test files is its own write-tests beat; production edits are edit', () => {
  const s = reduce([ev(0, 'activity', { data: { activity: 'edit-test' } }), ev(10, 'activity', { agent: 'y', data: { activity: 'edit' } })]);
  assert.equal(activityAt(s, s.agents.get('x'), T + 1000).kind, 'write-tests');
});
