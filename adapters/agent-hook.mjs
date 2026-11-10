// Agent hook adapter (Claude Code style hook JSON on stdin) -> Overfit Gym events.
//
// Opt-in only: nothing installs this. To use it, register it yourself as a
// PostToolUse and PostToolUseFailure command hook (see README). It reads the hook
// payload, and if the tool call was a shell command that looks like a test
// runner, it emits one `run.end` (command-level: no per-test detail). Spawning
// a subagent emits `agent.spawn`.
//
// It never executes, echoes or forwards the command. Only a coarse runner class
// ("npm test", "pytest", ...) and a hash of the command leave the process.
// It always exits 0 so it can never block the agent.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashHex } from '../src/core/hash.js';
import { classifyCommand as classifyCore } from '../src/core/activities.js';

/**
 * Runner class for a shell command, or null. Thin wrapper over the shared
 * classifier in src/core/activities.js so hooks and transcripts agree.
 */
export function classifyCommand(command) {
  const c = classifyCore(command);
  return c?.kind === 'test' ? c.runner : null;
}

/** Map one hook payload to zero or more events. Pure; exported for tests. */
export function mapHookPayload(p, now = Date.now()) {
  if (!p || typeof p !== 'object') return [];
  const session = typeof p.session_id === 'string' ? p.session_id : 'unknown';
  const agent = `hook-${hashHex(session)}`;
  const toolUse = typeof p.tool_use_id === 'string' ? p.tool_use_id : `${now}`;
  const base = { v: 1, ts: now, source: 'agent-hook', synthetic: false, agent };
  const event = p.hook_event_name;
  if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return [];
  const tool = p.tool_name;
  if (tool === 'Task' || tool === 'Agent') {
    if (event !== 'PostToolUse') return [];
    return [{ ...base, id: `${agent}:spawn:${hashHex(toolUse)}`, kind: 'agent.spawn', data: { child: `hook-${hashHex(`${session}:${toolUse}`)}` } }];
  }
  if (tool !== 'Bash') return [];
  const command = p.tool_input?.command;
  const runner = classifyCommand(command);
  if (!runner) return [];
  const cwdKey = typeof p.cwd === 'string' ? p.cwd : '';
  const out = {
    ...base,
    id: `${agent}:run:${hashHex(toolUse)}`,
    kind: 'run.end',
    run: `${agent}:${hashHex(toolUse)}`,
    status: event === 'PostToolUseFailure' ? 'fail' : 'pass',
    data: { target: `cmd:${hashHex(`${cwdKey}|${command.trim()}`)}`, command_class: runner, observed: 'command-level' },
  };
  if (typeof p.duration_ms === 'number' && p.duration_ms >= 0) out.duration_ms = p.duration_ms;
  if (event === 'PostToolUseFailure' && p.is_interrupt === true) out.status = 'cancelled';
  return [out];
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1_000_000) return; // oversized payload: ignore
  }
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }
  const events = mapHookPayload(payload);
  if (!events.length) return;
  const url = process.env.OVERFIT_URL || 'http://127.0.0.1:4377';
  if (url === 'off') return;
  try {
    await fetch(`${url}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }), signal: AbortSignal.timeout(1500) });
  } catch {
    // gym not running: stay silent, never block the agent
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => {});
  process.exit(0);
}
