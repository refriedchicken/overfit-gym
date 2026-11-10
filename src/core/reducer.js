// Pure-ish reducer: folds normalized events into gym state.
//
// The state is a plain object with Maps/Sets. `applyEvent` mutates the state it
// is given (for speed during replay); `reduce` builds a fresh one. Given the
// same events the result is always the same, regardless of arrival order,
// because `reduce` sorts by compareEvents and drops duplicate ids.

import { compareEvents, looksIntegration } from './events.js';
import { pseudonym } from './hash.js';
import { identityFor } from './identity.js';

export const ACTIVITY_HOLD_MS = 20_000; // a robot stays at its last station this long unless something newer happens
export const BURST_REP_MS = 260; // one counted rep per this many ms in a summary burst
export const BURST_MAX_MS = 6000;

export const DEFAULTS = Object.freeze({
  stallMs: 30_000, // an open run with no events for this long is "stalled"
  fatigueTauMs: 90_000, // fatigue decays with this time constant
  feedSize: 60,
});

export function createState() {
  return {
    seen: new Set(),
    count: 0,
    firstTs: null,
    lastTs: null,
    agents: new Map(),
    feed: [],
    sources: { synthetic: 0, live: 0 },
  };
}

function newUsageBucket() {
  return { events: 0, costEvents: 0, costUsd: 0, durationMs: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, labels: new Set() };
}

function addUsage(agent, u) {
  const b = agent.usage[u.source];
  b.events++;
  b.labels.add(u.sourceLabel);
  if (u.costUsd !== undefined) {
    b.costEvents++;
    b.costUsd += u.costUsd;
  }
  if (u.durationMs !== undefined) b.durationMs += u.durationMs;
  for (const [k, n] of Object.entries(u.tokens ?? {})) b.tokens[k] += n;
}

function newAgent(id, ts) {
  return {
    id,
    label: pseudonym(id),
    model: null, // "vendor:version" spec when known
    modelName: null, // real model id, when an adapter reports it
    project: null, // project folder name, when an adapter reports it
    lastSay: null,
    idleBefore: 0,
    parent: null,
    children: [],
    firstTs: ts,
    lastTs: ts,
    totals: {
      executions: 0,
      pass: 0,
      fail: 0,
      skip: 0,
      todo: 0,
      cancelled: 0,
      retries: 0,
      flaky: 0,
      runs: 0,
      runsFinished: 0,
      runsFailed: 0,
      reruns: 0,
      treadmill: 0,
      suites: 0,
      integration: 0,
      durationMs: 0,
      spawns: 0,
      summaryExecutions: 0, // executions known only from a runner's printed summary
    },
    // Sourced usage, kept apart by provenance. Never summed across reported/estimate.
    usage: { reported: newUsageBucket(), estimate: newUsageBucket() },
    activityCounts: {},
    lastActivity: null, // { id, ts, status, force }
    lastBurst: null, // { ts, total, pass, fail, skip, parser } from a summary-count run
    unique: new Set(),
    testStats: new Map(),
    diff: null, // latest diff.snapshot data
    diffTs: null,
    diffKey: null,
    lastTarget: null, // { target, diffKey }
    openRuns: new Map(),
    lastRun: null, // { id, ts, status, treadmill, rerun, reps }
    lastRep: null,
    streak: 0,
    bestStreak: 0,
    fatigue: { value: 0, ts },
  };
}

/** Attach a model identity: a family-adjacent name plus the version number, unless a label was given. */
function setModel(agent, spec) {
  const idn = identityFor(spec, agent.id);
  if (!idn) return;
  agent.model = spec;
  if (agent.label === pseudonym(agent.id)) agent.label = idn.label;
}

function getAgent(state, id, ts) {
  let a = state.agents.get(id);
  if (!a) {
    a = newAgent(id, ts);
    state.agents.set(id, a);
  }
  return a;
}

function addFatigue(agent, ts, amount, tau) {
  const dt = Math.max(0, ts - agent.fatigue.ts);
  agent.fatigue = { value: agent.fatigue.value * Math.exp(-dt / tau) + amount, ts };
}

function diffKeyOf(data) {
  if (data.key) return String(data.key);
  const c = data.categories;
  return Object.keys(c)
    .sort()
    .map((k) => `${k}:${c[k].added}/${c[k].deleted}/${c[k].files}`)
    .join('|');
}

function openRun(state, agent, ev, implicit) {
  const target = ev.data?.target ?? ev.suite ?? 'unknown-target';
  const prev = agent.lastTarget;
  const rerun = !!prev && prev.target === target;
  // A treadmill loop is a rerun of the same target with no observed code change
  // between the two runs. Without diff snapshots we cannot know, so it is null.
  let treadmill = null;
  if (rerun && prev.diffKey !== null && agent.diffKey !== null) treadmill = prev.diffKey === agent.diffKey;
  const run = {
    id: ev.run ?? ev.id,
    startTs: ev.ts,
    lastTs: ev.ts,
    target,
    implicit,
    rerun,
    treadmill,
    reps: 0,
    fails: 0,
    seenTests: new Map(),
    command: ev.data?.command_class ?? null,
  };
  agent.openRuns.set(run.id, run);
  agent.lastTarget = { target, diffKey: agent.diffKey };
  agent.totals.runs++;
  if (rerun) agent.totals.reruns++;
  if (treadmill) agent.totals.treadmill++;
  addFatigue(agent, ev.ts, 0.02, state.opts.fatigueTauMs);
  return run;
}

function pushFeed(state, ev) {
  state.feed.push(ev);
  if (state.feed.length > state.opts.feedSize) state.feed.shift();
}

/** Apply one normalized event. Returns false if it was a duplicate. */
export function applyEvent(state, ev, opts = DEFAULTS) {
  state.opts = opts;
  if (state.seen.has(ev.id)) return false;
  state.seen.add(ev.id);
  state.count++;
  state.firstTs = state.firstTs === null ? ev.ts : Math.min(state.firstTs, ev.ts);
  state.lastTs = state.lastTs === null ? ev.ts : Math.max(state.lastTs, ev.ts);
  if (ev.synthetic) state.sources.synthetic++;
  else state.sources.live++;

  const agent = getAgent(state, ev.agent, ev.ts);
  agent.idleBefore = Math.max(0, ev.ts - agent.lastTs); // quiet time before this event, for banter
  agent.lastTs = Math.max(agent.lastTs, ev.ts);
  const t = agent.totals;
  if (ev.usage) addUsage(agent, ev.usage);

  switch (ev.kind) {
    case 'agent.hello':
      if (ev.data?.model) setModel(agent, ev.data.model);
      if (ev.data?.label) agent.label = String(ev.data.label).slice(0, 40);
      if (ev.data?.model_name) agent.modelName = ev.data.model_name;
      if (ev.data?.project) agent.project = ev.data.project;
      break;
    case 'agent.say':
      agent.lastSay = { ts: ev.ts, text: ev.data.text, to: ev.data.to ?? null };
      break;
    case 'agent.spawn': {
      const child = getAgent(state, ev.data.child, ev.ts);
      if (!child.parent) child.parent = agent.id;
      if (!agent.children.includes(child.id)) agent.children.push(child.id);
      if (ev.data.model) setModel(child, ev.data.model);
      if (ev.data.label) child.label = String(ev.data.label).slice(0, 40);
      t.spawns++;
      break;
    }
    case 'diff.snapshot':
      agent.diff = ev.data;
      agent.diffTs = ev.ts;
      agent.diffKey = diffKeyOf(ev.data);
      break;
    case 'run.start':
      openRun(state, agent, ev, false);
      break;
    case 'run.end': {
      const id = ev.run ?? ev.id;
      // Partial telemetry: an end without a start still counts as one run.
      const run = agent.openRuns.get(id) ?? openRun(state, agent, ev, true);
      agent.openRuns.delete(run.id);
      t.runsFinished++;
      if (ev.status === 'fail') t.runsFailed++;
      agent.lastRun = {
        id: run.id,
        ts: ev.ts,
        status: ev.status ?? 'unknown', // no exit status observed (e.g. still running in the background)
        rerun: run.rerun,
        treadmill: run.treadmill,
        reps: run.reps,
        target: run.target,
        implicit: run.implicit,
      };
      // Runs seen only as a command with a printed summary (agent transcripts):
      // count the runner's own totals as executions, unless per-test results
      // already arrived for this run (never double count).
      const c = ev.data?.counts;
      if (c && run.reps === 0 && Number.isInteger(c.total)) {
        const pass = c.pass ?? 0;
        const fail = c.fail ?? 0;
        const skip = c.skip ?? 0;
        t.executions += c.total;
        t.summaryExecutions += c.total;
        t.pass += pass;
        t.fail += fail;
        t.skip += skip;
        if (ev.duration_ms) t.durationMs += ev.duration_ms;
        agent.lastBurst = { ts: ev.ts, total: c.total, pass, fail, skip, parser: ev.data.counts_parser ?? null };
        agent.lastRun.reps = c.total;
        if (fail === 0 && pass > 0) {
          agent.streak += pass;
          agent.bestStreak = Math.max(agent.bestStreak, agent.streak);
        } else if (fail > 0) agent.streak = 0;
        addFatigue(agent, ev.ts, Math.min(0.4, 0.02 * pass + 0.06 * fail), state.opts.fatigueTauMs);
      }
      break;
    }
    case 'activity': {
      const id = ev.data.activity;
      agent.activityCounts[id] = (agent.activityCounts[id] ?? 0) + 1;
      agent.lastActivity = { id, ts: ev.ts, status: ev.status ?? null, force: !!ev.data.force, count: agent.activityCounts[id] };
      addFatigue(agent, ev.ts, 0.01, state.opts.fatigueTauMs);
      break;
    }
    case 'suite.end':
      t.suites++;
      if (ev.run && agent.openRuns.has(ev.run)) agent.openRuns.get(ev.run).lastTs = ev.ts;
      break;
    case 'test.result': {
      const test = ev.test;
      let run = ev.run ? agent.openRuns.get(ev.run) : null;
      if (ev.run && !run && agent.lastRun?.id !== ev.run) {
        // Results for a run we never saw start: open it implicitly.
        run = openRun(state, agent, { ...ev, data: { target: ev.suite ?? test.file ?? 'unknown-target' } }, true);
      }
      t.executions++;
      t[ev.status]++;
      if (ev.duration_ms) t.durationMs += ev.duration_ms;
      agent.unique.add(test.id);
      const integration = (ev.tags ?? []).includes('integration') || looksIntegration(test);
      if (integration) t.integration++;

      // Retry: the runner says attempt > 1, or the same test ran twice in one run.
      let retry = (ev.attempt ?? 1) > 1;
      let flaky = false;
      if (run) {
        const prior = run.seenTests.get(test.id);
        if (prior) retry = true;
        if (retry && prior === 'fail' && ev.status === 'pass') flaky = true;
        run.seenTests.set(test.id, ev.status);
        run.lastTs = ev.ts;
        run.reps++;
        if (ev.status === 'fail') run.fails++;
      }
      if (retry) t.retries++;
      if (flaky) t.flaky++;

      const stat = agent.testStats.get(test.id) ?? { name: test.name, count: 0, pass: 0, fail: 0 };
      stat.count++;
      if (ev.status === 'pass') stat.pass++;
      if (ev.status === 'fail') stat.fail++;
      agent.testStats.set(test.id, stat);

      if (ev.status === 'pass') {
        agent.streak++;
        agent.bestStreak = Math.max(agent.bestStreak, agent.streak);
      } else if (ev.status === 'fail') agent.streak = 0;

      agent.lastRep = {
        ts: ev.ts,
        status: ev.status,
        name: test.name,
        testId: test.id,
        retry,
        flaky,
        integration,
        priorCount: stat.count - 1,
        priorPass: stat.pass - (ev.status === 'pass' ? 1 : 0),
      };
      addFatigue(agent, ev.ts, ev.status === 'fail' ? 0.06 : 0.02, state.opts.fatigueTauMs);
      break;
    }
    default:
      break;
  }
  pushFeed(state, ev);
  return true;
}

/** Build a fresh state from events in any order. */
export function reduce(events, opts = DEFAULTS) {
  const state = createState();
  const sorted = [...events].sort(compareEvents);
  for (const ev of sorted) applyEvent(state, ev, opts);
  state.opts = opts;
  return state;
}

/** Fatigue at time `now`, in [0, 1], including stall strain. */
export function fatigueAt(agent, now, opts = DEFAULTS) {
  const dt = Math.max(0, now - agent.fatigue.ts);
  let v = agent.fatigue.value * Math.exp(-dt / opts.fatigueTauMs);
  const stall = stalledRun(agent, now, opts);
  if (stall) v += Math.min(0.4, (now - stall.lastTs - opts.stallMs) / 120_000 + 0.1);
  return Math.max(0, Math.min(1, v));
}

/** The open run that has gone quiet for longer than stallMs, if any. */
export function stalledRun(agent, now, opts = DEFAULTS) {
  for (const run of agent.openRuns.values()) {
    if (now - run.lastTs > opts.stallMs) return run;
  }
  return null;
}

/**
 * What the agent is visibly doing at `now`. This drives the scene. It is a
 * function of state + time only, so scrubbing and frame-stepped capture work.
 *
 * Returns { kind, detail } where kind is one of:
 * stalled, fail, wobble, treadmill, coordinated, bench, celebrate, slump, spotting, idle,
 * write-tests (editing test files), or a non-test activity id from docs/EXERCISES.md
 * (edit, lint, push, commit, build, ...)
 */
export function activityAt(state, agent, now, opts = DEFAULTS) {
  const stall = stalledRun(agent, now, opts);
  if (stall) return { kind: 'stalled', detail: { run: stall, quietMs: now - stall.lastTs } };
  const rep = agent.lastRep;
  const repAge = rep ? now - rep.ts : Infinity;
  const open = [...agent.openRuns.values()].pop();
  if (rep && repAge < 1400 && rep.status === 'fail') return { kind: 'fail', detail: { rep } };
  if (open) {
    if (rep && repAge < 4000 && rep.retry) return { kind: 'wobble', detail: { rep, run: open } };
    if (open.treadmill) return { kind: 'treadmill', detail: { run: open } };
    if (rep && repAge < 5000 && rep.integration) return { kind: 'coordinated', detail: { rep, run: open } };
    return { kind: 'bench', detail: { rep, run: open } };
  }
  const last = agent.lastRun;
  const act = agent.lastActivity;
  // A summary-count run replays its printed total as a burst of reps.
  const burst = agent.lastBurst && last && agent.lastBurst.ts === last.ts ? agent.lastBurst : null;
  const burstMs = burst ? Math.min(burst.total * BURST_REP_MS, BURST_MAX_MS) : 0;
  const runAge = last ? now - last.ts : Infinity;
  const actAge = act ? now - act.ts : Infinity;
  const runWindow = burstMs + 3500;
  if (runAge < runWindow && !(actAge < ACTIVITY_HOLD_MS && act.ts > last.ts)) {
    if (last.treadmill && last.status !== 'fail') {
      // A treadmill run does not end in a flex: the agent keeps jogging, and
      // scribbles tests on the whiteboard if it is editing test files meanwhile.
      return { kind: 'treadmill', detail: { run: last, burst, burstAge: runAge, writing: !!act && act.id === 'edit-test' && actAge < ACTIVITY_HOLD_MS } };
    }
    if (burst && runAge < burstMs) return { kind: 'bench', detail: { run: last, burst, burstAge: runAge } };
    if (last.status === 'pass' || last.status === 'fail') return { kind: last.status === 'fail' ? 'slump' : 'celebrate', detail: { run: last } };
  }
  if (act && actAge < ACTIVITY_HOLD_MS) {
    if (act.id === 'edit-test' && last?.rerun && last.treadmill !== false) {
      return { kind: 'treadmill', detail: { run: last, writing: true, activity: act } };
    }
    // Writing tests gets its own hero station; production edits go to the small corner.
    return { kind: act.id === 'edit-test' ? 'write-tests' : act.id, detail: { activity: act, ageMs: actAge } };
  }
  if (agent.parent) {
    const parent = state.agents.get(agent.parent);
    if (parent && parent.openRuns.size > 0) return { kind: 'spotting', detail: { parent: parent.id } };
  }
  return { kind: 'idle', detail: {} };
}
