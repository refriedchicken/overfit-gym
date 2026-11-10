# Reference

Everything the README leaves out: other telemetry sources, the HTTP API, video export, capture mode
and replay bundles.

## Telemetry sources

**Sample project.** With the server running, push real `node:test` results from the bundled sample:

```bash
npm run fixture                         # 3 real runs; the last one enables one real failing case
npm run fixture -- --runs 6 --gap 1     # more runs
```

**`node:test` reporter in your own project.**

```bash
node --test \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=/path/to/overfit-gym/adapters/node-test-reporter.mjs --test-reporter-destination=stderr
```

| Variable | Default | Meaning |
|---|---|---|
| `OVERFIT_URL` | `http://127.0.0.1:4377` | Where adapters send events. `off` disables sending. |
| `OVERFIT_OUT` | unset | Also append events to this JSONL file. |
| `OVERFIT_AGENT` | `node-<hash>` | Agent id. Set one per agent to tell agents apart. |
| `OVERFIT_DIFF` | on | `0` skips the git diff snapshot (and with it the treadmill and per-line metrics). |

The reporter never changes what runs and never fails your test run. If the gym isn't running it prints
one warning and carries on.

**Agent hook (opt-in).** `adapters/agent-hook.mjs` reads a Claude Code style hook payload on stdin.
Nothing installs it; add it yourself to a project's hook settings:

```json
{
  "hooks": {
    "PostToolUse": [{ "matcher": "Bash|Task", "hooks": [{ "type": "command", "command": "node /path/to/overfit-gym/adapters/agent-hook.mjs", "timeout": 5 }] }],
    "PostToolUseFailure": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node /path/to/overfit-gym/adapters/agent-hook.mjs", "timeout": 5 }] }]
  }
}
```

Shell commands that look like test runners become one run each, pass or fail (no per-test reps), and
subagent launches become spotters. Only hashes and a runner class are sent. The hook always exits 0.

**JUnit XML and Jest/Vitest JSON.**

```bash
node adapters/junit-import.mjs report.xml --post            # pytest, jest-junit, Surefire, ...
node adapters/jest-json-import.mjs results.json --post      # jest --json, vitest --reporter=json
```

One file is one run. Per-case timestamps are laid out from the reported durations, so they are
approximate.

**Anything else.** Anything that can POST JSON can feed the gym. Events follow schema v1
(`src/core/events.js`, [docs/PRIMITIVES.md](PRIMITIVES.md)):

```bash
curl -s http://127.0.0.1:4377/api/events -H 'content-type: application/json' -d '{"events":[
  {"id":"my-run-1:0","ts":"2026-01-05T09:00:00Z","source":"my-ci","synthetic":false,"agent":"agent-a",
   "kind":"test.result","run":"my-run-1","test":{"name":"adds numbers","file":"test/math.test.js"},"status":"pass"}
]}'
```

| Endpoint | Purpose |
|---|---|
| `POST /api/events` | Single event, array, or `{events: [...]}` (500 max, 512 KB). Returns accepted, duplicates and per-event errors. |
| `GET /api/events` | The accepted log, for replay. |
| `GET /api/stream` | Server-Sent Events for new events. |
| `GET /api/health` | Counters used by the connection indicator. |
| `GET /api/config` | The look configured for the requesting hostname, if any. |

`id` is the deduplication key. Events may arrive late or out of order; replay sorts them by `ts`, `seq`,
`id`.

## Export a video

```bash
npm run export:video -- --out captures/demo.mp4               # the seeded demo, 1080p, 24 fps
npm run export:video -- --seed 7 --from 30 --to 60 --crf 26
```

With the server running, this drives a headless Chrome-family browser frame by frame in capture mode
and pipes the frames to ffmpeg, so no frames are dropped however slow the machine is. It needs ffmpeg on
`PATH` and finds Chrome, Chromium or Edge in the usual places on macOS, Linux and Windows (or set
`CHROME_PATH`). Only the macOS path has been exercised. Film grain is costly to compress: `--crf 18`
(default) is a master, `--crf 26` is a size you can post. All flags are listed at the top of
`scripts/export-video.mjs`.

## Capture mode

`?capture=1&seed=7[&tms=MILLISECONDS][&content=1]` puts the page under one virtual clock.
Nothing animates on wall-clock time, there is no animation loop, and a frame is drawn only when you seek.
The same `(seed, t)` draws the same frame, whatever order you seek in.

- `window.__overfit.seek(timeMs)` resolves after the state is recomputed and one frame is drawn;
  `window.__overfit.duration()` is the timeline length in ms.
- `document.documentElement.dataset.captureReady === '1'` and `window.__overfit.ready` signal the first
  frame. The root `#app` carries `data-composition-id` and `data-duration` (seconds).
- An `hf-seek` event with `detail.time` in seconds is also accepted, for HyperFrames-style frame
  steppers. That contract is assumed and has not been checked against a real HyperFrames render.
- `npm run verify:capture` is the pixel proof: it drives headless Chrome with software GL and compares
  PNG hashes for repeated and out-of-order seeks. Identical pixels need software GL; GPU rendering
  varies by a few pixels.

## Replay bundles

Export a replay to a local JSONL file and open it again later, byte for byte the same run:

```bash
node scripts/export-replay.mjs --seed 7 --out replays/demo-7.jsonl --recap replays/demo-7.html
node scripts/export-replay.mjs --in data/events.jsonl --out replays/live.jsonl   # exported as a LIVE replay
node scripts/export-replay.mjs --verify replays/demo-7.jsonl
```

Line 1 is a header (`kind`, `version`, `seed`, `source` of `synthetic` or `live`, `createdAt`,
`eventCount`, `stateHash`); the rest are normalized events. Import re-validates every event, rejects
absolute paths, and re-reduces the events: if the result does not match `stateHash`, the file is refused.
Open one with the **Open replay** button or `/?replay=replays/demo-7.jsonl` (files in `./replays/`, which
is gitignored). `--recap` writes the summary line as a static HTML card. The hash detects accidental or
casual edits; it is not a signature.
