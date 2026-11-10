// node:test custom reporter -> Overfit Gym events.
//
// Observes a real `node --test` run and forwards normalized events. It never
// changes what runs, never retries, and never fails the test run: if the gym
// is not reachable it prints one warning and keeps going.
//
//   node --test \
//     --test-reporter=spec --test-reporter-destination=stdout \
//     --test-reporter=./adapters/node-test-reporter.mjs --test-reporter-destination=stderr
//
// Environment:
//   OVERFIT_URL    gym base URL (default http://127.0.0.1:4377); set to "off" to disable posting
//   OVERFIT_OUT    optional JSONL file to append events to (useful offline / for replay)
//   OVERFIT_AGENT  optional agent id; default is a hash of host + cwd (pseudonymous)
//   OVERFIT_DIFF   set to 0 to skip the git diff snapshot

import fs from 'node:fs';
import path from 'node:path';
import { hashHex } from '../src/core/hash.js';
import { collectSnapshot, defaultAgentId } from './git-diff.mjs';

/**
 * Pure mapping from one node:test reporter event to zero or one gym event
 * fields (without id/ts/agent/run, which the caller adds). Exported for tests.
 */
export function mapNodeTestEvent(e, cwd) {
  const d = e.data ?? {};
  if (e.type !== 'test:pass' && e.type !== 'test:fail') return null;
  const file = d.file ? relativeSafe(cwd, d.file) : undefined;
  // With process isolation each file is wrapped in a synthetic top-level test
  // named after the file. It is not a test case; skip it.
  if (d.nesting === 0 && d.file && d.name && (d.file === d.name || d.file.endsWith(d.name))) return null;
  // --test-rerun-failures replays earlier passes without executing them
  // (details.passed_on_attempt < details.attempt). Not an execution: skip.
  const det = d.details ?? {};
  if (typeof det.passed_on_attempt === 'number' && typeof det.attempt === 'number' && det.passed_on_attempt < det.attempt) return null;
  const type = d.details?.type ?? 'test';
  let status = e.type === 'test:pass' ? 'pass' : 'fail';
  if (d.skip) status = 'skip';
  else if (d.todo) status = 'todo';
  else if (d.details?.error?.failureType === 'cancelledByParent') status = 'cancelled';
  const duration = typeof d.details?.duration_ms === 'number' ? Math.round(d.details.duration_ms * 100) / 100 : undefined;
  if (type === 'suite') return { kind: 'suite.end', suite: d.name, status, duration_ms: duration };
  const out = { kind: 'test.result', test: file ? { name: d.name, file } : { name: d.name }, status, duration_ms: duration };
  if (typeof det.attempt === 'number') out.attempt = det.attempt + 1; // node counts attempts from 0
  return out;
}

function relativeSafe(cwd, file) {
  const f = file.startsWith('file://') ? new URL(file).pathname : file;
  const rel = path.relative(cwd, f);
  return rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(f) : rel.split(path.sep).join('/');
}

export default async function* overfitReporter(source) {
  const cwd = process.cwd();
  const url = process.env.OVERFIT_URL || 'http://127.0.0.1:4377';
  const outFile = process.env.OVERFIT_OUT;
  const agent = process.env.OVERFIT_AGENT || defaultAgentId('node', cwd);
  const started = Date.now();
  const run = `${agent}:run:${hashHex(`${process.pid}:${started}`)}`;
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--test-reporter'));
  const target = `node-test:${hashHex(`${cwd}|${args.join(' ')}`)}`;
  let n = 0;
  let pending = [];
  let warned = false;
  let sent = 0;
  const counts = { pass: 0, fail: 0, skip: 0, todo: 0, cancelled: 0 };
  const suiteStack = [];

  const make = (fields) => ({ v: 1, id: `${run}:${n}`, seq: n++, ts: Date.now(), source: 'node-test', synthetic: false, agent, run, ...fields });

  async function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    if (outFile) fs.appendFileSync(outFile, batch.map((e) => JSON.stringify(e)).join('\n') + '\n');
    if (url === 'off') return;
    try {
      const r = await fetch(`${url}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: batch }), signal: AbortSignal.timeout(2000) });
      if (r.ok) sent += batch.length;
      else if (!warned) (warned = true), process.emitWarning(`overfit-gym: server answered ${r.status}`);
    } catch {
      if (!warned) (warned = true), process.emitWarning(`overfit-gym: gym not reachable at ${url}; continuing without it`);
    }
  }

  if (process.env.OVERFIT_DIFF !== '0') {
    const snap = collectSnapshot(cwd);
    if (snap) pending.push(make({ kind: 'diff.snapshot', data: snap }));
  }
  pending.push(make({ kind: 'run.start', data: { target, command_class: 'node --test' } }));
  await flush();

  let lastFlush = Date.now();
  for await (const e of source) {
    if (e.type === 'test:start') suiteStack[e.data.nesting] = e.data.name;
    const mapped = mapNodeTestEvent(e, cwd);
    if (!mapped) continue;
    if (mapped.kind === 'test.result') {
      counts[mapped.status]++;
      const suite = suiteStack.slice(0, e.data.nesting).filter(Boolean).join(' > ');
      if (suite) mapped.suite = suite;
    }
    pending.push(make(mapped));
    if (Date.now() - lastFlush > 150 || pending.length >= 100) {
      await flush();
      lastFlush = Date.now();
    }
  }
  pending.push(make({ kind: 'run.end', status: counts.fail > 0 ? 'fail' : 'pass', duration_ms: Date.now() - started, data: { counts } }));
  await flush();
  yield `overfit-gym: ${n} events for agent ${agent} (${sent} delivered${outFile ? ', also written to OVERFIT_OUT' : ''})\n`;
}
