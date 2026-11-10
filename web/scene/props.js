// Procedural gym equipment. Every prop is built from three.js primitives and
// canvas textures; no external models or images. Station units are built in
// the robot's local frame: the robot stands at the origin facing +z.
// Each unit returns { group, update?(now, o), after?(now, o) } where `o` is the
// occupant ({ v, robot, kind }) or null.
import * as THREE from 'three';
import { PALETTE, mat, glow, mesh, part, GEO, rbox, canvasTexture, woodTexture, brushedTexture, boost, FONT, MONO, css, dyn, roundRect, F80 } from './materials.js';
import { laminateTexture } from './film80-tex.js';
import { ease, cyc, span, SLOT, SLOT_MS, DIM, actAge } from './rhythm.js';

const PI = Math.PI;
const brushed = (color, rough = 0.32) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 1, roughnessMap: brushedTexture(), envMapIntensity: 1.2 });
const M = {
  frame: mat(0x2b2f37, { rough: 0.42, metal: 0.55 }), // powder-coated steel
  frameDark: mat(0x1d2026, { rough: 0.45, metal: 0.6 }),
  steel: mat(PALETTE.steel, { rough: 0.25, metal: 0.9 }),
  chrome: mat(PALETTE.chrome, { rough: 0.1, metal: 1 }),
  brushed: brushed(0xd9dde3),
  rubber: mat(PALETTE.rubber, { rough: 0.92 }),
  pad: mat(0x1c1d22, { rough: 0.7 }),
  plate: mat(PALETTE.plate, { rough: 0.55, metal: 0.2 }),
  wood: null,
  white: mat(0xf2efe8, { rough: 0.7 }),
  board: mat(0xf4f3ef, { rough: 0.35 }),
  amber: mat(PALETTE.amber, { rough: 0.45, metal: 0.2 }),
  coral: mat(PALETTE.coral, { rough: 0.5 }),
  lime: mat(PALETTE.lime, { rough: 0.5 }),
  violet: mat(PALETTE.violet, { rough: 0.55 }),
  cyan: mat(PALETTE.cyan, { rough: 0.5 }),
  gold: mat(PALETTE.gold, { rough: 0.22, metal: 1 }),
  pass: mat(PALETTE.pass, { rough: 0.45, emissive: 0x1f6b35, ei: 0.7 }),
  fail: mat(PALETTE.fail, { rough: 0.45, emissive: 0x6b1010, ei: 0.7 }),
  rope: mat(0xe8dcc0, { rough: 0.9 }),
  alu: mat(0xd5d9de, { rough: 0.32, metal: 0.85 }),
  blue: mat(0x2f80ed, { rough: 0.4, metal: 0.3 }), // test wing accent paint
  glass: new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, roughness: 0.05, envMapIntensity: 1.5, depthWrite: false }),
};
const woodMat = () => (M.wood ??= new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, color: F80 ? 0xb07a4c : 0xffffff }));
// film80: chrome and black vinyl with a decade of wear, burgundy and teal enamel, red LEDs
if (F80)
  Object.assign(M, {
    frame: mat(0x1b1a1a, { rough: 0.5, metal: 0.5, raw: true }),
    frameDark: mat(0x121111, { rough: 0.55, metal: 0.5, raw: true }),
    chrome: mat(0xd8dbde, { rough: 0.16, metal: 1, raw: true }),
    brushed: brushed(0xb9bcc0, 0.42),
    pad: mat(0x17100f, { rough: 0.45, raw: true }),
    board: mat(0xe6dcc0, { rough: 0.5, raw: true }),
    blue: mat(0x1f6a68, { rough: 0.5, metal: 0.25, raw: true }),
    amber: mat(0xb9862a, { rough: 0.5, metal: 0.3, raw: true }),
    alu: mat(0x9c9588, { rough: 0.45, metal: 0.7, raw: true }),
  });
/** LED / marker / board colours that differ between the looks. */
const INK = F80
  ? { led: ['#ff4a2e', '#ffb02e'], off: '#5a2a20', good: '#ffb02e', wb: '#eee4c4', wbHead: '#7a1f2b', wbTally: '#a8281e', wbText: '#2a211a', wbGhost: 'rgba(110,90,60,0.09)', wbMute: '#8a7d68' }
  : { led: ['#7cf29a', '#ffb238'], off: '#5a5f6a', good: '#7cf29a', wb: '#f6f5f0', wbHead: '#2b5fd9', wbTally: '#d93a2b', wbText: '#16171b', wbGhost: 'rgba(100,110,130,0.06)', wbMute: '#9aa0aa' };

// ---------- shared geometry ----------

const gcache = new Map();
const cached = (key, make) => gcache.get(key) ?? gcache.set(key, make()).get(key);

/** Bumper plate around +y: hub, recessed face, raised rim. Radius r, thickness t. */
function plateGeo(r = 0.22, t = 0.06) {
  return cached(`plate${r}|${t}`, () => {
    const h = t / 2;
    const prof = [
      [0.026, -h * 0.7],
      [0.07, -h * 0.7],
      [0.08, -h * 0.45],
      [r * 0.72, -h * 0.45],
      [r * 0.8, -h],
      [r - 0.012, -h],
      [r, -h * 0.75],
      [r, h * 0.75],
      [r - 0.012, h],
      [r * 0.8, h],
      [r * 0.72, h * 0.45],
      [0.08, h * 0.45],
      [0.07, h * 0.7],
      [0.026, h * 0.7],
      [0.026, -h * 0.7],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(prof, 36);
    g.computeVertexNormals();
    return g;
  });
}

/** Spur gear in the xy plane (extruded along z), with bevelled teeth and lightening holes. */
function gearGeo(r, teeth, depth = 0.07) {
  return cached(`gear${r}|${teeth}|${depth}`, () => {
    const shape = new THREE.Shape();
    const root = r * 0.84;
    const tip = r;
    const n = teeth * 4;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * PI * 2;
      const k = i % 4;
      const rr = k === 1 || k === 2 ? tip : root;
      const da = (k === 1 ? 0.18 : k === 2 ? -0.18 : 0) * ((PI * 2) / n);
      const x = Math.cos(a + da) * rr;
      const y = Math.sin(a + da) * rr;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const hub = new THREE.Path();
    hub.absarc(0, 0, r * 0.12, 0, PI * 2, true);
    shape.holes.push(hub);
    const holes = teeth >= 9 ? 5 : 3;
    for (let i = 0; i < holes; i++) {
      const a = (i / holes) * PI * 2 + 0.3;
      const p = new THREE.Path();
      p.absarc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.16, 0, PI * 2, true);
      shape.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** Little square-hole pattern down a rack upright (transparent decal). */
let holeTex = null;
function rackHoles() {
  holeTex ??= canvasTexture(
    32,
    512,
    (c, w, h) => {
      c.clearRect(0, 0, w, h);
      for (let y = 12; y < h - 8; y += 22) {
        c.fillStyle = 'rgba(10,10,12,0.9)';
        c.fillRect(w / 2 - 5, y, 10, 10);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(w / 2 - 5, y + 10, 10, 1.5);
      }
    },
    { srgb: false },
  );
  return holeTex;
}
let holeMat = null;
const holeMaterial = () => (holeMat ??= new THREE.MeshBasicMaterial({ map: rackHoles(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));

// ---------- small builders ----------

/** LED panel: a dark screen whose canvas is redrawn only when its key changes. */
export function led(parent, w, h, pos, { rot = [0, 0, 0], px = 256, bezel = true, color = 0x0b0c0f, bright = 2.4 } = {}) {
  const cw = px;
  const ch = Math.round((px * h) / w);
  const tex = canvasTexture(cw, ch, null, { aniso: 4 });
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  if (bezel) part(g, rbox(w + 0.06, h + 0.06, 0.05, 0.02), M.frameDark, 1, [0, 0, -0.03]);
  const screen = part(g, GEO.plane, boost(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), bright), [w, h, 1], [0, 0, 0.001], { cast: false });
  screen.userData.keep = true;
  parent.add(g);
  let key = null;
  return {
    group: g,
    tex,
    set(k, draw) {
      if (k === key) return;
      key = k;
      tex.userData.redraw((c, W, H) => {
        c.fillStyle = css(color);
        c.fillRect(0, 0, W, H);
        draw(c, W, H);
      });
    },
  };
}

function ledText(c, W, H, lines, colors = INK.led) {
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((t, i) => {
    const big = i === 0;
    const size = big ? Math.floor(H * (n > 1 ? 0.5 : 0.7)) : Math.floor(H * 0.26);
    c.font = `${big ? '800' : '600'} ${size}px ${big ? FONT : MONO}`;
    c.fillStyle = colors[i] ?? colors[colors.length - 1];
    c.shadowColor = c.fillStyle;
    c.shadowBlur = 8;
    const y = n === 1 ? H / 2 : big ? H * 0.38 : H * 0.8;
    c.fillText(String(t), W / 2, y, W - 16);
  });
  c.shadowBlur = 0;
}

/** A bumper plate standing on its edge (axis along x). */
function plate(parent, m, r, t, pos, rotY = 0) {
  const p = part(parent, plateGeo(r, t), m, 1, pos, { rot: [0, rotY, PI / 2] });
  return p;
}

/** Barbell along x (decor and shared bars). */
export function barbell(length = 1.6, plateMat = M.plate, size = 1) {
  const g = new THREE.Group();
  part(g, GEO.cyl, M.brushed, [0.032, length, 0.032], [0, 0, 0], { rot: [0, 0, PI / 2] });
  const plates = [];
  for (const s of [-1, 1]) {
    part(g, GEO.cyl, M.chrome, [0.058, length * 0.2, 0.058], [s * (length / 2 - length * 0.1), 0, 0], { rot: [0, 0, PI / 2] });
    plates.push(part(g, plateGeo(0.22 * size, 0.07), plateMat, 1, [s * (length / 2 - 0.16), 0, 0], { rot: [0, 0, PI / 2] }));
    plates.push(part(g, plateGeo(0.16 * size, 0.05), plateMat, 1, [s * (length / 2 - 0.1), 0, 0], { rot: [0, 0, PI / 2] }));
    part(g, GEO.cyl, M.steel, [0.08, 0.035, 0.08], [s * (length / 2 - 0.215), 0, 0], { rot: [0, 0, PI / 2], cast: false });
  }
  g.userData.plates = plates;
  return g;
}

export function dumbbell(size = 1, color = PALETTE.plateRim) {
  const g = new THREE.Group();
  part(g, GEO.cyl, M.brushed, [0.035 * size, 0.24 * size, 0.035 * size], [0, 0, 0], { rot: [0, 0, PI / 2] });
  const head = cached(`dbhead`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, 6));
  for (const s of [-1, 1]) part(g, head, mat(color, { rough: 0.5 }), [0.14 * size, 0.08 * size, 0.14 * size], [s * 0.13 * size, 0, 0], { rot: [0, 0, PI / 2] });
  return g;
}

/** Rack upright: powder-coated tube, numbered hole column on the front face, foot plate. */
function upright(parent, x, z, h, w = 0.08, m = M.frame) {
  part(parent, rbox(w, h, w, 0.012, 2), m, 1, [x, h / 2, z]);
  const holes = part(parent, GEO.plane, holeMaterial(), [w * 0.5, h - 0.3, 1], [x, h / 2 + 0.05, z + w / 2 + 0.002], { cast: false });
  holes.renderOrder = 2;
  part(parent, rbox(w + 0.08, 0.02, w + 0.08, 0.008, 1), m, 1, [x, 0.01, z], { cast: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(parent, GEO.cylLo, M.chrome, [0.018, 0.012, 0.018], [x + sx * (w / 2 + 0.025), 0.022, z + sz * (w / 2 + 0.025)], { cast: false });
}

function post(parent, x, z, h, w = 0.08, m = M.frame) {
  return part(parent, rbox(w, h, w, 0.012, 2), m, 1, [x, h / 2, z]);
}

/** Lifting platform: oak centre panel and rubber side tiles, bevelled, with a steel border. */
function platformBase(parent, w, d, z = 0) {
  part(parent, rbox(w + 0.06, 0.05, d + 0.06, 0.015, 2), M.frameDark, 1, [0, 0.025, z], { receive: true, cast: false });
  part(parent, rbox(w * 0.5, 0.055, d - 0.02, 0.01, 2), woodMat(), 1, [0, 0.03, z], { receive: true, cast: false });
  for (const s of [-1, 1]) part(parent, rbox(w * 0.24, 0.056, d - 0.02, 0.01, 2), M.rubber, 1, [s * (w / 2 - w * 0.12), 0.031, z], { receive: true, cast: false });
}

function floorMat(parent, w, d, color, z = 0) {
  return part(parent, rbox(w, 0.03, d, 0.012), mat(color, { rough: 0.85 }), 1, [0, 0.015, z], { receive: true, cast: false });
}

/** Half rack in the robot's frame: rear uprights at z = -0.62, spotter arms, pull-up bar, J-hooks. */
function halfRack(g, half, { hooks = true, storage = true } = {}) {
  const H = 2.15;
  for (const s of [-1, 1]) {
    const x = s * half;
    upright(g, x, -0.62, H);
    // base foot running forward with a brace
    part(g, rbox(0.08, 0.06, 0.95, 0.01, 2), M.frame, 1, [x, 0.04, -0.2]);
    const brace = part(g, rbox(0.05, 0.62, 0.05, 0.01, 1), M.frame, 1, [x, 0.3, -0.4], { rot: [0.72, 0, 0] });
    void brace;
    // J-hook in test-wing amber and a chrome spotter arm
    if (hooks) {
      part(g, rbox(0.07, 0.12, 0.13, 0.015, 1), M.amber, 1, [x, 1.3, -0.52], { cast: false });
      part(g, rbox(0.07, 0.05, 0.05, 0.012, 1), M.amber, 1, [x, 1.36, -0.46], { cast: false });
    }
    part(g, rbox(0.06, 0.06, 0.72, 0.012, 2), M.brushed, 1, [x, 0.92, -0.25]);
    part(g, rbox(0.1, 0.1, 0.1, 0.015, 1), M.frame, 1, [x, 0.92, -0.6], { cast: false });
    // plate storage horn on the back with stored bumpers
    if (storage) {
      part(g, GEO.cyl, M.brushed, [0.06, 0.26, 0.06], [x, 0.42, -0.79], { rot: [PI / 2, 0, 0], cast: false });
      plate(g, s < 0 ? M.pass : M.fail, 0.22, 0.06, [x, 0.42, -0.74 - 0.08], PI / 2);
      plate(g, M.plate, 0.18, 0.05, [x, 0.42, -0.86], PI / 2);
    }
  }
  part(g, rbox(half * 2 + 0.08, 0.08, 0.08, 0.012, 2), M.frame, 1, [0, H, -0.62]);
  // pull-up bar on outriggers
  for (const s of [-1, 1]) part(g, rbox(0.05, 0.05, 0.26, 0.01, 1), M.frame, 1, [s * (half - 0.06), H + 0.02, -0.5], { cast: false });
  part(g, GEO.cyl, M.brushed, [0.034, half * 2 - 0.02, 0.034], [0, H + 0.02, -0.38], { rot: [0, 0, PI / 2] });
  // test-wing blue name plate across the top
  part(g, rbox(0.72, 0.1, 0.02, 0.01, 1), M.blue, 1, [0, H, -0.575], { cast: false });
}

const fmtCount = (o, unit = 'SET') => (o?.v?.activity?.count ? `${unit} ${o.v.activity.count}` : o ? `${unit} --` : 'OPEN');
void fmtCount;

// ---------- units ----------

/** ASSERTION PRESS: platform + half rack with a rep counter. Green plates on pass, red crash on fail (the plates are on the robot's bar). */
export function pressUnit() {
  const g = new THREE.Group();
  platformBase(g, 1.9, 1.6, -0.1);
  halfRack(g, 0.82);
  const screen = led(g, 0.82, 0.36, [0, 1.86, -0.56], { px: 256 });
  const lamp = dyn(part(g, GEO.sphereLo, glow(0x333333), 0.09, [0.62, 2.0, -0.55], { cast: false }));
  part(g, GEO.cylLo, M.frameDark, [0.12, 0.04, 0.12], [0.62, 2.0, -0.6], { rot: [PI / 2, 0, 0], cast: false });
  // plate tree: green and red plates waiting
  const tree = new THREE.Group();
  tree.position.set(1.15, 0, -0.45);
  part(tree, GEO.cyl, M.frame, [0.05, 0.9, 0.05], [0, 0.45, 0]);
  part(tree, rbox(0.42, 0.04, 0.42, 0.015, 1), M.frame, 1, [0, 0.02, 0]);
  [M.pass, M.fail, M.pass].forEach((m, i) => part(tree, plateGeo(0.17, 0.05), m, 1, [0, 0.35 + i * 0.2, 0.06 * (i % 2 ? -1 : 1)], { rot: [PI / 2, 0, 0] }));
  g.add(tree);
  // chalk bowl on a stand
  part(g, GEO.cyl, M.frame, [0.03, 0.8, 0.03], [-1.12, 0.4, -0.5], { cast: false });
  part(g, GEO.cyl, mat(0xf4f2ee, { rough: 0.9 }), [0.24, 0.07, 0.24], [-1.12, 0.83, -0.5], { cast: false });
  return {
    group: g,
    update(now, o) {
      const v = o?.v;
      if (!v) {
        screen.set('open', (c, W, H) => ledText(c, W, H, ['--', 'open'], [INK.off, INK.off]));
        lamp.material = glow(0x333333);
      } else if (o.kind === 'stalled') {
        screen.set('stall', (c, W, H) => ledText(c, W, H, ['STALL', `quiet ${Math.round((v.quietMs ?? 0) / 1000)}s`], ['#ffb238', '#ffb238']));
        lamp.material = glow(PALETTE.stall);
      } else {
        const reps = v.runReps ?? 0;
        const fails = v.runFails ?? 0;
        screen.set(`${reps}|${fails}`, (c, W, H) => ledText(c, W, H, [`REP ${reps}`, fails ? `${fails} failed` : 'all green'], [fails ? '#ff6b6b' : INK.good, fails ? '#ff6b6b' : INK.good]));
        const fresh = (v.repAge ?? Infinity) < 700;
        lamp.material = glow(fresh ? (v.repStatus === 'fail' ? PALETTE.fail : v.repStatus === 'skip' ? PALETTE.skip : PALETTE.pass) : 0x333333);
      }
    },
  };
}

/** INTEGRATION TANDEM LIFT: one long bar shared by every slot. Built in station space. */
export function tandemStation(slots) {
  const g = new THREE.Group();
  const xs = slots.map((s) => s.pos.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const cx = (x0 + x1) / 2;
  const z = slots[0].pos.z;
  const len = x1 - x0 + 1.6;
  const base = new THREE.Group();
  base.position.set(cx, 0, z);
  platformBase(base, len + 0.3, 1.6, -0.1);
  halfRack(base, len / 2 + 0.05, { storage: false });
  // a middle upright so the long rig looks able to take the load
  upright(base, 0, -0.62, 2.15, 0.07);
  const sign = led(base, 1.6, 0.34, [0, 1.86, -0.56], { px: 512 });
  sign.set('t', (c, W, H) => ledText(c, W, H, ['TANDEM LIFT'], ['#59f0d2']));
  g.add(base);
  const bar = barbell(len, mat(PALETTE.cyan, { rough: 0.45, emissive: 0x0d4a40, ei: 0.5 }), 1.05);
  bar.position.set(cx, 1.3, z - 0.42);
  g.add(dyn(bar));
  const mid = new THREE.Vector3();
  const acc = new THREE.Vector3();
  return {
    group: g,
    /** Shared lift phase so every robot on the bar moves together. */
    after(now, occs) {
      let n = 0;
      acc.set(0, 0, 0);
      for (const o of occs) {
        if (!o || o.kind !== 'coordinated') continue;
        o.robot.handsMid(mid);
        acc.add(mid);
        n++;
      }
      if (n) {
        acc.multiplyScalar(1 / n);
        bar.position.set(cx, acc.y, acc.z);
      } else bar.position.set(cx, 1.3, z - 0.42);
    },
  };
}

/** WHITEBOARD TREADMILL: deck with rollers and a motor hood, console, handrails, a 0.0 km display, and a whiteboard of test lines. */
export function treadmillUnit() {
  const g = new THREE.Group();
  // deck, side rails, rollers and motor hood
  part(g, rbox(0.9, 0.15, 1.95, 0.05), M.frame, 1, [0, 0.08, 0.0]);
  for (const s of [-1, 1]) part(g, rbox(0.1, 0.035, 1.75, 0.012, 1), mat(0xbfc5cc, { rough: 0.55, metal: 0.3 }), 1, [s * 0.4, 0.175, -0.05], { cast: false });
  part(g, GEO.cyl, M.chrome, [0.07, 0.72, 0.07], [0, 0.13, -0.92], { rot: [0, 0, PI / 2], cast: false });
  part(g, rbox(0.9, 0.24, 0.36, 0.06), mat(0x22262d, { rough: 0.35, metal: 0.4 }), 1, [0, 0.14, 0.86]);
  part(g, rbox(0.5, 0.012, 0.2, 0.005, 1), M.blue, 1, [0, 0.262, 0.86], { cast: false });
  const beltTex = canvasTexture(
    32,
    128,
    (c, W, H) => {
      c.fillStyle = '#111215';
      c.fillRect(0, 0, W, H);
      c.fillStyle = '#272a30';
      for (let i = 0; i < H; i += 16) c.fillRect(0, i, W, 3);
    },
    { repeat: [1, 5], srgb: false },
  );
  const belt = part(g, GEO.plane, new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.9 }), [0.66, 1.62, 1], [0, 0.178, -0.08], { rot: [-PI / 2, 0, 0], cast: false, receive: true });
  belt.userData.keep = true;
  // handrails: chrome tubes from the console back along the sides
  for (const s of [-1, 1]) {
    part(g, GEO.cyl, M.chrome, [0.04, 0.8, 0.04], [s * 0.42, 0.98, 0.3], { rot: [PI / 2, 0, 0] });
    part(g, GEO.sphereLo, M.chrome, 0.045, [s * 0.42, 0.98, -0.1], { cast: false });
    part(g, rbox(0.07, 1.75, 0.07, 0.015, 2), M.frame, 1, [s * 0.45, 0.875, DIM.boardZ]);
  }
  // console between the uprights, tilted toward the runner
  const con = new THREE.Group();
  con.position.set(0, 1.0, DIM.boardZ - 0.04);
  con.rotation.x = -0.35;
  part(con, rbox(0.84, 0.2, 0.12, 0.03), mat(0x2a2e35, { rough: 0.4, metal: 0.4 }), 1, [0, 0, 0]);
  if (F80) {
    // a chunky 1980s console: cream plastic hood, wood-grain fascia, fat membrane keys
    const lam = (M.lam ??= new THREE.MeshStandardMaterial({ map: laminateTexture(), roughness: 0.42 }));
    const cream = mat(0xc9bd9e, { rough: 0.6, raw: true });
    part(con, rbox(0.9, 0.36, 0.17, 0.04), cream, 1, [0, 0.03, 0.03]);
    part(con, rbox(0.8, 0.09, 0.012, 0.004, 1), lam, 1, [0, -0.08, -0.058], { cast: false });
    for (let i = 0; i < 5; i++) part(con, rbox(0.1, 0.05, 0.02, 0.006, 1), mat([0x6a1a26, 0x1f6a68, 0xc08e2a, 0x1f6a68, 0x6a1a26][i], { rough: 0.6, raw: true }), 1, [-0.3 + i * 0.15, -0.08, -0.068], { cast: false });
    part(con, rbox(0.11, 0.11, 0.03, 0.01, 1), mat(0x8a1a16, { rough: 0.5, raw: true }), 1, [0.34, 0.1, -0.06], { cast: false });
    part(con, rbox(0.52, 0.2, 0.012, 0.006, 1), M.frameDark, 1, [-0.06, 0.1, -0.052], { cast: false });
  }
  for (let i = 0; i < 4; i++) part(con, GEO.cylLo, glow([0x7cf29a, 0xffb238, 0x59f0d2, 0xff6b6b][i]), [0.03, 0.02, 0.03], [-0.33 + i * 0.07 + (i > 1 ? 0.52 : 0), 0.04, -0.06], { rot: [PI / 2, 0, 0], cast: false });
  g.add(con);
  // whiteboard
  const board = new THREE.Group();
  board.position.set(0, 1.47, DIM.boardZ - 0.04);
  board.rotation.y = PI;
  part(board, rbox(1.38, 0.94, 0.04, 0.02), M.alu, 1, [0, 0, -0.025]);
  const tex = canvasTexture(512, 344, null, { aniso: 8 });
  const face = part(board, GEO.plane, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.22, metalness: 0.0, envMapIntensity: 0.6 }), [1.3, 0.86, 1], [0, 0, 0.001], { cast: false });
  face.userData.keep = true;
  part(board, rbox(1.2, 0.03, 0.08, 0.01, 1), M.alu, 1, [0, -0.48, 0.03]);
  part(board, rbox(0.14, 0.04, 0.05, 0.01, 1), mat(0x2f80ed, { rough: 0.6 }), 1, [0.35, -0.45, 0.04], { cast: false });
  g.add(board);
  // display that never moves
  const disp = F80 ? led(con, 0.46, 0.15, [-0.06, 0.1, -0.057], { rot: [0, PI, 0], px: 192, bezel: false }) : led(g, 0.42, 0.13, [0, 0.93, DIM.boardZ - 0.11], { rot: [0, PI, 0], px: 192 });
  // film80: seven-segment-red digits that have read 00.0 since 1984
  const digits = (c, W, H) => {
    c.font = `700 ${Math.floor(H * 0.78)}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,60,40,0.14)';
    c.fillText('88.8 MPH', W / 2, H / 2 + 2, W - 10);
    c.fillStyle = '#ff3a22';
    c.shadowColor = '#ff2a12';
    c.shadowBlur = 9;
    c.fillText('00.0 MPH', W / 2, H / 2 + 2, W - 10);
    c.shadowBlur = 0;
  };
  disp.set('d', F80 ? digits : (c, W, H) => ledText(c, W, H, ['0.0 km'], ['#59f0d2']));
  // the board is also visible from the camera side
  const back = led(g, 0.42, 0.13, [0, 0.93, DIM.boardZ + 0.0], { rot: [0, 0, 0], px: 192, bezel: false });
  back.set('d', F80 ? digits : (c, W, H) => ledText(c, W, H, ['0.0 km'], ['#59f0d2']));
  let key = '';
  let strokeT = 0;
  function drawBoard(lines, writing, now) {
    tex.userData.redraw((c, W, H) => {
      c.fillStyle = INK.wb;
      c.fillRect(0, 0, W, H);
      // ghosting from old erasures
      c.fillStyle = INK.wbGhost;
      for (let i = 0; i < 6; i++) c.fillRect(40 + i * 70, 120 + (i % 3) * 60, 120, 10);
      c.fillStyle = 'rgba(0,0,0,0.04)';
      c.fillRect(0, H - 30, W, 30);
      c.font = `800 40px ${FONT}`;
      c.fillStyle = INK.wbHead;
      c.textAlign = 'left';
      c.fillText('TEST PLAN', 22, 50);
      c.strokeStyle = INK.wbHead;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(22, 60);
      c.lineTo(200, 60);
      c.stroke();
      // tally marks: one stroke per test line written, groups of five
      const n = Math.min(lines, 60);
      c.strokeStyle = INK.wbTally;
      c.lineWidth = 6;
      c.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const grp = Math.floor(i / 5);
        const k = i % 5;
        const gx = 26 + (grp % 6) * 80;
        const gy = 90 + Math.floor(grp / 6) * 90;
        c.beginPath();
        if (k < 4) {
          c.moveTo(gx + k * 14, gy);
          c.lineTo(gx + k * 14 + 2, gy + 60);
        } else {
          c.moveTo(gx - 6, gy + 50);
          c.lineTo(gx + 54, gy + 8);
        }
        c.stroke();
      }
      if (lines === 0) {
        c.font = `600 22px ${MONO}`;
        c.fillStyle = INK.wbMute;
        c.fillText('no new test lines yet', 22, 130);
      }
      c.font = `800 30px ${FONT}`;
      c.fillStyle = INK.wbText;
      c.textAlign = 'right';
      c.fillText(`${lines} test line${lines === 1 ? '' : 's'}`, W - 20, H - 40);
      if (writing) {
        // marker squiggle in progress
        const p = (now % 1600) / 1600;
        c.strokeStyle = '#16171b';
        c.lineWidth = 4;
        c.beginPath();
        const y = 300;
        c.moveTo(22, y);
        for (let x = 0; x < p * 260; x += 6) c.lineTo(22 + x, y + Math.sin(x * 0.25) * 8);
        c.stroke();
      }
    });
  }
  return {
    group: g,
    update(now, o) {
      const running = !!o && (o.kind === 'treadmill' || o.kind === 'wait');
      if (running) beltTex.offset.y = (now * -0.0024) % 1;
      const wb = o?.v?.whiteboard;
      const lines = wb?.testLines ?? 0;
      const writing = !!wb?.writing && running;
      const k = `${lines}|${writing}`;
      if (k !== key || (writing && now - strokeT > 120)) {
        key = k;
        strokeT = now;
        drawBoard(lines, writing, now);
      }
    },
  };
}

/** FLAKY SLOT MACHINE: lever on the robot side, reels face local +x. */
export function slotUnit() {
  const g = new THREE.Group();
  const cab = new THREE.Group();
  cab.position.set(0, 0, 0.66);
  g.add(cab);
  const body = mat(0x4a1f5c, { rough: 0.38, metal: 0.08, env: 0.6 });
  const dark = mat(0x2a0f36, { rough: 0.35, metal: 0.1, env: 0.6 });
  // pedestal, body, sloped button deck, top box
  part(cab, rbox(0.8, 0.2, 0.7, 0.03), M.frameDark, 1, [0, 0.1, 0]);
  part(cab, rbox(0.72, 0.62, 0.62, 0.05), body, 1, [0, 0.51, 0]);
  part(cab, rbox(0.66, 0.58, 0.6, 0.06), dark, 1, [-0.02, 1.08, 0]);
  part(cab, rbox(0.62, 0.36, 0.64, 0.08), body, 1, [-0.02, 1.55, 0]);
  // chrome trims on every horizontal seam and the front edges
  for (const y of [0.2, 0.82, 1.37]) part(cab, rbox(0.78, 0.035, 0.68, 0.012, 1), M.chrome, 1, [0, y, 0], { cast: false });
  for (const s of [-1, 1]) part(cab, rbox(0.03, 1.55, 0.03, 0.01, 1), M.chrome, 1, [0.36, 0.98, s * 0.31], { cast: false });
  part(cab, rbox(0.76, 0.06, 0.66, 0.02), M.gold, 1, [0, 1.36, 0]);
  // marquee
  const marquee = led(cab, 0.6, 0.26, [0.33, 1.55, 0], { rot: [0, PI / 2, 0], px: 256, bright: 3 });
  marquee.set('m', (c, W, H) => {
    const grd = c.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#3a0f52');
    grd.addColorStop(1, '#14061e');
    c.fillStyle = grd;
    c.fillRect(0, 0, W, H);
    ledText(c, W, H, ['FLAKY'], ['#d79bff']);
  });
  // reel window on +x face: a gold bezel standing proud of the cabinet, a dark hood, backlit reels
  for (const [sx, sy, sz, y, z] of [
    [0.1, 0.04, 0.58, 1.27, 0],
    [0.1, 0.04, 0.58, 0.85, 0],
    [0.1, 0.42, 0.04, 1.06, 0.27],
    [0.1, 0.42, 0.04, 1.06, -0.27],
  ])
    part(cab, rbox(sx, sy, sz, 0.012, 1), dark, 1, [0.35, y, z], { cast: false });
  for (const [sy, sz, y, z] of [
    [0.035, 0.6, 1.285, 0],
    [0.035, 0.6, 0.835, 0],
    [0.45, 0.035, 1.06, 0.29],
    [0.45, 0.035, 1.06, -0.29],
  ])
    part(cab, rbox(0.03, sy, sz, 0.01, 1), M.gold, 1, [0.405, y, z], { cast: false });
  const reelTex = canvasTexture(512, 64, (c, W, H) => {
    const cells = ['PASS', 'FAIL', 'FAIL', 'PASS', 'FAIL', 'PASS', 'FAIL', 'FAIL'];
    const cw = W / cells.length;
    cells.forEach((s, i) => {
      c.fillStyle = '#f7f1e1';
      c.fillRect(i * cw, 0, cw, H);
      c.save();
      c.translate(i * cw + cw / 2, H / 2);
      c.rotate(-PI / 2);
      c.fillStyle = s === 'PASS' ? '#1f9d4a' : '#d93a2b';
      c.beginPath();
      c.arc(0, 0, 24, 0, PI * 2);
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 7;
      c.lineCap = 'round';
      c.beginPath();
      if (s === 'PASS') {
        c.moveTo(-11, 1);
        c.lineTo(-3, 10);
        c.lineTo(12, -9);
      } else {
        c.moveTo(-9, -9);
        c.lineTo(9, 9);
        c.moveTo(9, -9);
        c.lineTo(-9, 9);
      }
      c.stroke();
      c.restore();
      c.fillStyle = '#c9c2b0';
      c.fillRect(i * cw, 0, 2, H);
    });
  });
  const reels = [];
  const reelGeo = cached('reel', () => new THREE.CylinderGeometry(0.15, 0.15, 0.15, 24, 1, true));
  const reelMat = new THREE.MeshStandardMaterial({ map: reelTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: reelTex, emissiveIntensity: 0.55 });
  for (let i = 0; i < 3; i++) {
    const r = dyn(mesh(reelGeo, reelMat, { cast: false }));
    r.position.set(0.25, 1.06, (i - 1) * 0.17);
    cab.add(r);
    reels.push(r);
  }
  const pane = part(cab, GEO.box, M.glass, [0.004, 0.4, 0.55], [0.41, 1.06, 0], { cast: false });
  pane.userData.keep = true;
  // lights row (animated) and a static chaser ring around the marquee
  const bulbs = [];
  for (let i = 0; i < 5; i++) bulbs.push(dyn(part(cab, GEO.sphereLo, glow(0x444444), 0.05, [0.36, 1.33, (i - 2) * 0.11], { cast: false })));
  // button deck
  for (let i = 0; i < 3; i++) part(cab, GEO.cyl, glow([0xff5a5a, 0xffd23a, 0x5aff8a][i]), [0.06, 0.03, 0.06], [0.37, 0.88, (i - 1) * 0.14], { rot: [0, 0, PI / 2], cast: false });
  // tray
  part(cab, rbox(0.14, 0.09, 0.4, 0.02), M.chrome, 1, [0.38, 0.32, 0]);
  part(cab, GEO.box, mat(0x0c0c0e), [0.01, 0.05, 0.3], [0.452, 0.33, 0], { cast: false });
  // lever: on the -z face (robot side)
  const lever = dyn(new THREE.Group());
  lever.position.set(-0.25, 1.05, 0.33 - 0.66);
  part(lever, GEO.cyl, M.chrome, [0.035, 0.45, 0.035], [0, 0.225, 0]);
  part(lever, GEO.sphere, mat(PALETTE.fail, { rough: 0.2, emissive: 0x400000 }), 0.11, [0, 0.47, 0]);
  part(lever, GEO.cyl, M.chrome, [0.12, 0.08, 0.12], [0, 0, 0], { rot: [PI / 2, 0, 0] });
  cab.add(lever);
  // symbol index -> angle: cell i is centred at u = (i + 0.5) / 8 around the cylinder
  const cellAngle = (i) => ((i + 0.5) / 8) * PI * 2;
  const FAIL = 1;
  const PASS = 3;
  const targets = [FAIL, FAIL + 1, PASS];
  const laps = [3, 4, 5];
  const bulbOff = glow(0x3a3340);
  return {
    group: g,
    update(now, o) {
      const active = !!o && o.kind === 'wobble';
      const u = active ? cyc(now, SLOT_MS, (o.robot.seed ?? 0) * 400) : 0.95;
      const reach = span(u, 0, SLOT.reach);
      const pull = span(u, SLOT.reach, SLOT.pull);
      lever.rotation.x = u < SLOT.reach ? 0 : u < SLOT.pull ? -1.2 * ease(pull) : -1.2 * (1 - ease(span(u, SLOT.pull, SLOT.pull + 0.12)));
      void reach;
      for (let i = 0; i < 3; i++) {
        const stop = SLOT.stops[i];
        const speed = (laps[i] * PI * 2) / (stop - SLOT.spinStart);
        let a = -cellAngle(targets[i]) + PI / 2;
        if (u > SLOT.spinStart && u < stop) a += (stop - u) * speed;
        else if (u >= stop && u < stop + 0.04) a -= Math.sin(((u - stop) / 0.04) * PI) * 0.12;
        reels[i].rotation.set(PI / 2, a, 0);
      }
      const win = u >= SLOT.win;
      bulbs.forEach((b, i) => {
        const on = active && (win ? Math.floor(now / 120 + i) % 2 === 0 : u > SLOT.spinStart && Math.floor(now / 80 + i) % 3 === 0);
        b.material = on ? glow(win ? PALETTE.pass : PALETTE.wobble) : bulbOff;
      });
    },
  };
}

/** External tangent loop around two circles (a chain path), sampled to n points. */
function chainPath(c1, r1, c2, r2, n) {
  const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  const base = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const th = Math.acos((r1 - r2) / d);
  const pts = [];
  const arc = (c, r, a0, a1, steps) => {
    for (let i = 0; i < steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push(new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));
    }
  };
  arc(c1, r1, base + th, base + PI * 2 - th, 40);
  arc(c2, r2, base - th, base + th, 24);
  const curve = new THREE.SplineCurve([...pts, pts[0]]);
  return curve.getSpacedPoints(n);
}

/** THE MACHINE: an elaborate contraption of real gears and a chain that lifts a 0.5 kg dumbbell. */
export function machineUnit() {
  const g = new THREE.Group();
  const beam = (w, h, d, x, y, z, m = M.frame) => part(g, rbox(w, h, d, 0.015, 2), m, 1, [x, y, z]);
  floorMat(g, 2.9, 2.0, 0x3a2c18, 0.1);
  // hazard stripes along the front edge of the mat
  const hz = canvasTexture(256, 32, (c, W, H) => {
    c.fillStyle = '#f4c430';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#1b1d22';
    for (let x = -H; x < W; x += 32) {
      c.beginPath();
      c.moveTo(x, H);
      c.lineTo(x + 16, H);
      c.lineTo(x + 16 + H, 0);
      c.lineTo(x + H, 0);
      c.fill();
    }
  });
  part(g, GEO.plane, new THREE.MeshStandardMaterial({ map: hz, roughness: 0.7 }), [2.8, 0.12, 1], [0, 0.04, 1.04], { rot: [-PI / 2, 0, 0], cast: false });
  beam(0.12, 2.7, 0.12, -1.25, 1.35, -0.55);
  beam(0.12, 2.7, 0.12, 1.25, 1.35, -0.55);
  beam(2.62, 0.12, 0.12, 0, 2.7, -0.55);
  beam(2.62, 0.08, 0.08, 0, 0.9, -0.62);
  beam(0.1, 1.6, 0.1, 0.75, 0.8, 0.45);
  beam(0.6, 0.08, 0.08, 0.75, 1.6, 0.15);
  // rivets along the top beam
  for (let i = 0; i < 9; i++) part(g, GEO.sphereLo, M.steel, 0.03, [-1.1 + i * 0.275, 2.7, -0.48], { cast: false });
  // back plate the gears are mounted on
  part(g, rbox(2.3, 1.75, 0.04, 0.02), mat(0x3a4250, { rough: 0.55, metal: 0.5 }), 1, [0, 1.8, -0.6], { cast: false });
  const gears = [];
  const spec = [
    [-0.7, 1.95, 0.4, 16, PALETTE.gold],
    [-0.04, 2.24, 0.26, 10, PALETTE.coral],
    [0.48, 1.8, 0.32, 13, PALETTE.gold],
    [-0.4, 1.12, 0.24, 9, PALETTE.cyan],
    [0.12, 1.36, 0.18, 7, PALETTE.violet],
    [0.84, 2.36, 0.2, 8, PALETTE.lime],
  ];
  for (const [x, y, r, teeth, color] of spec) {
    const gear = dyn(new THREE.Group());
    const gm = mat(color, { metal: 0.8, rough: 0.28 });
    part(gear, gearGeo(r, teeth), gm, 1, [0, 0, 0]);
    part(gear, GEO.cyl, M.chrome, [r * 0.3, 0.12, r * 0.3], [0, 0, 0], { rot: [PI / 2, 0, 0], cast: false });
    part(gear, GEO.cylLo, M.frameDark, [r * 0.1, 0.14, r * 0.1], [0, 0, 0], { rot: [PI / 2, 0, 0], cast: false });
    gear.position.set(x, y, -0.5);
    g.add(gear);
    // axle into the back plate
    part(g, GEO.cyl, M.steel, [0.04, 0.12, 0.04], [x, y, -0.56], { rot: [PI / 2, 0, 0], cast: false });
    gears.push({ gear, r });
  }
  // a roller chain looping the big gold gear and the cyan one
  const path = chainPath(new THREE.Vector2(-0.7, 1.95), 0.37, new THREE.Vector2(-0.4, 1.12), 0.22, 200);
  const LINKS = 46;
  const linkGeo = cached('link', () => new THREE.TorusGeometry(0.022, 0.007, 4, 8));
  const chain = dyn(new THREE.InstancedMesh(linkGeo, M.steel, LINKS));
  chain.castShadow = false;
  chain.position.z = -0.43;
  chain.userData.keep = true;
  g.add(chain);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const pv = new THREE.Vector3();
  function placeChain(shift) {
    for (let i = 0; i < LINKS; i++) {
      const u = (((i / LINKS + shift) % 1) + 1) % 1;
      const k = Math.floor(u * (path.length - 1));
      const a = path[k];
      const b = path[(k + 1) % path.length];
      pv.set(a.x, a.y, 0);
      e.set(i % 2 ? PI / 2 : 0, 0, Math.atan2(b.y - a.y, b.x - a.x));
      q.setFromEuler(e);
      m4.compose(pv, q, one.set(1.5, 1, 1));
      chain.setMatrixAt(i, m4);
    }
    chain.instanceMatrix.needsUpdate = true;
  }
  placeChain(0);
  // the tiny load: a hanging chain-hoist hook and the 0.5 kg dumbbell
  const rope = dyn(part(g, GEO.cylLo, M.steel, [0.015, 1, 0.015], [0.75, 1.9, 0.45], { cast: false }));
  part(g, GEO.torus, M.steel, [0.22, 0.22, 0.22], [0.75, 1.52, 0.15], { rot: [0, PI / 2, 0], cast: false });
  const tiny = dyn(dumbbell(0.5));
  g.add(tiny);
  const crank = dyn(new THREE.Group());
  part(crank, rbox(0.05, 0.32, 0.05, 0.01, 1), M.brushed, 1, [0, 0.16, 0]);
  part(crank, GEO.cyl, M.coral, [0.06, 0.16, 0.06], [0, 0.32, 0.08], { rot: [PI / 2, 0, 0] });
  crank.position.set(-0.27, 1.0, 0.42);
  g.add(crank);
  part(g, rbox(0.08, 1.0, 0.08, 0.012, 1), M.frame, 1, [-0.27, 0.5, 0.42]);
  // pressure gauge for comedy: needle pinned at zero
  part(g, GEO.cyl, M.chrome, [0.2, 0.05, 0.2], [1.0, 1.3, -0.56], { rot: [PI / 2, 0, 0], cast: false });
  part(g, GEO.cyl, mat(0xf4f2ee, { rough: 0.4 }), [0.17, 0.052, 0.17], [1.0, 1.3, -0.555], { rot: [PI / 2, 0, 0], cast: false });
  part(g, GEO.box, M.fail, [0.008, 0.07, 0.01], [0.985, 1.28, -0.525], { rot: [0, 0, 0.6], cast: false });
  const sign = led(g, 1.7, 0.5, [0, 3.05, -0.55], { px: 512, bright: 2.8 });
  sign.set('s', (c, W, H) => ledText(c, W, H, ['THE MACHINE', 'lifts 0.5 kg'], ['#f4c430', '#f2e9d8']));
  return {
    group: g,
    update(now, o) {
      const effort = o ? 1 : 0.05;
      let lift = 0;
      const v = o?.v;
      if (v && v.repAge !== null && v.repAge < 900) lift = Math.sin((v.repAge / 900) * PI);
      else if (o) lift = 0.15 + 0.1 * Math.sin(now * 0.002);
      gears.forEach(({ gear, r }, i) => (gear.rotation.z = ((i % 2 ? -1 : 1) * now * 0.004 * effort) / r));
      // links travel with the big gear's rim speed: 0.004 rad/ms over the whole loop
      placeChain((((now * 0.004 * effort) / 0.4) * 0.37) / 3.2);
      crank.rotation.x = now * 0.006 * effort;
      const h = 0.3 + lift * 0.95;
      tiny.position.set(0.75, h, 0.45);
      rope.scale.y = Math.max(0.05, 1.52 - h - 0.05);
      rope.position.y = (1.52 + h + 0.05) / 2;
    },
  };
}

/** PERSONAL RECORD BELL: a brass bell on a post; the robot yanks the rope with its left hand. */
export function bellUnit() {
  const g = new THREE.Group();
  post(g, 0.95, 0.3, 2.45, 0.1);
  part(g, rbox(0.4, 0.04, 0.4, 0.015, 1), M.frame, 1, [0.95, 0.02, 0.3]);
  part(g, rbox(0.5, 0.08, 0.08, 0.012, 1), M.frame, 1, [0.72, 2.4, 0.3]);
  const bell = dyn(new THREE.Group());
  bell.position.set(0.55, 2.36, 0.3);
  // lathe profile: crown, waist, flared lip
  const prof = [
    [0.0, 0.0],
    [0.07, -0.01],
    [0.11, -0.05],
    [0.13, -0.12],
    [0.15, -0.22],
    [0.2, -0.32],
    [0.26, -0.38],
    [0.27, -0.41],
    [0.24, -0.41],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const shell = mesh(new THREE.LatheGeometry(prof, 32), new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 1, roughness: 0.18, side: THREE.DoubleSide }));
  shell.position.y = 0.02;
  bell.add(shell);
  part(bell, GEO.box, M.frame, [0.06, 0.08, 0.06], [0, 0.05, 0]);
  part(bell, GEO.sphereLo, M.frameDark, 0.08, [0, -0.38, 0], { cast: false });
  g.add(bell);
  const rope = dyn(part(g, GEO.cylLo, M.rope, [0.018, 1, 0.018], [0.55, 1.9, 0.3], { cast: false }));
  const plaque = led(g, 0.9, 0.32, [0.95, 1.55, 0.38], { px: 384 });
  plaque.set('p', (c, W, H) => ledText(c, W, H, ['PR BELL'], ['#f4c430']));
  plaque.group.rotation.y = -0.5;
  // confetti burst
  const bits = [];
  const colors = [PALETTE.lime, PALETTE.gold, PALETTE.coral, PALETTE.cyan, PALETTE.violet];
  for (let i = 0; i < 18; i++) bits.push(dyn(part(g, GEO.box, glow(colors[i % colors.length]), [0.05, 0.05, 0.01], [0, 0, 0], { cast: false })));
  const hand = new THREE.Vector3();
  return {
    group: g,
    update(now, o) {
      const active = !!o && o.kind === 'merge';
      const u = active ? cyc(now, 1500, (o.robot.seed ?? 0) * 200) : 0;
      const ring = active ? Math.sin(span(u, 0.25, 1) * PI * 4) * Math.exp(-span(u, 0.25, 1) * 3) : 0;
      bell.rotation.z = ring * 0.5;
      const fresh = active && actAge(o.v.activity, now, 5000) < 3000;
      bits.forEach((b, i) => {
        b.visible = active && (fresh || i < 8);
        if (!b.visible) return;
        const ph = span(u, 0.3, 1);
        const a = i * 2.39;
        const sp = 0.6 + (i % 5) * 0.15;
        b.position.set(0.55 + Math.cos(a) * ph * sp, 2.3 + Math.sin(ph * PI) * 0.5 - ph * ph * 1.2, 0.3 + Math.sin(a) * ph * sp);
        b.rotation.set(now * 0.01 + i, i, now * 0.007);
        b.scale.setScalar(ph > 0 && ph < 1 ? 0.06 : 0.0001);
      });
    },
    after(now, o) {
      if (o && o.kind === 'merge') {
        o.robot.handWorld(1, hand);
        g.worldToLocal(hand);
      } else hand.set(0.55, 1.5, 0.3);
      const topY = 2.0;
      const len = Math.max(0.05, topY - hand.y);
      rope.scale.y = len;
      rope.position.set((0.55 + hand.x) / 2, (topY + hand.y) / 2, (0.3 + hand.z) / 2);
      rope.rotation.set(-Math.atan2(hand.z - 0.3, len), 0, Math.atan2(hand.x - 0.55, len));
    },
  };
}

/** Idle seat for a robot in the locker room (oak slat bench segment on steel legs). */
export function seatUnit() {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) part(g, rbox(0.9, 0.04, 0.095, 0.012, 1), woodMat(), 1, [0, DIM.seat - 0.02, -0.05 - 0.16 + i * 0.105]);
  for (const s of [-1, 1]) {
    part(g, rbox(0.05, DIM.seat - 0.04, 0.05, 0.01, 1), M.frame, 1, [s * 0.38, (DIM.seat - 0.04) / 2, -0.2]);
    part(g, rbox(0.05, DIM.seat - 0.04, 0.05, 0.01, 1), M.frame, 1, [s * 0.38, (DIM.seat - 0.04) / 2, 0.1]);
  }
  part(g, rbox(0.8, 0.03, 0.03, 0.008, 1), M.frame, 1, [0, 0.12, -0.05], { cast: false });
  return { group: g };
}

// ---------- decor ----------

let lockerNumbers = null;
export function lockers(n = 5) {
  const g = new THREE.Group();
  const colors = F80 ? [0x2f6462, 0x285a58] : [0x8fb3c4, 0x82a6b8];
  lockerNumbers ??= canvasTexture(512, 64, (c, W, H) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = '#f4f2ee';
      c.fillRect(i * 64 + 4, 6, 56, 52);
      c.fillStyle = '#1f2a3a';
      c.font = `700 34px ${MONO}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(101 + i), i * 64 + 32, 34);
    }
  });
  // plinth and crown
  part(g, rbox(n * 0.6 + 0.04, 0.1, 0.52, 0.015, 1), M.frameDark, 1, [(n - 1) * 0.3, 0.05, 0], { receive: true });
  part(g, rbox(n * 0.6 + 0.06, 0.05, 0.54, 0.015, 1), mat(0x6f8f9e, { rough: 0.45, metal: 0.4 }), 1, [(n - 1) * 0.3, 2.07, 0]);
  for (let i = 0; i < n; i++) {
    const door = mat(colors[i % 2], { metal: 0.45, rough: F80 ? 0.52 : 0.4, raw: F80 });
    const l = part(g, rbox(0.56, 1.95, 0.5, 0.02), door, 1, [i * 0.6, 1.075, 0]);
    l.receiveShadow = true;
    // door seam, vents, number plate, handle, lock
    part(g, GEO.box, M.frameDark, [0.54, 0.01, 0.005], [i * 0.6, 1.02, 0.252], { cast: false });
    for (let k = 0; k < 5; k++) {
      part(g, GEO.box, M.frameDark, [0.3, 0.018, 0.01], [i * 0.6, 1.72 + k * 0.045, 0.252], { cast: false });
      part(g, GEO.box, M.frameDark, [0.3, 0.018, 0.01], [i * 0.6, 0.32 + k * 0.045, 0.252], { cast: false });
    }
    const num = part(g, GEO.plane, new THREE.MeshStandardMaterial({ map: lockerNumbers, roughness: 0.6 }), [0.1, 0.09, 1], [i * 0.6, 1.95, 0.253], { cast: false });
    num.geometry = cached(`lknum${i % 8}`, () => {
      const pg = new THREE.PlaneGeometry(1, 1);
      const uv = pg.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i % 8) / 8 + uv.getX(k) / 8);
      return pg;
    });
    part(g, rbox(0.03, 0.14, 0.03, 0.01, 1), M.chrome, 1, [i * 0.6 + 0.2, 1.1, 0.27], { cast: false });
    part(g, GEO.cylLo, M.gold, [0.03, 0.02, 0.03], [i * 0.6 + 0.2, 1.24, 0.258], { rot: [PI / 2, 0, 0], cast: false });
  }
  // a towel left over one door
  part(g, rbox(0.3, 0.42, 0.04, 0.015, 1), mat(0xff8a5c, { rough: 0.95 }), 1, [2.4, 1.75, 0.27], { rot: [0, 0, 0.04] });
  return { group: g };
}

/** Towel rail with three folded towels (locker room wall). */
export function towelHook() {
  const g = new THREE.Group();
  part(g, GEO.cyl, M.chrome, [0.025, 1.4, 0.025], [0, 1.6, 0.12], { rot: [0, 0, PI / 2], cast: false });
  for (const s of [-1, 1]) part(g, rbox(0.04, 0.04, 0.12, 0.01, 1), M.chrome, 1, [s * 0.68, 1.6, 0.06], { cast: false });
  [0xffffff, 0x8fc3ea, 0xffb238].forEach((c, i) => part(g, rbox(0.32, 0.5, 0.05, 0.02, 1), mat(c, { rough: 0.95 }), 1, [-0.42 + i * 0.42, 1.4, 0.13], { rot: [0, 0, (i - 1) * 0.03] }));
  return { group: g };
}

export function coolant() {
  const g = new THREE.Group();
  part(g, rbox(0.45, 1.05, 0.4, 0.04), mat(0xe8ecf0, { rough: 0.3, metal: 0.3 }), 1, [0, 0.525, 0]);
  part(g, rbox(0.3, 0.2, 0.08, 0.02, 1), mat(0x2a2e35, { rough: 0.4 }), 1, [0, 0.95, 0.19], { cast: false });
  part(g, GEO.cylLo, M.chrome, [0.04, 0.08, 0.04], [0, 0.88, 0.25], { cast: false });
  // film80: an office water cooler, the inverted blue bottle and all
  const tank = part(g, GEO.cyl, F80 ? new THREE.MeshStandardMaterial({ color: 0x8fc4e0, transparent: true, opacity: 0.55, roughness: 0.06, envMapIntensity: 2.0 }) : new THREE.MeshStandardMaterial({ color: PALETTE.lime, transparent: true, opacity: 0.72, roughness: 0.08, emissive: 0x4a7a10, emissiveIntensity: 0.6, envMapIntensity: 1.4 }), [0.34, 0.5, 0.34], [0, 1.3, 0]);
  tank.userData.keep = true;
  part(g, GEO.cyl, F80 ? mat(0x8fc4e0, { rough: 0.2, raw: true }) : mat(PALETTE.lime, { emissive: 0x2a4a08 }), F80 ? [0.3, 0.06, 0.3] : [0.2, 0.04, 0.2], [0, 1.57, 0], { cast: false });
  if (F80) {
    part(g, GEO.cone, mat(0x8fc4e0, { rough: 0.2, raw: true }), [0.2, 0.1, 0.2], [0, 1.03, 0], { rot: [PI, 0, 0], cast: false });
    part(g, GEO.cylLo, mat(0xb5332a, { rough: 0.5, raw: true }), [0.03, 0.05, 0.03], [-0.07, 0.86, 0.25], { cast: false });
    // paper-cone dispenser on the side
    part(g, GEO.cyl, mat(0xe9e2cf, { rough: 0.8, raw: true }), [0.09, 0.34, 0.09], [0.28, 0.8, 0.05], { cast: false });
  }
  part(g, rbox(0.3, 0.04, 0.16, 0.01, 1), M.chrome, 1, [0, 0.3, 0.16], { cast: false });
  const sign = led(g, 0.42, 0.16, [0, 0.72, 0.205], { px: 192, bezel: false });
  sign.set('c', (c, W, H) => ledText(c, W, H, ['COOLANT'], ['#b8f25c']));
  return { group: g };
}

/** Round woven rug: jute rings with a coral border (station-free lounge decor). */
export function rug(size = 2.8, seed = 1) {
  const g = new THREE.Group();
  const tex = canvasTexture(512, 512, (c, W, H) => {
    let s = seed * 131;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    c.fillStyle = '#efe2cb';
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2, 0, PI * 2);
    c.fill();
    for (let r = 12; r < W / 2 - 30; r += 7) {
      c.strokeStyle = `rgba(${170 + rnd() * 30},${140 + rnd() * 20},${100 + rnd() * 20},0.35)`;
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(W / 2, H / 2, r, 0, PI * 2);
      c.stroke();
    }
    if (F80) {
      // a deep-pile burgundy and mustard number left over from the seventies
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = seed % 2 ? 'rgba(110,26,38,0.82)' : 'rgba(150,104,30,0.8)';
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
      for (let r = 40; r < W / 2 - 40; r += 44) {
        c.strokeStyle = seed % 2 ? 'rgba(201,147,43,0.75)' : 'rgba(110,26,38,0.75)';
        c.lineWidth = 9;
        c.beginPath();
        c.arc(W / 2, H / 2, r, 0, PI * 2);
        c.stroke();
      }
    }
    c.strokeStyle = F80 ? (seed % 2 ? '#c9932b' : '#1f6a68') : seed % 2 ? '#ff8a5c' : '#2f80ed';
    c.lineWidth = 18;
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2 - 22, 0, PI * 2);
    c.stroke();
    c.strokeStyle = '#f7efe0';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2 - 40, 0, PI * 2);
    c.stroke();
  });
  const m = part(g, cached('rugdisc', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 48)), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: 0xffffff }), [size, 0.012, size], [0, 0.006, 0], { cast: false, receive: true });
  void m;
  return { group: g };
}

// ---------- plants ----------

let leafGeo = null;
/** A split monstera-ish leaf in the xy plane, base at the origin, tip at +y (1 m long). */
function monsteraLeaf() {
  if (leafGeo) return leafGeo;
  const pts = [];
  const N = 72;
  const slits = [0.12, 0.2, 0.28, 0.37];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = -PI / 2 + u * PI * 2;
    let k = 1;
    for (const c of slits) if (Math.abs(u - c) < 0.014 || Math.abs(1 - u - c) < 0.014) k = 0.42;
    if (u < 0.03 || u > 0.97) k = 0.2; // heart notch at the stem
    pts.push(new THREE.Vector2(Math.cos(a) * 0.38 * k, 0.5 + Math.sin(a) * 0.5 * k));
  }
  leafGeo = new THREE.ShapeGeometry(new THREE.Shape(pts));
  // a gentle cup so the leaves catch light instead of reading as flat cards
  const p = leafGeo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -Math.abs(p.getX(i)) * 0.35 + Math.sin(p.getY(i) * PI) * 0.06);
  leafGeo.computeVertexNormals();
  return leafGeo;
}
const LEAF = {};
const leafMat = (c) => (LEAF[c] ??= new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, side: THREE.DoubleSide }));

/** Tapered planter with a rolled lip (lathe). */
function potGeo() {
  return cached('pot', () => {
    const prof = [
      [0, 0],
      [0.36, 0],
      [0.4, 0.04],
      [0.48, 0.86],
      [0.53, 0.9],
      [0.53, 1.0],
      [0.47, 1.0],
      [0.45, 0.92],
      [0, 0.92],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(prof, 28);
  });
}

/**
 * Potted plant. kind: 'monstera' (big split leaves), 'snake' (tall blades),
 * 'dead' (the production corner's).
 */
export function plant({ kind = 'monstera', size = 1, seed = 1 } = {}) {
  const g = new THREE.Group();
  let s = seed * 7919 + 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // film80: terracotta and glazed brown stoneware instead of white fibreglass
  const potM = F80 ? mat(kind === 'dead' ? 0x8a5f42 : seed % 3 === 0 ? 0x4a2e1c : seed % 3 === 1 ? 0xa5583a : 0x8a6a3a, { rough: seed % 3 === 0 ? 0.3 : 0.8, raw: true }) : mat(kind === 'dead' ? 0x9a6b4a : seed % 3 === 0 ? 0x2b2f37 : 0xf3efe7, { rough: 0.45 });
  part(g, potGeo(), potM, [0.5 * size, 0.46 * size, 0.5 * size], [0, 0, 0]);
  part(g, GEO.cyl, mat(0x4a3526, { rough: 0.95 }), [0.46 * size, 0.02, 0.46 * size], [0, 0.43 * size, 0], { cast: false });
  if (kind === 'snake') {
    const m = leafMat(0x3d7a4a);
    const m2 = leafMat(0x5c9a52);
    for (let i = 0; i < 11; i++) {
      const a = i * 2.4;
      const h = (0.8 + rnd() * 0.8) * size;
      const blade = part(g, GEO.sphere, i % 3 ? m : m2, [0.09 * size, h, 0.025 * size], [Math.cos(a) * 0.09 * size, 0.43 * size + h * 0.45, Math.sin(a) * 0.09 * size]);
      blade.rotation.set(Math.cos(a) * 0.14, a, Math.sin(a) * 0.14);
    }
    return { group: g };
  }
  const dead = kind === 'dead';
  const lm = leafMat(dead ? 0x8a6a3a : 0x2f7d46);
  const lm2 = leafMat(dead ? 0x6e5530 : 0x3f9152);
  const stemM = mat(dead ? 0x6e5530 : 0x4c7a3a, { rough: 0.7 });
  const n = dead ? 4 : 10;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39 + rnd();
    const lean = dead ? 1.25 + rnd() * 0.3 : 0.3 + rnd() * 0.6;
    const len = (0.55 + rnd() * 0.5) * size;
    const stem = new THREE.Group();
    stem.position.set(0, 0.43 * size, 0);
    stem.rotation.set(0, a, 0);
    const tilt = new THREE.Group();
    tilt.rotation.x = lean;
    stem.add(tilt);
    part(tilt, GEO.cylLo, stemM, [0.025 * size, len, 0.025 * size], [0, len / 2, 0], { cast: false });
    const leaf = mesh(monsteraLeaf(), i % 2 ? lm : lm2, { cast: true });
    const ls = (0.5 + rnd() * 0.35) * size * (dead ? 0.6 : 1);
    leaf.scale.set(ls, ls, ls);
    leaf.position.set(0, len, 0);
    leaf.rotation.set(dead ? 1.2 : 0.5 + rnd() * 0.5, 0, (rnd() - 0.5) * 0.4);
    tilt.add(leaf);
    g.add(stem);
  }
  if (dead) for (let i = 0; i < 3; i++) part(g, monsteraLeaf(), lm2, 0.18, [0.3 + i * 0.12, 0.012, 0.1 - i * 0.15], { rot: [-PI / 2, 0, i * 1.7], cast: false });
  return { group: g };
}

export function plateTree() {
  const g = new THREE.Group();
  part(g, rbox(0.5, 0.05, 0.5, 0.015, 1), M.frame, 1, [0, 0.025, 0]);
  part(g, GEO.cyl, M.frame, [0.06, 1.1, 0.06], [0, 0.55, 0]);
  const cols = [M.plate, M.amber, M.plate, M.coral];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    part(g, GEO.cyl, M.brushed, [0.04, 0.2, 0.04], [Math.cos(a) * 0.06, 0.35 + (i % 2) * 0.35, Math.sin(a) * 0.06], { rot: [PI / 2, a, 0], cast: false });
    part(g, plateGeo(0.21, 0.06), cols[i], 1, [Math.cos(a) * 0.1, 0.35 + (i % 2) * 0.35, Math.sin(a) * 0.1], { rot: [PI / 2, 0, -a - PI / 2] });
  }
  return { group: g };
}

export function dumbbellRack(n = 5) {
  const g = new THREE.Group();
  part(g, rbox(n * 0.32 + 0.2, 0.05, 0.5, 0.012, 1), M.frame, 1, [0, 0.5, 0], { rot: [0.25, 0, 0] });
  part(g, rbox(n * 0.32 + 0.2, 0.05, 0.5, 0.012, 1), M.frame, 1, [0, 0.85, -0.12], { rot: [0.25, 0, 0] });
  for (const s of [-1, 1]) part(g, rbox(0.06, 0.9, 0.5, 0.012, 1), M.frame, 1, [s * (n * 0.16 + 0.1), 0.45, -0.05]);
  const cols = [PALETTE.amber, PALETTE.coral, PALETTE.lime, PALETTE.cyan, PALETTE.violet];
  for (let i = 0; i < n; i++) {
    for (const [y, z] of [
      [0.6, 0.05],
      [0.95, -0.07],
    ]) {
      const d = dumbbell(0.85 + i * 0.07, cols[i % cols.length]);
      d.position.set(-n * 0.16 + 0.16 + i * 0.32, y, z);
      d.rotation.y = PI / 2;
      g.add(d);
    }
  }
  return { group: g };
}

export function kettlebell(color = PALETTE.coral, s = 1) {
  const g = new THREE.Group();
  part(g, GEO.sphere, mat(color, { rough: 0.4, metal: 0.3 }), [0.3 * s, 0.27 * s, 0.3 * s], [0, 0.135 * s, 0]);
  part(g, GEO.cyl, mat(color, { rough: 0.4, metal: 0.3 }), [0.16 * s, 0.03 * s, 0.16 * s], [0, 0.012 * s, 0], { cast: false });
  part(g, GEO.torus, M.frameDark, [0.2 * s, 0.2 * s, 0.4 * s], [0, 0.3 * s, 0]);
  return { group: g };
}

// ---------- the test wing's signature station ----------

const HAND = '"Marker Felt", "Chalkboard SE", "Comic Sans MS", "Bradley Hand", cursive';
const SUBJECTS = ['leftPad', 'isEven(2)', 'add(2, 2)', 'the button', 'true', 'Array.length'];
const TESTS = [
  'works',
  'still works',
  'is defined',
  'handles null',
  'handles null again',
  'returns true when true',
  'does not throw',
  'renders without crashing',
  'mock returns the mock',
  'expect(1).toBe(1)',
  'handles empty string',
  'handles empty empty string',
  'is not undefined',
  'snapshot matches snapshot',
  'works (2)',
  'works on Tuesdays',
  'calls the fn that calls the fn',
  'should should',
  'passes',
  'passes, but faster',
  'handles undefined, probably',
  'returns 4 (2 + 2)',
  'works (final)',
  'works (final final)',
  'type is type',
  'string is a string',
  'does the thing',
  'is idempotent-ish',
];

/**
 * TEST-WRITING WALL: a floor-to-ceiling whiteboard the robot faces, filled
 * with it('...') cases. Lines grow with the activity count and shrink as the
 * board runs out of room, because nobody ever stops to write the code.
 */
export function writeWallUnit(index = 0) {
  const g = new THREE.Group();
  const W = 2.36;
  const H = 3.1;
  const Z = 0.74;
  const board = new THREE.Group();
  board.position.set(0, 0.32 + H / 2, Z);
  board.rotation.y = PI;
  g.add(board);
  // aluminium frame with mitred corners, standoff mounts into the wall
  part(board, rbox(W + 0.06, H + 0.06, 0.03, 0.01, 2), mat(0xeeeeec, { rough: 0.6 }), 1, [0, 0, -0.03], { receive: true });
  // film80: a slate-green chalkboard in a varnished oak frame
  const frameM = F80 ? (M.lam ??= new THREE.MeshStandardMaterial({ map: laminateTexture(), roughness: 0.42 })) : M.alu;
  for (const [w, h, x, y] of [
    [W + 0.12, 0.06, 0, H / 2 + 0.03],
    [W + 0.12, 0.06, 0, -H / 2 - 0.03],
    [0.06, H + 0.12, W / 2 + 0.03, 0],
    [0.06, H + 0.12, -W / 2 - 0.03, 0],
  ])
    part(board, rbox(w, h, 0.05, 0.012, 2), frameM, 1, [x, y, -0.005]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) part(board, GEO.cylLo, M.chrome, [0.035, 0.08, 0.035], [sx * (W / 2 - 0.08), sy * (H / 2 - 0.08), -0.06], { rot: [PI / 2, 0, 0], cast: false });
  const tex = canvasTexture(512, 672, null, { aniso: 8 });
  const face = part(board, GEO.plane, new THREE.MeshStandardMaterial({ map: tex, roughness: F80 ? 0.86 : 0.18, metalness: 0, envMapIntensity: F80 ? 0.25 : 0.55 }), [W, H, 1], [0, 0, 0.001], { cast: false, receive: true });
  face.userData.keep = true;
  // marker tray with markers and an eraser
  part(board, rbox(W * 0.92, 0.035, 0.11, 0.012, 1), frameM, 1, [0, -H / 2 + 0.01, 0.06]);
  part(board, rbox(W * 0.92, 0.03, 0.01, 0.004, 1), frameM, 1, [0, -H / 2 + 0.035, 0.11], { cast: false });
  (F80 ? [0xf2efe4, 0xf0dc7a, 0xf2efe4, 0xe8a8b0] : [PALETTE.fail, 0x1d4fbf, 0x1b1d22, PALETTE.pass]).forEach((c, i) => {
    // film80: stubs of chalk instead of markers
    if (F80) return void part(board, GEO.cylLo, mat(c, { rough: 0.95, raw: true }), [0.024, 0.07 + (i % 2) * 0.03, 0.024], [-0.7 + i * 0.16, -H / 2 + 0.045, 0.06], { rot: [0, 0.3 * (i - 1.5), PI / 2], cast: false });
    part(board, GEO.cylLo, mat(0xf4f2ee, { rough: 0.5 }), [0.03, 0.13, 0.03], [-0.7 + i * 0.16, -H / 2 + 0.05, 0.06], { rot: [0, 0, PI / 2], cast: false });
    part(board, GEO.cylLo, mat(c, { rough: 0.5 }), [0.032, 0.04, 0.032], [-0.7 + i * 0.16 + 0.065, -H / 2 + 0.05, 0.06], { rot: [0, 0, PI / 2], cast: false });
  });
  part(board, rbox(0.16, 0.05, 0.06, 0.012, 1), mat(0x2b2f37, { rough: 0.8 }), 1, [0.55, -H / 2 + 0.055, 0.06], { cast: false });
  part(board, GEO.box, mat(0xe8e3d6, { rough: 1 }), [0.15, 0.012, 0.055], [0.55, -H / 2 + 0.028, 0.06], { cast: false });
  // magnets holding printouts at the top corner
  for (let k = 0; k < 2; k++) {
    part(board, GEO.plane, mat(0xffffff, { rough: 0.9 }), [0.24, 0.32, 1], [-W / 2 + 0.25 + k * 0.28, H / 2 - 0.3, 0.004], { rot: [0, 0, (k - 0.5) * 0.1], cast: false });
    part(board, GEO.cyl, mat([PALETTE.coral, PALETTE.cyan][k], { rough: 0.35 }), [0.05, 0.025, 0.05], [-W / 2 + 0.25 + k * 0.28, H / 2 - 0.16, 0.014], { rot: [PI / 2, 0, 0], cast: false });
  }
  // bin of dried-out markers beside the board
  const bin = new THREE.Group();
  bin.position.set(1.05, 0, 0.5);
  part(bin, GEO.cone, M.brushed, [0.26, 0.3, 0.26], [0, 0.15, 0], { rot: [PI, 0, 0] });
  for (let k = 0; k < 7; k++) part(bin, GEO.cylLo, mat([PALETTE.fail, 0x1d4fbf, 0x1b1d22][k % 3], { rough: 0.5 }), [0.03, 0.14, 0.03], [Math.cos(k * 2.3) * 0.06, 0.3, Math.sin(k * 2.3) * 0.06], { rot: [Math.cos(k) * 0.5, 0, Math.sin(k * 1.7) * 0.5], cast: false });
  g.add(bin);

  const subject = SUBJECTS[index % SUBJECTS.length];
  const seedLines = 8 + index * 5;
  let rs = 11 + index * 31;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const ghosts = Array.from({ length: 14 }, () => [rnd() * 460, 90 + rnd() * 540, 60 + rnd() * 160]);
  const name = (i) => TESTS[(i * 7 + index * 3) % TESTS.length];
  // chalk on slate (film80) or marker on gloss white
  const CK = F80 ? { head: '#f0dc7a', tally: '#f0a8b0', text: '#f2efe4', alt: '#a8d8f0', tick: '#b8f0a8', ghost: 'rgba(235,240,230,0.07)' } : { head: '#1d4fbf', tally: '#d6362b', text: '#1b1d22', alt: '#1d4fbf', tick: '#1f9d4a', ghost: 'rgba(110,120,140,0.07)' };

  function draw(n, partial, writing) {
    tex.userData.redraw((c, Wc, Hc) => {
      c.fillStyle = '#fbfbf7';
      c.fillRect(0, 0, Wc, Hc);
      if (F80) {
        // slate green, with the cloudy smears of a board wiped a thousand times
        c.fillStyle = '#24402f';
        c.fillRect(0, 0, Wc, Hc);
        let cs = 5 + index * 17;
        const cr = () => ((cs = (cs * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 46; i++) {
          const grd = c.createRadialGradient(0, 0, 0, 0, 0, 1);
          grd.addColorStop(0, `rgba(215,228,212,${0.03 + cr() * 0.06})`);
          grd.addColorStop(1, 'rgba(215,228,212,0)');
          c.save();
          c.translate(cr() * Wc, cr() * Hc);
          c.rotate(cr() * 3);
          c.scale(40 + cr() * 150, 16 + cr() * 50);
          c.fillStyle = grd;
          c.fillRect(-1, -1, 2, 2);
          c.restore();
        }
      }
      // a soft sheen band, as if the window light lands on the gloss
      const sheen = c.createLinearGradient(0, 0, Wc, Hc);
      sheen.addColorStop(0.3, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.42, F80 ? 'rgba(225,235,245,0.04)' : 'rgba(225,235,245,0.35)');
      sheen.addColorStop(0.55, 'rgba(255,255,255,0)');
      c.fillStyle = sheen;
      c.fillRect(0, 0, Wc, Hc);
      // ghosts of erased tests
      c.fillStyle = CK.ghost;
      for (const [x, y, w] of ghosts) c.fillRect(x, y, w, 9);
      c.textBaseline = 'alphabetic';
      c.textAlign = 'left';
      c.fillStyle = CK.head;
      c.font = `30px ${HAND}`;
      c.fillText(`describe('${subject}', () => {`, 16, 42, Wc - 130);
      // running tally
      c.textAlign = 'right';
      c.fillStyle = CK.tally;
      c.font = `800 52px ${FONT}`;
      c.fillText(String(n), Wc - 14, 52);
      c.font = `700 13px ${MONO}`;
      c.fillText('TESTS', Wc - 16, 70);
      // the cases: two columns, cramming smaller as the board fills
      const top = 92;
      const bottom = Hc - 44;
      const perCol = 22;
      const shown = Math.min(n, 150);
      const lh = shown <= perCol * 2 ? (bottom - top) / perCol : Math.max(5, ((bottom - top) * 2) / shown);
      const rows = Math.floor((bottom - top) / lh);
      const colW = Wc / 2 - 12;
      c.textAlign = 'left';
      for (let i = 0; i < shown; i++) {
        const col = Math.floor(i / rows);
        if (col > 1) break;
        const x = 14 + col * (colW + 10);
        const y = top + (i % rows) * lh + lh * 0.8;
        const last = i === shown - 1 && writing;
        let text = `it('${name(i)}')`;
        if (last) text = text.slice(0, Math.max(3, Math.floor(text.length * partial)));
        c.font = `${Math.max(5, Math.round(lh * 0.74))}px ${HAND}`;
        c.fillStyle = i % 9 === 4 ? CK.alt : CK.text;
        c.fillText(text, x, y, colW - lh);
        if (!last) {
          c.strokeStyle = CK.tick;
          c.lineWidth = Math.max(1.5, lh * 0.12);
          c.lineCap = 'round';
          const tx = x + colW - lh * 0.9;
          c.beginPath();
          c.moveTo(tx, y - lh * 0.3);
          c.lineTo(tx + lh * 0.22, y - lh * 0.05);
          c.lineTo(tx + lh * 0.6, y - lh * 0.6);
          c.stroke();
        }
      }
      c.fillStyle = CK.head;
      c.font = `30px ${HAND}`;
      c.fillText('})', 16, Hc - 14);
      if (index === 1) {
        // the sticky note nobody reads
        c.save();
        c.translate(Wc - 120, Hc - 96);
        c.rotate(-0.08);
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillRect(3, 4, 104, 84);
        c.fillStyle = '#ffe873';
        c.fillRect(0, 0, 104, 84);
        c.fillStyle = '#1b1d22';
        c.font = `17px ${HAND}`;
        c.fillText('TODO:', 8, 26);
        c.fillText('write the', 8, 50);
        c.fillText('actual code', 8, 72);
        c.restore();
      }
    });
  }

  let key = '';
  let lastN = seedLines;
  draw(lastN, 1, false);
  return {
    group: g,
    update(now, o) {
      const active = !!o && o.kind === 'write-tests';
      let n = lastN;
      let partial = 1;
      if (active) {
        const a = o.v.activity;
        const age = actAge(a, now, 5200);
        const count = a?.count ?? 1;
        const step = 650;
        n = seedLines + count * 3 + Math.min(8, Math.floor(age / step)) + 1;
        partial = (age % step) / step;
        lastN = n;
      }
      const k = active ? `${n}|${Math.floor(partial * 8)}` : `${n}|idle`;
      if (k === key) return;
      key = k;
      draw(n, partial, active);
    },
  };
}

// ---------- the production code corner ----------

/** PRODUCTION CODE: one rickety desk, an old laptop, a 1 kg dumbbell and a take-a-number dispenser. */
export function prodDeskUnit() {
  const g = new THREE.Group();
  const desk = new THREE.Group();
  desk.position.set(0, 0, 0.5);
  desk.rotation.z = 0.025; // one leg is shorter
  const wood = mat(0x8a7356, { rough: 0.85 });
  part(desk, rbox(0.74, 0.04, 0.48, 0.01, 1), wood, 1, [0, 0.9, 0]);
  part(desk, GEO.box, mat(0x6e5a40, { rough: 0.9 }), [0.66, 0.1, 0.02], [0, 0.83, 0.21], { cast: false });
  for (const [x, z, h] of [
    [-0.32, -0.19, 0.9],
    [0.32, -0.19, 0.88],
    [-0.32, 0.19, 0.9],
    [0.32, 0.19, 0.86],
  ])
    part(desk, GEO.box, mat(0x5d5a55, { rough: 0.6, metal: 0.4 }), [0.035, h, 0.035], [x, h / 2, z]);
  // a folded coaster under the short leg
  part(desk, GEO.box, mat(0xd8cfa8, { rough: 0.9 }), [0.07, 0.02, 0.07], [0.32, 0.01, 0.19], { cast: false });
  // dust
  const dust = new THREE.MeshBasicMaterial({ color: 0xbdb6a6, transparent: true, opacity: 0.35, depthWrite: false });
  for (const [x, z, sx] of [
    [-0.2, 0.12, 0.2],
    [0.18, -0.1, 0.14],
  ])
    part(desk, GEO.plane, dust, [sx, sx * 0.6, 1], [x, 0.922, z], { rot: [-PI / 2, 0, 0.4], cast: false });
  // old beige laptop, thick
  const lap = new THREE.Group();
  lap.position.set(0, 0.92, -0.02);
  const beige = mat(0xcfc6ad, { rough: 0.7 });
  part(lap, rbox(0.44, 0.05, 0.3, 0.012), beige, 1, [0, 0.025, 0]);
  const lid = new THREE.Group();
  lid.position.set(0, 0.05, 0.14);
  lid.rotation.x = 0.3;
  part(lid, rbox(0.44, 0.3, 0.03, 0.01), beige, 1, [0, 0.15, 0]);
  const code = canvasTexture(
    128,
    96,
    (c, W, H) => {
      c.fillStyle = '#10151c';
      c.fillRect(0, 0, W, H);
      c.font = `600 9px ${MONO}`;
      c.fillStyle = '#7f8b78';
      ['function main() {', '  // TODO', '  // TODO later', '  return 42;', '}', '', '// last edited:', '// a long time ago'].forEach((t, i) => c.fillText(t, 6, 14 + i * 10.5));
    },
    { aniso: 2 },
  );
  const screenM = new THREE.MeshBasicMaterial({ map: code, color: 0x9a9a9a, toneMapped: false });
  part(lid, GEO.plane, screenM, [0.38, 0.25, 1], [0, 0.15, -0.016], { rot: [0, PI, 0], cast: false });
  // OUT OF ORDER note on the back of the lid (faces the room)
  const note = canvasTexture(128, 96, (c, W, H) => {
    c.fillStyle = '#fff6c9';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#c0392b';
    c.font = `800 30px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('OUT OF', W / 2, 40);
    c.fillText('ORDER', W / 2, 76);
  });
  part(lid, GEO.plane, new THREE.MeshStandardMaterial({ map: note, roughness: 0.9 }), [0.22, 0.165, 1], [0.04, 0.16, 0.017], { rot: [0, 0, 0.12], cast: false });
  lap.add(lid);
  desk.add(lap);
  // a cold mug of coffee with a skin on it
  part(desk, GEO.cyl, mat(0xe9e4da, { rough: 0.5 }), [0.08, 0.1, 0.08], [-0.27, 0.97, 0.12], { cast: false });
  part(desk, GEO.cyl, mat(0x3a2a1c, { rough: 0.3 }), [0.068, 0.005, 0.068], [-0.27, 1.015, 0.12], { cast: false });
  // the 1 kg dumbbell, pink, with a tag
  const db = dumbbell(0.55, 0xf29ab8);
  db.position.set(0.27, 0.95, 0.1);
  db.rotation.y = 0.5;
  desk.add(db);
  const tag = canvasTexture(64, 32, (c, W, H) => {
    c.fillStyle = '#f7f1e1';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#16171b';
    c.font = `800 22px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('1 kg', W / 2, 25);
  });
  part(desk, GEO.plane, new THREE.MeshStandardMaterial({ map: tag, roughness: 0.9, side: THREE.DoubleSide }), [0.09, 0.045, 1], [0.27, 0.935, 0.24], { rot: [-0.3, 0, 0], cast: false });
  g.add(desk);
  // a wobbly office chair nobody sits in
  const chair = new THREE.Group();
  chair.position.set(-0.55, 0, -0.1);
  chair.rotation.y = 0.6;
  part(chair, GEO.cylLo, M.frameDark, [0.04, 0.42, 0.04], [0, 0.23, 0], { cast: false });
  part(chair, rbox(0.42, 0.06, 0.4, 0.02, 1), mat(0x4a4f45, { rough: 0.9 }), 1, [0, 0.46, 0]);
  part(chair, rbox(0.4, 0.42, 0.05, 0.02, 1), mat(0x4a4f45, { rough: 0.9 }), 1, [0, 0.72, -0.2], { rot: [-0.15, 0, 0.06] });
  for (let i = 0; i < 5; i++) part(chair, GEO.box, M.frameDark, [0.04, 0.03, 0.26], [Math.sin((i / 5) * PI * 2) * 0.13, 0.03, Math.cos((i / 5) * PI * 2) * 0.13], { rot: [0, (i / 5) * PI * 2, 0], cast: false });
  g.add(chair);
  // take-a-number dispenser
  const tn = new THREE.Group();
  tn.position.set(0.85, 0, 0.15);
  part(tn, GEO.cyl, mat(0x5d5a55, { rough: 0.6, metal: 0.4 }), [0.04, 1.2, 0.04], [0, 0.6, 0]);
  part(tn, GEO.cyl, mat(0x5d5a55, { rough: 0.6, metal: 0.4 }), [0.3, 0.03, 0.3], [0, 0.015, 0]);
  part(tn, rbox(0.16, 0.2, 0.14, 0.04), mat(0xc0392b, { rough: 0.5 }), 1, [0, 1.28, 0]);
  const serving = led(tn, 0.3, 0.12, [0, 1.48, 0], { px: 128, rot: [0, -0.6, 0] });
  serving.set('s', (c, W, H) => ledText(c, W, H, ['NOW SERVING', '0001'], ['#ff6b5a', '#ff6b5a']));
  g.add(tn);
  return {
    group: g,
    update(now, o) {
      const on = !!o && o.kind === 'edit';
      if (on) code.offset.y = -((now * 0.00004) % 1);
      // the screen flickers like it has been on since 2014
      screenM.color.setScalar(on ? 0.8 + (Math.sin(now * 0.05) > 0.92 ? -0.4 : 0) : 0.35);
    },
  };
}

// ---------- the juice bar ----------

/** Low upholstered pouf: the robot sits with its back to the bar counter. */
export function stoolUnit() {
  const g = new THREE.Group();
  const body = cached('pouf', () => {
    const prof = [
      [0, 0],
      [0.42, 0],
      [0.48, 0.04],
      [0.5, 0.2],
      [0.5, 0.78],
      [0.47, 0.94],
      [0.4, 1.0],
      [0, 1.0],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(prof, 28);
  });
  // film80: burgundy vinyl bar stools with a chrome foot ring
  part(g, body, F80 ? mat(0x5e1722, { rough: 0.42, raw: true }) : mat(0xe7d9c3, { rough: 0.95 }), [0.48, DIM.seat - 0.03, 0.48], [0, 0, -0.04]);
  part(g, GEO.cyl, F80 ? mat(0x6e1c28, { rough: 0.35, raw: true }) : mat(0xff8a5c, { rough: 0.85 }), [0.4, 0.03, 0.4], [0, DIM.seat - 0.02, -0.04], { cast: false });
  part(g, GEO.torus, F80 ? M.chrome : mat(0xd4c3a8, { rough: 0.9 }), [0.48, 0.48, 0.3], [0, 0.12, -0.04], { rot: [PI / 2, 0, 0], cast: false });
  return { group: g };
}

/** High-top table shared by two standing robots (built by the first slot of a pair). */
export function highTableUnit() {
  const g = new THREE.Group();
  const t = new THREE.Group();
  t.position.set(0, 0, 0.575);
  part(t, GEO.cyl, M.brushed, [0.44, 0.03, 0.44], [0, 0.015, 0]);
  part(t, GEO.cyl, M.brushed, [0.05, 1.0, 0.05], [0, 0.5, 0]);
  part(t, GEO.cyl, M.brushed, [0.28, 0.015, 0.28], [0, 0.32, 0], { cast: false });
  part(t, GEO.cyl, mat(0xf6f3ee, { rough: 0.2 }), [0.68, 0.04, 0.68], [0, 1.02, 0]);
  part(t, GEO.cyl, woodMat(), [0.7, 0.012, 0.7], [0, 0.995, 0], { cast: false });
  cup(t, -0.12, 1.04, 0.05, 0x7cd35a);
  cup(t, 0.14, 1.04, -0.08, 0xff7a9a);
  g.add(t);
  return { group: g };
}

function cup(parent, x, y, z, color) {
  const c = part(parent, GEO.cone, M.glass, [0.09, 0.16, 0.09], [x, y + 0.08, z], { rot: [PI, 0, 0], cast: false });
  c.userData.keep = true;
  part(parent, GEO.cone, mat(color, { rough: 0.35 }), [0.075, 0.12, 0.075], [x, y + 0.065, z], { rot: [PI, 0, 0], cast: false });
  part(parent, GEO.cylLo, mat(0xffffff, { rough: 0.5 }), [0.012, 0.2, 0.012], [x + 0.02, y + 0.2, z], { rot: [0, 0, 0.2], cast: false });
  part(parent, GEO.sphereLo, mat(0xf4e04d, { rough: 0.5 }), [0.05, 0.05, 0.015], [x - 0.04, y + 0.155, z], { rot: [0, 0, 0.6], cast: false });
}

/** JUICE BAR counter, back bar, dispensers and a glowing menu board (station space, behind the poufs). */
export function juiceBar(slots) {
  const g = new THREE.Group();
  const xs = slots.slice(0, 4).map((s) => s.pos.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2 + 0.25;
  const z = slots[0].pos.z - 0.72;
  const len = 5.6;
  const bar = new THREE.Group();
  bar.position.set(cx, 0, z);
  g.add(bar);
  // counter: slatted oak front over a dark kick plate, white stone top with a bullnose
  const oak = F80 ? new THREE.MeshStandardMaterial({ map: laminateTexture(), color: 0xd9c0a0, roughness: 0.42 }) : new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0xf2d7b0, roughness: 0.55 });
  part(bar, rbox(len, 0.94, 0.56, 0.02, 2), oak, 1, [0, 0.53, 0], { receive: true });
  part(bar, rbox(len - 0.04, 0.1, 0.5, 0.01, 1), M.frameDark, 1, [0, 0.05, -0.02], { cast: false });
  // film80: padded burgundy vinyl front with a chrome kick rail, mustard formica top
  for (let i = 0; i < 28; i++) part(bar, rbox(0.06, 0.82, 0.03, 0.012, 1), F80 ? mat(i % 7 === 3 ? 0x54141e : 0x641a25, { rough: 0.4, raw: true }) : mat(0xd2ae7c, { rough: 0.6 }), 1, [-len / 2 + 0.12 + (i * (len - 0.24)) / 27, 0.53, 0.285], { cast: false });
  if (F80) part(bar, GEO.cyl, M.chrome, [0.04, len - 0.1, 0.04], [0, 0.2, 0.36], { rot: [0, 0, PI / 2], cast: false });
  part(bar, rbox(len + 0.14, 0.07, 0.68, 0.03, 2), F80 ? mat(0xb98f3a, { rough: 0.3, raw: true }) : mat(0xf7f5f0, { rough: 0.14, metal: 0.0 }), 1, [0, 1.03, 0], { receive: true });
  // warm LED strip under the stone lip
  const strip = part(bar, GEO.box, boost(new THREE.MeshBasicMaterial({ color: 0xffc27a, toneMapped: false }), 1.6), [len - 0.1, 0.02, 0.02], [0, 0.985, 0.31], { cast: false });
  strip.userData.keep = true;
  // goods on the counter
  for (let i = 0; i < 6; i++) cup(bar, -2.2 + i * 0.85, 1.065, 0.05 + (i % 2) * 0.1, [0x7cd35a, 0xff7a9a, 0xffb238, 0x9b6bff][i % 4]);
  const bowl = new THREE.Group();
  bowl.position.set(1.9, 1.065, -0.05);
  part(bowl, GEO.sphere, mat(0xf3efe7, { rough: 0.3 }), [0.38, 0.16, 0.38], [0, 0.04, 0]);
  [
    [0xffa31a, 0.07, 0.07],
    [0x7cd35a, -0.08, 0.02],
    [0xff6b5a, 0.02, -0.08],
    [0xf4e04d, -0.04, 0.09],
    [0xffa31a, 0.09, -0.05],
  ].forEach(([c, x, zz]) => part(bowl, GEO.sphere, mat(c, { rough: 0.45 }), 0.11, [x, 0.12, zz], { cast: false }));
  bar.add(bowl);
  // a pineapple, because juice bars are legally required to have one
  const pine = new THREE.Group();
  pine.position.set(2.45, 1.07, 0.02);
  part(pine, GEO.sphere, mat(0xd9a43a, { rough: 0.7 }), [0.14, 0.22, 0.14], [0, 0.11, 0]);
  for (let i = 0; i < 7; i++) part(pine, GEO.cone, mat(0x3f8f4e, { rough: 0.6 }), [0.03, 0.18, 0.012], [0, 0.27, 0], { rot: [Math.cos(i) * 0.5, i * 0.9, Math.sin(i) * 0.5], cast: false });
  bar.add(pine);
  // back bar: cabinets, stone top, juice dispensers, a blender and shelves of bottles
  const back = new THREE.Group();
  back.position.set(cx, 0, z - 0.95);
  g.add(back);
  part(back, rbox(len * 0.85, 0.9, 0.42, 0.02, 2), oak, 1, [0, 0.45, 0], { receive: true });
  for (let i = 0; i < 6; i++) part(back, rbox(0.7, 0.72, 0.01, 0.005, 1), mat(0xdcb98a, { rough: 0.6 }), 1, [-len * 0.425 + 0.4 + i * 0.8, 0.46, 0.215], { cast: false });
  part(back, rbox(len * 0.85 + 0.08, 0.04, 0.48, 0.015, 1), mat(0xf7f5f0, { rough: 0.15 }), 1, [0, 0.92, 0]);
  const blender = new THREE.Group();
  blender.position.set(-1.2, 0.94, 0);
  part(blender, rbox(0.18, 0.14, 0.18, 0.03), mat(0x2b2f37, { rough: 0.3, metal: 0.4 }), 1, [0, 0.07, 0]);
  part(blender, GEO.cyl, glow(0x7cf29a), [0.02, 0.01, 0.02], [0.05, 0.1, 0.091], { rot: [PI / 2, 0, 0], cast: false });
  const jar = part(blender, GEO.cone, M.glass, [0.17, 0.3, 0.17], [0, 0.29, 0], { rot: [PI, 0, 0], cast: false });
  jar.userData.keep = true;
  part(blender, GEO.cyl, mat(0x2b2f37, { rough: 0.4 }), [0.19, 0.04, 0.19], [0, 0.46, 0], { cast: false });
  const blend = dyn(part(blender, GEO.cone, mat(0x7cd35a, { rough: 0.4 }), [0.14, 0.16, 0.14], [0, 0.23, 0], { rot: [PI, 0, 0], cast: false }));
  back.add(blender);
  // two juice dispensers with lit liquid
  for (const [x, c] of [
    [0.9, 0xffa31a],
    [1.45, 0xff6f91],
  ]) {
    const d = new THREE.Group();
    d.position.set(x, 0.94, 0);
    part(d, rbox(0.34, 0.12, 0.3, 0.02, 1), M.brushed, 1, [0, 0.06, 0]);
    const tank = part(d, GEO.cyl, M.glass, [0.28, 0.44, 0.28], [0, 0.36, 0], { cast: false });
    tank.userData.keep = true;
    part(d, GEO.cyl, mat(c, { rough: 0.15, emissive: c, ei: 0.35 }), [0.25, 0.3, 0.25], [0, 0.3, 0], { cast: false });
    part(d, GEO.cyl, M.brushed, [0.3, 0.05, 0.3], [0, 0.6, 0], { cast: false });
    part(d, GEO.cylLo, M.chrome, [0.03, 0.08, 0.03], [0, 0.1, 0.17], { cast: false });
    back.add(d);
  }
  // bottles along the back counter
  for (let i = 0; i < 9; i++) {
    const c = [0x7cd35a, 0xff7a9a, 0xffb238, 0x59c3f0, 0xf4e04d][i % 5];
    const b = part(back, GEO.cyl, new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 1.3 }), [0.1, 0.28 - (i % 3) * 0.04, 0.1], [-0.55 + i * 0.13, 1.08 - (i % 3) * 0.02, -0.08], { cast: false });
    b.userData.keep = true;
    part(back, GEO.cylLo, mat(0xf4f2ee, { rough: 0.4 }), [0.05, 0.04, 0.05], [-0.55 + i * 0.13, 1.24 - (i % 3) * 0.04, -0.08], { cast: false });
  }
  // menu board on posts: every non-test activity, as a drink
  const menu = new THREE.Group();
  menu.position.set(cx, 0, z - 1.25);
  g.add(menu);
  for (const s of [-1, 1]) part(menu, rbox(0.06, 2.3, 0.06, 0.012, 1), M.frame, 1, [s * 1.55, 1.15, 0]);
  part(menu, rbox(3.36, 1.3, 0.08, 0.04), mat(0x15201b, { rough: 0.6 }), 1, [0, 1.72, 0]);
  const mt = canvasTexture(1024, 368, (c, W, H) => {
    c.fillStyle = '#1f2b25';
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';
    c.fillStyle = '#ffb07a';
    c.shadowColor = '#ff8a5c';
    c.shadowBlur = 18;
    c.font = `800 84px ${FONT}`;
    c.fillText('JUICE BAR', W / 2, 96);
    c.shadowBlur = 0;
    const items = [
      ['LINT LEMONADE', '4'],
      ['TYPECHECK TEA', '4'],
      ['GREP-FRUIT JUICE', '3'],
      ['REBASE ROOIBOS', '5'],
      ['CI COLD BREW', '∞'],
      ['DOCKER DETOX', '6'],
      ['PUSH PROTEIN', '5'],
      ['BUILD BULK SHAKE', '7'],
    ];
    c.font = `600 27px ${MONO}`;
    items.forEach(([n, p], i) => {
      const col = i % 2;
      const x = 60 + col * 490;
      const y = 172 + Math.floor(i / 2) * 50;
      c.textAlign = 'left';
      c.fillStyle = '#f4efe6';
      c.fillText(n, x, y);
      c.textAlign = 'right';
      c.fillStyle = '#ffb07a';
      c.fillText(p, x + 420, y);
    });
  });
  const mm = part(menu, GEO.plane, boost(new THREE.MeshBasicMaterial({ map: mt, toneMapped: false }), 1.3), [3.22, 1.16, 1], [0, 1.72, 0.042], { cast: false });
  mm.userData.keep = true;
  // a small neon cup glowing on top of the menu board
  part(menu, GEO.torus, boost(new THREE.MeshBasicMaterial({ color: 0xff8a5c, toneMapped: false }), 3.5), [0.2, 0.2, 0.2], [1.3, 2.52, 0], { cast: false });
  return {
    group: g,
    update(now, occs) {
      const busy = occs.some((o) => o);
      blend.rotation.y = busy ? now * 0.05 : 0;
      blend.scale.y = 0.16 * (busy ? 1 + Math.sin(now * 0.08) * 0.08 : 1);
    },
  };
}

// keep the helper for callers that draw rounded labels on canvases
export { roundRect };
