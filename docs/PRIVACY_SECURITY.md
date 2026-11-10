# Privacy and security

Overfit Gym is a local observer. It is built so that running it, or publishing a capture from it,
leaks as little as possible.

## Network surface

- The server binds to `127.0.0.1` by default (`OVERFIT_HOST`).
- Every request's `Host` header must be `localhost`, `127.0.0.1`, `[::1]`, or a name listed in
  `OVERFIT_ALLOWED_HOSTS`. This blocks DNS-rebinding attacks.
- Browser requests with an `Origin` header from any other host are rejected (403), so a web page you
  visit cannot post fake events or read your log. No CORS headers are sent. The Origin check
  compares host names only, so another page served from `localhost` on a different port can post events.
  Anything it posts still has to pass validation, and the Live badge flags events marked synthetic.
- `POST /api/events` accepts only `application/json`, bodies up to 512 KB, and batches of up to 500
  events. Each event is validated against schema v1, unknown fields are dropped, and `data` payloads are
  capped at 4 KB.
- Static serving is limited to `web/`, `src/core/` and the local `replays/` folder, with path traversal
  rejected and an allowlist of file types.

## No execution of inbound data

Nothing the server receives is executed, evaluated or used as a path. The only things the project
executes are:

- `adapters/git-diff.mjs`, which runs fixed `git` subcommands (`rev-parse`, `diff --numstat`,
  `ls-files`) through `execFile` with no shell, in the directory where it was launched.
- `scripts/run-fixture.mjs`, which runs `node --test` on the bundled `examples/sample-project` only.

## What telemetry contains

- **Agent ids** are pseudonymous: `node-<hash of hostname + cwd>` by default. The display name
  ("Brisk Gecko") is derived from the hash and contains none of the input.
- **Run targets and repo keys** are hashes. Command lines and absolute paths are never sent.
- **Test file paths** are sent relative to the working directory. A file outside it is reduced to its
  basename.
- **Test names are sent as written**. If your test names contain sensitive text, set `OVERFIT_URL=off`
  and use `OVERFIT_OUT` to review the JSONL first.
- **Diff snapshots** contain only per-category line and file counts and a content hash. No file names
  and no code.
- No prompts, transcripts, environment variables, tokens or error messages are collected. Test failure
  messages are deliberately not forwarded.

## Transcript watcher

`adapters/transcript-watch.mjs` opens Claude Code and Codex session logs read-only
(`~/.claude/projects` and `~/.codex/sessions`, or `OVERFIT_CLAUDE_DIR` / `OVERFIT_CODEX_DIR`). Per tool
call it keeps only:

- an activity id or test-runner class
- a hash of the command and its working directory, which is the rerun fingerprint
- edit line counts per category
- test counts parsed from a runner summary
- timestamps

Session ids are hashed into agent ids. **Two real names are sent by default** so the live view is
useful:

- the session's model id, exactly as the CLI recorded it (`OVERFIT_MODEL_NAMES=0` turns it off; the
  clanker identity then still comes from a normalized `vendor:version` spec), and
- the project folder name, the last path segment only, never the path (`OVERFIT_PROJECT_LABELS=0`
  turns it off).

If a Claude Code record carries a numeric `costUSD` field, that cost and the record's token counts are
sent as a `usage` event marked `reported`. Nothing is priced or estimated from tokens.

Prompts, command text, file paths, tool output and assistant messages are never sent. The tests check
this against fixture transcripts. File offsets are kept in `data/watch-state.json` (gitignored).

The transcript formats are not documented interfaces. If a CLI changes its format, the watcher can
miss or misread beats; it cannot start sending fields it does not explicitly extract.

## Storage

Accepted events are appended to `data/events.jsonl` (gitignored), capped at the most recent 50,000 on
load. Delete the file to forget everything.

## Captures

The capture button burns the source label ("SYNTHETIC DEMO · seed N" or "LIVE TELEMETRY") into the
PNG, so a still can't pass synthetic data off as real. A live capture can show model ids, project folder
names and test names, so review it before sharing. Demo frames contain only synthetic
data.
