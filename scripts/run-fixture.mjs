// Run the bundled sample project's real tests through the node:test reporter,
// a few times, so the live gym has something true to show.
//
//   npm start            # in one terminal
//   npm run fixture      # in another (defaults: 3 runs, 4s apart, one strict run)
//
// Flags: --runs N  --gap SECONDS  --no-strict
// Sends to OVERFIT_URL, or to 127.0.0.1 on OVERFIT_PORT (default 4377).
// Only the sample project under examples/ is executed. Nothing is installed.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'examples/sample-project');
const REPORTER = path.join(ROOT, 'adapters/node-test-reporter.mjs');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const runs = Math.max(1, Math.min(20, Number(arg('--runs', 3))));
const gap = Math.max(0, Math.min(60, Number(arg('--gap', 4))));
const strict = !process.argv.includes('--no-strict');
const log = (lvl, msg) => console.log(`${new Date().toISOString()} | ${lvl} | ${msg}`);

const { NODE_TEST_CONTEXT, ...env } = process.env;
// The reporter posts to OVERFIT_URL; default it to the port this gym was started on.
const url = env.OVERFIT_URL || `http://127.0.0.1:${env.OVERFIT_PORT || 4377}`;

function once(i) {
  const strictRun = strict && i === runs - 1 && runs > 1;
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', `--test-reporter=${REPORTER}`, '--test-reporter-destination=stderr'],
      { cwd: SAMPLE, env: { ...env, OVERFIT_URL: url, SAMPLE_STRICT: strictRun ? '1' : '0' } },
      (err, stdout, stderr) => {
        const summary = stdout.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l)).join(', ');
        log(err ? 'WARN' : 'INFO', `run ${i + 1}/${runs}${strictRun ? ' (strict: one real failing case enabled)' : ''}: ${summary || 'done'}`);
        if (stderr.trim()) log('INFO', stderr.trim().split('\n').pop());
        resolve();
      },
    );
  });
}

for (let i = 0; i < runs; i++) {
  await once(i);
  if (i < runs - 1) await new Promise((r) => setTimeout(r, gap * 1000));
}
log('INFO', `done. Open the gym in Live mode: ${url}/?mode=live`);
