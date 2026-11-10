// Read-only transcript watcher: Claude Code and Codex session logs -> gym events.
//
//   npm run watch                      # backfill the last 6 h, then tail every 2 s
//   node adapters/transcript-watch.mjs --once --backfill-hours 24
//
// What it reads: ~/.claude/projects/**/*.jsonl and ~/.codex/sessions/**/*.jsonl
// (override with OVERFIT_CLAUDE_DIR / OVERFIT_CODEX_DIR). It only ever opens those
// files for reading. Its own state (file offsets) lives in data/watch-state.json.
//
// What it sends: pseudonymous agent ids (hashes of session ids), the session's
// real model id (OVERFIT_MODEL_NAMES=0 hides it) and project folder name
// (OVERFIT_PROJECT_LABELS=0 hides it), activity ids, runner classes, hashes of
// commands, line counts of edits, test counts parsed from runner summaries, and a
// cost with token counts only when a record itself carries a costUSD field.
// Never prompts, command text, file paths, or output.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashHex, pseudonym } from '../src/core/hash.js';
import { classifyCommand } from '../src/core/activities.js';
import { identityFor, parseModelId } from '../src/core/identity.js';
import { parseTestSummary } from '../src/core/test-summary.js';
import { classifyPath } from './git-diff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATS = ['production', 'test', 'docs', 'generated', 'unknown'];

const lineCount = (s) => (typeof s === 'string' && s.length ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0);

function relTo(cwd, p) {
  if (typeof p !== 'string') return '';
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  return p.split('/').slice(-3).join('/'); // keep only the tail for classification
}

/** Count +/- lines per file in an apply_patch body. */
export function parsePatch(text) {
  const files = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
    if (m) {
      cur = { path: m[2].trim(), added: 0, deleted: 0, op: m[1] };
      files.push(cur);
      continue;
    }
    if (!cur || line.startsWith('***') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) cur.added++;
    else if (line.startsWith('-')) cur.deleted++;
  }
  return files;
}

/** Pull shell commands and patch bodies out of a Codex `exec` tool input (JS source). */
export function extractCodexCalls(input) {
  const commands = [];
  const patches = [];
  if (typeof input !== 'string') return { commands, patches };
  const lit = (src) => {
    try {
      return JSON.parse(src);
    } catch {
      return null;
    }
  };
  for (const m of input.matchAll(/exec_command\(\s*\{\s*cmd\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
    const s = lit(m[1]);
    if (s) commands.push(s);
  }
  for (const m of input.matchAll(/apply_patch\(\s*("(?:[^"\\]|\\.)*")/g)) {
    const s = lit(m[1]);
    if (s) patches.push(s);
  }
  if (!commands.length && !patches.length && input.includes('*** Begin Patch')) patches.push(input);
  return { commands, patches };
}

/** Flatten a tool output (string, array of {text}, nested JSON) into text plus exit codes. */
export function flattenOutput(out) {
  const texts = [];
  const codes = [];
  const visit = (v, depth = 0) => {
    if (depth > 6 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try {
          return visit(JSON.parse(t), depth + 1);
        } catch {
          /* plain text */
        }
      }
      texts.push(v);
      for (const m of v.matchAll(/(?:Exit code|exited with code|exit_code)\D{0,3}(-?\d+)/gi)) codes.push(Number(m[1]));
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (typeof v === 'object') {
      if (typeof v.exit_code === 'number') codes.push(v.exit_code);
      for (const [k, x] of Object.entries(v)) if (k !== 'exit_code') visit(x, depth + 1);
    }
  };
  visit(out);
  return { text: texts.join('\n'), codes };
}

/**
 * Stateful parser for one transcript file. feed(obj) returns events for one
 * JSON line. Pure apart from its own state; exported for tests.
 */
export function createSessionParser({ source, fileKey, projectLabels = true, modelNames = true }) {
  const short = source === 'claude' ? 'cc' : 'cx';
  const pending = new Map();
  const agents = new Map(); // agentId -> { edits, editCount }
  let sessionId = null;
  let cwd = null;
  let parentAgent = null;
  let model = null; // "vendor:version" spec
  let rawModel = null; // the id as the session reports it
  let selfAgent = null;
  let seq = 0;

  const agentFor = (sid) => `${short}-${hashHex(sid)}`;

  function ensureAgent(id, ts, out) {
    if (agents.has(id)) return agents.get(id);
    const st = { edits: Object.fromEntries(CATS.map((c) => [c, { added: 0, deleted: 0, files: 0 }])), editCount: 0, files: new Set() };
    agents.set(id, st);
    out.push(base(id, ts, `hello`, { kind: 'agent.hello', data: helloData(id) }));
    st.helloModel = rawModel;
    // Edits start at zero, so a rerun before any edit is observably "no code change".
    out.push(base(id, ts, `diff0`, { kind: 'diff.snapshot', data: { repo: id, key: 'edits:0', basis: 'transcript-edits', categories: st.edits } }));
    if (parentAgent) out.push(base(parentAgent, ts, `spawn:${id}`, { kind: 'agent.spawn', data: { child: id } }));
    return st;
  }

  /** Display name: a family-adjacent name plus the version number when the model is known. */
  function helloData(id) {
    const idn = identityFor(model, id);
    const name = idn ? idn.label : pseudonym(id);
    const data = { label: name };
    if (idn) data.model = idn.spec;
    // What makes the gym useful day to day: the real model and the project it is working in.
    const clean = (s) => String(s).replace(/[^\w .:@+\-\[\]/]/g, '').slice(0, 60);
    if (modelNames && rawModel && clean(rawModel)) data.model_name = clean(rawModel);
    if (projectLabels && cwd && clean(path.basename(cwd))) data.project = clean(path.basename(cwd));
    return data;
  }

  /** The session's model, once seen: a normalized spec for the identity, plus the real id for the sidebar. */
  function noteModel(raw, ts, out) {
    if (raw.startsWith('<')) return; // placeholder ids such as synthetic turns
    const spec = parseModelId(raw);
    if (raw === rawModel || (!spec && rawModel)) return;
    rawModel = raw;
    model = spec ?? model;
    const st = selfAgent ? agents.get(selfAgent) : null;
    if (st && st.helloModel !== raw) {
      st.helloModel = raw;
      out.push(base(selfAgent, ts, `hello:${hashHex(raw)}`, { kind: 'agent.hello', data: helloData(selfAgent) }));
    }
  }

  function base(agent, ts, key, fields) {
    return { v: 1, id: `${agent}:${key}`, ts, seq: seq++, source: `${source}-transcript`, synthetic: false, agent, ...fields };
  }

  function edit(ts, files, out) {
    const agent = selfAgent;
    // Tool inputs are not guaranteed: an edit with no path (or a notebook edit) is skipped.
    files = files.filter((f) => typeof f.path === 'string' && f.path && Number.isFinite(f.added) && Number.isFinite(f.deleted));
    if (!files.length) return;
    const st = ensureAgent(agent, ts, out);
    let testLines = 0;
    let prodLines = 0;
    for (const f of files) {
      const cat = classifyPath(relTo(cwd, f.path));
      const c = st.edits[cat];
      c.added += f.added;
      c.deleted += f.deleted;
      const fk = hashHex(f.path);
      if (!st.files.has(`${cat}:${fk}`)) {
        st.files.add(`${cat}:${fk}`);
        c.files++;
      }
      if (cat === 'test') testLines += f.added + f.deleted;
      if (cat === 'production') prodLines += f.added + f.deleted;
    }
    st.editCount++;
    const k = `edit:${st.editCount}:${ts}`;
    out.push(base(agent, ts, k, { kind: 'activity', data: { activity: testLines > prodLines ? 'edit-test' : 'edit', basis: 'transcript-tool' } }));
    out.push(base(agent, ts, `${k}:diff`, { kind: 'diff.snapshot', data: { repo: agent, key: `edits:${st.editCount}`, basis: 'transcript-edits', categories: JSON.parse(JSON.stringify(st.edits)) } }));
  }

  function startCall(callId, commands, ts, out) {
    let best = null;
    for (const c of commands) {
      const r = classifyCommand(c);
      if (r && (!best || (r.kind === 'test' && best.kind !== 'test'))) best = { ...r, cmd: c };
    }
    if (!best) return;
    const agent = selfAgent;
    ensureAgent(agent, ts, out);
    const key = hashHex(String(callId));
    if (best.kind === 'test') {
      const run = `${agent}:run:${key}`;
      out.push(base(agent, ts, `${key}:start`, { kind: 'run.start', run, data: { target: `cmd:${hashHex(`${cwd ?? ''}|${best.segment ?? best.cmd.trim()}`)}`, command_class: best.runner, observed: 'transcript' } }));
      pending.set(callId, { type: 'test', run, ts, agent, key });
    } else {
      pending.set(callId, { type: 'activity', activity: best.activity, force: !!best.force, ts, agent, key });
    }
  }

  function endCall(callId, { text, isError, interrupted }, ts, out) {
    const p = pending.get(callId);
    if (!p) return;
    pending.delete(callId);
    if (p.type === 'test') {
      const counts = parseTestSummary(text);
      // Outcome only when observed: an exit status, an error flag, or a printed
      // summary. A command still running in the background has none of these.
      let status;
      if (interrupted) status = 'cancelled';
      else if (isError === true || (counts && counts.fail > 0)) status = 'fail';
      else if (isError === false || counts) status = 'pass';
      const data = { observed: 'transcript' };
      if (counts) {
        data.counts = { total: counts.total, pass: counts.pass, fail: counts.fail, skip: counts.skip };
        data.counts_parser = counts.parser;
      }
      const end = { kind: 'run.end', run: p.run, duration_ms: Math.max(0, ts - p.ts), data };
      if (status) end.status = status;
      else data.outcome = 'unknown';
      out.push(base(p.agent, ts, `${p.key}:end`, end));
    } else {
      const data = { activity: p.activity, basis: 'cmd-pattern' };
      if (p.force) data.force = true;
      const act = { kind: 'activity', data };
      if (isError === true) act.status = 'fail';
      else if (isError === false) act.status = 'pass';
      out.push(base(p.agent, ts, `${p.key}:act`, act));
    }
  }

  function feedClaude(o, ts, out) {
    if (o.cwd) cwd = o.cwd;
    if (o.type === 'assistant' && typeof o.message?.model === 'string') noteModel(o.message.model, ts, out);
    if (!sessionId && o.sessionId) sessionId = o.sessionId;
    if (!selfAgent) {
      if (o.isSidechain && o.agentId && sessionId) {
        selfAgent = agentFor(`${sessionId}:${o.agentId}`);
        parentAgent = agentFor(sessionId);
      } else if (sessionId) selfAgent = agentFor(sessionId);
      else selfAgent = agentFor(fileKey);
    }
    // Cost is mapped only when the record itself carries a numeric cost field
    // (costUSD). Token counts alone never produce a usage event: no invented pricing.
    if (o.type === 'assistant' && typeof o.costUSD === 'number' && Number.isFinite(o.costUSD) && o.costUSD >= 0 && (o.uuid || o.requestId)) {
      ensureAgent(selfAgent, ts, out);
      const u = o.message?.usage ?? {};
      const tokens = {};
      for (const [k, f] of [['input', 'input_tokens'], ['output', 'output_tokens'], ['cacheRead', 'cache_read_input_tokens'], ['cacheWrite', 'cache_creation_input_tokens']]) {
        if (Number.isInteger(u[f]) && u[f] >= 0) tokens[k] = u[f];
      }
      const usage = { source: 'reported', sourceLabel: 'claude transcript costUSD', costUsd: o.costUSD };
      if (Object.keys(tokens).length) usage.tokens = tokens;
      out.push(base(selfAgent, ts, `${hashHex(String(o.uuid ?? o.requestId))}:usage`, { kind: 'usage', usage }));
    }
    const content = o.message?.content;
    if (!Array.isArray(content)) return;
    if (o.type === 'assistant') {
      for (const it of content) {
        if (it?.type !== 'tool_use') continue;
        const input = it.input ?? {};
        switch (it.name) {
          case 'Bash':
            startCall(it.id, [input.command], ts, out);
            break;
          case 'Edit':
            edit(ts, [{ path: input.file_path, added: lineCount(input.new_string), deleted: lineCount(input.old_string) }], out);
            break;
          case 'MultiEdit':
          {
            const edits = Array.isArray(input.edits) ? input.edits.filter((e) => e && typeof e === 'object') : [];
            edit(ts, [{ path: input.file_path, added: edits.reduce((s, e) => s + lineCount(e.new_string), 0), deleted: edits.reduce((s, e) => s + lineCount(e.old_string), 0) }], out);
          }
            break;
          case 'Write':
            edit(ts, [{ path: input.file_path, added: lineCount(input.content), deleted: 0 }], out);
            break;
          case 'Read':
          case 'NotebookRead':
            ensureAgent(selfAgent, ts, out);
            out.push(base(selfAgent, ts, `${hashHex(String(it.id))}:read`, { kind: 'activity', data: { activity: 'read', basis: 'transcript-tool' } }));
            break;
          case 'Grep':
          case 'Glob':
            ensureAgent(selfAgent, ts, out);
            out.push(base(selfAgent, ts, `${hashHex(String(it.id))}:grep`, { kind: 'activity', data: { activity: 'grep', basis: 'transcript-tool' } }));
            break;
          default:
            break;
        }
      }
    } else if (o.type === 'user') {
      for (const it of content) {
        if (it?.type !== 'tool_result' || !pending.has(it.tool_use_id)) continue;
        const tr = o.toolUseResult && typeof o.toolUseResult === 'object' ? o.toolUseResult : {};
        const text = [tr.stdout, tr.stderr].filter((x) => typeof x === 'string').join('\n') || flattenOutput(it.content).text;
        endCall(it.tool_use_id, { text, isError: it.is_error === true, interrupted: tr.interrupted === true }, ts, out);
      }
    }
  }

  function feedCodex(o, ts, out) {
    const p = o.payload ?? {};
    if (o.type === 'session_meta') {
      sessionId = p.id ?? p.session_id ?? sessionId;
      cwd = p.cwd ?? cwd;
      const parent = p.source?.subagent?.thread_spawn?.parent_thread_id;
      if (parent) parentAgent = agentFor(parent);
      selfAgent = agentFor(sessionId ?? fileKey);
      ensureAgent(selfAgent, ts, out);
      return;
    }
    if (o.type === 'turn_context' && p.cwd) cwd = p.cwd;
    if (o.type === 'turn_context' && typeof p.model === 'string') noteModel(p.model, ts, out);
    if (!selfAgent) selfAgent = agentFor(sessionId ?? fileKey);
    if (o.type !== 'response_item') return;
    if (p.type === 'custom_tool_call' || p.type === 'function_call' || p.type === 'local_shell_call') {
      let commands = [];
      let patches = [];
      if (p.name === 'apply_patch' && typeof p.input === 'string') patches = [p.input];
      else if (typeof p.input === 'string') ({ commands, patches } = extractCodexCalls(p.input));
      else if (typeof p.arguments === 'string') {
        try {
          const a = JSON.parse(p.arguments);
          const c = a.cmd ?? a.command;
          if (c) commands = [Array.isArray(c) ? c.join(' ') : String(c)];
        } catch {
          /* not JSON */
        }
      } else if (p.action?.command) commands = [[].concat(p.action.command).join(' ')];
      for (const patch of patches) edit(ts, parsePatch(patch), out);
      if (commands.length) startCall(p.call_id ?? p.id, commands.map((c) => c.replace(/^(?:bash|zsh|sh)\s+-l?c\s+/, '')), ts, out);
      return;
    }
    if ((p.type === 'custom_tool_call_output' || p.type === 'function_call_output' || p.type === 'local_shell_call_output') && pending.has(p.call_id)) {
      const { text, codes } = flattenOutput(p.output);
      endCall(p.call_id, { text, isError: codes.length ? codes.some((c) => c !== 0) : null, interrupted: false }, ts, out);
    }
  }

  return {
    feed(o) {
      const out = [];
      if (!o || typeof o !== 'object') return out;
      const ts = Date.parse(o.timestamp ?? o.payload?.timestamp);
      if (!Number.isFinite(ts)) return out;
      if (source === 'claude') feedClaude(o, ts, out);
      else feedCodex(o, ts, out);
      return out;
    },
    get agent() {
      return selfAgent;
    },
  };
}

// ---------- file walking and tailing ----------

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function readHeadLine(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const s = buf.subarray(0, n).toString('utf8');
    const i = s.indexOf('\n');
    return i > 0 ? s.slice(0, i) : null;
  } finally {
    fs.closeSync(fd);
  }
}

export function createWatcher({ sources, backfillMs, stateFile, projectLabels = true, modelNames = true, maxChunk = 16 * 1024 * 1024 }) {
  let state = { files: {} };
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    /* fresh */
  }
  const parsers = new Map();

  function parserFor(file, source) {
    let p = parsers.get(file);
    if (!p) {
      p = createSessionParser({ source, fileKey: hashHex(file), projectLabels, modelNames });
      parsers.set(file, p);
      // Resuming mid-file: replay the first line so session metadata (Codex cwd, ids) is known.
      if ((state.files[file]?.offset ?? 0) > 0) {
        const head = readHeadLine(file);
        if (head) {
          try {
            p.feed(JSON.parse(head));
          } catch {
            /* ignore */
          }
        }
      }
    }
    return p;
  }

  /** Scan all files once; returns { events, commit } where commit() persists offsets. */
  function scan(now = Date.now()) {
    const events = [];
    const next = {};
    for (const { source, dir } of sources) {
      for (const file of walk(dir)) {
        let st;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        const prev = state.files[file];
        if (!prev && now - st.mtimeMs > backfillMs) continue;
        let offset = prev?.offset ?? 0;
        if (st.size < offset) offset = 0; // truncated or replaced
        if (st.size === offset) continue;
        const len = Math.min(st.size - offset, maxChunk);
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        fs.closeSync(fd);
        const lastNl = buf.lastIndexOf(10);
        if (lastNl < 0) {
          if (len === maxChunk) next[file] = { offset: offset + len }; // giant single line: skip it
          continue;
        }
        const text = buf.subarray(0, lastNl).toString('utf8');
        const parser = parserFor(file, source);
        // Older than the backfill window: keep identity (hello, spawn) and the
        // latest cumulative edit snapshot per agent, drop the rest.
        const lateSnapshots = new Map();
        for (const line of text.split('\n')) {
          if (!line) continue;
          let o;
          try {
            o = JSON.parse(line);
          } catch {
            continue;
          }
          let evs;
          try {
            evs = parser.feed(o);
          } catch {
            continue; // one malformed line never stops the watcher
          }
          for (const ev of evs) {
            if (prev || now - ev.ts <= backfillMs || ev.kind === 'agent.hello' || ev.kind === 'agent.spawn') events.push(ev);
            else if (ev.kind === 'diff.snapshot') lateSnapshots.set(ev.agent, ev);
          }
        }
        events.push(...lateSnapshots.values());
        next[file] = { offset: offset + lastNl + 1 };
      }
    }
    return {
      events,
      progressed: Object.keys(next).length > 0,
      commit() {
        Object.assign(state.files, next);
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify(state));
      },
    };
  }

  return { scan };
}

async function post(url, events) {
  for (let i = 0; i < events.length; i += 400) {
    const r = await fetch(`${url}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: events.slice(i, i + 400) }), signal: AbortSignal.timeout(5000) });
    if (!r.ok && r.status !== 400) throw new Error(`server answered ${r.status}`);
  }
}

async function main() {
  const arg = (n, d) => {
    const i = process.argv.indexOf(n);
    return i > -1 ? process.argv[i + 1] : d;
  };
  const log = (lvl, msg) => console.log(`${new Date().toISOString()} | ${lvl} | ${msg}`);
  const url = process.env.OVERFIT_URL || 'http://127.0.0.1:4377';
  const home = os.homedir();
  const sources = [
    { source: 'claude', dir: process.env.OVERFIT_CLAUDE_DIR || path.join(home, '.claude/projects') },
    { source: 'codex', dir: process.env.OVERFIT_CODEX_DIR || path.join(home, '.codex/sessions') },
  ];
  const watcher = createWatcher({
    sources,
    backfillMs: Number(arg('--backfill-hours', 6)) * 3600_000,
    stateFile: path.resolve(ROOT, process.env.OVERFIT_DATA_DIR || 'data', 'watch-state.json'),
    projectLabels: process.env.OVERFIT_PROJECT_LABELS !== '0',
    modelNames: process.env.OVERFIT_MODEL_NAMES !== '0',
  });
  const once = process.argv.includes('--once');
  const interval = Math.max(500, Number(arg('--interval', 2000)));
  log('INFO', `watching ${sources.map((s) => s.source).join(' + ')} transcripts (read-only), posting to ${url}`);
  for (;;) {
    const { events, commit, progressed } = watcher.scan();
    if (events.length) {
      try {
        await post(url, events);
        commit();
        const runs = events.filter((e) => e.kind === 'run.end').length;
        log('INFO', `sent ${events.length} events (${runs} test runs)`);
      } catch (err) {
        log('WARN', `gym not reachable (${err.message}); will retry`);
      }
    } else commit();
    if (once && !progressed) break; // --once still drains large files chunk by chunk
    if (once) continue;
    await new Promise((r) => setTimeout(r, interval));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
