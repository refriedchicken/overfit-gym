import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, normalizeBatch, compareEvents, EventError, LIMITS } from '../src/core/events.js';

const base = { id: 'e1', ts: 1_700_000_000_000, source: 'test', synthetic: false, agent: 'a1', kind: 'run.start' };

test('normalizes a minimal event and fills defaults', () => {
  const ev = normalizeEvent(base);
  assert.equal(ev.v, 1);
  assert.equal(ev.seq, 0);
  assert.deepEqual(Object.keys(ev).sort(), ['agent', 'id', 'kind', 'seq', 'source', 'synthetic', 'ts', 'v']);
});

test('accepts ISO timestamps', () => {
  const ev = normalizeEvent({ ...base, ts: '2026-01-05T09:00:00.000Z' });
  assert.equal(ev.ts, Date.UTC(2026, 0, 5, 9));
});

test('rejects unknown kinds, bad status and missing synthetic flag', () => {
  assert.throws(() => normalizeEvent({ ...base, kind: 'shell.exec' }), EventError);
  assert.throws(() => normalizeEvent({ ...base, kind: 'test.result', test: { name: 'x' }, status: 'meh' }), EventError);
  const { synthetic, ...noFlag } = base;
  assert.throws(() => normalizeEvent(noFlag), /synthetic/);
});

test('rejects oversized fields and data payloads', () => {
  assert.throws(() => normalizeEvent({ ...base, id: 'x'.repeat(LIMITS.idLength + 1) }), /id exceeds/);
  assert.throws(() => normalizeEvent({ ...base, data: { blob: 'x'.repeat(LIMITS.dataBytes) } }), /data exceeds/);
});

test('drops unknown top-level fields', () => {
  const ev = normalizeEvent({ ...base, transcript: 'secret prompt text', cwd: '/home/someone' });
  assert.equal(ev.transcript, undefined);
  assert.equal(ev.cwd, undefined);
});

test('test.result derives a stable test id when none is given', () => {
  const a = normalizeEvent({ ...base, kind: 'test.result', suite: 's', status: 'pass', test: { name: 'n', file: 'f.js' } });
  const b = normalizeEvent({ ...base, id: 'e2', kind: 'test.result', suite: 's', status: 'fail', test: { name: 'n', file: 'f.js' } });
  assert.equal(a.test.id, b.test.id);
});

test('diff.snapshot validates categories', () => {
  assert.throws(() => normalizeEvent({ ...base, kind: 'diff.snapshot', data: { categories: { vibes: { added: 1, deleted: 0, files: 1 } } } }), /unknown diff category/);
  assert.throws(() => normalizeEvent({ ...base, kind: 'diff.snapshot', data: { categories: { production: { added: -1, deleted: 0, files: 1 } } } }), /non-negative/);
  assert.throws(() => normalizeEvent({ ...base, kind: 'diff.snapshot', data: { categories: { production: null } } }), EventError);
  const ok = normalizeEvent({ ...base, kind: 'diff.snapshot', data: { categories: { production: { added: 1, deleted: 0, files: 1 } } } });
  assert.equal(ok.data.categories.production.added, 1);
});

test('batch keeps good events and reports bad ones by index', () => {
  const { events, errors } = normalizeBatch({ events: [base, { ...base, id: 'e2', kind: 'nope' }, { ...base, id: 'e3' }] });
  assert.equal(events.length, 2);
  assert.deepEqual(errors.map((e) => e.index), [1]);
  assert.throws(() => normalizeBatch(Array.from({ length: LIMITS.batch + 1 }, () => base)), /batch exceeds/);
});

test('compareEvents orders by ts, then seq, then id', () => {
  const evs = [
    { ts: 2, seq: 0, id: 'b' },
    { ts: 1, seq: 5, id: 'z' },
    { ts: 1, seq: 5, id: 'a' },
    { ts: 1, seq: 0, id: 'q' },
  ];
  assert.deepEqual(evs.sort(compareEvents).map((e) => e.id), ['q', 'a', 'z', 'b']);
});
