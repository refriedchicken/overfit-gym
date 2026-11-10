# Overfit Gym: Prior Art and Event Primitives

Research notes, gathered 2026-11-08 from primary sources (repo files, official docs, upstream source).
Bracketed numbers point to the Citations list at the end. Anything not checked against a source is
marked **unverified**. These are point-in-time notes written before Overfit Gym was built: the projects
described here may have changed since, and their own repositories are the authority on them.

## 1. khanh020905/my-office ("My Office")

| Item | Finding |
| --- | --- |
| Exists | Yes. Created 2026-10-28, last push 2026-11-07. Description: "A 3D office for your Claude Code sessions" [1] |
| Demo | The repo homepage field and README list https://khanh020905.github.io/my-office/ as a static build of the `?demo` mode, published by `.github/workflows/pages.yml` [2]. The page was not loaded for this research (**unverified** that it is live) |
| License | MIT. `LICENSE`: "MIT License, Copyright (c) 2026 khanh020905". The GitHub API license field is `MIT` [1][3] |
| Renderer | three.js (MIT). Server is plain Node ESM, and the UI is Next.js (`docs/ARCHITECTURE.md`) [4] |
| npm package | `claude-my-office` (from the README badge and install steps) [2] |

**Ingestion: hooks first, with transcripts and OTel alongside** [4][5]
- `hooks/hooks.json` registers command hooks that `curl` the hook's stdin JSON to `POST http://127.0.0.1:4310/event`,
  with `async: true` and a 5 s timeout. The events are `SessionStart`, `SessionEnd`, `UserPromptSubmit`,
  `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `SubagentStart`,
  `SubagentStop`, `Stop`, `StopFailure` and `PreCompact` [5].
- Three hooks are synchronous. `PreToolUse` with matcher `AskUserQuestion|ExitPlanMode` goes to `/hook/question`
  (55 s). `PermissionRequest` goes to `/hook/permission` (55 s), so you can approve from the office. A second
  `PreToolUse` goes to `/hook/loop` (0.3 s) to detect stuck loops and edits that overlap another session's [4][5].
- `hooks/send.mjs` does the same job on Windows, where curl may be missing [6].
- Transcripts are read for token usage (`server/usage.mjs`), a history vault and per-project tenure. Claude Code
  OpenTelemetry (OTLP/HTTP JSON at `/v1/metrics` and `/v1/logs`) feeds the cost view [4].
- The server streams to the page over Server-Sent Events (`/stream`) [4].

**Event to scene mapping** (`src/office/ui/event-text.js`) [7]:
- `read`, `grep`, `glob` and `skill` go to the library, with a "read" animation.
- `edit` and `write` go to the desk, with a "type" animation.
- `bash` goes to the server room, with a "console" animation.
- `deploy` goes to the server room, with a "celebrate" animation and a rocket. The README says "it launches a
  rocket when you deploy".
- Approvals become cards in the UI [2].
- The page says how deploys are detected. The detection logic itself was not read (**unverified**).

**Directly relevant prior art for tests:** `server/testrun.mjs` sorts a Bash `command` string into a test runner.
It uses regexes over each part of a chained command (`npm test`, `vitest`, `jest`, `node --test`, `pytest`,
`go test`, `cargo test`, and others), and it skips env prefixes, `timeout` and `npx`. This drives an in-office
"test board" (`life/tests.js`) with an amber lamp while tests run, then green or red [4][7]. It works at command
level only, not per test case.

**Assets and licensing** (README "Credits" table) [2]:
- three.js and qrcode.js are MIT.
- The fonts are Be Vietnam Pro and JetBrains Mono (SIL OFL). Simple Icons are CC0.
- The car models are the Kenney Car Kit (CC0), documented in `public/assets/vehicles/README.md`.
- The shop signs come from Wikimedia Commons, and the brand names are trademarks of their owners.
- Many shops and props are "drawn and modelled in code".
- Credited ideas come from "agents-at-work", "cubicle-crew" (MIT) and "cc-reaper" (Apache-2.0).
- The licensing of the character models is not stated separately (**unverified**). They seem to be procedural or
  in-code, given the "A · Toy, B · Pixar" looks.

## 2. Other verified projects

| Project | License | What it ingests (primary source) | Asset notes |
| --- | --- | --- | --- |
| pixel-agents-hq/pixel-agents [8] (the old `pablodelucca/pixel-agents` URL redirects here) | MIT (README and API) | **Hooks mode** (default): a hook script receives `SessionStart`, `PreToolUse`, `PermissionRequest`, `Stop` and others, then POSTs authenticated events to local servers. **Heuristic mode** scans the JSONL transcripts under `~/.claude/projects/` instead. Both are normalised into a typed `AgentEvent` behind a `HookProvider` interface. Canvas 2D with pathfinding | Bundled sprites live in `webview-ui/public/assets/`, with external packs loaded through manifests (`docs/external-assets.md`). Separate licensing for the bundled art is **unverified** |
| rezored/cubicle-crew [9] | MIT | **Transcript tailing**, no hooks needed: `~/.claude/projects/**/*.jsonl`, plus Codex, Gemini and OpenCode logs. Each line becomes `tool_start`, `tool_end`, `say` or `user_prompt`. Tools map to states: Edit and Write are typing; Read, Grep and WebFetch are reading; Bash is running; Task is delegating; AskUserQuestion is waiting. 8 s of silence means idle. There is also a generic `POST /api/event` endpoint and an optional permission hook | "Everything is drawn in code". The PNG character sheet and tileset can be swapped for your own |
| a16z-infra/ai-town [10] | MIT | Not coding-agent telemetry: LLM-driven characters in a simulated town (Convex backend, PixiJS). Its primitives are the agents' own conversations and movement, not external tool events | Tilesheets come from OpenGameArt (George Bailey's "16x16 game assets", hilau's "16x16 RPG tileset", ansimuz). The UI is based on Mounir Tohami's assets. Each third-party pack keeps its own license (**unverified** per pack) |

The "agents-at-work" project credited by my-office was not found by name (**unverified**).

## 3. Event primitives for test telemetry

### 3a. Node.js `node:test` reporter events (v24.x docs) [11]
A custom reporter receives `{ type, data }` objects. The documented events are `test:coverage`,
`test:complete`, `test:dequeue`, `test:diagnostic`, `test:enqueue`, `test:fail`, `test:interrupted`,
`test:log`, `test:pass`, `test:plan`, `test:start`, `test:stderr`, `test:stdout`, `test:summary`,
`test:watch:drained` and `test:watch:restarted`.

There are two orderings:
- **Declaration order** (buffered, in source order): `test:start`, `test:pass`, `test:fail`, `test:plan`.
- **Execution order** (emitted as it happens): `test:enqueue`, `test:dequeue`, `test:complete`. `test:start`
  marks when a test begins *reporting*. The body actually starts at `test:dequeue`.

Fields:
- **Common** (`start`, `pass`, `fail`, `enqueue`, `complete`): `name`, `nesting`, `file`, `line`, `column`,
  `entryFile` (with process isolation), `testId`, `parentId`, `tags`.
- **`test:enqueue`**: `type` is `'suite' | 'test'`.
- **`test:pass` and `test:fail`**: add `testNumber`, `todo`, `skip`, and `details`. `details` holds
  `duration_ms`, `type` (marks suites), `error` (fail only, with `.cause`), and `attempt`. `attempt` is present
  only with `--test-rerun-failures`, which is a natural "treadmill rerun" signal.
- **`test:complete`**: `details.passed`, `duration_ms`, `error`, `type`.
- **`test:plan`**: `nesting`, `count` (the number of subtests run), file and location.
- **`test:summary`**: `counts.{tests, suites, passed, failed, skipped, todo, cancelled, topLevel}`,
  `duration_ms`, `success`, and `file` (undefined when the summary covers several files).
- **`test:diagnostic`**: a `message` plus location (the section was not reviewed in detail).

Caveat: these were read from the `v24.x` branch head. Newer fields (`testId`, `parentId`, `tags`, `attempt`,
`entryFile`) may be missing on older 24.x minors (**unverified** per minor), so treat them as optional.

### 3b. Claude Code hooks: `PostToolUse` input [12]
- **Common fields:** `session_id`, `transcript_path` (the JSONL file, written asynchronously so it may lag),
  `cwd`, `permission_mode` (not on every event), `hook_event_name`. Some fields appear only when relevant:
  `prompt_id`, `effort.level`, and `agent_id`/`agent_type` inside subagents.
- **`PostToolUse` adds:** `tool_name`, `tool_input` and `tool_response` (both schemas depend on the tool),
  `tool_use_id`, and an optional `duration_ms` (execution time, excluding permission prompts).
- It fires only on success. Failures go to **`PostToolUseFailure`**, which has `error`, `is_interrupt` and
  `duration_ms`. The docs' own example is `tool_name: "Bash"` with `tool_input.command: "npm test"`, which is
  exactly a failed set.
- For a gym: a `Bash` `tool_input.command` that matches a test runner starts a "set". Success or failure
  (`PostToolUse` vs `PostToolUseFailure`) ends it. The same command repeated in one session looks like a rerun.

### 3c. JUnit XML as written by `pytest --junitxml` [13]
- **Root:** `<testsuites name="pytest tests">` wraps one `<testsuite>`. The suite's attributes are `name`,
  `errors`, `failures`, `skipped`, `tests`, `time` (seconds, 3 decimals), `timestamp` and `hostname`. It has an
  optional `<properties><property name value/>`.
- **`<testcase>`:** `classname`, `name`, `time`. The `xunit1`/legacy family adds `file` and `line`. The default
  family is `xunit2`, which leaves them out.
- **Children:**
  - `<failure message>` holds a failed assertion or test.
  - `<error message>` holds a setup/teardown or collection error.
  - `<skipped type message>` uses type `pytest.skip`, or `pytest.xfail` for xfail.
  - `<system-out>` and `<system-err>` appear depending on `junit_logging`.
- Reps map to `testcase`. A set maps to `testsuite`. A failed rep maps to `failure`, a dropped weight to `error`,
  and a skipped machine to `skipped`.

## 4. What we take / what we don't

**We take (ideas only):**
- The general pattern "local hook or reporter, then POST to a localhost server, then stream to the browser".
- The *event primitives* defined by the public specs above: Node `node:test` events, Claude Code hook payloads
  and JUnit XML elements.
- The observation that tool categories (read, edit, run, wait) can be mapped to locations and animations. That
  is a common idea across several MIT projects; the mapping Overfit Gym uses is its own gym metaphor.
- The idea of spotting test-runner commands in a Bash `command` string. Overfit Gym's matcher
  (`src/core/activities.js`) was written from the runners' public CLI names.

**We don't take:**
- Any code, regexes, file layouts, scene designs, sprites, 3D models, textures, fonts, sounds, names or copy from
  my-office, pixel-agents, cubicle-crew, ai-town or their credited asset packs.
- Any assets at all from these projects, even the CC0 ones. Overfit Gym's art is original, and any third-party
  asset we ever add gets its own entry in `THIRD_PARTY.md`.
- Any branding or trademark imagery.

## Citations
1. https://api.github.com/repos/khanh020905/my-office (metadata and license field)
2. https://github.com/khanh020905/my-office/blob/HEAD/README.md
3. https://github.com/khanh020905/my-office/blob/HEAD/LICENSE
4. https://github.com/khanh020905/my-office/blob/HEAD/docs/ARCHITECTURE.md
5. https://github.com/khanh020905/my-office/blob/HEAD/hooks/hooks.json
6. https://github.com/khanh020905/my-office/blob/HEAD/hooks/send.mjs
7. https://github.com/khanh020905/my-office/blob/HEAD/server/testrun.mjs and https://github.com/khanh020905/my-office/blob/HEAD/src/office/ui/event-text.js
8. https://github.com/pixel-agents-hq/pixel-agents (README, "How It Works", "Office assets", "License")
9. https://github.com/rezored/cubicle-crew (README, architecture section)
10. https://github.com/a16z-infra/ai-town (README, "Credits")
11. https://nodejs.org/docs/latest-v24.x/api/test.html#reporters (read from https://github.com/nodejs/node/blob/v24.x/doc/api/test.md)
12. https://code.claude.com/docs/en/hooks (sections "Common input fields", "PostToolUse input", "PostToolUseFailure")
13. https://github.com/pytest-dev/pytest/blob/main/src/_pytest/junitxml.py and https://docs.pytest.org/en/stable/how-to/output.html#creating-junitxml-format-files
