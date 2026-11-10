// Jest / Vitest JSON reporter importer -> Overfit Gym events.
//
//   node adapters/jest-json-import.mjs results.json [--agent ID] [--post | --out events.jsonl]
//
// Reads the output of `jest --json` or `vitest --reporter=json` (Vitest's format is
// Jest-compatible). One file is one run.
//
// Assertion counts: Jest writes `numPassingAsserts` on each assertionResults entry
// (passing `expect` calls only). Vitest's JSON reporter has no such field. So:
//   - Jest, status "passed", numPassingAsserts present  -> assertions = that number
//   - failed/skipped/todo tests, or the field missing (Vitest) -> assertions absent (unknown)
// For a failed test numPassingAsserts is only the assertions that passed before the
// failure, not the test's total, so it is deliberately not reported.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashHex } from '../src/core/hash.js';

const STATUS = { passed: 'pass', failed: 'fail', pending: 'skip', skipped: 'skip', disabled: 'skip', todo: 'todo' };

function relativeSafe(cwd, file) {
  if (typeof file !== 'string' || !file) return undefined;
  const rel = path.relative(cwd, file);
  return rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(file) : rel.split(path.sep).join('/');
}

/** Parse a Jest-compatible results object into suites of cases. */
export function parseJestJson(json, { cwd = process.cwd() } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.testResults)) throw new Error('not a Jest/Vitest JSON results object (no testResults array)');
  return data.testResults.map((tr) => {
    const cases = (Array.isArray(tr.assertionResults) ? tr.assertionResults : []).map((a) => {
      const status = STATUS[a.status] ?? 'skip';
      const c = {
        name: [...(Array.isArray(a.ancestorTitles) ? a.ancestorTitles : []), a.title ?? a.fullName ?? '(unnamed)'].join(' > '),
        status,
        time: typeof a.duration === 'number' && a.duration >= 0 ? a.duration / 1000 : 0,
      };
      if (status === 'pass' && Number.isInteger(a.numPassingAsserts) && a.numPassingAsserts >= 0) c.assertions = a.numPassingAsserts;
      return c;
    });
    const file = relativeSafe(cwd, tr.name);
    const time = typeof tr.endTime === 'number' && typeof tr.startTime === 'number' ? Math.max(0, (tr.endTime - tr.startTime) / 1000) : 0;
    return { name: file ?? 'suite', file, time, startTime: typeof tr.startTime === 'number' ? tr.startTime : undefined, cases };
  });
}

/** Turn parsed suites into normalized events for one run. */
export function jestToEvents(suites, { agent, runKey, startTs, command_class = 'jest json import' }) {
  const run = `${agent}:jest-json:${runKey}`;
  let seq = 0;
  let t = startTs;
  const ev = (fields) => ({ v: 1, id: `${run}:${seq}`, seq: seq++, source: 'jest-json', synthetic: false, agent, run, ...fields });
  const events = [ev({ ts: t, kind: 'run.start', data: { target: `jest-json:${hashHex(suites.map((s) => s.name).join('|'))}`, command_class } })];
  let failed = false;
  for (const s of suites) {
    if (s.startTime && s.startTime > t) t = s.startTime;
    let suiteFailed = false;
    for (const c of s.cases) {
      t += Math.max(1, Math.round(c.time * 1000));
      if (c.status === 'fail') failed = suiteFailed = true;
      const test = s.file ? { name: c.name, file: s.file } : { name: c.name };
      const fields = { ts: t, kind: 'test.result', suite: s.name, test, status: c.status, duration_ms: Math.round(c.time * 1000) };
      if (c.assertions !== undefined) fields.assertions = c.assertions;
      events.push(ev(fields));
    }
    events.push(ev({ ts: t, kind: 'suite.end', suite: s.name, status: suiteFailed ? 'fail' : 'pass', duration_ms: Math.round(s.time * 1000) }));
  }
  events.push(ev({ ts: t + 1, kind: 'run.end', status: failed ? 'fail' : 'pass' }));
  return events;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node adapters/jest-json-import.mjs results.json [--agent ID] [--post | --out events.jsonl]');
    process.exit(2);
  }
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const text = fs.readFileSync(file, 'utf8');
  const stat = fs.statSync(file);
  const agent = arg('--agent') || `jest-json-${hashHex(path.resolve(file))}`;
  const events = jestToEvents(parseJestJson(text), { agent, runKey: hashHex(text), startTs: Math.round(stat.mtimeMs) });
  if (process.argv.includes('--post')) {
    const url = process.env.OVERFIT_URL || 'http://127.0.0.1:4377';
    for (let i = 0; i < events.length; i += 500) {
      const r = await fetch(`${url}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: events.slice(i, i + 500) }) });
      console.log(JSON.stringify(await r.json()));
    }
  } else if (arg('--out')) {
    fs.appendFileSync(arg('--out'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    console.log(`wrote ${events.length} events`);
  } else {
    for (const e of events) console.log(JSON.stringify(e));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
