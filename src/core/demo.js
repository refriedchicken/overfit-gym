// Seeded synthetic demo. Every event is marked synthetic: true and source "demo".
// Same seed -> byte-identical event list (checked in tests).
//
// The scenarios are written to exercise each visual beat once, on a
// predictable schedule, so captured footage is reproducible.

import { mulberry32 } from './hash.js';

export const DEMO_BASE_TS = Date.UTC(2026, 0, 5, 9, 0, 0);
export const DEMO_DURATION_S = 150;

const AUTH_TESTS = [
  'issues token for valid credentials',
  'rejects expired token',
  'rejects token with wrong audience',
  'refreshes token before expiry',
  'hashes password with salt',
  'locks account after 5 attempts',
  'unlocks account after cooldown',
  'returns 401 without header',
  'normalizes email casing',
  'trims whitespace in username',
  'logs out all sessions',
  'rotates refresh token',
  'rejects reused refresh token',
  'accepts clock skew of 30s',
  'emits audit event on login',
  'redacts password in logs',
  'supports legacy md5 migration',
  'returns same error for unknown user',
];

const CHECKOUT_TESTS = [
  'creates order from cart',
  'applies discount code once',
  'retries payment webhook',
  'reserves inventory',
  'releases inventory on timeout',
  'sends receipt email',
  'handles currency rounding',
  'idempotent order submission',
];

const SIGNUP_TESTS = ['signup happy path', 'signup duplicate email', 'signup verification link', 'signup welcome tour', 'signup rate limit'];

const LEFTPAD_TESTS = Array.from({ length: 36 }, (_, i) => {
  const kinds = ['pads', 'does not pad', 'handles', 'preserves', 'rejects', 'accepts'];
  const what = ['empty string', 'unicode', 'negative width', 'width 0', 'width 1', 'null char', 'emoji', 'tab fill'];
  return `leftPad ${kinds[i % kinds.length]} ${what[i % what.length]} (case ${i + 1})`;
});

export const DEMO_AGENTS = Object.freeze([
  { id: 'demo-treadmill', label: 'Ballad 5.5', model: 'anthropic:5.5' },
  { id: 'demo-flaky', label: 'Neon 4', model: 'google:4' },
  { id: 'demo-stall', label: 'Nova 6', model: 'openai:6' },
  { id: 'demo-coach', label: 'Saga 5.2', model: 'anthropic:5.2' },
  { id: 'demo-machine', label: 'Comet 6.1', model: 'openai:6.1' },
]);

function diff(prod, test, docs = [0, 0, 0], extra = {}) {
  return {
    repo: 'demo-repo',
    categories: {
      production: { added: prod[0], deleted: prod[1], files: prod[2] },
      test: { added: test[0], deleted: test[1], files: test[2] },
      docs: { added: docs[0], deleted: docs[1], files: docs[2] },
      generated: { added: 0, deleted: 0, files: 0 },
      unknown: { added: 0, deleted: 0, files: 0 },
    },
    ...extra,
  };
}

/**
 * Generate the demo event list.
 * @param {number} seed
 */
export function generateDemo(seed = 1) {
  const rand = mulberry32(seed);
  const events = [];
  let seq = 0;
  let runN = 0;
  const id = () => `demo-${seed}-${String(seq).padStart(5, '0')}`;
  const push = (tSec, agent, kind, fields = {}) => {
    events.push({ v: 1, id: id(), ts: Math.round(DEMO_BASE_TS + tSec * 1000), seq: seq++, source: 'demo', synthetic: true, agent, kind, ...fields });
  };
  const jitter = (base, spread) => base + (rand() - 0.5) * spread;

  /** Emit one run of `tests`, returning the end time. */
  const run = (t, agent, target, tests, { file, failAt = new Set(), retry = new Set(), gap = 0.28, endStatus, end = true, maxTests } = {}) => {
    const r = `${agent}-run-${++runN}`;
    push(t, agent, 'run.start', { run: r, data: { target } });
    let ct = t + 0.6;
    let failed = false;
    const list = maxTests ? tests.slice(0, maxTests) : tests;
    list.forEach((name, i) => {
      const testFields = { run: r, suite: target, test: { name, file } };
      if (retry.has(i)) {
        push(ct, agent, 'test.result', { ...testFields, status: 'fail', attempt: 1, duration_ms: Math.round(jitter(220, 80)) });
        ct += gap * 2.2;
        push(ct, agent, 'test.result', { ...testFields, status: 'pass', attempt: 2, duration_ms: Math.round(jitter(240, 80)) });
      } else {
        const status = failAt.has(i) ? 'fail' : 'pass';
        if (status === 'fail') failed = true;
        push(ct, agent, 'test.result', { ...testFields, status, duration_ms: Math.round(jitter(40, 30)) });
      }
      ct += jitter(gap, gap * 0.4);
    });
    if (end) {
      push(ct, agent, 'suite.end', { run: r, suite: target, status: failed ? 'fail' : 'pass', duration_ms: Math.round((ct - t) * 1000) });
      push(ct + 0.1, agent, 'run.end', { run: r, status: endStatus ?? (failed ? 'fail' : 'pass') });
    }
    return ct + 0.1;
  };

  for (const a of DEMO_AGENTS) push(0.2, a.id, 'agent.hello', { data: { label: a.label, model: a.model } });
  const act = (tSec, agent, activity, extra = {}) => push(tSec, agent, 'activity', { status: extra.status ?? 'pass', data: { activity, basis: 'demo', ...(extra.force ? { force: true } : {}) } });

  // 1. The Treadmill: same target, same diff, over and over.
  const tq = 'demo-treadmill';
  push(1, tq, 'diff.snapshot', { data: diff([12, 3, 2], [40, 0, 1]) });
  let t = 2;
  for (let i = 0; i < 5; i++) t = run(t, tq, 'unit:auth', AUTH_TESTS, { file: 'test/auth.test.js', gap: 0.22 }) + jitter(6, 2);
  act(t - 4, tq, 'edit-test'); // scribbling tests on the whiteboard mid-treadmill
  act(t - 2, tq, 'edit-test');
  push(t, tq, 'diff.snapshot', { data: diff([13, 3, 2], [40, 0, 1]) }); // one line changed: next rerun is not a treadmill
  t = run(t + 2, tq, 'unit:auth', AUTH_TESTS, { file: 'test/auth.test.js', gap: 0.22 }) + 6;
  for (let i = 0; i < 3 && t < DEMO_DURATION_S - 10; i++) t = run(t, tq, 'unit:auth', AUTH_TESTS, { file: 'test/auth.test.js', gap: 0.22 }) + jitter(6, 2);

  act(t + 1, tq, 'commit');
  act(t + 4, tq, 'push', { force: true });

  // 2. The Flake: integration checkout suite with a wobbling webhook test.
  const fm = 'demo-flaky';
  push(3, fm, 'diff.snapshot', { data: diff([48, 10, 3], [22, 4, 1]) });
  t = 5;
  for (let i = 0; i < 7 && t < DEMO_DURATION_S - 10; i++) {
    const failAt = i === 2 ? new Set([4]) : new Set();
    t = run(t, fm, 'integration:checkout', CHECKOUT_TESTS, { file: 'test/integration/checkout.test.js', retry: new Set([2]), failAt, gap: 0.7 }) + jitter(8, 3);
  }

  act(t - 20, fm, 'edit-test');
  act(t - 12, fm, 'edit-test');
  act(t + 1, fm, 'pr');
  act(t + 6, fm, 'ci');
  act(t + 11, fm, 'merge');

  // 3. The Stall: a run goes quiet for a long time, then gets cancelled.
  const si = 'demo-stall';
  push(4, si, 'diff.snapshot', { data: diff([30, 6, 2], [18, 0, 1]) });
  t = run(10, si, 'unit:parser', AUTH_TESTS.slice(0, 6).map((n) => n.replace('token', 'tokenizer')), { file: 'test/parser.test.js', end: false, gap: 0.5 });
  const stalledRun = `demo-stall-run-${runN}`;
  t += 48; // silence: longer than the 30s stall threshold
  push(t, si, 'run.end', { run: stalledRun, status: 'cancelled' });
  t = run(t + 3, si, 'unit:parser', AUTH_TESTS.slice(0, 6).map((n) => n.replace('token', 'tokenizer')), { file: 'test/parser.test.js', gap: 0.4, failAt: new Set([5]) }) + 5;
  t = run(t, si, 'unit:parser', AUTH_TESTS.slice(0, 6).map((n) => n.replace('token', 'tokenizer')), { file: 'test/parser.test.js', gap: 0.4 });

  act(t + 2, si, 'install');
  act(t + 7, si, 'build');

  // 4. The Committee: one lift, three spotters, coordinated e2e runs.
  const cb = 'demo-coach';
  push(6, cb, 'diff.snapshot', { data: diff([20, 2, 1], [35, 0, 2]) });
  const helpers = ['demo-coach-h1', 'demo-coach-h2', 'demo-coach-h3'];
  helpers.forEach((h, i) => push(18 + i * 1.5, cb, 'agent.spawn', { data: { child: h, label: `Spotter ${i + 1}` } }));
  t = run(24, cb, 'e2e:signup', SIGNUP_TESTS, { file: 'test/e2e/signup.e2e.js', gap: 1.4 });
  helpers.forEach((h, i) => {
    let ht = 26 + i * 2;
    for (let k = 0; k < 3; k++) ht = run(ht, h, 'e2e:signup', SIGNUP_TESTS, { file: 'test/e2e/signup.e2e.js', gap: 1.2, failAt: k === 1 && i === 2 ? new Set([3]) : new Set() }) + jitter(7, 2);
  });
  const ce = run(t + 30, cb, 'e2e:signup', SIGNUP_TESTS, { file: 'test/e2e/signup.e2e.js', gap: 1.4 });
  act(t + 4, cb, 'diff');
  act(t + 10, cb, 'diff');
  act(t + 16, cb, 'diff');
  act(ce + 2, cb, 'commit');
  act(ce + 7, cb, 'push');
  act(ce + 12, cb, 'pull');

  // 5. The Machine: nine production lines across six files, a mountain of tests.
  const dg = 'demo-machine';
  push(8, dg, 'diff.snapshot', { data: diff([7, 2, 6], [180, 0, 4], [60, 0, 2]) });
  act(9, dg, 'grep');
  act(10.5, dg, 'read');
  t = 12;
  const dgExtras = ['lint', 'typecheck', 'format', 'lint', 'benchmark', 'coverage'];
  for (let i = 0; i < 6 && t < DEMO_DURATION_S - 12; i++) {
    if (i > 0) act(t - 4, dg, dgExtras[i]);
    if (i > 0) {
      // The Machine keeps writing tests for the same nine production lines.
      act(t - 7, dg, 'edit-test');
      push(t - 6.5, dg, 'diff.snapshot', { data: diff([7, 2, 6], [180 + i * 45, 0, 4 + i], [60, 0, 2]) });
    }
    t = run(t, dg, 'unit:leftpad', LEFTPAD_TESTS, { file: 'test/leftpad.test.js', gap: 0.12, failAt: i === 3 ? new Set([17]) : new Set() }) + jitter(9, 3);
  }

  return events;
}
