import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJUnit, junitToEvents } from '../adapters/junit-import.mjs';
import { normalizeEvent } from '../src/core/events.js';
import { reduce } from '../src/core/reducer.js';
import { agentMetrics } from '../src/core/metrics.js';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="1" skipped="1" tests="4" time="0.5" timestamp="2026-01-05T09:00:00">
    <testcase classname="tests.test_api" name="test_ok" time="0.010"/>
    <testcase classname="tests.test_api" name="test_broken &amp; sad" time="0.020"><failure message="assert 1 == 2">trace</failure></testcase>
    <testcase classname="tests.test_api" name="test_later" time="0.001"><skipped type="pytest.skip" message="later"/></testcase>
    <testcase classname="tests.integration.test_db" name="test_roundtrip" time="0.300"/>
  </testsuite>
</testsuites>`;

test('JUnit XML parses statuses and entities', () => {
  const [s] = parseJUnit(XML);
  assert.equal(s.cases.length, 4);
  assert.deepEqual(s.cases.map((c) => c.status), ['pass', 'fail', 'skip', 'pass']);
  assert.equal(s.cases[1].name, 'test_broken & sad');
});

test('JUnit events validate and feed the reducer', () => {
  const events = junitToEvents(parseJUnit(XML), { agent: 'ci', runKey: 'k', startTs: 1e12 }).map(normalizeEvent);
  const m = agentMetrics(reduce(events).agents.get('ci'));
  assert.equal(m.executions, 4);
  assert.equal(m.fail, 1);
  assert.equal(m.skip, 1);
  assert.equal(m.integration, 1, 'heuristic tag from classname path');
  assert.ok(!JSON.stringify(events).includes('assert 1 == 2'), 'failure messages are not forwarded');
});
