// Git diff snapshot adapter.
//
// Produces a `diff.snapshot` event: working-tree changes vs HEAD (tracked) plus
// untracked files, with line churn split into production / test / docs /
// generated / unknown. Only fixed git subcommands are run, via execFile (no
// shell), in the directory the caller is already working in.
//
// Usage as a CLI:
//   node adapters/git-diff.mjs            # print the event JSON
//   node adapters/git-diff.mjs --post     # POST it to the gym (OVERFIT_URL)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashHex } from '../src/core/hash.js';

const SOURCE_EXT = new Set(
  'js mjs cjs ts tsx jsx mts cts py go rs java kt kts swift rb php cs c h cc cpp hpp m mm scala sql vue svelte css scss sass less html sh bash zsh lua dart ex exs erl clj elm hs ml zig'.split(' '),
);
const DOC_EXT = new Set(['md', 'mdx', 'rst', 'txt', 'adoc']);

/** Classify one repo-relative path. Order matters: generated beats test beats docs. */
export function classifyPath(p) {
  const f = p.replace(/\\/g, '/').toLowerCase();
  const base = f.split('/').pop();
  const ext = base.includes('.') ? base.split('.').pop() : '';
  if (
    /(^|\/)(node_modules|dist|build|out|vendor|coverage|\.next|target)\//.test(f) ||
    /(^|\/)__snapshots__\//.test(f) ||
    /\.(min\.js|min\.css|map|snap|lock)$/.test(f) ||
    ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'cargo.lock', 'poetry.lock', 'go.sum', 'gemfile.lock', 'composer.lock'].includes(base) ||
    /(^|[._-])generated([._-]|$)/.test(base)
  ) {
    return 'generated';
  }
  if (
    /(^|\/)(test|tests|__tests__|spec|specs|e2e|testdata|fixtures)\//.test(f) ||
    /\.(test|spec|e2e)\.[a-z0-9]+$/.test(base) ||
    /_test\.(go|py|rb|exs)$/.test(base) ||
    /^test_.*\.py$/.test(base) ||
    /tests?\.(swift|kt|java|cs)$/.test(base)
  ) {
    return 'test';
  }
  if (DOC_EXT.has(ext) || /(^|\/)docs?\//.test(f) || ['license', 'changelog', 'readme', 'notice', 'authors'].includes(base)) return 'docs';
  if (SOURCE_EXT.has(ext)) return 'production';
  return 'unknown';
}

/** Parse `git diff --numstat` output. Binary files show "-" and count 0 lines. */
export function parseNumstat(text) {
  const files = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [a, d, ...rest] = line.split('\t');
    const p = rest.join('\t');
    if (!p) continue;
    const binary = a === '-' || d === '-';
    files.push({ path: p, added: binary ? 0 : Number(a), deleted: binary ? 0 : Number(d), binary });
  }
  return files;
}

/**
 * Build diff.snapshot data from per-file churn. Paths are never included.
 * `contentKey` should hash the actual diff content: two different edits with the
 * same line counts must not look like "no code change".
 */
export function snapshotData(files, { repo, contentKey } = {}) {
  const categories = {};
  for (const c of ['production', 'test', 'docs', 'generated', 'unknown']) categories[c] = { added: 0, deleted: 0, files: 0 };
  for (const f of files) {
    const c = f.binary ? 'unknown' : classifyPath(f.path);
    categories[c].added += f.added;
    categories[c].deleted += f.deleted;
    categories[c].files += 1;
  }
  const key = hashHex(`${contentKey ?? ''}|${files.map((f) => `${f.path}:${f.added}:${f.deleted}`).sort().join('\n')}`);
  return repo ? { repo, key, categories } : { key, categories };
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024, timeout: 5000 });
}

/**
 * Collect a snapshot for the repo containing `cwd`. Returns null when `cwd` is
 * not inside a git work tree.
 */
export function collectSnapshot(cwd = process.cwd(), { maxUntracked = 500, maxBytes = 1_000_000 } = {}) {
  let top;
  try {
    top = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return null;
  }
  let numstat = '';
  try {
    numstat = git(top, ['diff', 'HEAD', '--numstat', '--no-renames']);
  } catch {
    try {
      numstat = git(top, ['diff', '--cached', '--numstat', '--no-renames']); // repo without commits yet
    } catch {
      numstat = '';
    }
  }
  const files = parseNumstat(numstat);
  // Hash the diff content itself so a same-size edit still counts as a change.
  let content = '';
  try {
    content = git(top, ['diff', 'HEAD', '--no-renames', '--no-ext-diff']);
  } catch {
    content = '';
  }
  const contentParts = [hashHex(content)];
  let untracked = [];
  try {
    untracked = git(top, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).slice(0, maxUntracked);
  } catch {
    untracked = [];
  }
  for (const rel of untracked) {
    let added = 0;
    let binary = false;
    try {
      const st = fs.statSync(path.join(top, rel));
      if (st.size > maxBytes) binary = true;
      else {
        const buf = fs.readFileSync(path.join(top, rel));
        if (buf.includes(0)) binary = true;
        else {
          const text = buf.toString('utf8');
          added = text.split('\n').length - (buf.at(-1) === 10 ? 1 : 0);
          contentParts.push(`${rel}:${hashHex(text)}`);
        }
      }
    } catch {
      binary = true;
    }
    files.push({ path: rel, added, deleted: 0, binary });
  }
  // The repo key is a hash so the absolute path never leaves this machine.
  return snapshotData(files, { repo: hashHex(`${os.hostname()}:${top}`), contentKey: hashHex(contentParts.join('\n')) });
}

/** Pseudonymous stable agent id for a working directory (hash only). */
export function defaultAgentId(prefix, cwd = process.cwd()) {
  return `${prefix}-${hashHex(`${os.hostname()}:${cwd}`)}`;
}

async function main() {
  const data = collectSnapshot();
  if (!data) {
    console.error('not inside a git work tree');
    process.exit(1);
  }
  const agent = process.env.OVERFIT_AGENT || defaultAgentId('git');
  const ts = Date.now();
  const ev = { v: 1, id: `${agent}:diff:${data.key}:${ts}`, ts, source: 'git-diff', synthetic: false, agent, kind: 'diff.snapshot', data };
  if (process.argv.includes('--post')) {
    const url = process.env.OVERFIT_URL || 'http://127.0.0.1:4377';
    const r = await fetch(`${url}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([ev]) });
    console.log(JSON.stringify(await r.json()));
  } else {
    console.log(JSON.stringify(ev, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
