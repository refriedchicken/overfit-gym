// Classify shell commands into gym activities (see docs/EXERCISES.md).
//
// Heuristic by nature: it looks at command text only. Every caller labels the
// result's basis as "cmd-pattern". The command itself is never stored.

export const ACTIVITY_LABELS = Object.freeze({
  test: 'Assertion Press',
  lint: 'Lint Pulldown',
  format: 'Format Foam Roller',
  typecheck: 'Type-Check Yoga',
  build: 'Build Bulk',
  push: 'Git Push-ups',
  pull: 'Git Pull-ups',
  commit: 'Commit Crunches',
  rebase: 'Squash Squats',
  revert: 'Rollback Rowing',
  diff: 'Diff Dips',
  pr: 'Lat Pull Request',
  merge: 'Personal Record Bell',
  ci: 'CI Spin Class',
  install: 'Dependency Burpees',
  benchmark: 'Benchmark Press',
  coverage: 'Coverage Weigh-in',
  docker: 'Docker Box Jumps',
  grep: 'Grep Grip',
  read: 'Reading Rack',
  edit: 'Edit Station',
  'edit-test': 'Test-Writing Treadmill',
});

export const ACTIVITY_IDS = Object.freeze(Object.keys(ACTIVITY_LABELS).filter((k) => k !== 'test'));

const PM = '(?:npm|pnpm|yarn|bun)';
const RUN = `${PM}\\s+(?:run\\s+)?`;

// Test runners: [runner class, pattern]. Checked before activities.
const TEST_RUNNERS = [
  ['node --test', /^node\b.*\s--test\b/],
  ['npm test', new RegExp(`^${RUN}test(?::\\S+)?\\b`)],
  ['vitest', /^vitest\b(?!.*\bbench\b)/],
  ['jest', /^jest\b/],
  ['mocha', /^mocha\b/],
  ['playwright test', /^playwright\s+test\b/],
  ['pytest', /^(?:python3?\s+-m\s+|uv\s+run\s+(?:python\s+-m\s+)?)?pytest\b/],
  ['go test', /^go\s+test\b(?!.*\s-bench)/],
  ['cargo test', /^cargo\s+(?:test|nextest)\b/],
  ['bun test', /^bun\s+test\b/],
  ['deno test', /^deno\s+test\b/],
  ['rspec', /^(?:bundle\s+exec\s+)?rspec\b/],
  ['swift test', /^swift\s+test\b/],
  ['xcodebuild test', /^xcodebuild\b.*\btest(?:-without-building)?\b/],
  ['dotnet test', /^dotnet\s+test\b/],
  ['gradle test', /^(?:\.\/)?gradlew?\s+.*\btest\b/],
  ['mvn test', /^mvn\b.*\b(?:test|verify)\b/],
];

// Activities, in priority order (first match wins within a segment).
const ACTIVITY_PATTERNS = [
  ['benchmark', [/^hyperfine\b/, /^cargo\s+bench\b/, /^go\s+test\b.*\s-bench/, new RegExp(`^${RUN}bench\\b`), /^vitest\s+bench\b/]],
  ['coverage', [/^(?:c8|nyc)\s+report\b/, /^coverage\s+(?:report|html|xml)\b/, /^go\s+tool\s+cover\b/]],
  ['lint', [/^(?:eslint|oxlint|swiftlint|golangci-lint|stylelint|shellcheck|markdownlint|flake8|pylint|hadolint)\b/, /^ruff(?:\s+check)?\b(?!\s+format)/, /^biome\s+(?:lint|check|ci)\b/, /^cargo\s+clippy\b/, new RegExp(`^${RUN}lint\\b`), /^prettier\b.*--check\b/]],
  ['format', [/^prettier\b.*--write\b/, /^(?:black|gofmt|rustfmt|swift-format|isort)\b/, /^ruff\s+format\b/, /^cargo\s+fmt\b/, /^biome\s+format\b/, new RegExp(`^${RUN}(?:format|fmt)\\b`)]],
  ['typecheck', [/^(?:tsc|vue-tsc|mypy|pyright|basedpyright)\b/, /^cargo\s+check\b/, /^go\s+vet\b/, new RegExp(`^${RUN}(?:typecheck|type-check|tsc|check-types)\\b`)]],
  ['build', [new RegExp(`^${RUN}build\\b`), /^(?:vite|next|astro|webpack|esbuild|tsup|rollup)\s+build\b/, /^(?:cargo|go|swift)\s+build\b/, /^xcodebuild\b/, /^make\b(?:\s|$)/, /^gradlew?\s+(?:assemble|build)\b/]],
  ['pr', [/^gh\s+pr\s+(?:create|edit|ready)\b/]],
  ['merge', [/^gh\s+pr\s+merge\b/, /^git\s+merge\b(?!.*--squash)/]],
  ['ci', [/^gh\s+run\s+(?:watch|view|list|rerun)\b/, /^gh\s+pr\s+checks\b/]],
  ['push', [/^git\s+push\b/]],
  ['pull', [/^git\s+(?:pull|fetch)\b/]],
  ['rebase', [/^git\s+rebase\b/, /^git\s+commit\b.*--amend\b/, /^git\s+merge\b.*--squash\b/]],
  ['commit', [/^git\s+commit\b/]],
  ['revert', [/^git\s+(?:revert|reset|restore)\b/, /^git\s+checkout\s+--\s/]],
  ['diff', [/^git\s+(?:diff|show)\b/, /^git\s+log\b.*\s-p\b/]],
  ['install', [new RegExp(`^${PM}\\s+(?:install|i|add|ci)\\b`), /^(?:pip3?|uv\s+pip)\s+install\b/, /^uv\s+(?:add|sync)\b/, /^brew\s+install\b/, /^cargo\s+add\b/, /^go\s+get\b/, /^pod\s+install\b/]],
  ['docker', [/^docker(?:-compose|\s+compose)?\s+(?:build|run|up|compose)\b/]],
  ['grep', [/^(?:rg|grep|egrep|ag|ack)\b/, /^git\s+grep\b/]],
  ['read', [/^(?:cat|head|tail|less|bat)\b/, /^sed\s+-n\b/]],
];

const PRIORITY = ['test', ...ACTIVITY_PATTERNS.map(([id]) => id)];

/** Split on &&, ||, ;, | and newlines, but never inside quotes. */
function splitTopLevel(command) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        cur += ch + (command[i + 1] ?? '');
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      out.push(cur);
      cur = '';
      if ((ch === '|' && command[i + 1] === '|') || ch === '&') i++;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function segments(command) {
  return splitTopLevel(command)
    .map((seg) => {
      let s = seg.trim();
      for (;;) {
        const before = s;
        s = s.replace(/^\(+\s*/, '');
        s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/, '');
        s = s.replace(/^(?:npx|pnpx|bunx|pnpm\s+exec|env|time|command|exec|nice|timeout\s+\S+|gtimeout\s+\S+)\s+/, '');
        s = s.replace(/^(?:bash|sh|zsh)\s+-l?c\s+["']?/, '');
        if (s === before) break;
      }
      return s;
    })
    .filter(Boolean);
}

/**
 * Classify a command. Returns { kind: 'test', runner } | { kind: 'activity', activity } | null.
 * When a chained command does several things, the highest-priority one wins
 * (tests first), so `npm run lint && npm test` is a test run.
 */
export function classifyCommand(command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 8000) return null;
  let best = null;
  let bestRank = Infinity;
  for (const seg of segments(command)) {
    // benchmark beats test (go test -bench), then tests, then the rest
    const bench = ACTIVITY_PATTERNS[0][1].some((re) => re.test(seg));
    if (bench) {
      best = { kind: 'activity', activity: 'benchmark' };
      bestRank = -1;
      continue;
    }
    const runner = TEST_RUNNERS.find(([, re]) => re.test(seg));
    if (runner && 0 < bestRank) {
      // `segment` is the test command itself, minus pipes, redirects and cd: the rerun fingerprint.
      best = { kind: 'test', runner: runner[0], segment: seg.replace(/\s+\d?>&?\s*\S+/g, '').replace(/\s+/g, ' ').trim() };
      bestRank = 0;
      continue;
    }
    for (const [id, res] of ACTIVITY_PATTERNS) {
      if (res.some((re) => re.test(seg))) {
        const rank = PRIORITY.indexOf(id);
        if (rank < bestRank) {
          best = { kind: 'activity', activity: id };
          bestRank = rank;
        }
        break;
      }
    }
  }
  if (best?.activity === 'push' && /\s(?:--force|-f|--force-with-lease)\b/.test(command)) best.force = true;
  return best;
}
