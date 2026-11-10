# Security policy

## Threat model

Overfit Gym is a local tool. The server binds to `127.0.0.1` by default, checks `Host` and `Origin`
headers against an allowlist, validates and size-limits every event, and never executes anything it
receives. The transcript watcher only reads session logs and sends hashes and counts, plus each
session's model id and project folder name unless those are turned off. Details are in
[docs/PRIVACY_SECURITY.md](docs/PRIVACY_SECURITY.md).

Things we treat as security bugs:

- any way for a web page or remote host to post events, read the log, or read local files through the
  server
- any adapter sending prompts, command text, file paths, tool output, credentials or other private data
  beyond the documented fields
- path traversal, code execution, or denial of service through the ingest API
- a capture or replay bundle that leaks more than the documented fields

## Reporting a vulnerability

Please use GitHub's [private vulnerability reporting](https://github.com/buddyh/overfit-gym/security/advisories/new)
rather than a public issue. Include steps to reproduce and the version or commit. We aim to reply
within a week.

## Supported versions

Only the latest `main` is supported.
