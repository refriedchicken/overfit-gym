// Assertion counts: present only where a runner exposes them, absent (unknown) elsewhere.
// Fixtures in test/fixtures/runners are hand-written format fixtures, not live runner output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJUnit, junitToEvents } from '../adapters/junit-import.mjs';
import { parseJestJson, jestToEvents } from '../adapters/jest-json-import.mjs';
import { mapNodeTestEvent } from '../adapters/node-test-reporter.mjs';
import { normalizeEvent } from '../src/core/events.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/runners');
const results = (events) => events.map(normalizeEvent).filter((e) => e.kind === 'test.result');
const base = { v: 1, id: 'a', ts: 1e12, source: 'x', synthetic: false, agent: 'a', kind: 'test.result', test: { name: 't' }, status: 'pass' };

test('events: assertions must be a non-negative integer or absent; never defaulted', () => {
  assert.equal('assertions' in normalizeEvent(base), false);
  assert.equal(normalizeEvent({ ...base, assertions: 0 }).assertions, 0);
  assert.equal('assertions' in normalizeEvent({ ...base, assertions: null }), false);
  for (const bad of [-1, 1.5, '3', NaN]) assert.throws(() => normalizeEvent({ ...base, assertions: bad }), /assertions/);
  assert.throws(() => normalizeEvent({ ...base, kind: 'suite.end', assertions: 1 }), /only valid on test.result/);
});

test('JUnit: assertions attribute is read when present, unknown otherwise', () => {
  const xml = `<testsuite name="php"><testcase name="a" assertions="3"/><testcase name="b"/><testcase name="c" assertions="x"/></testsuite>`;
  const r = results(junitToEvents(parseJUnit(xml), { agent: 'ci', runKey: 'k', startTs: 1e12 }));
  assert.deepEqual(r.map((e) => e.assertions), [3, undefined, undefined]);
  assert.ok(r.slice(1).every((e) => !('assertions' in e)));
});

test('Jest JSON (format fixture): numPassingAsserts only for passed tests', () => {
  const json = fs.readFileSync(path.join(FIX, 'jest-results.format-fixture.json'), 'utf8');
  const r = results(jestToEvents(parseJestJson(json, { cwd: '/nowhere' }), { agent: 'j', runKey: 'k', startTs: 1e12 }));
  assert.deepEqual(r.map((e) => e.status), ['pass', 'pass', 'fail', 'skip']);
  assert.deepEqual(r.map((e) => e.assertions), [2, 0, undefined, undefined], 'failed test count is partial, so unknown');
  assert.equal(r[0].test.name, 'math > adds');
});

test('Vitest JSON (format fixture): no per-test count exposed, so unknown', () => {
  const json = fs.readFileSync(path.join(FIX, 'vitest-results.format-fixture.json'), 'utf8');
  const r = results(jestToEvents(parseJestJson(json), { agent: 'v', runKey: 'k', startTs: 1e12, command_class: 'vitest json import' }));
  assert.equal(r.length, 2);
  assert.ok(r.every((e) => !('assertions' in e)));
});

test('Jest importer rejects non-results input', () => {
  assert.throws(() => parseJestJson({}), /testResults/);
});

test('node:test reporter never reports assertions', () => {
  const m = mapNodeTestEvent({ type: 'test:pass', data: { name: 'x', nesting: 1, file: '/p/t.js', details: { type: 'test', duration_ms: 1 } } }, '/p');
  assert.equal(m.kind, 'test.result');
  assert.equal('assertions' in m, false);
});
