import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGymServer } from '../server/server.mjs';

let gym;
let base;
before(async () => {
  gym = createGymServer({ persist: false, allowedHosts: ['overfit.test', 'retro.test'], lookHosts: 'retro.test=film80,bad.test=<script>' });
  const addr = await gym.listen(0);
  base = `http://127.0.0.1:${addr.port}`;
});
after(() => gym.close());

const ev = (id, extra = {}) => ({ id, ts: 1_700_000_000_000, source: 'test', synthetic: false, agent: 'a', kind: 'run.start', ...extra });

function raw(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('accepts a batch, dedupes, and reports per-event errors', async () => {
  const r = await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [ev('s1'), ev('s1'), ev('bad', { kind: 'exec' })] }) });
  assert.equal(r.status, 202);
  const j = await r.json();
  assert.equal(j.accepted, 1);
  assert.equal(j.duplicates, 1);
  assert.equal(j.errors.length, 1);
  const log = await (await fetch(`${base}/api/events`)).json();
  assert.equal(log.events.length, 1);
});

test('streams new events over SSE', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([ev('s2')]) });
  while (!buf.includes('"s2"')) buf += dec.decode((await reader.read()).value);
  assert.match(buf, /event: events/);
  ctrl.abort();
});

test('rejects bad content-type, bad JSON, oversize bodies', async () => {
  assert.equal((await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })).status, 400);
  const big = JSON.stringify({ events: [ev('x', { data: { pad: 'y'.repeat(600 * 1024) } })] });
  const r = await raw('POST', '/api/events', { headers: { 'content-type': 'application/json' }, body: big });
  assert.equal(r.status, 413, 'client receives a 413, not a connection reset');
  const chunked = await raw('POST', '/api/events', { headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, body: big });
  assert.equal(chunked.status, 413);
});

test('rejects foreign Host and Origin headers (DNS rebinding / CSRF)', async () => {
  assert.equal((await raw('GET', '/api/health', { headers: { host: 'evil.example' } })).status, 421);
  assert.equal((await raw('POST', '/api/events', { headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '[]' })).status, 403);
  assert.equal((await raw('GET', '/api/health', { headers: { host: 'overfit.test' } })).status, 200);
});

test('serves web and core modules but not files outside them', async () => {
  assert.equal((await fetch(`${base}/core/events.js`)).status, 200);
  assert.notEqual((await raw('GET', '/core/../../package.json')).status, 200);
  assert.notEqual((await raw('GET', '/%2e%2e/package.json')).status, 200);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await raw('GET', '/%zz')).status, 400);
});

test('config reports a per-host look and ignores malformed entries', async () => {
  assert.deepEqual(JSON.parse((await raw('GET', '/api/config', { headers: { host: 'retro.test' } })).body), { look: 'film80' });
  assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { look: null });
});

test('static files support byte ranges for audio seeking', async () => {
  const full = await raw('GET', '/styles.css');
  const part = await raw('GET', '/styles.css', { headers: { range: 'bytes=0-9' } });
  assert.equal(part.status, 206);
  assert.equal(part.body.length, 10);
  assert.equal(part.body, full.body.slice(0, 10));
  assert.equal((await raw('GET', '/styles.css', { headers: { range: 'bytes=99999999-' } })).status, 416);
});
