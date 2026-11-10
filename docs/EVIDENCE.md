# Verification evidence

First recorded 2026-11-08 and re-checked 2026-11-10 on macOS with Node 24 and Chrome. Everything here
is reproducible with the commands shown. Raw telemetry is not committed; only counts are recorded here.

## Automated tests

`npm test`: 104 tests, 0 failures (2026-11-10), across events, reducer/store, metrics, pacing,
evolution/demo/captions, identities, usage records, server, and adapters
(transcript watcher, node:test reporter, git diff, agent hook, JUnit, Jest/Vitest JSON). CI runs the same
suite on Node 22 and 24 on Linux.

The adapter tests run the bundled sample project through the real `node:test` reporter
(`OVERFIT_URL=off`, `OVERFIT_OUT=<tmp>`) and check:

- 13 `test.result` events (11 unit cases plus 2 integration cases, one of them a skip)
- the opt-in failing case (`SAMPLE_STRICT=1`) appears as one `fail` and a failed `run.end`
- two identical runs are one rerun of the same target
- no absolute paths appear in the emitted events

## Live end to end: reporter to server to scene

1. `npm start` (server on 127.0.0.1:4377)
2. `npm run fixture -- --runs 3 --gap 2`. Output:
   - run 1/3: tests 13, pass 12, fail 0, skipped 1, 18 events delivered
   - run 2/3: tests 13, pass 12, fail 0, skipped 1, 18 events delivered
   - run 3/3 (strict): tests 13, pass 11, fail 1, skipped 1, 18 events delivered
3. `GET /api/events` summary: `diff.snapshot` 3, `run.start` 3, `test.result` 39, `suite.end` 6,
   `run.end` 3. Synthetic: 0. Statuses: pass 35, skip 3, fail 1. No absolute paths in the log.
4. The diff snapshot at that moment had 0 production lines changed (only one untracked docs file, 151
   lines), so the per-line metric correctly read `n/a (0 production lines changed)`.
5. Headless Chrome (a throwaway profile) opened `/?mode=live` while further fixture runs streamed in. The
   page showed `LIVE · LOCAL TELEMETRY`, `connected · 504 events · paced +5.3s`, the reruns-without-change
   counter, and the metric `3.36` (316 executions / 94 production lines). By then the working tree held
   uncommitted source edits, and the agent was walking to the treadmill. The page also showed the
   treadmill caption, generated from real reruns with an unchanged diff: "Rerun #11 of the same target.
   No code changed since the last run. Cardio."

## Blind verification

An independent reviewer, given only the claims and the repo, re-ran the tests and probed the server
(traversal, foreign Host/Origin, oversize bodies) and the reporter with the server down. Every claim
passed. It also found real bugs, all fixed in separate commits: diff keys ignored content (a same-size
edit could be called "no code change"), synthetic events shown under a Live badge, no refetch after an
SSE reconnect, a connection reset instead of 413, a 500 on malformed path encoding, and a TypeError on
null diff categories.

## Real agent sessions (transcript watcher)

Run on 2026-11-08 against this machine's own Claude Code and Codex transcripts, read-only, with a
6-hour backfill. Only aggregate counts are recorded here, and no real-session screenshots are committed
(they show private project names).

- 74 to 75 agent sessions, including subagents linked to their parents.
- 138 test runs from transcripts, with 2,225 test executions counted from runner summary lines
  (node:test, vitest, XCTest), 6 of them failures.
- 31 reruns, 26 of them with no edit in between (treadmill).
- Hundreds of activity beats: reads, searches, edits, git commits, pushes and diffs, builds, PRs,
  merges.
- 0 events rejected by the server. A test checks that transcripts are never modified and that nothing
  private leaks. The page loaded the full log (4,000+ events) in a real browser with no console errors.
- Fixes found by looking at real data, each with a regression test:
  - command splitting ignored quotes, so `rg 'vitest|npm test'` looked like a test run
  - vitest's ANSI colors broke summary parsing
  - tail-trimmed node:test output was missed
  - background commands with no exit status were wrongly treated as passes
  - the initial log exceeded the client's batch limit

## Fresh clone (2026-11-10)

A clean `git clone` into an empty directory, with no `data/`, `.env` or local media:

- `npm test`: 104 pass.
- `OVERFIT_PORT=4411 npm start`, then `curl`: `/`, `/gallery.html`, the app modules, `/core/*.js`,
  the fonts and the vendored three.js files return 200 with the right types; `/fonts/OFL.txt` is refused
  (403, not an allowed type) and traversal attempts return 404.
- `OVERFIT_PORT=4411 npm run fixture -- --runs 2 --gap 0`: 36 events accepted by that server.
- Headless Chrome loaded `/?mode=demo&seed=7` and `/gallery.html?cast=1&clean=1&frames=3`
  and rendered each, with no exceptions.

## Demo determinism

- `generateDemo(seed)` is byte-identical for the same seed (tested), and different for a different seed.
- Stills via `?mode=demo&seed=7&t=<s>` reproduce the same frame state on reload. The images in
  `docs/media/` come from demo and pose-gallery URLs only, never from a live session.
- `npm run verify:capture` checks that capture mode draws byte-identical frames for repeated and
  out-of-order seeks (software GL).

## Boundaries: what is not verified

- Visual checks used headless Chrome on macOS, with SwiftShader (software WebGL) or the GPU. Frame rate
  on other GPUs, and other browsers and operating systems, were not measured.
- Mobile layout was written for narrow widths but only desktop sizes were captured.
- The transcript watcher's command classification is pattern based. Runs without a printed summary count
  once, with no reps. The transcript formats are undocumented and may change.
- The `hf-seek` capture contract for HyperFrames-style frame steppers is assumed, not checked against a
  real HyperFrames render.
- Chrome detection on Linux and Windows in `scripts/chrome-path.mjs` is untested; only macOS was run.
