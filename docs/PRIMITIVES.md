# Primitives: from real signals to gym beats

Overfit Gym only shows what an adapter actually observed. This table is the contract between
telemetry and comedy. "Certainty" says how much each beat can be trusted.

- **observed**: a runner or tool reported it directly.
- **derived**: computed deterministically from observed events.
- **heuristic**: a guess from names or shapes, always labelled as one in the UI.
- **inferred**: concluded from the absence of events, such as silence.

## Mapping table

| Source signal | Normalized event | Gym action | Metric | Certainty / limitations |
|---|---|---|---|---|
| `node:test` `test:pass` / `test:fail` with `details.type = "test"` | `test.result` (status pass/fail) | One overhead press (rep); green ring. Fail: bar crashes to the floor, red ring | executions, pass, fail, pass rate | observed. Duration is the runner's own `duration_ms`. |
| `node:test` `skip` / `todo` flags | `test.result` (skip/todo) | Shrug, no lift | skip count | observed. Skips are counted as executions because the runner reported them, but never as passes. |
| `node:test` `details.type = "suite"` | `suite.end` | Completes a set (rep counter on the rack) | suites | observed. The file-level wrapper test that `node --test` adds per file is dropped: it is not a test case. |
| Reporter start / end of one `node --test` invocation | `run.start` / `run.end` with `data.target` (hash of cwd + args) | Agent walks to a station; the run's result decides flex or slump | runs (runner invocations, one per command attempt) | observed. The target is a hash; the command line itself is never sent. |
| Same `target` as the agent's previous run | (derived in reducer) | Rerun | reruns | derived. Same target = same command in the same directory. |
| Same target **and** identical `diff.snapshot` key before and after | (derived) | Treadmill: running hard, display stuck at "0.0 km" | treadmill (reruns with no code change) | derived. Needs diff snapshots: with none, a rerun is never called a treadmill. |
| `details.attempt` (from `--test-rerun-failures`, 0-based in Node) or the same test id twice in one run | `test.result` with `attempt > 1` | Wobbling on the dome (flaky zone) | retries | observed. Passes that `--test-rerun-failures` carries over without executing them (`passed_on_attempt < attempt`) are dropped, not counted. |
| Retry that went fail to pass within one run | (derived) | Wobble with a "flaky" caption | flaky | derived. Fail to pass across *different* runs is not called flaky. |
| Test file or name matches `integration`, `e2e`, `end-to-end`, `contract`, or adapter tag `integration` | `tags: ["integration"]` or path match | Long bar in the integration zone | integration-tagged executions | **heuristic**. File naming is a convention, not a fact. |
| Agent hook `PostToolUse` / `PostToolUseFailure` for `Bash` whose command matches a test-runner pattern | `run.end` (pass / fail / cancelled on interrupt), `data.observed = "command-level"` | Agent walks to a station and finishes a set: flex or slump | runs, reruns | runner detection is **heuristic** (command patterns). No per-test reps. The command is hashed for the rerun fingerprint and never sent. |
| Transcript: test command (Claude `Bash` tool_use / Codex `exec_command`) and its result | `run.start` / `run.end`, with `data.counts` and `data.counts_parser` when a summary is printed | Assertion Press: counted reps replayed as a burst, then flex or slump | runs, reruns, executions (summary basis) | command classification is **heuristic**. Counts are **observed** from the runner's own summary line (node:test, pytest, vitest, jest, cargo, XCTest, Swift Testing, `go test -v`). With no summary, there are no reps. With no exit status (a background command), the outcome is unknown and is never assumed to be a pass. |
| Transcript: other shell commands | `activity` (`lint`, `push`, `commit`, `pr`, `merge`, `ci`, `build`, ...) | Dev-pun stations (docs/EXERCISES.md) | activity counts | **heuristic** (command patterns, quote-aware). `git push --force` is flagged. |
| Transcript: Edit / Write / MultiEdit / apply_patch | `activity` (`edit` or `edit-test`) plus a cumulative `diff.snapshot` (basis `transcript-edits`) | Edit Station; the whiteboard on the treadmill when the edits are mostly test files | per-line metric denominator | line counts are **derived** from tool inputs. A Write counts every line as added, even when it overwrites a file. |
| Transcript: Claude sidechain files / Codex `parent_thread_id` | `agent.spawn` | Spotters | spawns | observed |
| Transcript: Claude record with a numeric `costUSD` field | `usage` with `source: "reported"`, plus token counts when present | Cost overlay on the HUD and inspector | reported cost per agent and for the gym | observed. Records without `costUSD` produce nothing. |
| JUnit XML `<testcase>` with `<failure>`/`<error>`/`<skipped>` | `test.result` | Reps, as for `node:test` | executions | observed statuses. Per-case timestamps are **approximate** (laid out from reported durations). |
| Agent reports a helper/subagent | `agent.spawn` with `data.child` | Spotters gather around the parent while it lifts | spawns | observed only when an adapter emits it: the demo does, the agent hook does for `Task`/`Agent` tool calls, and the `node:test` reporter cannot see agents. |
| `git diff HEAD --numstat` plus untracked files, classified by path | `diff.snapshot` with per-category added/deleted/files | Denominator for the scoreboard; feeds The Machine | executions per changed production line | observed counts. The category of each file is **heuristic** (path rules in `adapters/git-diff.mjs`). Binary files count as unknown with 0 lines. |
| Production diff spread thin (4+ files, at most 6 lines per file) or test churn 8x production churn | (derived from `diff.snapshot`) | The Machine: gears, pulleys and a crank lifting a 0.5 kg dumbbell | none; it is a label, not a score | **heuristic**. It sees the *shape* of a diff, not abstraction. Captions start with "Heuristic:". |
| Open run with no events for 30 s | (derived at playhead time) | Frozen mid-press, trembling, amber pulse, "quiet Ns" | none | **inferred** from silence. A killed process looks the same as a slow one. |
| Cumulative executions | (derived) | Arms grow: bicep scale 1.0 to 2.8, `1 - exp(-executions/120)`. Legs never grow | muscle 0..1 | derived, bounded, deterministic. |
| Recent load: each rep +0.02, each fail +0.06, each run +0.02, decaying with tau = 90 s, plus stall strain | (derived) | Sweat drops, redder skin, forward slump | fatigue 0..1 | derived, bounded. Decays when idle, so a rested agent recovers. |
| Thresholds on totals | (derived) | Gear: sweatband (10 reps), headphones (3 runs), wrist wraps (3 reruns), chalk (5 fails), knee sleeves (5 integration-tagged), belt (50 reps), coach whistle (spawned helpers), participation chain (200 reps); 6 shown at most | none | derived. The inspector shows why each item was earned. |

## Identity and dialogue

| Source signal | Normalized event | Gym result | Certainty |
|---|---|---|---|
| Session model id in a transcript (Claude `message.model`, Codex `turn_context.model`) | `agent.hello` with `data.model` = `vendor:version`, and the raw id as `data.model_name` | Kit color, jersey number, size and family-adjacent name from the spec; the raw id is shown under the name in the Live sidebar and inspector | observed, then normalized. `OVERFIT_MODEL_NAMES=0` drops the raw id; the spec is still sent. Unknown vendors get no identity, only a pseudonym. |
| Session working directory in a transcript | `agent.hello` with `data.project` = last path segment | Project folder shown under the name in Live | observed. `OVERFIT_PROJECT_LABELS=0` drops it. The full path is never sent. |
| A real event by an agent from another family (first run after 10+ quiet minutes, a failed run, a third no-change rerun, a force push) | none (derived caption, kind `rib`) | A line spoken by the most recently active agent of a different family | derived. The trigger is real; the wit is ours. Same-family agents never rib each other. |
| Scripted demo dialogue | `agent.say` (synthetic only) | Subtitle or speech bubble | synthetic. Adapters never emit `agent.say`. |

## What is not detected (and is not faked)

| Concept | Why not | What would be needed |
|---|---|---|
| Assertions per test (most runners) | `node:test` reporter events carry no assertion count, and neither does Vitest's JSON/JUnit output. `test.result.assertions` stays absent (unknown, never 0) | Only Jest JSON (`numPassingAsserts`, passed tests) and JUnit XML with an `assertions` attribute (PHPUnit) are imported; see docs/METRICS.md |
| "Excessive" abstraction | Needs code understanding | Out of scope; The Machine is explicitly a diff-shape heuristic |
| Money cost without a reported figure | Token counts alone carry no price | The transcript watcher maps only a record's own `costUSD` field (as `reported`); nothing is estimated. Estimates from other adapters must be labelled `estimate` (docs/METRICS.md) |
| Whether a rerun was *necessary* | Intent is invisible | Nothing honest; the gym shows repetition, not judgement |
| Which agent ran a test when one reporter serves several agents | The reporter only knows its process | Set `OVERFIT_AGENT` per agent, or use a hook adapter that knows the session |

## Event kinds (schema v1)

See `src/core/events.js`. Kinds: `agent.hello`, `agent.say`, `agent.spawn`, `run.start`, `run.end`,
`suite.end`, `test.result`, `diff.snapshot`, `activity`, `usage`. Every event carries `id` (deduplication key), `ts`, `seq`, `source`,
`synthetic` (required boolean), and `agent` (a pseudonymous id). Unknown fields are dropped on ingest.
