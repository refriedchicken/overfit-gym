import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCommand, mapHookPayload } from '../adapters/agent-hook.mjs';
import { normalizeEvent } from '../src/core/events.js';
import { reduce } from '../src/core/reducer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('classifyCommand recognizes runners through env vars, wrappers and chains', () => {
  const yes = {
    'npm test': 'npm test',
    'pnpm run test -- --watch=false': 'npm test',
    'CI=1 npx vitest run': 'vitest',
    'cd app && python -m pytest -q': 'pytest',
    'go test ./...': 'go test',
    'cargo nextest run': 'cargo test',
    'node --test test/': 'node --test',
    'git status; npm test 2>&1 | tail -20': 'npm test',
  };
  for (const [cmd, want] of Object.entries(yes)) assert.equal(classifyCommand(cmd), want, cmd);
  for (const cmd of ['npm install', 'ls test/', 'git commit -m "add test"', 'cat jest.config.js', 'echo pytest']) assert.equal(classifyCommand(cmd), null, cmd);
});

const payload = (over = {}) => ({
  session_id: 'sess-123',
  transcript_path: '/private/path/transcript.jsonl',
  cwd: '/private/project',
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_use_id: 'toolu_1',
  tool_input: { command: 'SECRET_TOKEN=abc npm test' },
  tool_response: { stdout: 'lots of output' },
  ...over,
});

test('hook payload maps to a command-level run and leaks nothing private', () => {
  const [ev] = mapHookPayload(payload(), 1_700_000_000_000);
  const n = normalizeEvent(ev);
  assert.equal(n.kind, 'run.end');
  assert.equal(n.status, 'pass');
  assert.equal(n.data.command_class, 'npm test');
  const json = JSON.stringify(n);
  for (const secret of ['sess-123', 'SECRET_TOKEN', 'abc', '/private', 'transcript', 'lots of output']) assert.ok(!json.includes(secret), secret);
});

test('hook failure, interrupt, non-test commands and subagents', () => {
  assert.equal(mapHookPayload(payload({ hook_event_name: 'PostToolUseFailure' }))[0].status, 'fail');
  assert.equal(mapHookPayload(payload({ hook_event_name: 'PostToolUseFailure', is_interrupt: true }))[0].status, 'cancelled');
  assert.deepEqual(mapHookPayload(payload({ tool_input: { command: 'npm install' } })), []);
  assert.deepEqual(mapHookPayload(payload({ hook_event_name: 'PreToolUse' })), []);
  const [spawn] = mapHookPayload(payload({ tool_name: 'Task', tool_input: { prompt: 'secret plan' } }));
  assert.equal(normalizeEvent(spawn).kind, 'agent.spawn');
  assert.ok(!JSON.stringify(spawn).includes('secret plan'));
});

test('same command twice in a session is a rerun', () => {
  const a = mapHookPayload(payload({ tool_use_id: 't1' }), 1e12)[0];
  const b = mapHookPayload(payload({ tool_use_id: 't2' }), 1e12 + 5000)[0];
  const t = reduce([a, b].map(normalizeEvent)).agents.get(a.agent).totals;
  assert.equal(t.runs, 2);
  assert.equal(t.reruns, 1);
});

test('hook script exits 0 on garbage and never runs the command', () => {
  const script = path.join(ROOT, 'adapters/agent-hook.mjs');
  for (const input of ['not json', JSON.stringify(payload({ tool_input: { command: 'npm test && touch /tmp/overfit-should-not-exist' } }))]) {
    execFileSync(process.execPath, [script], { input, env: { ...process.env, OVERFIT_URL: 'off' } });
  }
  assert.throws(() => execFileSync('test', ['-e', '/tmp/overfit-should-not-exist']));
});

