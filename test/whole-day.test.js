// The rest of the working day: Windows shells, and the signals that are not
// tests (thinking, connectors, the browser, planning, prompts, waits, errors,
// compaction, subagent chatter). Every one becomes an activity id and nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand } from '../src/core/activities.js';
import { createSessionParser, extractCodexToolUses } from '../adapters/transcript-watch.mjs';
import { normalizeEvent } from '../src/core/events.js';

const T0 = Date.parse('2026-01-05T09:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const acts = (events) => events.filter((e) => e.kind === 'activity').map((e) => e.data.activity);

test('PowerShell and Windows commands get the same stations as their Unix cousins', () => {
  const c = (cmd) => {
    const r = classifyCommand(cmd);
    return r ? (r.kind === 'test' ? `test:${r.runner}` : r.activity) : null;
  };
  assert.equal(c("Get-Content -LiteralPath 'memory/a.md'"), 'read');
  assert.equal(c('gc README.md -TotalCount 20'), 'read');
  assert.equal(c("Get-Content x.log | Select-Object -Last 40"), 'read');
  assert.equal(c("Select-String -Path *.cs -Pattern 'Foo'"), 'grep');
  assert.equal(c('findstr /s /i foo *.cs'), 'grep');
  assert.equal(c("find . -name '*.md'"), 'grep');
  assert.equal(c('ls -la'), null, 'listing a folder is not a search');
  assert.equal(c('Get-ChildItem -Directory'), null, 'nor is its PowerShell twin');
  assert.equal(c("$ErrorActionPreference='Stop'\nGet-Content a.md"), 'read', 'a PowerShell preamble is its own statement');
  assert.equal(c('$note = Get-Content -Raw a.md'), 'read', 'assignment prefix is stripped');
  assert.equal(c("& 'C:\\repo\\run-tests.ps1' -Filter Unit"), 'test:test script');
  assert.equal(c('.\\run-tests.ps1'), 'test:test script');
  assert.equal(c('./scripts/test.sh'), 'test:test script');
  assert.equal(c('pwsh -NoProfile -File run_tests.ps1'), 'test:test script');
  assert.equal(c('Invoke-Pester -Path tests'), 'test:pester');
  assert.equal(c('pwsh -NoProfile -Command "dotnet test"'), 'test:dotnet test');
  assert.equal(c('powershell.exe -Command git push --force'), 'push');
  assert.equal(classifyCommand('powershell.exe -Command git push --force').force, true);
  assert.equal(c('Get-Content run-tests.ps1'), 'read', 'reading a test script is not running it');
  assert.equal(c('cat a.txt'), 'read', 'unix behavior unchanged');
  assert.equal(c('npm test'), 'test:npm test');
  assert.equal(c('lsof -i :4377'), null, 'ls needs a word boundary');
});

function claude() {
  const p = createSessionParser({ source: 'claude', fileKey: 'k' });
  let n = 0;
  const line = (type, extra) => ({ type, timestamp: at(n++), uuid: `u${n}`, sessionId: 'sess-secret', cwd: 'C:\\Users\\someone\\work\\app', ...extra });
  const say = (content, extra) => p.feed(line('assistant', { message: { model: 'claude-opus-5-5', content }, ...extra }));
  const hear = (content, extra) => p.feed(line('user', { message: { content }, ...extra }));
  const sys = (extra) => p.feed(line('system', extra));
  return { say, hear, sys };
}

test('claude: thinking, connectors, browser, planning, waits and chatter become activities', () => {
  const { say } = claude();
  const tool = (id, name, input = {}) => say([{ type: 'tool_use', id, name, input }]);
  const all = [
    say([{ type: 'thinking', thinking: 'secret plan', signature: 'x' }]),
    tool('t1', 'mcp__11111111-2222-4333-8444-555555555555__slack_send_message', { text: 'secret message' }),
    tool('t2', 'mcp__Claude_Browser__navigate', { url: 'https://example.invalid/secret' }),
    tool('t3', 'mcp__claude-in-chrome__computer'),
    tool('t4', 'WebFetch', { url: 'https://example.invalid/doc' }),
    tool('t5', 'WebSearch', { query: 'secret query' }),
    tool('t6', 'mcp__ccd_turn__update_plan', { items: [] }),
    tool('t7', 'TodoWrite', { todos: [] }),
    tool('t8', 'AskUserQuestion', { questions: [] }),
    tool('t9', 'SendMessage', { to: 'x', message: 'secret' }),
    tool('t10', 'Skill', { skill: 'secret-skill' }),
    tool('t11', 'mcp__ccd_session__start_session', {}),
    tool('t12', 'mcp__terminal__run_in_terminal', {}),
  ].flat();
  assert.deepEqual(acts(all), ['think', 'connector', 'browse', 'browse', 'browse', 'browse', 'plan', 'plan', 'wait', 'huddle', 'read']);
  all.forEach((e) => normalizeEvent(e));
  const json = JSON.stringify(all);
  for (const leak of ['secret', 'slack', 'example.invalid', 'navigate', 'Users', 'someone', 'start_session', '11111111']) assert.ok(!json.includes(leak), `does not leak ${leak}`);
});

test('claude: PowerShell tool calls are runs and activities, like Bash', () => {
  const { say, hear } = claude();
  const start = say([{ type: 'tool_use', id: 'ps1', name: 'PowerShell', input: { command: 'dotnet test' } }]);
  assert.ok(start.some((e) => e.kind === 'run.start'));
  const end = hear([{ type: 'tool_result', tool_use_id: 'ps1', content: 'Passed!  - Failed: 0, Passed: 12, Skipped: 0, Total: 12' }]);
  assert.ok(end.some((e) => e.kind === 'run.end' && e.status === 'pass'));
  say([{ type: 'tool_use', id: 'ps2', name: 'PowerShell', input: { command: 'Get-Content a.md' } }]);
  assert.deepEqual(acts(hear([{ type: 'tool_result', tool_use_id: 'ps2', content: 'x' }])), ['read']);
});

test('claude: your messages blow the whistle; injected and subagent messages do not', () => {
  const { hear } = claude();
  assert.deepEqual(acts(hear('please fix the secret bug')), ['coach']);
  assert.deepEqual(acts(hear([{ type: 'text', text: 'and this one' }])), ['coach']);
  assert.deepEqual(acts(hear([{ type: 'text', text: '[Request interrupted by user]' }])), ['coach']);
  assert.deepEqual(acts(hear('<system-reminder>x</system-reminder>')), []);
  assert.deepEqual(acts(hear('<task-notification>x</task-notification>')), []);
  assert.deepEqual(acts(hear('meta', { isMeta: true })), []);
  assert.deepEqual(acts(hear('from the parent agent', { isSidechain: true, agentId: 'a1' })), []);
  assert.deepEqual(acts(hear('summary of earlier', { isCompactSummary: true })), []);
  const json = JSON.stringify(hear('my password is hunter2'));
  assert.ok(!json.includes('hunter2'), 'prompt text never leaves');
});

test('claude: failed tool calls are fumbles; failed shell runs keep their own status', () => {
  const { say, hear } = claude();
  say([{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'C:\\Users\\someone\\work\\app\\src\\a.js', old_string: 'a', new_string: 'b' } }]);
  const f = hear([{ type: 'tool_result', tool_use_id: 'e1', is_error: true, content: 'String not found: secret' }]);
  assert.deepEqual(acts(f), ['fumble']);
  assert.equal(f.find((e) => e.data?.activity === 'fumble').status, 'fail');
  say([{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'git push' } }]);
  const b = hear([{ type: 'tool_result', tool_use_id: 'b1', is_error: true, content: 'rejected' }]);
  assert.deepEqual(acts(b), ['push'], 'no extra fumble for a tracked command');
  assert.equal(b[0].status, 'fail');
});

test('claude: compaction is a protein shake', () => {
  const { sys, say } = claude();
  say([{ type: 'thinking', thinking: '' }]);
  assert.deepEqual(acts(sys({ subtype: 'compact_boundary', content: 'Conversation compacted' })), ['refuel']);
  assert.deepEqual(acts(sys({ subtype: 'informational', content: 'x' })), []);
});

test('claude: Windows edit paths classify relative to the project', () => {
  const p = createSessionParser({ source: 'claude', fileKey: 'w' });
  const cwd = 'C:\\build\\app';
  const edit = (file, ts) => p.feed({ type: 'assistant', timestamp: at(ts), uuid: `e${ts}`, sessionId: 's', cwd, message: { content: [{ type: 'tool_use', id: `x${ts}`, name: 'Write', input: { file_path: file, content: 'a\nb\n' } }] } });
  const snap = (evs) => evs.find((e) => e.kind === 'diff.snapshot' && e.data.key !== 'edits:0').data.categories;
  assert.equal(snap(edit('C:\\build\\app\\src\\a.js', 1)).production.added, 2, 'a "build" folder above the project does not make it generated');
  assert.equal(snap(edit('c:\\build\\app\\test\\a.test.js', 2)).test.added, 2, 'drive letter case does not matter');
});

function codex() {
  const p = createSessionParser({ source: 'codex', fileKey: 'c' });
  let n = 0;
  const rec = (type, payload) => p.feed({ timestamp: at(n++), type, payload });
  rec('session_meta', { id: 'codex-secret', cwd: 'C:\\Users\\someone\\work\\api' });
  return rec;
}

test('codex: reasoning, connectors and the web inside JS, waits, chatter and plans', () => {
  const rec = codex();
  const all = [
    rec('response_item', { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'secret' }),
    rec('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c1', input: 'const r = await Promise.all([tools.mcp__codex_apps__gmail_search({q:"secret"}), tools.web__run({q:"secret"}), tools.mcp__node_repl__eval({})]);' }),
    rec('response_item', { type: 'function_call', name: 'request_user_input_async', call_id: 'c2', arguments: '{"questions":[]}' }),
    rec('response_item', { type: 'function_call', name: 'send_message', call_id: 'c3', arguments: '{"message":"secret"}' }),
    rec('response_item', { type: 'function_call', name: 'update_plan', call_id: 'c4', arguments: '{"plan":[]}' }),
    rec('response_item', { type: 'web_search_call', id: 'ws1', action: { query: 'secret' } }),
  ].flat();
  assert.deepEqual(acts(all), ['think', 'connector', 'browse', 'wait', 'huddle', 'plan', 'browse']);
  all.forEach((e) => normalizeEvent(e));
  const json = JSON.stringify(all);
  for (const leak of ['secret', 'gmail', 'codex_apps', 'Users', 'someone']) assert.ok(!json.includes(leak), `does not leak ${leak}`);
});

test('codex: commands inside the js tool are seen, PowerShell included', () => {
  const rec = codex();
  const start = rec('response_item', { type: 'function_call', name: 'js', call_id: 'j1', arguments: JSON.stringify({ title: 't', code: 'await tools.exec_command({cmd: "& .\\\\run-tests.ps1"})' }) });
  assert.ok(start.some((e) => e.kind === 'run.start'), 'run-tests.ps1 inside js is a test run');
  const end = rec('response_item', { type: 'function_call_output', call_id: 'j1', output: 'Exit code: 0' });
  assert.ok(end.some((e) => e.kind === 'run.end' && e.status === 'pass'));
  rec('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'x1', input: 'await tools.exec_command({cmd: "Get-Content -LiteralPath \'a.md\'"})' });
  assert.deepEqual(acts(rec('response_item', { type: 'custom_tool_call_output', call_id: 'x1', output: 'Exit code: 0' })), ['read']);
});

test('codex: human messages and interrupts blow the whistle; injected ones and reviewer history do not', () => {
  const rec = codex();
  const user = (text) => rec('response_item', { type: 'message', role: 'user', id: `m${text.length}`, content: [{ type: 'input_text', text }] });
  assert.deepEqual(acts(user('can you split this function?')), ['coach']);
  assert.deepEqual(acts(user('<turn_aborted> The user interrupted the previous turn')), ['coach']);
  assert.deepEqual(acts(user('<environment_context> x')), []);
  assert.deepEqual(acts(user('# AGENTS.md instructions for C:\\x')), []);
  assert.deepEqual(acts(user('The following is the Codex agent history added since your last approval')), []);
  assert.deepEqual(acts(rec('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] })), []);
  assert.deepEqual(acts(rec('compacted', { message: 'secret summary' })), ['refuel']);
});

test('extractCodexToolUses maps JS tool calls to activity ids, skipping plumbing', () => {
  assert.deepEqual(
    extractCodexToolUses('tools.mcp__codex_apps__slack_send({}); tools.mcp__playwright__click({}); tools.mcp__node_repl__x(); tools.view_image({}); tools.exec_command({cmd:"ls"}); tools.apply_patch("x")'),
    ['connector', 'browse', 'read'],
  );
  assert.deepEqual(extractCodexToolUses(null), []);
});
