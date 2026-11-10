// JUnit XML importer -> Overfit Gym events.
//
//   node adapters/junit-import.mjs report.xml [--agent ID] [--post | --out events.jsonl]
//
// Works with the common JUnit dialect produced by pytest --junitxml, jest-junit,
// vitest's junit reporter, Maven Surefire, and others: <testsuite>/<testcase> with
// <failure>, <error> or <skipped> children. One file is one run. Timestamps come
// from the suite's `timestamp` attribute when present, otherwise the file's mtime,
// and per-case times are laid out from the reported `time` values. They are
// approximations, not observations. A <testcase assertions="N"> attribute (written by
// PHPUnit) becomes `assertions` on the result; without it the count stays unknown.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashHex } from '../src/core/hash.js';

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[3] ?? m[4] ?? '');
  return out;
}

function decode(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (_, n, d, x) =>
    d ? String.fromCodePoint(Number(d)) : x ? String.fromCodePoint(parseInt(x, 16)) : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[n.toLowerCase()],
  );
}

/** Parse JUnit XML into suites of cases. Tolerant, dependency-free, no entity expansion beyond the basics. */
export function parseJUnit(xml) {
  if (typeof xml !== 'string' || xml.length > 20_000_000) throw new Error('input too large or not text');
  const suites = [];
  const suiteRe = /<testsuite\b([^>]*?)(\/>|>([\s\S]*?)<\/testsuite>)/g;
  for (const sm of xml.matchAll(suiteRe)) {
    const sa = attrs(sm[1]);
    const body = sm[3] ?? '';
    const cases = [];
    for (const cm of body.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const ca = attrs(cm[1]);
      const inner = cm[3] ?? '';
      let status = 'pass';
      if (/<(failure|error)\b/.test(inner)) status = 'fail';
      else if (/<skipped\b/.test(inner)) status = 'skip';
      const c = { name: ca.name ?? '(unnamed)', classname: ca.classname, file: ca.file, time: Number(ca.time) || 0, status };
      // `assertions` is a non-standard attribute (PHPUnit writes it). Absent or malformed means unknown.
      if (/^\d+$/.test(ca.assertions ?? '')) c.assertions = Number(ca.assertions);
      cases.push(c);
    }
    suites.push({ name: sa.name ?? 'suite', timestamp: sa.timestamp, time: Number(sa.time) || 0, cases });
  }
  return suites;
}

/** Turn parsed suites into normalized events for one run. */
export function junitToEvents(suites, { agent, runKey, startTs }) {
  const run = `${agent}:junit:${runKey}`;
  let seq = 0;
  let t = startTs;
  const ev = (fields) => ({ v: 1, id: `${run}:${seq}`, seq: seq++, source: 'junit', synthetic: false, agent, run, ...fields });
  const events = [ev({ ts: t, kind: 'run.start', data: { target: `junit:${hashHex(suites.map((s) => s.name).join('|'))}`, command_class: 'junit import' } })];
  let failed = false;
  for (const s of suites) {
    const suiteStart = s.timestamp && !Number.isNaN(Date.parse(s.timestamp)) ? Math.max(t, Date.parse(s.timestamp)) : t;
    t = suiteStart;
    let suiteFailed = false;
    for (const c of s.cases) {
      t += Math.max(1, Math.round(c.time * 1000));
      if (c.status === 'fail') failed = suiteFailed = true;
      const test = { name: c.classname ? `${c.classname} > ${c.name}` : c.name };
      if (c.file) test.file = c.file;
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
    console.error('usage: node adapters/junit-import.mjs report.xml [--agent ID] [--post | --out events.jsonl]');
    process.exit(2);
  }
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const xml = fs.readFileSync(file, 'utf8');
  const stat = fs.statSync(file);
  const agent = arg('--agent') || `junit-${hashHex(path.resolve(file))}`;
  const events = junitToEvents(parseJUnit(xml), { agent, runKey: hashHex(xml), startTs: Math.round(stat.mtimeMs) });
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
