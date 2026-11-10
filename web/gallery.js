// Station gallery: one clanker at every station with fake view models, for
// checking poses and props. Nothing here is telemetry.
// Query: ?kind=<k> focus one station, ?t=<ms> freeze time, ?yaw= ?elev= ?r= camera,
// ?clean=1 hide the overlay list and tags.
// ?cast=1 swaps the pose cast for the six model identities (vendor kit, jersey number,
// pecking-order height): alone it lines them up on the open floor; with ?kind=<k> it sends
// them to that station. ?who=0,5 picks identities (0 = the 1.45 giant ... 5 = the 0.84 one),
// ?speak=<i>|all marks who is talking, ?arch=<archetype> forces one body type, ?muscle=0..1.
import * as THREE from 'three';
import { ARCHETYPES, GEAR } from '/core/evolution.js';
import { createWorld } from './scene/world.js';
import { createRobot } from './scene/robot.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('gym');
const world = createWorld(canvas);
// for headless checks: quality tier, draw calls and triangles of the last frame
window.__gymStats = () => world.stats?.();
if (params.get('clean') === '1') document.body.classList.add('clean');

const SKIN = [0xc9ced6, 0x9aa3b0, 0xe8c07a, 0x7fb3c8, 0xd98c6c, 0xb8a5d9];
const SHIRT = [0x2ec4b6, 0xff6b35, 0x9b5de5, 0x00bbf9, 0xf15bb5, 0xfee440, 0x8ac926, 0xef476f];
const SHORTS = [0x1d1f26, 0x26324d, 0x3b2a4d, 0x2c3e2f, 0x4a2b2b, 0x0f3b46];
const BAND = [0xff4d4d, 0xffb238, 0x59f0d2, 0xf15bb5, 0x7cf29a, 0xffffff];
const SHOES = [0xf2f2f2, 0x7cf29a, 0xff6b35, 0x00bbf9, 0xfee440, 0x9b5de5];

// [kind, variant]
const CAST = [
  ['bench'],
  ['fail'],
  ['stalled'],
  ['celebrate'],
  ['slump'],
  ['write-tests'],
  ['write-tests'],
  ['write-tests'],
  ['treadmill', 'writing'],
  ['treadmill'],
  ['wobble'],
  ['coordinated', 'parent'],
  ['coordinated'],
  ['spotting', 'helper'],
  ['spotting', 'helper'],
  ['machine'],
  ['idle'],
  ['idle'],
  ['edit'],
  ['edit'],
  ['merge'],
  ['lint'],
  ['ci'],
  ['push'],
  ['build'],
  ['read'],
  ['typecheck'],
];

function lookFor(i, kind) {
  const muscle = [0.1, 0.45, 0.8, 1][i % 4];
  const fatigue = kind === 'stalled' || kind === 'slump' || kind === 'fail' ? 0.85 : [0, 0.2, 0.5][i % 3];
  return {
    archetype: ARCHETYPES[i % ARCHETYPES.length],
    outfit: { top: SHIRT[(i * 3) % SHIRT.length], shorts: SHORTS[i % SHORTS.length], headband: BAND[(i * 5) % BAND.length], shoes: SHOES[(i * 7) % SHOES.length] },
    skin: SKIN[(i * 5) % SKIN.length],
    shirt: SHIRT[(i * 3) % SHIRT.length],
    height: 0.95 + (i % 11) / 100,
    muscle,
    fatigue,
    bicep: 1 + muscle * 1.8,
    chest: 1 + muscle * 0.55,
    slump: kind === 'idle' || kind === 'stalled' ? fatigue * 0.35 : 0,
    sweat: Math.round(fatigue * 8),
    gear: GEAR.map((g) => g.id).filter((_, k) => (i + k) % 3 === 0),
    machine: kind === 'machine',
    rank: 'Gym Rat',
    isHelper: false,
  };
}

// ---------- the six identities (mirrors src/core/identity.js; fake, for checking only) ----------
const KITS = {
  anthropic: { skin: 0xe9dcc6, top: 0xd97757, shorts: 0x2a211c, headband: 0xd97757, shoes: 0xf4efe6 },
  openai: { skin: 0xd5dde8, top: 0x2f6bff, shorts: 0x16203a, headband: 0xffffff, shoes: 0xe8f0ff },
  google: { skin: 0xf1f3f4, top: 0x4285f4, shorts: 0xea4335, headband: 0xfbbc05, shoes: 0x34a853 },
  xai: { skin: 0x1d1d1f, top: 0xf2f2f2, shorts: 0x101012, headband: 0xf2f2f2, shoes: 0xf2f2f2 },
};
const IDENT = [
  ['anthropic', '5.2', 1.45, 'powerbuilder'],
  ['anthropic', '5.5', 1.28, 'crossfit'],
  ['openai', '6', 1.14, 'cardio'],
  ['openai', '6.1', 1.04, 'rookie'],
  ['google', '4', 0.94, 'yogi'],
  ['xai', '4.7', 0.84, 'rookie'],
];
const castMode = params.get('cast') === '1';
const speakP = params.get('speak');
function identLook(i, kind) {
  const [vendor, jersey, height, arch] = IDENT[i];
  const k = KITS[vendor];
  const muscle = params.has('muscle') ? Number(params.get('muscle')) : [0.7, 0.5, 0.3, 0.2, 0.35, 0.15][i];
  const fatigue = kind === 'stalled' || kind === 'slump' || kind === 'fail' ? 0.85 : 0.1;
  return {
    archetype: params.get('arch') ?? arch,
    outfit: { top: k.top, shorts: k.shorts, headband: k.headband, shoes: k.shoes },
    skin: k.skin,
    shirt: k.top,
    height,
    vendor,
    jersey,
    speaking: speakP === 'all' || (speakP !== null && Number(speakP) === i),
    muscle,
    fatigue,
    bicep: 1 + muscle * 1.8,
    chest: 1 + muscle * 0.55,
    slump: 0,
    sweat: Math.round(fatigue * 8),
    gear: params.get('gear') === '0' ? [] : GEAR.map((g) => g.id).filter((_, n) => (i + n) % 3 === 0),
    machine: kind === 'machine',
    rank: 'Gym Rat',
    isHelper: false,
  };
}
const WHO = (params.get('who') ?? '0,5').split(',').map(Number).filter((i) => IDENT[i]);
const castKind = params.get('kind');
const castLooks = WHO.map((i) => identLook(i, castKind));
function castViews(now) {
  if (!castKind) return [];
  return WHO.map((w, n) => {
    const kind = castKind;
    const repPeriod = kind === 'fail' ? 2400 : 1700;
    return {
      id: `c${w}`,
      label: IDENT[w][1],
      look: castLooks[n],
      kind,
      helper: false,
      parentId: null,
      helperIndex: 0,
      repAge: ['bench', 'fail', 'coordinated', 'wobble', 'machine'].includes(kind) ? (now + (kind === 'coordinated' ? 0 : n * 237)) % repPeriod : null,
      repStatus: kind === 'fail' ? 'fail' : 'pass',
      runReps: 12 + n,
      runFails: kind === 'fail' ? 2 : 0,
      quietMs: kind === 'stalled' ? 42000 : 0,
      selected: false,
      activity: { id: kind === 'write-tests' ? 'edit-test' : kind, ageMs: params.has('age') ? Number(params.get('age')) : 4000 + ((now + n * 911) % 2000), count: 5 + n, status: 'pass' },
      whiteboard: kind === 'treadmill' ? { testLines: 17, writing: params.get('wb') !== '0' } : null,
    };
  });
}
// the lineup: robots built directly, standing on the open floor in front of the press row
const lineup = [];
if (castMode && !castKind) {
  IDENT.forEach((_, i) => {
    const look = identLook(i, 'wait');
    const robot = createRobot(look);
    robot.root.position.set(-4.9 + i * 1.5 + (i > 1 ? -0.3 : 0), 0, 6.0);
    world.scene.add(robot.root);
    lineup.push({ robot, look });
  });
}

const looks = CAST.map(([kind], i) => lookFor(i, kind));
const parentIndex = CAST.findIndex(([, v]) => v === 'parent');

const limit = params.has('n') ? Number(params.get('n')) : Infinity;

function viewsAt(now) {
  if (castMode) return castViews(now);
  let helperN = 0;
  return CAST.slice(0, limit).map(([kind, variant], i) => {
    const id = `g${i}-${kind}`;
    const helper = variant === 'helper';
    const repPeriod = kind === 'fail' ? 2400 : 1700;
    const repAge = (now + i * 237) % repPeriod;
    const repStatus = kind === 'fail' ? 'fail' : kind === 'bench' && Math.floor(now / 1700) % 4 === 3 ? 'fail' : 'pass';
    return {
      id,
      label: kind,
      look: helper ? { ...looks[i], isHelper: true } : looks[i],
      kind,
      helper,
      parentId: helper ? `g${parentIndex}-coordinated` : null,
      helperIndex: helper ? helperN++ : 0,
      repAge: ['bench', 'fail', 'coordinated', 'wobble', 'machine'].includes(kind) ? repAge : null,
      repStatus,
      runReps: 12 + i,
      runFails: kind === 'fail' ? 2 : 0,
      quietMs: kind === 'stalled' ? 42000 : 0,
      selected: params.get('select') === kind && i === CAST.findIndex(([k]) => k === kind),
      activity: { id: kind === 'write-tests' ? 'edit-test' : kind, ageMs: (now + i * 911) % 6000, count: kind === 'write-tests' ? 2 + (i % 3) * 3 : 3 + i, force: variant === 'force', status: variant === 'fail' ? 'fail' : 'pass' },
      whiteboard: kind === 'treadmill' ? { testLines: variant === 'writing' ? 17 : 0, writing: variant === 'writing' } : null,
    };
  });
}

// ---------- camera ----------

// keep in step with web/director.js HOME / CENTER
const CENTER = new THREE.Vector3(0.9, 0.4, -2.0);
const WIDE = { yaw: 0.6, elev: 0.66, radius: 43.5 };
const cam = { ...WIDE, target: CENTER.clone() };
const stations = world.stationInfo();
const FOCUS_YAW = { treadmill: Math.PI / 2 + 0.35, wobble: 0.35, 'write-tests': 0.3, lounge: 0.45, merge: 0.45, idle: 1.9, edit: 1.2 };
const stationFor = (kind) => stations.find((x) => x.kind === kind) ?? (['fail', 'stalled', 'celebrate', 'slump'].includes(kind) ? stations.find((x) => x.kind === 'bench') : kind && kind !== 'spotting' ? stations.find((x) => x.kind === 'lounge') : null);

function focus(kind) {
  const s = stationFor(kind);
  if (!s) {
    Object.assign(cam, WIDE);
    cam.target.copy(CENTER);
  } else {
    const slotX = kind === 'fail' ? 1 : kind === 'stalled' ? 2 : kind === 'celebrate' ? 3 : kind === 'slump' ? 4 : 0;
    cam.target.set(s.x + slotX * 2.2, 1.0, s.z);
    cam.yaw = FOCUS_YAW[s.kind === kind ? kind : s.kind] ?? s.yaw + 0.55;
    if (s.kind === 'lounge' || s.kind === 'write-tests') cam.target.x += s.kind === 'lounge' ? 1.7 : 3.9;
    cam.elev = 0.55;
    cam.radius = 5.2;
  }
  if (castMode && !s) {
    cam.target.set(-1.55, 1.2, 6.0);
    cam.yaw = 0.1;
    cam.elev = 0.1;
    cam.radius = 13;
  }
  if (params.has('yaw')) cam.yaw = Number(params.get('yaw'));
  if (params.has('elev')) cam.elev = Number(params.get('elev'));
  if (params.has('r')) cam.radius = Number(params.get('r'));
  if (params.has('tx')) cam.target.set(Number(params.get('tx')), Number(params.get('ty') ?? 0.8), Number(params.get('tz') ?? 0));
  document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.kind === kind));
}

function place() {
  const c = world.camera;
  c.position.set(cam.target.x + Math.sin(cam.yaw) * Math.cos(cam.elev) * cam.radius, cam.target.y + Math.sin(cam.elev) * cam.radius, cam.target.z + Math.cos(cam.yaw) * Math.cos(cam.elev) * cam.radius);
  c.lookAt(cam.target);
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.yaw -= (e.clientX - drag.x) * 0.005;
  cam.elev = Math.min(1.4, Math.max(0.05, cam.elev + (e.clientY - drag.y) * 0.004));
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    cam.radius = Math.min(70, Math.max(2, cam.radius * (1 + Math.sign(e.deltaY) * 0.08)));
  },
  { passive: false },
);

// ---------- overlay ----------

const list = document.getElementById('list');
const wide = document.createElement('button');
wide.textContent = 'Wide shot';
wide.dataset.kind = '';
wide.onclick = () => focus('');
list.append(wide);
for (const [kind] of CAST.filter(([k], i, a) => a.findIndex(([x]) => x === k) === i)) {
  const s = stationFor(kind);
  const b = document.createElement('button');
  b.dataset.kind = kind;
  b.innerHTML = `${kind} <small>${s ? s.name.toLowerCase() : 'around the parent'}</small>`;
  b.onclick = () => {
    focus(kind);
    const p = new URLSearchParams(location.search);
    p.set('kind', kind);
    history.replaceState(null, '', `?${p}`);
  };
  list.append(b);
}
const tags = document.getElementById('tags');
const tagEls = new Map();

function resize() {
  world.resize(canvas.clientWidth, canvas.clientHeight);
}
window.addEventListener('resize', resize);
resize();
focus(params.get('kind') ?? '');

const frozen = params.has('t') ? Number(params.get('t')) : null;
// ?frames=N stops rendering after N frames (fast headless screenshots)
const maxFrames = params.has('frames') ? Number(params.get('frames')) : Infinity;
let frames = 0;
let last = performance.now();
let first = true;
function frame(t) {
  const dt = Math.min(100, t - last);
  last = t;
  const now = frozen ?? t;
  world.update(now, dt, viewsAt(now), { snap: first, global: { value: '1.0', sub: 'pose gallery: no telemetry', testLines: 2431, prodLines: 16 } });
  first = false;
  for (const { robot, look } of lineup) robot.update(look, now, { kind: params.get('pose') ?? 'wait', queued: !params.has('pose'), speed: 0, repAge: null, repStatus: 'pass' });
  place();
  world.render();
  for (const a of world.anchors(canvas.clientWidth, canvas.clientHeight)) {
    let el = tagEls.get(a.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tag';
      el.textContent = a.id.split('-').slice(1).join('-');
      tags.append(el);
      tagEls.set(a.id, el);
    }
    el.style.left = `${a.x}px`;
    el.style.top = `${a.y}px`;
  }
  if (params.get('stats') === '1' && frames === 1) console.log('STATS', JSON.stringify(world.renderer.info.render), 'objects', world.scene.children.length);
  if (++frames < maxFrames) requestAnimationFrame(frame);
  else {
    // freeze the last frame as an image so headless screenshots capture it
    const img = new Image();
    img.src = canvas.toDataURL('image/png');
    img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
    document.body.insertBefore(img, tags);
  }
}
requestAnimationFrame(frame);
