// Presentation pacing for live telemetry.
//
// Real test runs are fast: 13 cases can finish in 50 ms, which is invisible as
// animation. Pacing spreads each agent's events out so every rep is seen,
// without reordering, dropping or inventing anything. It only ever delays an
// event, never by more than maxLagMs, and the original time is kept in
// `observedTs`. Metrics are counts, so pacing cannot change them; only the
// time-based beats (when a rep animates, when a run looks stalled) move.
//
// Pure and deterministic: the same sorted input yields the same output.

export const PACING_DEFAULTS = Object.freeze({
  maxLagMs: 15_000,
  gaps: { 'test.result': 240, 'suite.end': 300, 'run.start': 500, 'run.end': 600, activity: 500 },
});

/**
 * @param {object[]} sorted events sorted by compareEvents
 * @returns {object[]} new event objects with paced `ts` and `observedTs`
 */
export function paceEvents(sorted, opts = PACING_DEFAULTS) {
  const lastByAgent = new Map();
  return sorted.map((ev) => paceOne(ev, lastByAgent, opts));
}

/**
 * Pace one event given the per-agent state (agent -> last paced ts). Feeding
 * events in sorted order through paceOne equals paceEvents, so live clients
 * can pace incrementally and rebuild only when an event arrives out of order.
 */
export function paceOne(ev, lastByAgent, opts = PACING_DEFAULTS) {
  const gap = opts.gaps[ev.kind] ?? 0;
  const prev = lastByAgent.get(ev.agent) ?? -Infinity;
  let ts = Math.max(ev.ts, prev + gap);
  if (ts - ev.ts > opts.maxLagMs) ts = ev.ts + opts.maxLagMs;
  ts = Math.max(ts, prev); // never reorder within an agent
  lastByAgent.set(ev.agent, ts);
  return { ...ev, ts, observedTs: ev.ts };
}

/** Largest current delay among paced events not yet shown at `now`. */
export function pacingLag(paced, now) {
  let lag = 0;
  for (let i = paced.length - 1; i >= 0; i--) {
    const ev = paced[i];
    if (ev.observedTs > now) continue;
    if (ev.ts > now) lag = Math.max(lag, now - ev.observedTs);
    else if (ev.ts < now - PACING_DEFAULTS.maxLagMs) break;
  }
  return lag;
}
