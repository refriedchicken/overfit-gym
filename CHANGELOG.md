# Changelog

## 0.1.0 (unreleased)

The first public version.

- Live telemetry: a read-only Claude Code and Codex transcript watcher, a `node:test` reporter, a git
  diff snapshot, an opt-in agent hook, JUnit XML and Jest/Vitest JSON importers, and a generic JSON
  event API.
- The transcript watcher sends hashes and counts, plus each session's real model id and project folder
  name by default (`OVERFIT_MODEL_NAMES=0` and `OVERFIT_PROJECT_LABELS=0` turn them off), and a cost only
  when a record reports `costUSD` itself.
- An honest metrics core: unique vs total executions, reruns vs treadmill reruns, retries and flaky
  tests, test lines written per production line, and test executions per changed production line, each
  with explicit unknown states.
- A 3D test gym with clanker robots: the test-writing wall, assertion press, whiteboard treadmills, flaky
  slot machines, the integration tandem lift, the machine, a dusty production-code corner, a juice bar
  with a PR bell, and a locker room.
- Two looks: `film80`, a 1980s gym on 35mm film, is the standard; `?look=default` is the daytime gym.
- Model identities: kit colors, jersey numbers, sizes and family-adjacent names from the agent's model;
  cross-family banter tied to real events.
- A seeded demo, live pacing, captions, a director camera, content mode, replay bundles with a recap
  card, and a pose gallery.
- Capture mode and `scripts/export-video.mjs`: frame-stepped MP4 export through a headless Chrome-family
  browser and ffmpeg, plus a pixel-determinism check.
