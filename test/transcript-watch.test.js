import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWatcher, parsePatch, extractCodexCalls } from '../adapters/transcript-watch.mjs';
import { normalizeEvent } from '../src/core/events.js';
import { reduce } from '../src/core/reducer.js';
import { agentMetrics } from '../src/core/metrics.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/transcripts');
const NOW = Date.parse('2026-01-05T11:00:00Z');

function scanAll() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overfit-watch-'));
  const stateFile = path.join(dir, 'state.json');
  const w = createWatcher({
    sources: [
      { source: 'claude', dir: path.join(FIX, 'claude') },
      { source: 'codex', dir: path.join(FIX, 'codex') },
    ],
    backfillMs: 1e15,
    stateFile,
  });
  return { w, stateFile };
}

function snapshotTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

test('claude + codex fixtures become valid events with real counts', () => {
  const before = snapshotTree(FIX);
  const { w } = scanAll();
  const { events, commit } = w.scan(NOW);
  commit();
  assert.deepEqual(snapshotTree(FIX), before, 'transcripts are never modified');
  const norm = events.map(normalizeEvent);
  const s = reduce(norm);

  const claude = [...s.agents.values()].find((a) => a.project === 'demo-app' && !a.parent);
  assert.ok(claude, 'claude session agent carries its project folder name only');
  const m = agentMetrics(claude);
  assert.equal(m.runs, 3);
  assert.equal(m.executions, 13 + 13 + 14, 'counts parsed from node:test summaries');
  assert.equal(m.fail, 1);
  assert.equal(m.treadmill, 1, 'second identical npm test with no edit between is a treadmill');
  assert.equal(m.reruns, 2, 'third run after edits is a rerun but not a treadmill');
  assert.equal(claude.activityCounts.push, 1);
  assert.equal(claude.lastActivity.force, true);
  assert.equal(claude.diff.categories.production.added, 3);
  assert.equal(claude.diff.categories.test.added, 4);
  assert.equal(m.ratio.denominator, 5, 'Edit: +3/-2 production lines');

  const sub = [...s.agents.values()].find((a) => a.parent === claude.id);
  assert.ok(sub, 'subagent sidechain file becomes a spotter of the parent session');
  assert.equal(sub.activityCounts.lint, 1);

  const codex = [...s.agents.values()].find((a) => a.project === 'api');
  assert.ok(codex, 'codex session agent');
  const cm = agentMetrics(codex);
  assert.equal(cm.executions, 4);
  assert.equal(cm.fail, 1);
  assert.equal(codex.activityCounts.pr, 1);
  assert.equal(codex.diff.categories.production.added, 2);
  assert.equal(codex.diff.categories.test.added, 2);
  assert.ok(codex.parent, 'codex subagent linked to its parent thread');

  const json = JSON.stringify(events);
  for (const leak of ['/work/', 'demo-app && npm', 'pytest -q', 'sess-fixture-1', 'codex-sess-1', 'slug.js', 'eslint src', 'gh pr create', 'assert True', 'example.invalid']) {
    assert.ok(!json.includes(leak), `does not leak ${leak}`);
  }
});

test('rescans are incremental and idempotent', () => {
  const { w } = scanAll();
  const first = w.scan(NOW);
  first.commit();
  const second = w.scan(NOW);
  assert.equal(second.events.length, 0, 'nothing new after commit');
  const ids = new Set(first.events.map((e) => e.id));
  assert.equal(ids.size, first.events.length, 'event ids unique');
});

test('patch and codex call extraction', () => {
  assert.deepEqual(
    parsePatch('*** Begin Patch\n*** Update File: a.js\n@@\n-x\n+y\n+z\n*** Add File: b.test.js\n+1\n*** End Patch').map((f) => [f.path, f.added, f.deleted]),
    [
      ['a.js', 2, 1],
      ['b.test.js', 1, 0],
    ],
  );
  const { commands } = extractCodexCalls('await Promise.all([tools.exec_command({cmd:"npm test"}), tools.exec_command({ cmd: "git status" })])');
  assert.deepEqual(commands, ['npm test', 'git status']);
});

test('malformed tool inputs are skipped, never thrown', async () => {
  const { createSessionParser } = await import('../adapters/transcript-watch.mjs');
  const p = createSessionParser({ source: 'claude', fileKey: 'k' });
  const line = (content) => ({ type: 'assistant', timestamp: '2026-01-05T09:00:00Z', sessionId: 's', cwd: '/w', message: { content } });
  assert.doesNotThrow(() => p.feed(line([{ type: 'tool_use', id: 'a', name: 'Edit', input: {} }])));
  assert.doesNotThrow(() => p.feed(line([{ type: 'tool_use', id: 'b', name: 'Write', input: { content: 'x' } }])));
  assert.doesNotThrow(() => p.feed(line([{ type: 'tool_use', id: 'c', name: 'MultiEdit', input: { file_path: 'a.js', edits: 'nope' } }])));
  assert.doesNotThrow(() => p.feed(line([{ type: 'tool_use', id: 'd', name: 'Bash', input: {} }])));
});

test('session models become identities: adjacent name + version, never the raw model id', async () => {
  const { createSessionParser } = await import('../adapters/transcript-watch.mjs');
  const p = createSessionParser({ source: 'claude', fileKey: 'k' });
  const out = p.feed({ type: 'assistant', timestamp: '2026-01-05T09:00:00Z', sessionId: 's1', cwd: '/w/app', message: { model: 'claude-fable-5-2', content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm test' } }] } });
  const hello = out.find((e) => e.kind === 'agent.hello');
  assert.equal(hello.data.model, 'anthropic:5.2');
  assert.match(hello.data.label, /^[A-Z][a-z]+ 5\.2$/);
  assert.equal(hello.data.model_name, 'claude-fable-5-2', 'the real model id rides along for the sidebar');
  assert.equal(hello.data.project, 'app');
  const quiet = createSessionParser({ source: 'claude', fileKey: 'q', modelNames: false, projectLabels: false });
  const qh = quiet.feed({ type: 'assistant', timestamp: '2026-01-05T09:00:00Z', sessionId: 's9', cwd: '/w/app', message: { model: 'claude-fable-5-2', content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm test' } }] } }).find((e) => e.kind === 'agent.hello');
  assert.deepEqual(Object.keys(qh.data).sort(), ['label', 'model'], 'both can be switched off');
  const cx = createSessionParser({ source: 'codex', fileKey: 'k2' });
  cx.feed({ timestamp: '2026-01-05T10:00:00Z', type: 'session_meta', payload: { id: 'c1', cwd: '/w/api' } });
  const late = cx.feed({ timestamp: '2026-01-05T10:00:01Z', type: 'turn_context', payload: { model: 'gpt-6.1-sol' } });
  assert.equal(late.length, 1, 'a model seen after the first hello re-announces the agent');
  assert.equal(late[0].data.model, 'openai:6.1');
  assert.equal(late[0].data.model_name, 'gpt-6.1-sol');
  assert.equal(late[0].data.project, 'api');
});
