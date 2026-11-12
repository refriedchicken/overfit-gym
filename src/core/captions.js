// Comedic captions, chosen deterministically and rate limited.
//
// Rules: a caption only states what the events show. Heuristic beats carry
// `heuristic: true` (styled differently, and explained in the inspector).
// Captions are derived from the event log, so replay produces the same ones.

import { fnv1a } from './hash.js';
import { vendorOf } from './identity.js';
import { ceremonyHeuristic } from './metrics.js';
import { applyEvent, createState, DEFAULTS } from './reducer.js';

export const CAPTION_DEFAULTS = Object.freeze({
  perAgentGapMs: 9000,
  globalGapMs: 3500,
  ttlMs: 4200,
});

// Lines are spoken by the robot they hang over: short, dry, never explaining the joke.
const T = {
  repeatPass: ['It passed {prior} times. One more.', 'Again. For safety.', 'Green. Run it back.'],
  fail: ['Dropped it.', 'That one was heavy.', 'Nobody saw that.'],
  flaky: ['Fail, then pass. Classic.', 'It passes if you believe.'],
  treadmill: ['Rerun {reruns}. Changed nothing.', 'Same suite. Same diff.', 'Distance: 0.0.'],
  stall: ['Still lifting. {secs}s.', "Don't touch it. It's thinking."],
  spawn: ['Spotters. I need {children}.', 'Bring in the spotters.'],
  streak: ['{streak} green in a row.', '{streak} straight. Not stopping.'],
  ceremony: ['{files} files. {lines} lines. Behold.', '{tests} test lines for {lines} lines of code.'],
  runFail: ['Re-racking.', 'Red. Again.'],
  summaryRerun: ['{total} passed. Like last time.', 'Rerun {reruns}. Still {total} green.'],
  force: ['One arm. --force.', 'Force push. Look away.'],
  push: ['Push-up {n}.'],
  commit: ['Crunch {n}. Atomic.'],
  merge: ['Ding.'],
  pr: ['Reviewers. Assemble.'],
  diff: ['Same diff. Looked anyway.'],
  lint: ['The linter remains unimpressed.'],
  typecheck: ['Breathe in. Narrow the type.'],
  think: ['Mental rep {n}.', 'Visualizing the lift. Again.', 'Thinking. {n} sets today.'],
  connector: ['Front desk, call {n}.', 'Hold on, taking this call.'],
  browse: ['Watching TV on the bike.', 'Cardio. Technically.'],
  coach: ['Yes, coach.', 'Coach is watching.', 'Whistle. Eyes up.'],
  wait: ['Sauna. Waiting on the coach.', 'Your move, coach.'],
  fumble: ['Dropped it. {n} today.', 'Clang.', "That's {n}. Re-rack it."],
  refuel: ['Protein shake. Where were we?', 'Context refuelled. Memory: hazy.'],
  writing: ['More tests. While running.'],
  writeTests: ['{tests} test lines. {prod} of code.', "Another test. It's a three-line function.", 'The code did not ask for this.', '{ratio} to one. Tests to code.'],
  writeTestsNoProd: ['Tests for code nobody changed.', '{tests} test lines. Zero code.'],
};

// Banter between model families. Nobody ribs their own family. Every line is
// triggered by something the target really did (see ribCandidate).
const RIBS = {
  offBench: ["Good to see you off the bench, {name}. Didn't think you'd get any reps in today.", 'Look who found the weights. Morning, {name}.'],
  failed: ['Need a spotter, {name}?', 'Happens to the best of us, {name}. So I hear.'],
  laps: ['Lap {reruns}, {name}. Scenic route?', 'Same suite again, {name}? Bold.'],
  force: ['One arm, {name}? In front of everyone?'],
};
const BENCH_MS = 10 * 60_000;

/** Display time for a spoken line: long enough to read, never shorter than 2.2 s. */
export function sayTtlMs(text) {
  return Math.min(7000, 2200 + String(text ?? '').length * 55);
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
}

function short(name) {
  return name.length > 42 ? `${name.slice(0, 40)}...` : name;
}

/**
 * Decide whether an event (just applied to `state`) deserves a caption.
 * Returns { kind, text, agent, ts, heuristic } or null. Pure: no rate limits here.
 */
/** The most recently active agent from a different model family than `target`, or null. */
function heckler(state, target) {
  const tv = vendorOf(target.model);
  if (!tv) return null;
  let best = null;
  for (const a of state.agents.values()) {
    const v = vendorOf(a.model);
    if (!v || v === tv || a.id === target.id || a.parent) continue;
    if (!best || a.lastTs > best.lastTs || (a.lastTs === best.lastTs && a.id < best.id)) best = a;
  }
  return best;
}

/** A rib aimed at the agent that just did something, spoken by another family's agent. */
function ribCandidate(state, ev, agent) {
  let key = null;
  const vars = { name: agent.label.split(' · ')[0], reruns: agent.totals.reruns };
  if (ev.kind === 'run.start' && agent.idleBefore >= BENCH_MS) key = 'offBench';
  else if (ev.kind === 'run.end' && ev.status === 'fail') key = 'failed';
  else if (ev.kind === 'run.start' && agent.openRuns.get(ev.run ?? ev.id)?.treadmill && agent.totals.treadmill >= 3) key = 'laps';
  else if (ev.kind === 'activity' && ev.data.activity === 'push' && ev.data.force) key = 'force';
  if (!key) return null;
  // the bench line always lands; the rest share the stage with the agent's own lines
  if (key !== 'offBench' && fnv1a(`rib:${ev.id}`) % 2) return null;
  const speaker = heckler(state, agent);
  if (!speaker) return null;
  const list = RIBS[key];
  return { kind: 'rib', speaker: speaker.id, to: agent.id, text: fill(list[fnv1a(ev.id) % list.length], vars) };
}

export function captionCandidate(state, ev, now = ev.ts) {
  const agent = state.agents.get(ev.agent);
  if (!agent) return null;
  const rib = ribCandidate(state, ev, agent);
  if (rib) return rib;
  const pick = (list) => list[fnv1a(ev.id) % list.length];
  const label = agent.label;
  if (ev.kind === 'test.result') {
    const rep = agent.lastRep;
    if (!rep || rep.testId !== ev.test.id) return null;
    if (rep.flaky) return { kind: 'flaky', text: fill(pick(T.flaky), { name: short(rep.name) }) };
    if (ev.status === 'fail') return { kind: 'fail', text: fill(pick(T.fail), { name: short(rep.name) }) };
    if (ev.status === 'pass' && rep.priorPass >= 3) {
      return { kind: 'repeatPass', text: fill(pick(T.repeatPass), { name: short(rep.name), n: rep.priorCount + 1, prior: rep.priorPass }) };
    }
    if (ev.status === 'pass' && agent.streak > 0 && agent.streak % 25 === 0) {
      return { kind: 'streak', text: fill(pick(T.streak), { streak: agent.streak }) };
    }
    return null;
  }
  if (ev.kind === 'run.start') {
    const run = agent.openRuns.get(ev.run ?? ev.id);
    if (run?.treadmill) return { kind: 'treadmill', text: fill(pick(T.treadmill), { reruns: agent.totals.reruns }) };
    return null;
  }
  if (ev.kind === 'run.end' && ev.status === 'fail') return { kind: 'runFail', text: pick(T.runFail) };
  if (ev.kind === 'run.end' && ev.data?.counts && agent.lastRun?.rerun && ev.status === 'pass') {
    return { kind: 'summaryRerun', text: fill(pick(T.summaryRerun), { total: ev.data.counts.total, reruns: agent.totals.reruns }) };
  }
  if (ev.kind === 'activity') {
    const id = ev.data.activity;
    const n = agent.activityCounts[id] ?? 1;
    if (id === 'push' && ev.data.force) return { kind: 'force', text: pick(T.force) };
    if (id === 'merge') return { kind: 'merge', text: pick(T.merge) };
    if (id === 'pr') return { kind: 'pr', text: pick(T.pr) };
    if (id === 'edit-test' && agent.lastRun?.rerun) return { kind: 'writing', text: pick(T.writing) };
    if (id === 'edit-test' && n % 3 === 1) {
      const c = agent.diff?.categories ?? {};
      const tests = (c.test?.added ?? 0) + (c.test?.deleted ?? 0);
      const prod = (c.production?.added ?? 0) + (c.production?.deleted ?? 0);
      if (prod === 0 && tests > 0) return { kind: 'writeTests', text: fill(pick(T.writeTestsNoProd), { tests }) };
      const ratio = prod > 0 ? (tests / prod).toFixed(1) : '--';
      return { kind: 'writeTests', text: fill(pick(T.writeTests), { tests, prod, n, ratio }) };
    }
    if ((id === 'push' || id === 'commit') && n % 5 === 0) return { kind: id, text: fill(pick(T[id]), { n }) };
    if ((id === 'diff' || id === 'lint') && n >= 3) return { kind: id, text: fill(pick(T[id]), { n }) };
    if (id === 'typecheck' && n === 1) return { kind: id, text: pick(T.typecheck) };
    // The rest of the day. Frequent beats only speak on round numbers.
    if (id === 'think' && n % 40 === 0) return { kind: id, text: fill(pick(T.think), { n }) };
    if (id === 'connector' && n % 10 === 0) return { kind: id, text: fill(pick(T.connector), { n }) };
    if (id === 'browse' && n % 15 === 1) return { kind: id, text: pick(T.browse) };
    if (id === 'coach' && n % 5 === 1) return { kind: id, text: pick(T.coach) };
    if (id === 'wait') return { kind: id, text: pick(T.wait) };
    if (id === 'fumble' && n >= 3 && n % 3 === 0) return { kind: id, text: fill(pick(T.fumble), { n }) };
    if (id === 'refuel') return { kind: id, text: pick(T.refuel) };
  }
  if (ev.kind === 'agent.spawn') return { kind: 'spawn', text: fill(pick(T.spawn), { label, children: agent.children.length }) };
  if (ev.kind === 'diff.snapshot') {
    const c = ceremonyHeuristic(ev.data);
    if (c) return { kind: 'ceremony', heuristic: true, text: fill(pick(T.ceremony), { files: c.prodFiles, lines: c.prodChurn, tests: c.testChurn }) };
  }
  return null;
}

/** Stall captions come from time passing, not from an event. */
export function stallCaption(agent, run, now, stallMs) {
  const secs = Math.round((now - run.lastTs) / 1000);
  const tpl = T.stall[fnv1a(run.id) % T.stall.length];
  return { kind: 'stall', text: fill(tpl, { secs }), at: run.lastTs + stallMs };
}

/**
 * Rate limiter. Feed it candidates in event order; it keeps or drops them.
 * Deterministic because it only uses event timestamps.
 */
export function createCaptionGate(opts = CAPTION_DEFAULTS) {
  const lastByAgent = new Map();
  let lastGlobal = -Infinity;
  return {
    offer(agentId, ts, candidate) {
      if (!candidate) return null;
      if (ts - lastGlobal < opts.globalGapMs) return null;
      if (ts - (lastByAgent.get(agentId) ?? -Infinity) < opts.perAgentGapMs) return null;
      lastGlobal = ts;
      lastByAgent.set(agentId, ts);
      return { ...candidate, agent: agentId, ts, until: ts + opts.ttlMs };
    },
    reset() {
      lastByAgent.clear();
      lastGlobal = -Infinity;
    },
  };
}

/**
 * Precompute every caption for a whole sorted event log, including stall
 * captions that fire from time passing. Used by replay so captions are
 * identical no matter how playback is scrubbed.
 * @param {object[]} events sorted by compareEvents
 * @param {number} endTs time up to which stalls are checked
 */
export function captionTimeline(events, endTs, reducerOpts = DEFAULTS, opts = CAPTION_DEFAULTS) {
  const gate = createCaptionGate(opts);
  const state = createState();
  const stallCaptioned = new Set();
  const out = [];
  const checkStalls = (now) => {
    if (opts.only === 'say') return;
    for (const agent of state.agents.values()) {
      for (const run of agent.openRuns.values()) {
        const at = run.lastTs + reducerOpts.stallMs;
        const key = `${run.id}@${run.lastTs}`;
        if (at <= now && !stallCaptioned.has(key)) {
          // Offer at the stall moment; if the gate is busy, retry at later checks
          // while the run is still quiet.
          const when = Math.max(at, lastOffered);
          const c = gate.offer(agent.id, when, stallCaption(agent, run, when + 1000, reducerOpts.stallMs));
          if (c) {
            stallCaptioned.add(key);
            out.push(c);
          }
        }
      }
    }
  };
  let lastOffered = -Infinity;
  for (const ev of events) {
    checkStalls(ev.ts);
    if (!applyEvent(state, ev, reducerOpts)) continue;
    lastOffered = ev.ts;
    if (ev.kind === 'agent.say') {
      // scripted dialogue is never rate limited
      out.push({ kind: 'say', text: ev.data.text, to: ev.data.to ?? null, agent: ev.agent, ts: ev.ts, until: ev.ts + sayTtlMs(ev.data.text) });
      continue;
    }
    if (opts.only === 'say') continue;
    const cand = captionCandidate(state, ev);
    const c = gate.offer(cand?.speaker ?? ev.agent, ev.ts, cand);
    if (c) out.push(c);
  }
  checkStalls(endTs);
  return out;
}
