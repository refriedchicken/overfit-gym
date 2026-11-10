// DOM side of the gym: roster, inspector, metrics, feed, labels, captions.
import { agentMetrics, formatRatio, globalMetrics } from '/core/metrics.js';
import { GEAR } from '/core/evolution.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export const ACTIVITY_TEXT = {
  bench: 'lifting',
  fail: 'dropped it',
  stalled: 'stalled',
  wobble: 'wobbling',
  treadmill: 'treadmill',
  coordinated: 'integration',
  celebrate: 'flexing',
  slump: 'recovering',
  spotting: 'spotting',
  machine: 'the machine',
  idle: 'resting',
  lint: 'lint pulldown',
  format: 'foam rolling',
  typecheck: 'type-check yoga',
  build: 'build bulk',
  push: 'git push-ups',
  pull: 'git pull-ups',
  commit: 'commit crunches',
  rebase: 'squash squats',
  revert: 'rollback rowing',
  diff: 'diff dips',
  pr: 'lat pull request',
  merge: 'PR bell',
  ci: 'CI spin class',
  install: 'dep burpees',
  benchmark: 'benchmark press',
  coverage: 'coverage weigh-in',
  docker: 'box jumps',
  grep: 'grep grip',
  read: 'reading rack',
  edit: 'production code',
  'write-tests': 'writing tests',
};

function fmtNum(n) {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
export function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function pct(x) {
  return x === null ? 'n/a' : `${Math.round(x * 100)}%`;
}

export function renderRoster(views, selected, onSelect, onFloor = null) {
  const ul = $('roster');
  const floor = onFloor ? views.filter((v) => onFloor.has(v.id)) : views;
  const locker = onFloor ? views.filter((v) => !onFloor.has(v.id)) : [];
  $('agentCount').textContent = views.length ? `${floor.length}${locker.length ? ` + ${locker.length} in the locker room` : ''}` : '';
  const ordered = [...floor, ...locker.sort((a, b) => b.agent.lastTs - a.agent.lastTs).slice(0, 12)];
  const html = ordered
    .map((v) => {
      const m = v.metrics;
      const away = onFloor && !onFloor.has(v.id);
      return `<li data-id="${esc(v.id)}" class="${v.id === selected ? 'sel' : ''}${away ? ' away' : ''}">
        <span class="sw" style="background:${hex(v.look.shirt)}"></span>
        <span class="nm">${esc(v.label)}${v.helper ? ' <span class="muted">helper</span>' : ''}</span>
        <span class="chip k-${away ? 'idle' : v.kind}">${away ? 'locker room' : ACTIVITY_TEXT[v.kind] ?? v.kind}</span>
        ${v.agent.modelName || v.agent.project ? `<span class="meta" title="Real model and project folder, as reported by the session">${[v.agent.modelName, v.agent.project].filter(Boolean).map(esc).join(' · ')}</span>` : ''}
        <span class="sub"><span>${fmtNum(m.executions)} reps</span><span>${m.unique} unique</span><span>${m.reruns} reruns</span></span>
      </li>`;
    })
    .join('');
  if (ul.dataset.html !== html) {
    ul.innerHTML = html || '<li class="muted">Nobody here yet.</li>';
    ul.dataset.html = html;
    ul.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => onSelect(li.dataset.id)));
  }
}

function ratioBlock(r, label) {
  const def =
    r.state === 'ok'
      ? `${r.numerator} executions / ${r.denominator} production lines (+/-) across ${r.prodFiles} file${r.prodFiles === 1 ? '' : 's'}`
      : r.state === 'no-prod-change'
        ? 'A diff was observed but no production lines changed.'
        : 'No git diff snapshot observed, so the denominator is unknown.';
  const excl = r.state === 'unknown' ? '' : ` Excluded: test ${r.breakdown.test}, docs ${r.breakdown.docs}, generated ${r.breakdown.generated}, unknown ${r.breakdown.unknown}.`;
  return `<div class="metric wide"><div class="v">${esc(formatRatio(r))}</div><div class="l">${label}</div><div class="def">${esc(def + excl)}</div></div>`;
}

/** Headline lampoon stat: test lines written vs production lines, with the same honesty states. */
function testLineBlock(r) {
  if (r.state === 'unknown') return `<div class="metric wide headline"><div class="v">n/a</div><div class="l">test lines written per production line</div><div class="def">No edits or diffs observed yet.</div></div>`;
  const v = r.state === 'ok' ? (r.testLineRatio >= 10 ? r.testLineRatio.toFixed(0) : r.testLineRatio.toFixed(2)) : 'n/a';
  const max = Math.max(1, r.testLines, r.denominator);
  return `<div class="metric wide headline"><div class="v">${v}</div><div class="l">test lines written per production line</div>
    <div class="bars"><span class="bar t" style="width:${(r.testLines / max) * 100}%"></span><span class="bl">tests ${r.testLines}</span>
    <span class="bar p" style="width:${(r.denominator / max) * 100}%"></span><span class="bl">production ${r.denominator}</span></div></div>`;
}

const fmtUsd = (n) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

/**
 * Cost/time overlay. Returns '' unless some event carried a sourced cost.
 * Reported and estimated figures are separate rows; estimates carry an EST badge.
 */
export function usageBlock(u, scope) {
  if (!u) return '';
  const row = (src, label) => {
    const x = u[src];
    if (!x) return '';
    const est = src === 'estimate';
    const time = x.durationMs ? ` · ${fmtDur(x.durationMs)} reported time` : '';
    return `<div class="uline"><span class="uv">${fmtUsd(x.costUsd)}</span>${est ? ' <span class="est" title="Estimated, not reported by the agent">EST</span>' : ''} <span class="muted">${label}${time}</span>
      <div class="def">Source: ${esc(x.labels.join(', '))}</div></div>`;
  };
  return `<div class="metric wide usage"><div class="l">${scope} cost (sourced usage only)</div>${row('reported', 'reported')}${row('estimate', 'estimated')}
    <div class="def">Active span ${fmtDur(u.spanMs)} from event timestamps. Reported and estimated are never added together.</div></div>`;
}

export function renderGlobal(state) {
  const g = globalMetrics(state);
  const el = $('globalMetrics');
  const html = `
    <div class="metric"><div class="v">${fmtNum(g.executions)}</div><div class="l">test executions (reps)</div></div>
    <div class="metric"><div class="v">${fmtNum(g.unique)}</div><div class="l">unique test cases</div></div>
    <div class="metric"><div class="v">${g.runs}</div><div class="l">runner invocations</div></div>
    <div class="metric"><div class="v">${g.reruns} <small class="muted">/ ${g.treadmill}</small></div><div class="l">reruns / with no code change</div></div>
    <div class="metric"><div class="v">${g.retries} <small class="muted">/ ${g.flaky}</small></div><div class="l">retries / flaky (fail then pass)</div></div>
    <div class="metric"><div class="v">${pct(g.passRate)}</div><div class="l">pass rate (pass / pass+fail)</div></div>
    ${testLineBlock(g.ratio)}
    ${ratioBlock(g.ratio, 'test executions per changed production line')}
    ${usageBlock(g.usage, 'Gym')}`;
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
  return g;
}

export function renderInspector(view, state) {
  const el = $('inspector');
  if (!view) {
    const html = '<p class="muted">Click an athlete or a name on the floor list.</p>';
    if (el.dataset.html !== html) el.innerHTML = el.dataset.html = html;
    return;
  }
  const a = state.agents.get(view.id);
  const m = agentMetrics(a);
  const gear = GEAR.filter((g) => view.look.gear.includes(g.id));
  const parent = a.parent ? state.agents.get(a.parent) : null;
  const html = `
    <div class="who"><b>${esc(view.label)}</b><span class="chip k-${view.kind}">${ACTIVITY_TEXT[view.kind] ?? view.kind}</span></div>
    ${a.modelName || a.project ? `<dl class="ident">${a.modelName ? `<dt>Model</dt><dd>${esc(a.modelName)}</dd>` : ''}${a.project ? `<dt>Project</dt><dd>${esc(a.project)}</dd>` : ''}</dl>` : ''}
    <div class="muted">${esc(view.look.rank)}${parent ? ` · helper of ${esc(parent.label)}` : ''}${a.children.length ? ` · ${a.children.length} helper${a.children.length > 1 ? 's' : ''}` : ''}</div>
    <dl>
      <dt>Executions (unique)</dt><dd>${m.executions} (${m.unique})</dd>
      <dt>Repeat executions</dt><dd>${m.repeats}</dd>
      <dt>Pass / fail / skip</dt><dd>${m.pass} / ${m.fail} / ${m.skip}</dd>
      <dt>Runs / reruns / no-change</dt><dd>${m.runs} / ${m.reruns} / ${m.treadmill}</dd>
      <dt>Retries / flaky</dt><dd>${m.retries} / ${m.flaky}</dd>
      <dt>Integration-tagged (heuristic)</dt><dd>${m.integration}</dd>
      <dt>Reported test runtime</dt><dd>${(m.runtimeMs / 1000).toFixed(2)} s</dd>
      <dt>Best pass streak</dt><dd>${m.bestStreak}</dd>
      <dt>Muscle / fatigue</dt><dd>${Math.round(view.look.muscle * 100)} / ${Math.round(view.look.fatigue * 100)}</dd>
    </dl>
    <div class="metrics">${ratioBlock(m.ratio, 'executions per changed production line')}</div>
    ${m.usage ? `<div class="metrics">${usageBlock(m.usage, 'Agent')}</div>` : ''}
    ${gear.length ? `<div class="gear">${gear.map((g) => `<span title="${esc(g.why)}">${esc(g.label)}</span>`).join('')}</div>` : ''}
    ${view.look.machine ? `<div class="note">The Machine (${esc(view.look.machine.basis)}): ${view.look.machine.prodFiles} production files, ${view.look.machine.prodChurn} lines, ${view.look.machine.testChurn} test lines.</div>` : ''}
    ${Object.keys(m.activities).length ? `<div class="gear">${Object.entries(m.activities).sort((x, y) => y[1] - x[1]).map(([k, c]) => `<span title="${esc(k)}">${esc(ACTIVITY_TEXT[k === 'edit-test' ? 'edit' : k] ?? k)}${k === 'edit-test' ? ' (tests)' : ''} ×${c}</span>`).join('')}</div>` : ''}
    ${m.summaryExecutions ? `<div class="note">${m.summaryExecutions} of ${m.executions} executions are counted from runner summary lines in agent transcripts (no per-test names).</div>` : ''}
    <div class="note">Runtime is the sum of per-test durations the runner reported, not wall-clock or cost.</div>`;
  if (el.dataset.html !== html) el.innerHTML = el.dataset.html = html;
}

function feedLine(ev, state) {
  const a = state.agents.get(ev.agent);
  const who = a ? a.label : ev.agent;
  switch (ev.kind) {
    case 'test.result':
      return { d: ev.status === 'fail' ? 'fail' : ev.status === 'pass' ? ((ev.attempt ?? 1) > 1 ? 'retry' : 'pass') : '', who, txt: `${ev.status}${(ev.attempt ?? 1) > 1 ? ` (attempt ${ev.attempt})` : ''}: ${ev.test.name}` };
    case 'run.start':
      return { d: 'run', who, txt: `started a test run${ev.data?.command_class ? ` (${ev.data.command_class})` : ''}` };
    case 'run.end': {
      const c = ev.data?.counts;
      const counts = c ? ` (${c.pass} pass, ${c.fail} fail${c.skip ? `, ${c.skip} skip` : ''}, from ${ev.data.counts_parser ?? 'summary'})` : '';
      return { d: ev.status === 'fail' ? 'fail' : 'run', who, txt: `run ended: ${ev.status ?? 'outcome not seen'}${counts}` };
    }
    case 'suite.end':
      return { d: ev.status === 'fail' ? 'fail' : 'run', who, txt: `set done: ${ev.suite ?? 'suite'} (${ev.status})` };
    case 'diff.snapshot': {
      const c = ev.data.categories.production ?? { added: 0, deleted: 0 };
      return { d: 'diff', who, txt: `diff: +${c.added} / -${c.deleted} production lines` };
    }
    case 'agent.spawn':
      return { d: 'spawn', who, txt: 'called in a spotter (helper agent)' };
    case 'agent.hello':
      return { d: '', who, txt: 'walked in' };
    case 'agent.say':
      return { d: 'spawn', who, txt: `"${ev.data.text}"` };
    case 'usage':
      return { d: '', who, txt: 'usage record' };
    case 'activity': {
      const id = ev.data.activity;
      const name = ACTIVITY_TEXT[id === 'edit-test' ? 'write-tests' : id] ?? id;
      const extra = ev.data.force ? ' (--force)' : '';
      return { d: ev.status === 'fail' ? 'fail' : id === 'edit' || id === 'edit-test' ? 'diff' : 'run', who, txt: `${name}${extra}${ev.status === 'fail' ? ', failed' : ''}` };
    }
    default:
      return { d: '', who, txt: ev.kind };
  }
}

export function renderFeed(state) {
  const el = $('feed');
  // Transcript edit snapshots duplicate the "editing" line right next to them.
  const items = state.feed.filter((ev) => ev.kind !== 'usage').filter((ev) => !(ev.kind === 'diff.snapshot' && ev.data?.basis === 'transcript-edits')).slice(-40).reverse();
  const html = items
    .map((ev) => {
      const f = feedLine(ev, state);
      return `<li><span class="d ${f.d}"></span><span class="txt"><span class="who">${esc(f.who)}</span> ${esc(f.txt)}</span></li>`;
    })
    .join('');
  if (el.dataset.html !== html) el.innerHTML = el.dataset.html = html;
}

/** Name tags and caption bubbles positioned over the canvas. */
export function renderLabels(anchors, viewsById, captions, selected, onSelect) {
  const layer = $('labels');
  const seen = new Set();
  for (const an of anchors) {
    const v = viewsById.get(an.id);
    if (!v) continue;
    seen.add(an.id);
    let tag = layer.querySelector(`.tag[data-id="${CSS.escape(an.id)}"]`);
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'tag';
      tag.dataset.id = an.id;
      tag.innerHTML = '<span class="nm"></span><span class="chip"></span>';
      tag.addEventListener('click', () => onSelect(an.id));
      layer.appendChild(tag);
    }
    tag.classList.toggle('helper', v.helper);
    // Content mode keeps only the tag of whoever is captioned or selected.
    tag.classList.toggle('quiet', v.id !== selected && !captions.some((c) => c.agent === an.id));
    tag.style.left = `${an.x}px`;
    tag.style.top = `${an.y}px`;
    tag.style.setProperty('--c', hex(v.look.shirt));
    tag.style.zIndex = v.id === selected ? 10 : 1;
    const nm = tag.querySelector('.nm');
    const label = v.kind === 'stalled' ? `${v.label} · quiet ${Math.round(v.quietMs / 1000)}s` : v.label;
    if (nm.textContent !== label) nm.textContent = label;
    const chip = tag.querySelector('.chip');
    const text = v.kind === 'bench' && v.runReps ? `rep ${v.runReps}` : ACTIVITY_TEXT[v.kind] ?? v.kind;
    if (chip.textContent !== text) chip.textContent = text;
    chip.className = `chip k-${v.kind}`;

    const cap = captions.find((c) => c.agent === an.id);
    let bub = tag.querySelector('.bubble');
    if (cap) {
      if (!bub || bub.dataset.key !== `${cap.ts}`) {
        bub?.remove();
        bub = document.createElement('div');
        bub.className = `bubble${cap.heuristic ? ' heuristic' : ''}`;
        bub.dataset.key = `${cap.ts}`;
        bub.textContent = cap.text;
        bub.style.left = '50%';
        bub.style.top = '0';
        tag.appendChild(bub);
      }
    } else bub?.remove();
  }
  layer.querySelectorAll('.tag').forEach((t) => {
    if (!seen.has(t.dataset.id)) t.remove();
  });
}
