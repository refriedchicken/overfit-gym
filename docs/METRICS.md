# Metrics

All metrics are computed by `src/core/metrics.js` from the reducer state at the current playhead.
Replaying the same events gives the same numbers.

## Counts

| Metric | Definition |
|---|---|
| Test executions (reps) | Number of `test.result` events. Every execution counts, including reruns, retries and skips. |
| Unique test cases | Distinct test ids among those results. The id is `file::suite::name` unless the adapter supplies one. |
| Repeat executions | executions minus unique cases. |
| Runner invocations | `run.start` events, plus any `run.end` or result whose run was never seen starting (partial telemetry still counts once). |
| Reruns | Runs whose target fingerprint equals the same agent's previous run target. |
| Reruns with no code change (treadmill) | Reruns where the latest diff snapshot before the previous run and before this run are identical. Without snapshots this stays 0; it is never assumed. |
| Retries | Results with `attempt > 1`, or a second result for the same test id inside one run. |
| Flaky | Retries that went fail to pass inside one run. |
| Pass rate | pass / (pass + fail). Skips are excluded. n/a when both are 0. |
| Summary executions | Executions known only from a runner's printed summary line in an agent transcript. They count toward executions, pass and fail, but not toward unique test cases, because no test names are known. They are added only when a run had no per-test results, so they are never double counted. |
| Reported test runtime | Sum of per-test `duration_ms` the runner reported. Not wall-clock, not compute cost. |

## Assertion counts (optional, mostly unknown)

`test.result.assertions` is a non-negative integer or absent. Absent means **unknown**, never 0, and no
metric or HUD figure should render it as 0. Nothing aggregates it yet. Sources:

| Source | Count? | Detail |
|---|---|---|
| Jest `--json` via `adapters/jest-json-import.mjs` | yes, passed tests only | `assertionResults[].numPassingAsserts` counts passing `expect` calls. For failed tests it is only the passes before the failure, so it is dropped (unknown). Skipped/todo: unknown. |
| JUnit XML via `adapters/junit-import.mjs` | only if `<testcase assertions="N">` | PHPUnit writes it. pytest, jest-junit, Vitest and Surefire do not, so unknown. |
| Vitest `--reporter=json` (same importer) | no | Its JSON is Jest-compatible but has no per-test assertion count; `expect.assertions(n)` is a check, not reported output. Unknown. |
| `node:test` reporter | no | Events carry no assertion count. Unknown. |

Tests use hand-written format fixtures in `test/fixtures/runners`, not live runner output.

## Test executions per changed production line

```
value = numerator / denominator

numerator    test executions in scope (the inspector and scoreboard use executions;
             `testsPerProdLine(..., { numerator: 'unique' })` gives the unique-case variant)
denominator  production lines added + production lines deleted, from the latest diff.snapshot
```

**Window and scope.** The scope is either one agent or the whole gym, over all events up to the
playhead. Snapshots are cumulative (the working tree compared with `HEAD`), so one agent's snapshots are
never summed: the latest one wins. In the whole-gym view, agents that report the same repo key share one
denominator (the latest snapshot for that repo), so two agents in one checkout do not double count.

**Edge cases.**

| Case | Result |
|---|---|
| No diff snapshot observed | `n/a (no diff observed)`. The value is null, never 0 or infinity. |
| Snapshot with 0 production lines | `n/a (0 production lines changed)`. Test, docs, generated and unknown churn are still listed. |
| Deletion-only change | Counts: deleting 15 lines is 15 lines of churn. |
| Test files | Excluded from the denominator and reported as `test`. |
| Docs (`.md`, `docs/`, LICENSE, ...) | Excluded and reported as `docs`. |
| Generated (lockfiles, `dist/`, `vendor/`, `*.min.js`, snapshots, `*generated*`) | Excluded and reported as `generated`. |
| Unknown (configs, images, binaries) | Excluded and reported as `unknown`. Binary files count as 0 lines. |
| Untracked files | Included, counted as added lines, up to 500 files and 1 MB each. |

**Transcript denominators.** For transcript agents, the snapshot is the running sum of lines changed by
Edit/Write/patch tool calls in that session, split with the same path rules. It is not a git diff: a
Write counts the whole file as added, and edits that were later reverted still count.

**What it means.** The ratio is a measure of *effort per change*, not of quality. Ten executions per
production line can be perfectly healthy for risky code. The joke in the gym is only ever about
disproportion, and the number is shown with its numerator, denominator and exclusions so it can be checked.

## Test lines written per production line

`testLineRatio = test churn / production churn`, taken from the same snapshot(s) and with the same
`unknown` and `no-prod-change` states as the execution ratio. Test churn is lines added plus deleted in
files classified as tests. This is the headline stat: how much test code agents write for each line of
the code under test.

## Cost and time overlay (sourced usage only)

The cost overlay appears only when at least one event carries a `usage` payload with a `costUsd`.
With none, nothing is shown (never `$0.00`). The seeded demo carries no cost.

`usage: { costUsd?, durationMs?, tokens?, source, sourceLabel }`

| `source` | Meaning |
|---|---|
| `reported` | The agent or runtime itself reported the figure (e.g. a transcript record with a `costUSD` field). |
| `estimate` | Derived (e.g. tokens times a price table). `sourceLabel` must name the basis. Always shown with an `EST` badge. |

Reported and estimated totals are aggregated per agent and for the whole gym **separately**; they are
never summed into one number. Token counts without a cost never produce an overlay, and the transcript
adapter invents no pricing: it maps only a real `costUSD` field, as `reported`. Time shown is the
active span between real event timestamps, plus any `durationMs` the usage record itself reported.

## Live pacing

In Live mode, events are spread out per agent for display (`src/core/pacing.js`): a test result at least
240 ms after the previous one, and runs at least 500 to 600 ms apart, never more than 15 s behind. Pacing
only delays events; it never reorders, drops or invents any. Counts are unaffected (there is a test for
this). Time-based beats (when a rep animates, the 30 s stall threshold) use paced time. The current lag is
shown next to the connection status.
