import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDemo } from '../src/core/demo.js';
import { reduce } from '../src/core/reducer.js';
import { exportReplay, importReplay, stateHash, computeRecap, renderRecapHtml, ReplayError } from '../src/core/replay-export.js';

const AT = '2026-01-01T00:00:00.000Z';
const demo = (seed = 7) => exportReplay(generateDemo(seed), { seed, source: 'synthetic', createdAt: AT });

test('export -> import round trip restores header and events', () => {
  const text = demo();
  const { header, events } = importReplay(text);
  assert.equal(header.kind, 'overfit-replay');
  assert.equal(header.version, 1);
  assert.equal(header.seed, 7);
  assert.equal(header.source, 'synthetic');
  assert.equal(header.eventCount, events.length);
  assert.equal(header.eventCount, generateDemo(7).length);
  assert.equal(text.split('\n')[0].includes('"kind":"overfit-replay"'), true);
});

test('re-reducing imported events reproduces the header state hash', () => {
  const { header, events } = importReplay(demo());
  assert.equal(stateHash(events), header.stateHash);
  assert.equal(reduce(events).count, events.length);
  // a different seed gives a different hash
  assert.notEqual(importReplay(demo(8)).header.stateHash, header.stateHash);
});

test('same seed exports byte-identical bundles when createdAt is fixed', () => {
  assert.equal(demo(), demo());
  const a = importReplay(exportReplay(generateDemo(7), { seed: 7, createdAt: 'a' })).header;
  const b = importReplay(exportReplay(generateDemo(7), { seed: 7, createdAt: 'b' })).header;
  assert.equal(a.stateHash, b.stateHash);
});

test('tampered event fails the hash check', () => {
  const lines = demo().split('\n');
  const i = lines.findIndex((l) => l.includes('"status":"pass"') && l.includes('test.result'));
  lines[i] = lines[i].replace('"status":"pass"', '"status":"fail"');
  assert.throws(() => importReplay(lines.join('\n')), /state hash mismatch/);
});

test('dropped event and bad header are rejected', () => {
  const lines = demo().split('\n');
  assert.throws(() => importReplay([lines[0], ...lines.slice(2)].join('\n')), /header says/);
  assert.throws(() => importReplay(lines.slice(1).join('\n')), ReplayError);
  assert.throws(() => importReplay(''), /empty/);
  assert.throws(() => importReplay(lines[0].replace('"synthetic"', '"live"') + '\n' + lines.slice(1).join('\n')), /live/);
});

test('absolute paths are rejected on export and import', () => {
  const bad = generateDemo(7).slice(0, 5);
  const withPath = (file) => bad.concat({ ...generateDemo(7).find((e) => e.kind === 'test.result'), id: 'x1', test: { name: 'n', file } });
  for (const file of ['/Users/someone/proj/a.test.js', 'C:\\proj\\a.test.js', '~/proj/a.js', 'file:///etc/passwd']) {
    assert.throws(() => exportReplay(withPath(file), { seed: 7, source: 'synthetic' }), /absolute path/, file);
  }
  assert.doesNotThrow(() => exportReplay(withPath('test/a.test.js'), { seed: 7, source: 'synthetic' }));
  // a hand-edited file carrying a path is rejected even before the hash check
  const lines = demo().split('\n');
  lines[3] = lines[3].replace(/"kind":"[^"]+"/, '"kind":"activity"').replace(/\}$/, ',"suite":"/home/x/y"}');
  assert.throws(() => importReplay(lines.join('\n')), ReplayError);
});

test('source label must match the events', () => {
  assert.throws(() => exportReplay(generateDemo(7), { seed: 7, source: 'live' }), /live/);
  const live = generateDemo(7).map((e) => ({ ...e, synthetic: false }));
  const { header } = importReplay(exportReplay(live, { source: 'live', createdAt: AT }));
  assert.equal(header.source, 'live');
  assert.equal(header.seed, null);
});

test('recap card is computed from the replay and labelled', () => {
  const bundle = importReplay(demo());
  const recap = computeRecap(bundle);
  assert.equal(recap.label, 'SYNTHETIC');
  assert.ok(recap.runs > 0 && recap.pass > 0 && recap.fail > 0 && recap.flaky > 0);
  assert.ok(recap.topAgent);
  assert.ok(recap.durationMs > 100_000);
  const html = renderRecapHtml(recap);
  assert.match(html, /SYNTHETIC/);
  assert.doesNotMatch(html, /<script|\/Users\//);
  const live = importReplay(exportReplay(generateDemo(7).map((e) => ({ ...e, synthetic: false })), { source: 'live', createdAt: AT }));
  assert.equal(computeRecap(live).label, 'LIVE');
});
