// Parse test-runner summary lines from captured command output.
//
// Used when only a command's output is available (agent transcripts), not
// per-test events. Returns counts the runner itself printed, or null. Never
// guesses: if no known summary format is found, the run has no counts.

const num = (s) => Number(s.replace(/,/g, ''));

const PARSERS = [
  {
    name: 'node:test',
    parse(text) {
      const line = (k) => text.match(new RegExp(`^[ℹ#]\\s*${k}\\s+(\\d+)\\s*$`, 'm'));
      const get = (k) => num(line(k)?.[1] ?? '0');
      // Output is often trimmed with tail, so the "tests" total line may be gone;
      // pass and fail lines alone are enough.
      if (!line('tests') && !(line('pass') && line('fail'))) return null;
      const pass = get('pass');
      const fail = get('fail') + get('cancelled');
      const skip = get('skipped') + get('todo');
      return { total: line('tests') ? get('tests') : pass + fail + skip, pass, fail, skip };
    },
  },
  {
    name: 'pytest',
    parse(text) {
      // "==== 3 failed, 10 passed, 2 skipped in 1.23s ====" or quiet "10 passed in 0.5s"
      const lines = [...text.matchAll(/^[=\s]*((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in [\d.]+s/gm)];
      if (!lines.length) return null;
      const s = lines[lines.length - 1][1];
      const g = (k) => num(s.match(new RegExp(`(\\d+) ${k}`))?.[1] ?? '0');
      const pass = g('passed') + g('xpassed');
      const fail = g('failed') + g('errors?');
      const skip = g('skipped') + g('xfailed');
      return { total: pass + fail + skip, pass, fail, skip };
    },
  },
  {
    name: 'vitest',
    parse(text) {
      const m = [...text.matchAll(/^\s*Tests\s+((?:\d+ (?:passed|failed|skipped|todo)(?: \| )?)+)\s*\((\d+)\)/gm)].pop();
      if (!m) return null;
      const g = (k) => num(m[1].match(new RegExp(`(\\d+) ${k}`))?.[1] ?? '0');
      return { total: num(m[2]), pass: g('passed'), fail: g('failed'), skip: g('skipped') + g('todo') };
    },
  },
  {
    name: 'jest',
    parse(text) {
      const m = [...text.matchAll(/^Tests:\s+(.+?)(\d+) total\s*$/gm)].pop();
      if (!m) return null;
      const g = (k) => num(m[1].match(new RegExp(`(\\d+) ${k}`))?.[1] ?? '0');
      return { total: num(m[2]), pass: g('passed'), fail: g('failed'), skip: g('skipped') + g('todo') };
    },
  },
  {
    name: 'cargo',
    parse(text) {
      const all = [...text.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
      if (!all.length) return null;
      const c = all.reduce((a, m) => ({ pass: a.pass + num(m[1]), fail: a.fail + num(m[2]), skip: a.skip + num(m[3]) }), { pass: 0, fail: 0, skip: 0 });
      return { total: c.pass + c.fail + c.skip, ...c };
    },
  },
  {
    name: 'swift-testing',
    parse(text) {
      const m = text.match(/Test run with (\d+) tests? (?:in \d+ suites? )?(passed|failed)(?: after [\d.]+ seconds)?(?: with (\d+) issues?)?/);
      if (!m) return null;
      // Swift Testing reports issues, not failed-test counts; a failed run counts as 1 failure minimum.
      const total = num(m[1]);
      const fail = m[2] === 'failed' ? Math.min(total, Math.max(1, num(m[3] ?? '1'))) : 0;
      return { total, pass: total - fail, fail, skip: 0 };
    },
  },
  {
    name: 'xctest',
    parse(text) {
      const all = [...text.matchAll(/Executed (\d+) tests?, with (\d+) failures?(?: \((\d+) unexpected\))?/g)];
      if (!all.length) return null;
      // XCTest prints per-suite and aggregate lines; the largest total is the aggregate.
      const m = all.reduce((a, b) => (num(b[1]) >= num(a[1]) ? b : a));
      const total = num(m[1]);
      const fail = Math.min(total, num(m[2]));
      return { total, pass: total - fail, fail, skip: 0 };
    },
  },
  {
    name: 'go test -v',
    parse(text) {
      const pass = (text.match(/^\s*--- PASS:/gm) ?? []).length;
      const fail = (text.match(/^\s*--- FAIL:/gm) ?? []).length;
      const skip = (text.match(/^\s*--- SKIP:/gm) ?? []).length;
      if (!pass && !fail && !skip) return null;
      return { total: pass + fail + skip, pass, fail, skip };
    },
  },
];

/** @returns {{total:number, pass:number, fail:number, skip:number, parser:string} | null} */
export function parseTestSummary(text) {
  if (typeof text !== 'string' || !text) return null;
  const tail = text.length > 400_000 ? text.slice(-400_000) : text; // summaries are at the end
  const t = tail.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); // strip ANSI colors
  for (const p of PARSERS) {
    const r = p.parse(t);
    if (r && r.total >= 0 && Number.isFinite(r.total)) return { ...r, parser: p.name };
  }
  return null;
}
