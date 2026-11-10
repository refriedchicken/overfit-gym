// Event store with deterministic, incremental replay.
//
// Keeps every accepted event sorted by compareEvents. `stateAt(t)` returns the
// reducer state containing exactly the events with ts <= t. Moving forward is
// incremental; moving backwards, or receiving an event earlier than the replay
// cursor, triggers a full recompute from the sorted log. Both paths produce
// identical state, which the tests check.

import { compareEvents } from './events.js';
import { applyEvent, createState, DEFAULTS } from './reducer.js';

export function createStore(opts = DEFAULTS) {
  const events = [];
  const ids = new Set();
  let state = createState();
  let cursor = 0; // number of events applied to `state`
  let cursorTs = -Infinity;
  let dirty = false;

  function insertSorted(ev) {
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareEvents(events[mid], ev) <= 0) lo = mid + 1;
      else hi = mid;
    }
    events.splice(lo, 0, ev);
    return lo;
  }

  return {
    /** Add normalized events. Returns how many were new. */
    add(list) {
      let added = 0;
      for (const ev of list) {
        if (ids.has(ev.id)) continue;
        ids.add(ev.id);
        const at = insertSorted(ev);
        if (at < cursor) dirty = true;
        added++;
      }
      return added;
    },
    clear() {
      events.length = 0;
      ids.clear();
      state = createState();
      cursor = 0;
      cursorTs = -Infinity;
      dirty = false;
    },
    get size() {
      return events.length;
    },
    get firstTs() {
      return events.length ? events[0].ts : null;
    },
    get lastTs() {
      return events.length ? events[events.length - 1].ts : null;
    },
    all() {
      return events;
    },
    stateAt(t) {
      if (dirty || t < cursorTs) {
        state = createState();
        cursor = 0;
        dirty = false;
      }
      while (cursor < events.length && events[cursor].ts <= t) {
        applyEvent(state, events[cursor], opts);
        cursor++;
      }
      state.opts = opts;
      cursorTs = t;
      return state;
    },
  };
}
