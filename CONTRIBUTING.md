# Contributing to Overfit Gym

Thanks for wanting to make the gym funnier, or more honest. Ideally both.

## Ground rules

1. **Every joke has to be earned by a real signal.** A new station, caption or metric must map to
   something an adapter actually observes. Add a row to [docs/PRIMITIVES.md](docs/PRIMITIVES.md) or
   [docs/EXERCISES.md](docs/EXERCISES.md) with the signal, how it is detected, and its certainty
   (observed, derived, heuristic, inferred). Ideas that need signals we don't have go in the "parked"
   table instead.
2. **Never fake live data.** Synthetic events must carry `synthetic: true` and stay labelled in the UI
   and in captures.
3. **Privacy first.** Adapters send hashes, counts and activity ids, never prompts, command text, file
   paths or tool output. A change that sends more needs a test showing what leaves the machine, and an
   update to [docs/PRIVACY_SECURITY.md](docs/PRIVACY_SECURITY.md).
4. **Observe, don't drive.** Overfit Gym never runs, retries or schedules tests.
5. **No new dependencies without discussion.** The project runs on Node built-ins and vendored three.js
   (plus add-ons) on purpose. Anything vendored must be MIT/OFL-compatible and listed in
   [THIRD_PARTY.md](THIRD_PARTY.md).
6. **Determinism.** Scene code is a pure function of (event log, time, seed). No `Math.random`, `Date`
   or `performance.now` in code that affects pixels. `npm run verify:capture` checks this.

## Getting started

```bash
nvm use            # Node 22+
npm test           # all tests; no install step
npm start          # http://127.0.0.1:4377
```

Open `/gallery.html?kind=bench` to see a single station's pose (`kind`, `t`, `clean=1` and camera
parameters are supported; see `web/gallery.js`), or `/gallery.html?cast=1` for the model-identity lineup.

`npm run verify:capture` and `npm run export:video` need a Chrome-family browser (found automatically, or
set `CHROME_PATH`); the export also needs ffmpeg. `npm test` needs neither.

`package.json` has `"private": true` on purpose: Overfit Gym is an app you clone and run, not a library,
and the flag stops it from being published to npm by accident. Please leave it in place.

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | Pure, shared logic: event schema, reducer, replay store, metrics, evolution, captions, pacing, demo, activity classifier, capture clock. Runs in Node and the browser. |
| `server/` | Local-only ingest server (validation, SSE, JSONL log). |
| `adapters/` | Telemetry sources: transcript watcher, `node:test` reporter, git diff, agent hook, JUnit, Jest/Vitest JSON. |
| `scripts/` | Sample-project fixture runs, replay export, video export, and the capture determinism check. |
| `web/` | The app: HUD, director camera, pose gallery, and `web/scene/` for the three.js gym. |
| `test/` | `node:test` suites and synthetic fixtures. |
| `docs/` | Primitives, metrics, exercises, privacy, evidence, research. |

## Pull requests

- Keep commits small and focused: one logical change per commit, with a clear message (conventional
  commit prefixes like `feat(core):` and `fix(web):` are used throughout).
- Add or update tests for behavior changes. `npm test` must pass on Node 22 and 24 (CI checks both).
- For visual changes, attach a before/after screenshot. Demo mode with a seed (`?mode=demo&seed=7&t=62`)
  and the pose gallery make stills reproducible.
- Don't commit screenshots of real sessions (Live mode shows model ids and project folder names), raw
  telemetry (`data/`), audio, or anything with local paths.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
