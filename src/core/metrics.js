// Metrics with explicit definitions. See docs/METRICS.md for the prose version.
//
// Counting basis
//   executions      count of test.result events (every rep, including reruns/retries)
//   unique cases    distinct test ids among those results
//   repeat execs    executions - unique cases
//   runs            test-runner invocations (run.start, or run.end without a start)
//   reruns          runs whose target fingerprint equals the agent's previous run target
//   treadmill       reruns with an identical diff snapshot before and after: no code change
//                   observed between them. Unknown (not counted) when no diff snapshot exists.
//   retries         results with attempt > 1, or a second result for the same test in one run
//   flaky           retries that went fail -> pass inside one run
//
// Test lines per production line
//   testLines / production churn, from the same snapshot(s) and with the same
//   states. Only meaningful when diffs separate test files from production files.
//
// Tests per changed production line
//   numerator       executions (default) or unique cases, in the chosen scope
//   denominator     production churn = added + deleted lines in files classified
//                   "production", from the latest diff.snapshot (snapshots are cumulative,
//                   so they are never summed over time for one agent)
//   scope           one agent, or all agents (latest snapshot per repo key, summed)
//   excluded        test, docs, generated and unknown lines; reported, never in the denominator
//   states          ok              denominator > 0
//                   no-prod-change  snapshot exists, production churn is 0 -> value null
//                   unknown         no snapshot observed in scope -> value null
// Deletion-only production changes count: deleting 10 lines is 10 lines of churn.

import { DIFF_CATEGORIES } from './events.js';

const EMPTY_CAT = Object.freeze({ added: 0, deleted: 0, files: 0 });

function cat(diff, name) {
  return diff?.categories?.[name] ?? EMPTY_CAT;
}

export function churn(diff, name) {
  const c = cat(diff, name);
  return c.added + c.deleted;
}

/** Per-agent counts. */
export function agentMetrics(agent) {
  const t = agent.totals;
  const unique = agent.unique.size;
  return {
    executions: t.executions,
    unique,
    repeats: t.executions - unique,
    pass: t.pass,
    fail: t.fail,
    skip: t.skip + t.todo,
    runs: t.runs,
    reruns: t.reruns,
    treadmill: t.treadmill,
    retries: t.retries,
    flaky: t.flaky,
    integration: t.integration,
    suites: t.suites,
    runtimeMs: t.durationMs,
    summaryExecutions: t.summaryExecutions,
    activities: { ...agent.activityCounts },
    usage: usageMetrics([agent]),
    passRate: t.pass + t.fail > 0 ? t.pass / (t.pass + t.fail) : null,
    bestStreak: agent.bestStreak,
    ratio: testsPerProdLine({ executions: t.executions, unique, diffs: agent.diff ? [agent.diff] : [] }),
  };
}

/**
 * Core ratio computation.
 * @param {{executions:number, unique:number, diffs:object[]}} input
 * @param {{numerator?: 'executions'|'unique'}} [opt]
 */
export function testsPerProdLine({ executions, unique, diffs }, { numerator = 'executions' } = {}) {
  const num = numerator === 'unique' ? unique : executions;
  const breakdown = {};
  for (const name of DIFF_CATEGORIES) {
    breakdown[name] = diffs.reduce((s, d) => s + churn(d, name), 0);
  }
  const prodFiles = diffs.reduce((s, d) => s + cat(d, 'production').files, 0);
  const denominator = breakdown.production;
  let state = 'ok';
  let value = null;
  if (diffs.length === 0) state = 'unknown';
  else if (denominator === 0) state = 'no-prod-change';
  else value = num / denominator;
  // Test lines changed per production line changed: the "how much do agents write tests" ratio.
  // Same denominator and states as the execution ratio.
  const testLines = breakdown.test;
  const testLineRatio = state === 'ok' ? testLines / denominator : null;
  return { value, state, numerator: num, numeratorBasis: numerator, denominator, prodFiles, breakdown, testLines, testLineRatio };
}

/**
 * Usage overlay for one or more agents. Reported and estimated figures stay
 * separate. Returns null when no event carried a sourced cost: the UI shows
 * nothing in that case (never $0.00). Time is the real event-timestamp span.
 */
export function usageMetrics(agents) {
  const out = { reported: null, estimate: null, spanMs: 0 };
  let first = null;
  let last = null;
  let any = false;
  for (const agent of agents) {
    for (const src of ['reported', 'estimate']) {
      const b = agent.usage[src];
      if (b.costEvents === 0) continue;
      any = true;
      const acc = (out[src] ??= { costUsd: 0, durationMs: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, labels: [] });
      acc.costUsd += b.costUsd;
      acc.durationMs += b.durationMs;
      for (const k of Object.keys(acc.tokens)) acc.tokens[k] += b.tokens[k];
      for (const l of b.labels) if (!acc.labels.includes(l)) acc.labels.push(l);
    }
    first = first === null ? agent.firstTs : Math.min(first, agent.firstTs);
    last = last === null ? agent.lastTs : Math.max(last, agent.lastTs);
  }
  if (!any) return null;
  out.spanMs = Math.max(0, last - first);
  return out;
}

/** All-agent rollup. Diffs are deduplicated by repo key so co-located agents don't double count. */
export function globalMetrics(state) {
  const sum = {
    agents: state.agents.size,
    executions: 0,
    unique: 0,
    repeats: 0,
    pass: 0,
    fail: 0,
    skip: 0,
    runs: 0,
    reruns: 0,
    treadmill: 0,
    retries: 0,
    flaky: 0,
    runtimeMs: 0,
    summaryExecutions: 0,
    activities: {},
  };
  const latestByRepo = new Map();
  for (const agent of state.agents.values()) {
    const m = agentMetrics(agent);
    for (const k of Object.keys(sum)) if (k !== 'agents' && k !== 'activities' && k !== 'usage') sum[k] += m[k];
    for (const [id, c] of Object.entries(m.activities)) sum.activities[id] = (sum.activities[id] ?? 0) + c;
    if (agent.diff) {
      const key = agent.diff.repo ?? `agent:${agent.id}`;
      const prev = latestByRepo.get(key);
      if (!prev || prev.ts < agent.diffTs) latestByRepo.set(key, { ts: agent.diffTs, diff: agent.diff });
    }
  }
  const diffs = [...latestByRepo.values()].map((x) => x.diff);
  sum.ratio = testsPerProdLine({ executions: sum.executions, unique: sum.unique, diffs });
  sum.passRate = sum.pass + sum.fail > 0 ? sum.pass / (sum.pass + sum.fail) : null;
  sum.usage = usageMetrics(state.agents.values());
  sum.live = state.sources.live;
  sum.synthetic = state.sources.synthetic;
  return sum;
}

/** Human formatting of the ratio, never inventing a number. */
export function formatRatio(r) {
  if (r.state === 'unknown') return 'n/a (no diff observed)';
  if (r.state === 'no-prod-change') return 'n/a (0 production lines changed)';
  return r.value >= 10 ? r.value.toFixed(0) : r.value.toFixed(2);
}

/**
 * Heuristic "elaborate machine, tiny weight" detector. Only a heuristic: it
 * looks at shape of the diff, not at abstraction. Returned basis says so.
 */
export function ceremonyHeuristic(diff) {
  if (!diff) return null;
  const prod = cat(diff, 'production');
  const prodChurn = prod.added + prod.deleted;
  const testChurn = churn(diff, 'test');
  const spread = prod.files >= 4 && prodChurn > 0 && prodChurn / prod.files <= 6;
  const testHeavy = prodChurn > 0 && testChurn >= 8 * prodChurn;
  if (!spread && !testHeavy) return null;
  return {
    basis: spread ? 'heuristic:many-files-few-lines' : 'heuristic:test-churn-8x-production',
    prodChurn,
    prodFiles: prod.files,
    testChurn,
  };
}
