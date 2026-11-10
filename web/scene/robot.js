// Procedural clanker: a toy-like gym robot with a glossy painted chassis, an LED
// face screen, absurd arm cannons and spindly legs in big sneakers, dressed by
// archetype and outfit and posed every frame for the station it is using.
// Arms scale with test volume. Legs never do: this gym skips leg day.
//
// Rendering: every static part is rigidly skinned to a bone and merged per
// material, so a whole robot is ~10 draw calls plus whatever gear it has earned.
import * as THREE from 'three';
import { cyc } from './rhythm.js';
import { FONT, F80, realColor } from './materials.js';
import { BODY, POSES, KNOWN, newPose, resetPose, plantHips, walkCycle } from './robot-poses.js';
import { Rig, lathe, rbox, capsule, sphere, cyl, torus, helix, xf, gearMesh, canvasTex, paintMat, sharedMats, lum, fabricMat, shoeMat, topAtlas, lowAtlas, shoeAtlas, PAINT, TOP, LOW, SHOE } from './robot-kit.js';
import { drawFace, FACE_W, FACE_H, MOOD } from './robot-face.js';

export { BODY };

const PI = Math.PI;
/** Robots are drawn a bit larger than the equipment's nominal 1 m frame so they read in the wide shot; poses divide contact heights by the scale. */
const ROBOT_SCALE = 1.18;
const { HIP_Y, THIGH, SHIN, FOOT, SHOULDER_Y, UPPER, FORE, HAND, NECK_Y } = BODY;

const COL = { amber: 0xffb238, pass: 0x3ddc84, fail: 0xff4d4d, skip: 0x8a8f99, stall: 0xffb238, wobble: 0xb06bff, lime: 0xb8f25c, coral: 0xff6b5a };

// Torso silhouettes: normalized [radius, t] with t running waist (0) to neck (1).
const PROFILE = {
  barrel: [
    [0.62, 0],
    [0.8, 0.08],
    [0.93, 0.26],
    [0.99, 0.5],
    [1, 0.7],
    [0.93, 0.86],
    [0.7, 0.96],
    [0.4, 1.0],
  ],
  slim: [
    [0.72, 0],
    [0.8, 0.12],
    [0.86, 0.36],
    [0.96, 0.62],
    [1, 0.78],
    [0.9, 0.9],
    [0.6, 0.98],
    [0.38, 1.0],
  ],
  egg: [
    [0.78, 0],
    [0.93, 0.13],
    [1, 0.36],
    [0.98, 0.58],
    [0.88, 0.78],
    [0.68, 0.92],
    [0.4, 1.0],
  ],
  vtaper: [
    [0.56, 0],
    [0.62, 0.12],
    [0.76, 0.36],
    [0.94, 0.62],
    [1, 0.78],
    [0.9, 0.9],
    [0.62, 0.98],
    [0.38, 1.0],
  ],
  box: [
    [0.84, 0],
    [0.93, 0.08],
    [0.98, 0.3],
    [1, 0.6],
    [0.98, 0.82],
    [0.84, 0.94],
    [0.5, 1.0],
  ],
};
const CANNON = [
  [0.028, -0.105],
  [0.05, -0.08],
  [0.064, -0.035],
  [0.066, 0.01],
  [0.058, 0.055],
  [0.04, 0.09],
  [0.022, 0.11],
];
const cannonR = (y) => {
  for (let i = 1; i < CANNON.length; i++) if (y <= CANNON[i][1]) return CANNON[i - 1][0] + ((CANNON[i][0] - CANNON[i - 1][0]) * (y - CANNON[i - 1][1])) / (CANNON[i][1] - CANNON[i - 1][1]);
  return CANNON[CANNON.length - 1][0];
};
const rAt = (prof, t) => {
  for (let i = 1; i < prof.length; i++) if (t <= prof[i][1]) return prof[i - 1][0] + ((prof[i][0] - prof[i - 1][0]) * (t - prof[i - 1][1])) / (prof[i][1] - prof[i - 1][1]);
  return prof[prof.length - 1][0];
};

const ARCH = {
  powerbuilder: { id: 'powerbuilder', w: 0.66, d: 0.36, prof: 'barrel', top: 'tank', belt: true, shorts: 0.1, decal: 'ASSERT', decalSize: 70, stance: 0.06, ant: 0.09, head: 0.97 },
  cardio: { id: 'cardio', w: 0.42, d: 0.28, prof: 'slim', top: 'singlet', bib: true, visor: true, shorts: 0.05, split: true, stance: -0.02, ant: 0.2, head: 1.0 },
  yogi: { id: 'yogi', w: 0.48, d: 0.35, prof: 'egg', top: 'long', leggings: true, mat: true, shorts: 0, decal: 'ZEN', decalSize: 60, sub: 'it.skip()', stance: 0, ant: 0.12, head: 1.0 },
  crossfit: { id: 'crossfit', w: 0.56, d: 0.31, prof: 'vtaper', top: 'compression', kneeSleeves: true, socks: true, shorts: 0.08, decal: 'RE-RUN', decalSize: 62, stance: 0.03, ant: 0.12, head: 0.98 },
  rookie: { id: 'rookie', w: 0.46, d: 0.31, prof: 'box', top: 'tee', tag: true, shorts: 0.15, decal: 'DAY 1', decalSize: 66, sub: "it('works')", stance: -0.01, ant: 0.15, head: 1.04 },
};

// ---------- shared prop geometry/materials ----------

let PROPS = null;
function propKit() {
  if (PROPS) return PROPS;
  const canTex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#1f6f5a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b8f25c';
    g.fillRect(0, h * 0.34, w, h * 0.3);
    g.fillStyle = '#10241d';
    g.font = `22px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('COOLANT', w / 2, h * 0.5);
    g.fillStyle = '#c9ced6';
    g.fillRect(0, 0, w, h * 0.1);
    g.fillRect(0, h * 0.9, w, h * 0.1);
  }, { text: true });
  const markerTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#f4f2ec';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff6b5a';
    g.fillRect(0, 0, w, h * 0.3);
    g.fillRect(0, h * 0.86, w, h * 0.14);
    g.fillStyle = '#16171b';
    g.fillRect(0, h * 0.5, w, h * 0.12);
  });
  const cupTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#ffd1dc');
    gr.addColorStop(0.5, '#ff7a9a');
    gr.addColorStop(1, '#ff9f5a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w * 0.75, h);
    g.fillStyle = '#f7f6f2';
    g.fillRect(0, 0, w * 0.75, h * 0.14);
    g.fillStyle = '#7cd35a';
    g.fillRect(w * 0.75, 0, w * 0.25, h);
  });
  const lid = [0.76, 0.86, 1, 1];
  PROPS = {
    can: new THREE.MeshPhysicalMaterial({ map: canTex, metalness: 0.6, roughness: 0.28, clearcoat: 0.6 }),
    canGeo: cyl(0.036, 0.036, 0.12, 16),
    marker: new THREE.MeshPhysicalMaterial({ map: markerTex, roughness: 0.4, clearcoat: 0.5 }),
    markerGeo: lathe(
      [
        [0.004, -0.075],
        [0.009, -0.07],
        [0.014, -0.055],
        [0.014, 0.06],
        [0.016, 0.065],
        [0.016, 0.075],
      ],
      { seg: 10, smooth: false },
    ),
    cup: new THREE.MeshPhysicalMaterial({ map: cupTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
    cupGeo: (() => {
      const body = K_fit(
        lathe(
          [
            [0.026, -0.06],
            [0.034, 0.0],
            [0.04, 0.05],
            [0.043, 0.055],
            [0.03, 0.075],
            [0.006, 0.08],
          ],
          { seg: 18, n: 12 },
        ),
        [0, 0, 0.75, 1],
      );
      const straw = K_fit(xf(cyl(0.005, 0.005, 0.11, 6), { p: [0.012, 0.11, 0], r: [0, 0, -0.25] }), lid);
      return mergeGeo([body, straw]);
    })(),
  };
  return PROPS;
}
function K_fit(geo, rect) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
  return geo;
}
function mergeGeo(list) {
  const meshes = list.map((geo) => new THREE.Mesh(geo));
  // tiny local merge (same attributes, all indexed)
  let nv = 0;
  let ni = 0;
  for (const m of meshes) {
    nv += m.geometry.attributes.position.count;
    ni += m.geometry.index.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const m of meshes) {
    const a = m.geometry.attributes;
    pos.set(a.position.array, vo * 3);
    nor.set(a.normal.array, vo * 3);
    uv.set(a.uv.array, vo * 2);
    const ix = m.geometry.index.array;
    for (let i = 0; i < ix.length; i++) idx[io++] = ix[i] + vo;
    vo += a.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

let BAR = null;
function barKit() {
  if (BAR) return BAR;
  const phys = (c, o = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25, ...o });
  BAR = {
    bar: lathe(
      [
        [0.016, -0.73],
        [0.016, -0.5],
        [0.022, -0.49],
        [0.022, 0.49],
        [0.016, 0.5],
        [0.016, 0.73],
      ],
      { seg: 14, smooth: false },
    ),
    plate: lathe(
      [
        [0.03, -0.035],
        [0.2, -0.035],
        [0.22, -0.028],
        [0.225, 0],
        [0.22, 0.028],
        [0.2, 0.035],
        [0.03, 0.035],
      ],
      { seg: 36, smooth: false },
    ),
    small: lathe(
      [
        [0.03, -0.025],
        [0.14, -0.025],
        [0.158, -0.018],
        [0.16, 0],
        [0.158, 0.018],
        [0.14, 0.025],
        [0.03, 0.025],
      ],
      { seg: 32, smooth: false },
    ),
    collar: cyl(0.04, 0.04, 0.045, 16),
    m: {
      idle: phys(0x26282e),
      pass: phys(0x3ddc84, { emissive: 0x1f6b35, emissiveIntensity: 0.55 }),
      fail: phys(0xff4d4d, { emissive: 0x6b1010, emissiveIntensity: 0.55 }),
      skip: phys(0x8a8f99),
      stall: phys(0xffb238, { emissive: 0x5a3a00, emissiveIntensity: 0.5 }),
      lime: phys(0xb8f25c),
    },
  };
  return BAR;
}

/** Barbell owned by a robot: plates recolour by rep status and squash for rebases. */
function barbellProp() {
  const k = barKit();
  const S = sharedMats();
  const g = new THREE.Group();
  const bar = new THREE.Mesh(k.bar, S.chrome);
  bar.rotation.z = PI / 2;
  g.add(bar);
  const big = [];
  const small = [];
  const collars = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(k.plate, k.m.idle);
    b.rotation.z = PI / 2;
    b.position.x = s * 0.6;
    b.castShadow = true;
    g.add(b);
    big.push(b);
    const sm = new THREE.Mesh(k.small, k.m.idle);
    sm.rotation.z = PI / 2;
    sm.position.x = s * 0.665;
    g.add(sm);
    small.push(sm);
    const c = new THREE.Mesh(k.collar, S.dark);
    c.rotation.z = PI / 2;
    c.position.x = s * 0.54;
    g.add(c);
    collars.push(c);
  }
  let key = '';
  return {
    group: g,
    setPlates(status, kind) {
      const kk = `${status}|${kind}`;
      if (kk === key) return;
      key = kk;
      const m = kind === 'fail' || status === 'fail' ? k.m.fail : kind === 'stalled' ? k.m.stall : status === 'pass' ? k.m.pass : status === 'skip' ? k.m.skip : k.m.idle;
      for (const p of big) p.material = m;
      for (const p of small) p.material = kind === 'rebase' ? k.m.lime : m;
    },
    squash(v) {
      for (const p of small) p.scale.y = 1 - v * 0.75;
    },
  };
}

// ---------- robot ----------

/**
 * Build one clanker for `look` (from core/evolution.js). `opts.helper` makes a
 * mini spotter drone with a rotor and a thruster instead of legs.
 */
export function createRobot(look, { helper = false } = {}) {
  const arch = ARCH[look.archetype] ?? ARCH.rookie;
  const outfit = look.outfit ?? { top: look.shirt ?? 0x2ec4b6, shorts: 0x1d1f26, headband: 0xff4d4d, shoes: 0xf2f2f2 };
  // seed stays the same formula props.js relies on (slot lever, PR bell sync)
  const seed = ((look.skin ?? 0) % 997) / 997 + (look.height ?? 1) * 7;
  const W = arch.w;
  const D = arch.d;
  const prof = PROFILE[arch.prof];
  const S = sharedMats();

  const skinColor = look.skin ?? 0xc9ced6;
  // A known model wears its maker's kit: those colours have to stay recognizable, so they
  // skip the film80 desaturation and carry a little self-fill against the coloured set lights.
  const brand = !!look.vendor;
  const jersey = look.jersey ? String(look.jersey) : null;
  const paint = paintMat(skinColor, brand);
  const baseColor = F80 ? (brand ? brandPaint(skinColor) : realColor(skinColor, 0.5, 0.7)[0]) : new THREE.Color(skinColor);
  // a black chassis must not turn grey-brown with reflected room light
  if (brand && baseColor.r + baseColor.g + baseColor.b < 0.6) {
    paint.envMapIntensity = 0.3;
    paint.clearcoat = Math.min(paint.clearcoat, 0.35);
    paint.metalness = 0.15;
    paint.roughness = 0.5;
  }
  const hot = new THREE.Color(0xff5a3a);
  const heatK = brand ? 0.1 : 0.38;
  const num = 10 + (Math.round(seed * 997) % 89);
  let kit = null;
  if (brand || jersey) {
    const cand = [outfit.headband, outfit.shoes, outfit.shorts, 0x2a2c33].filter((c) => c !== outfit.top);
    const a = cand[0];
    const b = cand.find((c) => c !== a) ?? a;
    kit = { jersey, accents: brand ? [a, b] : null };
  }
  // self-fill is for colours: a white kit gets none (and sits a little under paper white) or it blooms on film
  const fillFor = (c) => {
    if (!brand || !F80) return 0;
    const l = lum(c);
    return l > 0.8 ? -1 : Math.round(0.24 * (1 - l) * 100) / 100;
  };
  const topTex = topAtlas(arch, outfit.top, outfit.headband, num, kit);
  const topM = fabricMat(topTex, outfit.top, `t|${arch.id}|${outfit.top}|${outfit.headband}|${num}|${jersey}|${brand}`, fillFor(outfit.top));
  const lowTex = lowAtlas(arch, outfit.shorts, outfit.headband);
  const lowM = fabricMat(lowTex, outfit.shorts, `l|${arch.id}|${outfit.shorts}|${outfit.headband}`, fillFor(outfit.shorts));
  const shoeM = shoeMat(shoeAtlas(outfit.shoes, outfit.headband), `${outfit.shoes}|${outfit.headband}`, fillFor(outfit.shoes));
  const glowM = new THREE.MeshBasicMaterial({ color: MOOD.norm, toneMapped: false });

  const root = new THREE.Group();
  root.name = 'robot';
  const rig = new Rig(root);

  // ---------- skeleton ----------
  const hips = rig.bone(root, 0, HIP_Y, 0, 'hips');
  const torso = rig.bone(hips, 0, 0, 0, 'torso');
  const chest = rig.bone(torso, 0, 0, 0, 'chest');
  const head = rig.bone(torso, 0, NECK_Y, 0, 'head');
  const ant0 = rig.bone(head, 0.1, 0.355, -0.05, 'ant0');
  const antLen = arch.ant;
  const ant1 = rig.bone(ant0, 0, 0.05 + antLen * 0.45, 0, 'ant1');
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = rig.bone(hips, s * 0.1, -0.02, 0, 'hip');
    const knee = rig.bone(hip, 0, -THIGH, 0, 'knee');
    const ankle = rig.bone(knee, 0, -SHIN, 0, 'ankle');
    legs.push({ s, hip, knee, ankle });
  }
  const arms = [];
  const shoulderX = W / 2 + 0.045;
  for (const s of [-1, 1]) {
    const shoulder = rig.bone(torso, s * shoulderX, SHOULDER_Y, 0, 'shoulder');
    const pad = rig.bone(shoulder, 0, 0.005, 0, 'pad');
    const bicep = rig.bone(shoulder, 0, -0.11, 0.012, 'bicep');
    const elbow = rig.bone(shoulder, 0, -UPPER, 0, 'elbow');
    const fore = rig.bone(elbow, 0, 0, 0, 'fore');
    const hand = rig.bone(elbow, 0, -FORE - HAND, 0, 'hand');
    const fingers = rig.bone(hand, 0, -0.034, 0, 'fingers');
    arms.push({ s, shoulder, pad, bicep, elbow, fore, hand, fingers });
  }

  // ---------- pelvis + shorts ----------
  const waistRx = Math.max(0.17, rAt(prof, 0) * (W / 2));
  const waistRz = Math.max(0.13, rAt(prof, 0) * (D / 2));
  if (!helper) {
    rig.add(
      hips,
      lathe(
        [
          [0.86, -0.1],
          [0.98, -0.04],
          [1.02, 0.04],
          [1.0, 0.1],
          [0.92, 0.13],
        ],
        { seg: 28, n: 10 },
      ),
      lowM,
      { s: [waistRx, 1, waistRz], uv: LOW.waist },
    );
    for (const L of legs) {
      // film80: high-cut shorts
      const len = F80 ? arch.shorts * 0.55 : arch.shorts;
      if (len > 0) {
        rig.add(
          L.hip,
          lathe(
            [
              [0.095 + len * 0.15, -0.035 - len],
              [0.09, -0.02 - len * 0.6],
              [0.088, 0.02],
              [0.08, 0.08],
            ],
            { seg: 18, n: 8 },
          ),
          lowM,
          { r: [0, (L.s * PI) / 2, 0], uv: LOW.leg },
        );
      }
      if (arch.leggings) {
        rig.add(
          L.hip,
          lathe(
            [
              [0.04, -THIGH],
              [0.046, -THIGH * 0.5],
              [0.06, 0.0],
              [0.075, 0.07],
            ],
            { seg: 14, n: 8 },
          ),
          lowM,
          { r: [0, (L.s * PI) / 2, 0], uv: LOW.legging },
        );
        rig.add(
          L.knee,
          lathe(
            [
              [0.034, -SHIN + 0.035],
              [0.038, -SHIN * 0.5],
              [0.044, 0.02],
            ],
            { seg: 14, n: 6 },
          ),
          lowM,
          { r: [0, (L.s * PI) / 2, 0], uv: LOW.legging },
        );
      }
      // spindly legs: thin rods, ball joints, chrome knee caps
      rig.add(L.hip, sphere(0.04, 12, 8), S.dark);
      rig.add(L.hip, capsule(0.024, THIGH - 0.04, 4, 10), S.dark, { p: [0, -THIGH / 2, 0] });
      rig.add(L.knee, sphere(0.04, 14, 10), S.dark);
      rig.add(L.knee, sphere(0.026, 12, 8), S.chrome, { p: [0, 0.004, 0.026], s: [1, 1, 0.6] });
      rig.add(L.knee, capsule(0.022, SHIN - 0.04, 4, 10), S.dark, { p: [0, -SHIN / 2, 0] });
      if (!arch.leggings) {
        // film80: everyone is in knee-high striped tube socks
        const high = F80 ? 0.175 : arch.socks ? 0.15 : 0.065;
        rig.add(
          L.knee,
          lathe(
            [
              [0.034, -SHIN + 0.0],
              [0.033, -SHIN + high * 0.5],
              [0.032, -SHIN + high],
            ],
            { seg: 14, smooth: false },
          ),
          lowM,
          { uv: LOW.sock },
        );
      }
      // sneaker: sole, upper with laces, toe bumper, heel tab, padded collar
      const fy = -FOOT;
      rig.add(L.ankle, rbox(0.15, 0.046, 0.31, 0.022), shoeM, { p: [0, fy + 0.023, 0.045], uv: SHOE.sole });
      rig.add(L.ankle, rbox(0.13, 0.095, 0.25, 0.046), shoeM, { p: [0, fy + 0.078, 0.03], box: [SHOE.side, SHOE.side, SHOE.top, SHOE.plain, SHOE.plain, SHOE.plain] });
      rig.add(L.ankle, sphere(0.066, 16, 10), shoeM, { p: [0, fy + 0.058, 0.13], s: [1, 0.62, 0.8], uv: SHOE.sole });
      rig.add(L.ankle, rbox(0.045, 0.06, 0.03, 0.012), shoeM, { p: [0, fy + 0.13, -0.09], r: [-0.25, 0, 0], uv: SHOE.sole });
      rig.add(L.ankle, torus(0.042, 0.016, 8, 18), shoeM, { p: [0, fy + 0.125, -0.025], r: [PI / 2, 0, 0], uv: SHOE.plain });
      rig.add(L.ankle, sphere(0.028, 10, 8), S.dark);
      if (F80) {
        // high-tops: a padded collar up over the ankle, with a fat tongue
        rig.add(
          L.ankle,
          lathe(
            [
              [0.05, fy + 0.11],
              [0.054, fy + 0.15],
              [0.05, fy + 0.2],
              [0.043, fy + 0.215],
            ],
            { seg: 16, n: 6 },
          ),
          shoeM,
          { uv: SHOE.plain },
        );
        rig.add(L.ankle, rbox(0.06, 0.1, 0.03, 0.013), shoeM, { p: [0, fy + 0.17, 0.05], r: [0.3, 0, 0], uv: SHOE.sole });
        // slouchy leg warmers for the cardio crowd
        if (arch.leggings || arch.split || arch.tag)
          rig.add(
            L.knee,
            lathe(
              [
                [0.05, -SHIN + 0.055],
                [0.066, -SHIN + 0.075],
                [0.058, -SHIN + 0.1],
                [0.068, -SHIN + 0.125],
                [0.058, -SHIN + 0.15],
                [0.064, -SHIN + 0.172],
                [0.046, -SHIN + 0.19],
              ],
              { seg: 16, n: 14 },
            ),
            topM,
            { uv: TOP.band },
          );
      }
    }
  } else {
    // drone: a thruster pod instead of legs
    rig.add(
      hips,
      lathe(
        [
          [0.06, -0.2],
          [0.1, -0.17],
          [0.15, -0.08],
          [0.17, 0.02],
          [0.15, 0.1],
        ],
        { seg: 24, n: 10 },
      ),
      paint,
      { uv: PAINT.plain },
    );
    rig.add(hips, torus(0.1, 0.018, 8, 24), S.dark, { p: [0, -0.17, 0], r: [PI / 2, 0, 0] });
    rig.add(hips, cyl(0.075, 0.075, 0.02, 20), glowM, { p: [0, -0.19, 0] });
  }

  // ---------- torso ----------
  rig.add(
    torso,
    lathe(
      [
        [0.11, -0.02],
        [0.13, 0.03],
        [0.11, 0.06],
        [0.13, 0.09],
        [0.11, 0.12],
        [0.12, 0.16],
      ],
      { seg: 20, n: 14 },
    ),
    S.dark,
    { s: [W / 0.42, 1, D / 0.3] },
  );
  rig.add(chest, lathe(prof, { seg: 32, n: 24 }), paint, { p: [0, 0.1, 0], s: [W / 2, 0.48, D / 2], uv: PAINT.torso });
  const tee = arch.top === 'tee';
  const shirtProf = [[prof[0][0] * (tee ? 1.18 : 1.04), tee ? -0.3 : -0.08], ...prof.map(([r, t]) => [r * (tee ? 1.1 : 1.045) + 0.01, t + 0.005])];
  shirtProf[shirtProf.length - 1][0] = Math.max(0.46, shirtProf[shirtProf.length - 1][0]);
  rig.add(chest, lathe(shirtProf, { seg: 32, n: 26 }), topM, { p: [0, 0.1, 0], s: [W / 2, 0.48, D / 2], uv: TOP.body });
  // neck: ribbed collar
  rig.add(
    torso,
    lathe(
      [
        [0.075, NECK_Y - 0.07],
        [0.085, NECK_Y - 0.05],
        [0.07, NECK_Y - 0.035],
        [0.08, NECK_Y - 0.02],
        [0.068, NECK_Y + 0.01],
      ],
      { seg: 18, n: 12 },
    ),
    S.dark,
  );
  // back: power pack with a status strip, or the yogi's rolled mat
  // (a numbered jersey keeps its back clear: the pack shrinks to a battery at the waist, the mat rides low)
  if (arch.mat) {
    const my = jersey ? 0.19 : 0.42;
    rig.add(chest, cyl(0.075, 0.075, 0.56, 22), lowM, { p: [0, my, -D / 2 - 0.07], r: [0, 0, PI / 2], uv: LOW.mat });
    for (const x of [-0.16, 0.16]) rig.add(chest, torus(0.085, 0.012, 6, 20), lowM, { p: [x, my, -D / 2 - 0.07], r: [0, PI / 2, 0], uv: LOW.black });
  } else if (!helper && jersey) {
    rig.add(chest, rbox(0.2, 0.1, 0.08, 0.03), S.dark, { p: [0, 0.2, -D / 2 - 0.035] });
    rig.add(chest, rbox(0.14, 0.022, 0.02, 0.008), glowM, { p: [0, 0.2, -D / 2 - 0.074] });
  } else if (!helper) {
    rig.add(chest, rbox(0.22, 0.2, 0.09, 0.035), S.dark, { p: [0, 0.38, -D / 2 - 0.02] });
    rig.add(chest, rbox(0.15, 0.03, 0.02, 0.01), glowM, { p: [0, 0.42, -D / 2 - 0.066] });
    rig.add(chest, rbox(0.15, 0.03, 0.02, 0.01), glowM, { p: [0, 0.36, -D / 2 - 0.066] });
  }

  // ---------- head ----------
  const HW = 0.42 * arch.head;
  const HH = 0.34 * arch.head;
  const HD = 0.36 * arch.head;
  const HY = 0.185;
  rig.add(head, rbox(HW, HH, HD, 0.1, 4), paint, { p: [0, HY, 0], uv: PAINT.head });
  rig.add(head, rbox(HW * 0.86, HH * 0.74, 0.05, 0.045, 3), S.glass, { p: [0, HY - 0.008, HD / 2 - 0.012] });
  for (const s of [-1, 1]) {
    rig.add(head, cyl(0.064, 0.07, 0.05, 22), S.dark, { p: [s * (HW / 2 + 0.012), HY, -0.01], r: [0, 0, PI / 2] });
    rig.add(head, torus(0.045, 0.009, 6, 22), glowM, { p: [s * (HW / 2 + 0.038), HY, -0.01], r: [0, PI / 2, 0] });
    rig.add(head, sphere(0.022, 12, 8), S.chrome, { p: [s * (HW / 2 + 0.04), HY, -0.01], s: [0.7, 1, 1] });
  }
  // chin vent
  for (let i = 0; i < 3; i++) rig.add(head, rbox(0.06, 0.01, 0.02, 0.004), S.dark, { p: [0, HY - HH / 2 + 0.001, HD / 2 - 0.05 - i * 0.03] });
  if (!helper) {
    rig.add(head, rbox(HW + 0.018, 0.062, HD + 0.018, 0.1, 3), topM, { p: [0, HY + HH / 2 - 0.045, 0], uv: TOP.band });
    if (arch.visor) rig.add(head, rbox(HW * 0.82, 0.016, 0.15, 0.007, 2), topM, { p: [0, HY + HH / 2 - 0.035, HD / 2 + 0.06], r: [0.2, 0, 0], uv: TOP.trim });
    // antenna: a coil spring, a two-segment stalk, glowing tip
    rig.add(ant0, cyl(0.022, 0.028, 0.02, 14), S.dark, { p: [0, 0.005, 0] });
    rig.add(ant0, helix(0.012, 0.05, 4, 0.0045), S.chrome, { p: [0, 0.012, 0] });
    rig.add(ant0, capsule(0.006, antLen * 0.45, 3, 6), S.chrome, { p: [0, 0.05 + antLen * 0.22, 0] });
    rig.add(ant1, capsule(0.005, antLen * 0.55, 3, 6), S.chrome, { p: [0, antLen * 0.27, 0] });
    rig.add(ant1, sphere(0.026, 14, 10), glowM, { p: [0, antLen * 0.55 + 0.02, 0] });
  }

  // ---------- arms ----------
  const sleeveLen = { tee: 0.13, compression: 0.075, long: 0.22, tank: 0, singlet: 0 }[arch.top] ?? 0;
  for (const A of arms) {
    rig.add(A.pad, sphere(0.088, 20, 14), paint, { s: [1.04, 0.92, 1], uv: PAINT.plain });
    rig.add(A.shoulder, sphere(0.05, 12, 8), S.dark);
    rig.add(A.shoulder, capsule(0.024, UPPER - 0.03, 4, 10), S.dark, { p: [0, -UPPER / 2, 0] });
    rig.add(
      A.bicep,
      lathe(CANNON, { seg: 26, n: 18 }),
      paint,
      { uv: PAINT.cannon },
    );
    if (sleeveLen > 0) {
      // the sleeve hugs the cannon (and stretches with it), flaring a little at the hem for the tee
      const bottom = 0.11 - sleeveLen;
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const y = bottom + (k / 8) * (0.108 - bottom);
        const flare = tee ? 0.014 * (1 - k / 8) ** 2 + 0.005 : 0.003;
        pts.push([cannonR(y) + flare, y]);
      }
      pts.push([0.012, 0.114]);
      rig.add(A.bicep, lathe(pts, { seg: 26, n: 14 }), topM, { uv: TOP.sleeve });
    }
    rig.add(A.elbow, sphere(0.04, 14, 10), S.dark);
    rig.add(A.elbow, sphere(0.022, 10, 8), S.chrome, { p: [0, 0, -0.03] });
    rig.add(
      A.fore,
      lathe(
        [
          [0.03, -FORE + 0.005],
          [0.038, -FORE + 0.02],
          [0.05, -FORE * 0.62],
          [0.048, -FORE * 0.4],
          [0.038, -0.03],
          [0.03, -0.008],
        ],
        { seg: 22, n: 14 },
      ),
      paint,
      { uv: PAINT.fore },
    );
    if (arch.top === 'long') {
      rig.add(
        A.fore,
        lathe(
          [
            [0.052, -FORE + 0.04],
            [0.056, -FORE * 0.6],
            [0.05, -0.02],
          ],
          { seg: 18, n: 6 },
        ),
        topM,
        { uv: TOP.sleeve },
      );
    }
    // mitt: palm, thumb, three chunky fingers on a curling bone
    rig.add(A.hand, cyl(0.032, 0.03, 0.03, 14), S.dark, { p: [0, 0.03, 0] });
    rig.add(A.hand, rbox(0.08, 0.074, 0.064, 0.027), S.dark, { p: [0, -0.004, 0] });
    rig.add(A.hand, capsule(0.015, 0.03, 3, 8), S.dark, { p: [-A.s * 0.043, -0.008, 0.018], r: [0.3, 0, -A.s * 0.55] });
    for (const x of [-0.026, 0, 0.026]) rig.add(A.fingers, rbox(0.024, 0.05, 0.034, 0.011), S.dark, { p: [x, -0.022, 0.004] });
  }

  // ---------- face screen (own material: a canvas per robot) ----------
  const faceTex = canvasTex(FACE_W, FACE_H, () => {}, { aniso: 4 });
  const faceG = faceTex.userData.ctx;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(HW * 0.8, HW * 0.8 * (FACE_H / FACE_W)), new THREE.MeshBasicMaterial({ map: faceTex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  face.position.set(0, HY - 0.008, HD / 2 + 0.024);
  head.add(face);

  // ---------- helper rotor ----------
  let rotor = null;
  if (helper) {
    rotor = new THREE.Group();
    rotor.position.set(0, HY + HH / 2 + 0.04, 0);
    gearMesh(rotor, [[cyl(0.03, 0.04, 0.05, 14)], [cyl(0.012, 0.012, 0.06, 8), { p: [0, -0.03, 0] }]], S.dark);
    const blades = gearMesh(
      rotor,
      [
        [rbox(0.62, 0.012, 0.07, 0.006, 2), { p: [0, 0.03, 0], r: [0, 0, 0.0] }],
        [rbox(0.62, 0.012, 0.07, 0.006, 2), { p: [0, 0.03, 0], r: [0, PI / 2, 0] }],
      ],
      new THREE.MeshPhysicalMaterial({ color: COL.amber, roughness: 0.35, clearcoat: 0.7 }),
    );
    rotor.userData.blades = blades;
    head.add(rotor);
  }
  const flame = helper ? new THREE.Mesh(xf(cyl(0.07, 0.0, 0.22, 16, true), { p: [0, -0.11, 0] }), S.flame) : null;
  if (flame) {
    flame.position.y = -0.2;
    hips.add(flame);
  }

  // ---------- gear (separate meshes so they can be shown as earned) ----------
  const gear = {};
  gear.phones = new THREE.Group();
  if (F80) {
    // a Walkman: thin sprung-steel band, orange foam pads, the player clipped to the waistband
    gearMesh(gear.phones, [[torus(HW / 2 + 0.035, 0.006, 6, 30, PI), { p: [0, HY + 0.02, -0.02] }]], S.chrome);
    gearMesh(
      gear.phones,
      [
        [cyl(0.058, 0.05, 0.036, 20), { p: [-(HW / 2 + 0.05), HY, -0.01], r: [0, 0, PI / 2] }],
        [cyl(0.05, 0.058, 0.036, 20), { p: [HW / 2 + 0.05, HY, -0.01], r: [0, 0, PI / 2] }],
      ],
      S.foam,
    );
    gear.walkman = new THREE.Group();
    gearMesh(gear.walkman, [[rbox(0.035, 0.13, 0.09, 0.01), { p: [waistRx + 0.03, 0.03, 0.02] }]], S.walkman, { cast: true });
    gearMesh(
      gear.walkman,
      [
        [rbox(0.008, 0.05, 0.06, 0.003), { p: [waistRx + 0.05, 0.04, 0.02] }],
        [rbox(0.012, 0.012, 0.07, 0.004), { p: [waistRx + 0.03, 0.1, 0.02] }],
      ],
      S.chrome,
    );
    gearMesh(gear.walkman, [[rbox(0.01, 0.014, 0.02, 0.003), { p: [waistRx + 0.05, -0.012, 0.045] }]], S.foam);
    hips.add(gear.walkman);
  } else
    gearMesh(
      gear.phones,
      [
        [torus(HW / 2 + 0.03, 0.016, 8, 30, PI), { p: [0, HY + 0.02, -0.02] }],
        [cyl(0.078, 0.078, 0.05, 22), { p: [-(HW / 2 + 0.04), HY, -0.01], r: [0, 0, PI / 2] }],
        [cyl(0.078, 0.078, 0.05, 22), { p: [HW / 2 + 0.04, HY, -0.01], r: [0, 0, PI / 2] }],
      ],
      S.phones,
    );
  head.add(gear.phones);
  gear.belt = gearMesh(
    chest,
    [
      [
        lathe(
          [
            [1.0, 0],
            [1.03, 0.5],
            [1.0, 1],
          ],
          { seg: 32, smooth: false },
        ),
        { p: [0, 0.075, 0], s: [rAt(prof, 0.04) * (W / 2) * 1.09 + 0.012, 0.11, rAt(prof, 0.04) * (D / 2) * 1.09 + 0.012] },
      ],
    ],
    S.leather,
    { cast: true },
  );
  gear.buckle = gearMesh(chest, [[rbox(0.1, 0.085, 0.025, 0.012), { p: [0, 0.13, rAt(prof, 0.04) * (D / 2) * 1.12 + 0.02] }]], S.gold);
  gear.whistle = new THREE.Group();
  gearMesh(gear.whistle, [[torus(0.13, 0.008, 6, 30), { p: [0, NECK_Y - 0.03, 0.03], r: [PI / 2 - 0.5, 0, 0], s: [1, 1.15, 1] }, TOP.trim]], topM);
  gearMesh(gear.whistle, [[rbox(0.05, 0.03, 0.03, 0.012), { p: [0.03, NECK_Y - (jersey ? 0.09 : 0.12), D * 0.53 + (jersey ? 0.0 : 0.03)] }]], S.chrome);
  torso.add(gear.whistle);
  gear.chain = gearMesh(
    torso,
    [
      [torus(0.13, 0.013, 6, 36), { p: [0, NECK_Y - 0.03, 0.03], r: [PI / 2 - 0.65, 0, 0], s: [1, 1.15, 1] }],
      [cyl(jersey ? 0.034 : 0.045, jersey ? 0.034 : 0.045, 0.016, 20), { p: [0, NECK_Y - (jersey ? 0.075 : 0.1), D * 0.5 + (jersey ? 0.0 : 0.02)], r: [PI / 2 - 0.3, 0, 0] }],
    ],
    S.gold,
  );
  gear.bands = arms.map((A) => gearMesh(A.fore, [[cyl(0.054, 0.054, 0.045, 18), { p: [0, -FORE + 0.035, 0] }, TOP.band]], topM));
  gear.wraps = arms.map((A) => gearMesh(A.hand, [[cyl(0.04, 0.036, 0.045, 14), { p: [0, 0.03, 0] }]], S.white));
  gear.chalk = arms.map((A) => gearMesh(A.hand, [[sphere(0.075, 10, 8), { s: [1, 0.8, 1] }]], S.chalk));
  gear.sleeves = legs.map((L) => gearMesh(L.knee, [[cyl(0.05, 0.05, 0.1, 16), { p: [0, -0.01, 0] }]], S.neoprene));
  let tag = null;
  if (arch.tag && !helper) {
    tag = new THREE.Group();
    tag.position.set(waistRx * 0.9, 0.02, 0.06);
    gearMesh(tag, [[cyl(0.003, 0.003, 0.06, 4), { p: [0, -0.03, 0] }]], S.white);
    gearMesh(tag, [[rbox(0.06, 0.085, 0.006, 0.006, 1), { p: [0, -0.1, 0] }, LOW.tag]], lowM);
    hips.add(tag);
  }

  // ---------- held props ----------
  const PK = propKit();
  const held = { can: [], marker: [], cup: [] };
  for (const A of arms) {
    const can = new THREE.Mesh(PK.canGeo, PK.can);
    can.position.set(0, -0.035, 0.05);
    A.hand.add(can);
    held.can.push(can);
    const marker = new THREE.Mesh(PK.markerGeo, PK.marker);
    marker.position.set(0, -0.05, 0.04);
    marker.rotation.x = 0.25;
    A.hand.add(marker);
    held.marker.push(marker);
    const cup = new THREE.Mesh(PK.cupGeo, PK.cup);
    cup.position.set(0, -0.03, 0.055);
    A.hand.add(cup);
    held.cup.push(cup);
  }

  // ---------- bake the body ----------
  rig.build({ cast: new Set([paint, topM, S.dark, shoeM, lowM]) });

  // ---------- floor fx: contact shadow, selection ring, rep flash ----------
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), blobMaterial());
  blob.rotation.x = -PI / 2;
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  root.add(blob);
  const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: COL.amber, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  ring.rotation.x = -PI / 2;
  ring.position.y = 0.02;
  root.add(ring);
  const flash = new THREE.Mesh(FLASH_GEO, new THREE.MeshBasicMaterial({ color: COL.pass, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  flash.rotation.x = -PI / 2;
  flash.position.y = 0.025;
  root.add(flash);

  // bar lives under root so it can leave the hands
  const bar = barbellProp();
  root.add(bar.group);

  // particles: steam, oil drips, sparks, dizzy stars (instanced: one draw each)
  const steam = instanced(STEAM_GEO, S.steam, 8);
  const oil = instanced(DROP_GEO, S.oil, 4);
  const sparks = instanced(SPARK_GEO, S.spark, 10);
  const stars = instanced(STAR_GEO, S.star, 5);
  steam.renderOrder = 3;
  root.add(steam, oil, sparks, stars);

  // picking proxies (invisible, cheap to raycast)
  const pickChest = new THREE.Mesh(BOX_GEO, S.hidden);
  pickChest.scale.set(W + 0.1, 0.55, D + 0.1);
  pickChest.position.y = 0.33;
  chest.add(pickChest);
  const pickHead = new THREE.Mesh(BOX_GEO, S.hidden);
  pickHead.scale.set(HW + 0.06, HH + 0.06, HD);
  pickHead.position.y = HY;
  head.add(pickHead);

  if (helper) head.scale.setScalar(1.3);

  // ---------- per-frame state ----------
  const P = newPose();
  const P2 = newPose();
  const ctx = { t: 0, lk: null, repAge: Infinity, repStatus: null, act: null, shift: 0, wb: null, at: null, lift: undefined, drop: 0, sx: shoulderX, seed, helper, k: 1 };
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const face0 = { expr: '', mood: '', open: 1, gx: 0, gy: 0, ph: 0, extra: '', talk: null };
  let faceKey = '';
  let lastGear = '';
  let lastScale = -1;

  function evalPose(Q, t, shift, kind, walking, info, lk) {
    resetPose(Q);
    ctx.t = t;
    ctx.lk = lk;
    const ra = info.repAge;
    ctx.repAge = ra === null || ra === undefined ? Infinity : ra - shift;
    if (ctx.repAge < 0) ctx.repAge = Infinity;
    ctx.repStatus = info.repStatus;
    ctx.act = info.act ?? null;
    ctx.shift = shift;
    ctx.wb = info.wb ?? null;
    ctx.at = info.at ?? null;
    ctx.lift = info.lift;
    ctx.drop = info.info?.drop ?? info.drop ?? 0;
    if (walking && !helper) walkCycle(Q, ctx);
    else if (walking && helper) POSES.spotting(Q, ctx);
    else POSES[kind](Q, ctx);
    if (lk.speaking && !walking) talk(Q, ctx, kind, root.rotation.y);
    if (Q.plant) plantHips(Q);
    const upright = Math.abs(Q.pitch) < 0.2 && Q.hipY > 0.3;
    if (upright && !helper) {
      Q.tx += lk.slump ?? 0;
      // archetype swagger on the stance
      Q.legs[0][1] += arch.stance;
      Q.legs[1][1] += arch.stance;
    }
  }

  function applyArm(A, v, extraAbd) {
    A.shoulder.rotation.set(v[0], v[4] * A.s, (v[1] + extraAbd) * A.s);
    A.elbow.rotation.set(v[2], 0, v[3] * A.s);
  }
  function applyLeg(L, v, ank, pitch) {
    L.hip.rotation.set(v[0], 0, v[1] * L.s);
    L.knee.rotation.x = v[2];
    L.ankle.rotation.set(Number.isNaN(ank) ? -(pitch + v[0] + v[2]) : ank, 0, -v[1] * L.s * 0.8);
  }

  function setGear(lk, kind) {
    const key = `${lk.gear ? lk.gear.join(',') : ''}|${kind}`;
    if (key === lastGear) return;
    lastGear = key;
    const has = new Set(lk.gear ?? []);
    gear.phones.visible = has.has('headphones') && !helper;
    if (gear.walkman) gear.walkman.visible = gear.phones.visible;
    gear.belt.visible = gear.buckle.visible = (!!arch.belt || has.has('belt')) && !helper;
    gear.chain.visible = has.has('chain');
    gear.whistle.visible = has.has('whistle') || kind === 'spotting';
    const lifting = kind === 'bench' || kind === 'fail' || kind === 'coordinated' || kind === 'stalled';
    for (let i = 0; i < 2; i++) {
      gear.bands[i].visible = has.has('sweatband');
      gear.wraps[i].visible = has.has('wraps');
      gear.chalk[i].visible = has.has('chalk') && lifting;
      gear.sleeves[i].visible = (!!arch.kneeSleeves || has.has('sleeves')) && !helper;
    }
  }

  function setFace(f) {
    const key = `${f.expr}|${f.mood}|${f.open}|${f.gx}|${f.gy}|${f.ph}|${f.extra}|${f.talk}`;
    if (key === faceKey) return;
    faceKey = key;
    drawFace(faceG, f);
    faceTex.needsUpdate = true;
    glowM.color.set(MOOD[f.mood] ?? MOOD.norm);
  }

  const TALK_EYES = new Set(['focus', 'meh', 'sleepy', 'smug', 'sad']);
  const TALK_BEAT = ['focus', 'happy', 'focus', 'proud'];
  const PHASED = new Set(['joy', 'strain', 'wince', 'panic', 'nervous', 'dazed', 'dead', 'love']);
  const BLINKABLE = new Set(['focus', 'determined', 'tongue', 'nervous', 'proud', 'smug', 'meh', 'sad', 'sleepy']);

  /**
   * Pose the robot for `now`.
   * info: { kind, at, repAge, repStatus, speed, selected, act, wb, lift, queued }
   */
  function update(lk, now, info) {
    const t = now;
    const walking = info.speed > 0.15;
    const kind = info.queued ? 'wait' : KNOWN.has(info.kind) ? info.kind : 'idle';

    // proportions: arms grow with test volume, legs never do
    const m = lk.muscle ?? 0;
    const bic = lk.bicep ?? 1;
    const chestK = 1 + ((lk.chest ?? 1) - 1) * 0.7;
    const sc = (lk.height ?? 1) * ROBOT_SCALE * (helper ? 0.55 : 1);
    if (sc !== lastScale) {
      root.scale.setScalar(sc);
      lastScale = sc;
    }
    const f = lk.fatigue ?? 0;
    paint.color.copy(baseColor).lerp(hot, f * heatK);
    paint.emissive.setRGB(f * 0.3, f * 0.06, 0).multiplyScalar(brand ? 0.3 : 1);
    setGear(lk, kind);
    ctx.k = 1 / sc;
    ctx.sx = shoulderX * chestK + m * 0.02;

    // pose now, and a moment ago (follow-through for the antenna)
    const LAG = 90;
    evalPose(P2, t - LAG, LAG, kind, walking, info, lk);
    evalPose(P, t, 0, kind, walking, info, lk);

    // blink, idle saccades, selection
    let open = 1;
    if (P.blinkOk && BLINKABLE.has(P.expr)) {
      const period = 3300 + ((seed * 1000) % 1700);
      const bu = cyc(t, period, seed * 1000);
      const bw = 140 / period;
      if (bu < bw) open = Math.abs(bu / bw - 0.5) * 2;
      else if (Math.floor((t + seed * 1000) / period) % 4 === 1 && bu > bw * 1.6 && bu < bw * 2.6) open = Math.abs((bu - bw * 1.6) / bw - 0.5) * 2;
    }
    if (P.gx === 0 && P.gy === 0 && (P.expr === 'focus' || P.expr === 'meh')) {
      const sac = Math.floor((t + seed * 777) / 1300);
      P.gx = Math.sin(sac * 12.9898 + seed) * 0.5;
      P.gy = Math.sin(sac * 78.233 + seed) * 0.25;
    }
    if (info.selected && P.expr === 'focus') P.expr = 'determined';
    if (f > 0.7 && P.expr === 'focus') P.expr = 'meh';
    // speaking: the mouth flaps at about 6 Hz under a slower syllable envelope, the eyes liven up
    if (lk.speaking) {
      const env = 0.6 + 0.4 * Math.sin(t * 0.0043 + seed * 9);
      const flap = 0.5 + 0.5 * Math.sin(t * 0.0377 + seed * 5);
      face0.talk = Math.round(flap * env * 3);
      if (TALK_EYES.has(P.expr)) P.expr = TALK_BEAT[Math.floor((t + seed * 500) / 950) & 3];
      if (P.mood === 'sleep') P.mood = 'norm';
    } else face0.talk = null;
    face0.expr = P.expr;
    face0.mood = P.mood;
    face0.open = open > 0.85 ? 1 : open > 0.45 ? 0.6 : open > 0.15 ? 0.25 : 0;
    face0.gx = Math.round(P.gx * 8) / 8;
    face0.gy = Math.round(P.gy * 6) / 6;
    face0.ph = PHASED.has(P.expr) || P.extra === 'zzz' || P.extra === 'tear' ? Math.floor(P.ph * 12) / 12 : 0;
    face0.extra = P.extra;
    setFace(face0);

    // breathing (heavier and faster when tired)
    const br = Math.sin(t * 0.0022 * (1 + f * 0.8) + seed * 3) * (0.012 + f * 0.012) * P.breath;

    // apply skeleton
    hips.position.set(P.offX, P.base + P.lift + P.hipY, P.offZ);
    hips.rotation.set(P.pitch, P.yaw, P.roll, 'YXZ');
    torso.rotation.set(P.tx, P.ty, P.tz);
    chest.scale.set(chestK * (1 + br * 0.4), 1 + br, (1 + (chestK - 1) * 0.6) * (1 + br * 0.4));
    head.rotation.set(P.hx - br * 0.6, P.hy, P.hz);
    const flareAbd = m * 0.34 * P.flare + (bic - 1) * 0.06 * P.flare;
    const squeeze = 1 + P.squeeze * 0.09;
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      A.shoulder.position.set(A.s * (shoulderX * chestK + m * 0.02), SHOULDER_Y + br * 0.5, 0);
      applyArm(A, P.arms[i], flareAbd);
      A.pad.scale.setScalar(1 + m * 0.6);
      A.bicep.scale.set(bic * squeeze, 1 + (bic - 1) * 0.38, bic * squeeze);
      A.bicep.position.z = 0.012 + (bic - 1) * 0.012;
      const fk = 1 + m * 1.05;
      A.fore.scale.set(fk, 1, fk);
      A.hand.rotation.set(P.wrist[i], 0, 0);
      A.hand.scale.setScalar(1 + m * 0.25);
      A.fingers.rotation.x = -P.grip[i] * 1.45;
    }
    applyLeg(legs[0], P.legs[0], P.ankle[0], P.pitch);
    applyLeg(legs[1], P.legs[1], P.ankle[1], P.pitch);

    // antenna: lags behind head motion, kicks on impacts, droops when sad
    const dP = hp(P) - hp(P2);
    const dR = hr(P) - hr(P2);
    const dY = hy(P) - hy(P2);
    const sway = Math.sin(t * 0.0042 + seed * 5) * 0.05;
    let bx = -dP * 1.6 + dY * 5 - P.kick * 0.35 + P.droop * 0.9 + sway;
    let bz = -dR * 1.6 + Math.sin(t * 0.0031 + seed) * 0.04;
    if (walking) bx += -0.25 + Math.sin(t * 0.027) * 0.08;
    bx = Math.max(-1.2, Math.min(1.4, bx));
    bz = Math.max(-1, Math.min(1, bz));
    ant0.rotation.set(bx * 0.45, 0, bz * 0.45);
    ant1.rotation.set(bx * 0.75, 0, bz * 0.75);
    if (rotor) {
      rotor.rotation.y = t * 0.045;
      rotor.rotation.z = P.roll * -0.5;
    }
    if (flame) {
      const fl = 0.8 + Math.sin(t * 0.07) * 0.12 + Math.sin(t * 0.13) * 0.08;
      flame.scale.set(1, fl, 1);
    }
    if (tag) tag.rotation.set(Math.sin(t * 0.006 + seed) * 0.2, 0, Math.sin(t * 0.008 + seed) * 0.35);

    blob.position.set(P.offX, 0.012, P.offZ);
    const air = P.hover ? 0.6 : P.base + P.lift;
    blob.scale.setScalar(Math.max(W + 0.35, 0.8) * (1 - Math.min(0.5, air * 0.5)) * (P.hipY < 0.25 ? 1.45 : 1));

    // held props
    for (const name in held) {
      held[name][0].visible = P.held[0] === name;
      held[name][1].visible = P.held[1] === name;
    }

    // bar
    root.updateMatrixWorld(true);
    const b = bar.group;
    b.visible = !!P.bar;
    bar.setPlates(info.repStatus, kind);
    bar.squash(P.squash);
    if (P.bar === 'hands') {
      arms[0].hand.getWorldPosition(tmpA);
      arms[1].hand.getWorldPosition(tmpB);
      root.worldToLocal(tmpA);
      root.worldToLocal(tmpB);
      b.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
      b.position.y -= 0.02;
      tmpB.sub(tmpA).normalize();
      tmpQ.setFromUnitVectors(X_AXIS, tmpB);
      b.quaternion.copy(tmpQ);
    } else if (P.bar === 'rack') {
      b.position.set(0, 1.32 * ctx.k, -0.42 * ctx.k);
      b.quaternion.identity();
    } else if (P.bar === 'drop') {
      const a = Math.max(0, P.barAge) / 1000;
      const y0 = 1.5;
      const yf = 0.225 * ctx.k;
      let y = y0 - 9.8 * a * a * 0.5;
      const tl = Math.sqrt((2 * (y0 - yf)) / 9.8);
      let z = 0.06 + Math.min(a, tl) * 1.0;
      let roll = Math.min(a, tl) * 0.9;
      if (y < yf) {
        const tb = a - tl;
        y = yf + Math.abs(Math.sin(tb * 11)) * 0.18 * Math.exp(-tb * 5);
        z += tb * 0.25 * Math.exp(-tb * 3);
        roll += Math.sin(tb * 9) * 0.1 * Math.exp(-tb * 4);
      }
      b.position.set(0, y, z);
      b.quaternion.setFromAxisAngle(Z_AXIS, roll * 0.3);
      tmpQ.setFromAxisAngle(X_AXIS, roll * 2);
      b.quaternion.multiply(tmpQ);
    }

    // sweat: steam rises off the head vents, oil drips from the joints
    const nSweat = Math.min(8, lk.sweat ?? 0);
    head.getWorldPosition(tmpA);
    root.worldToLocal(tmpA);
    let n = 0;
    for (let i = 0; i < nSweat; i++) {
      const ph = cyc(t, 1700, i * 377 + seed * 500);
      const ang = i * 2.4 + seed;
      const s = Math.sin(ph * PI) * 0.06 * (helper ? 0.6 : 1);
      tmpB.set(tmpA.x + Math.sin(ang) * 0.13 + Math.sin(ph * 5 + i) * 0.03, tmpA.y + 0.32 + ph * 0.6, tmpA.z + Math.cos(ang) * 0.1 - 0.04);
      tmpM.compose(tmpB, tmpQ.identity(), _sv.setScalar(s));
      steam.setMatrixAt(n++, tmpM);
    }
    steam.count = n;
    steam.instanceMatrix.needsUpdate = true;
    n = 0;
    const nOil = Math.floor(nSweat / 2);
    for (let i = 0; i < nOil; i++) {
      const src = i % 2 ? arms[i % 2].elbow : legs[(i >> 1) % 2].knee;
      src.getWorldPosition(tmpB);
      root.worldToLocal(tmpB);
      const ph = cyc(t, 1300, i * 431 + seed * 300);
      const y = tmpB.y - ph * ph * Math.max(0.2, tmpB.y);
      if (y < 0.02) continue;
      tmpB.y = y;
      const g0 = Math.min(1, ph / 0.15);
      tmpM.compose(tmpB, tmpQ.identity(), _sv.set(g0, g0 * (1 + ph * 0.6), g0));
      oil.setMatrixAt(n++, tmpM);
    }
    oil.count = n;
    oil.instanceMatrix.needsUpdate = true;
    // sparks burst from the head
    n = 0;
    const nSp = P.sparks > 0 ? Math.ceil(P.sparks * 10) : 0;
    for (let i = 0; i < nSp; i++) {
      const ph = cyc(t, 700, i * 131);
      const ang = i * 0.785 + seed;
      const r = ph * 0.6;
      tmpB.set(tmpA.x + Math.cos(ang) * r, tmpA.y + 0.35 + Math.sin(ph * PI) * 0.35 - ph * 0.2, tmpA.z + Math.sin(ang) * r);
      tmpQ.setFromAxisAngle(Y_AXIS, t * 0.01 + i);
      tmpM.compose(tmpB, tmpQ, _sv.setScalar(Math.sin(ph * PI) * 0.9));
      sparks.setMatrixAt(n++, tmpM);
    }
    sparks.count = n;
    sparks.instanceMatrix.needsUpdate = true;
    // dizzy stars orbit the head
    n = 0;
    if (P.stars > 0) {
      for (let i = 0; i < 5; i++) {
        const a = t * 0.004 + (i / 5) * PI * 2;
        tmpB.set(tmpA.x + Math.cos(a) * 0.3, tmpA.y + 0.42 + Math.sin(a * 2) * 0.03, tmpA.z + Math.sin(a) * 0.3);
        tmpQ.setFromAxisAngle(Y_AXIS, t * 0.006 + i);
        tmpM.compose(tmpB, tmpQ, _sv.setScalar(1));
        stars.setMatrixAt(n++, tmpM);
      }
    }
    stars.count = n;
    stars.instanceMatrix.needsUpdate = true;

    // flash ring on reps, amber pulse on stalls
    const age = info.repAge ?? Infinity;
    const repKinds = kind === 'bench' || kind === 'coordinated' || kind === 'fail' || kind === 'wobble';
    const fresh = age < 650 && repKinds;
    flash.material.opacity = fresh ? (1 - age / 650) ** 2 * 0.5 : kind === 'stalled' ? 0.2 + Math.sin(t * 0.0035) * 0.07 : 0;
    flash.material.color.set(kind === 'stalled' ? COL.stall : info.repStatus === 'fail' || kind === 'fail' ? COL.fail : info.repStatus === 'skip' ? COL.skip : kind === 'wobble' ? COL.wobble : COL.pass);
    flash.scale.setScalar(fresh ? 1 + (age / 650) * 0.9 : 1);
    flash.position.set(P.offX, 0.025 + P.base, P.offZ);
    ring.material.opacity = info.selected ? 0.7 + Math.sin(t * 0.004) * 0.12 : 0;
    ring.visible = !!info.selected;
    flash.visible = flash.material.opacity > 0.01;
    ring.rotation.z = t * 0.001;
    ring.position.set(P.offX, 0.02 + P.base, P.offZ);
  }

  return {
    root,
    props: [],
    seed,
    pose: P,
    update,
    headWorld(target) {
      head.getWorldPosition(target);
      target.y += 0.4 * root.scale.y * (helper ? 1.3 : 1);
      return target;
    },
    /** World midpoint between the hands (for shared bars and cables). */
    handsMid(target) {
      arms[0].hand.getWorldPosition(target);
      arms[1].hand.getWorldPosition(tmpB);
      return target.add(tmpB).multiplyScalar(0.5);
    },
    handWorld(i, target) {
      return arms[i].hand.getWorldPosition(target);
    },
    pickables: [pickChest, pickHead],
    /** World scale of this robot (pecking-order height x the base robot scale). */
    get scale() {
      return root.scale.y;
    },
  };
}

/** film80 colour for a brand chassis: keeps hue and saturation, only pulls the lightest paints off pure white. */
function brandPaint(color) {
  const c = new THREE.Color(color);
  const h = { h: 0, s: 0, l: 0 };
  c.getHSL(h);
  // black goes a touch cool, so the warm set lights land it on neutral black instead of brown
  if (h.l < 0.2) return c.setRGB(0.042, 0.05, 0.066);
  return c.setHSL(h.h, h.s, h.l > 0.5 ? 0.5 + (h.l - 0.5) * 0.86 : h.l);
}

// Which arm is free to gesture while speaking (0 right, 1 left), per pose. Poses not listed keep both hands busy.
const TALK_ARM = { idle: 0, wait: 0, lounge: 0, 'lounge-sit': 0, 'write-tests': 1, machine: 1, spotting: 0, slump: 0 };
// The direction most cameras sit in (the open corner of the room), as a world yaw.
const ROOM_YAW = 0.6;

/**
 * Speaking: a small head bob in time with the words, a talking hand if one is free, and a
 * turn of the head and shoulders toward the room when the pose faces a wall. Layered on
 * top of the pose, which keeps its main action. A pure function of time and the seed.
 */
function talk(Q, c, kind, rootYaw) {
  const t = c.t;
  const s = c.seed;
  const env = 0.6 + 0.4 * Math.sin(t * 0.0043 + s * 9);
  Q.hx += Math.sin(t * 0.0138 + s * 3) * 0.045 * env - 0.03;
  Q.hz += Math.sin(t * 0.0047 + s) * 0.05;
  if (kind === 'write-tests' || kind === 'treadmill') {
    let rel = ROOM_YAW - rootYaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    if (Math.abs(rel) > 0.9) {
      const sg = Math.sign(rel);
      Q.hy = sg * 1.05 + Math.sin(t * 0.0021 + s) * 0.1;
      Q.ty += sg * (kind === 'treadmill' ? 0.18 : 0.4);
      Q.gx = sg * 0.5;
      Q.gy = 0;
      Q.hx = Math.sin(t * 0.0138 + s * 3) * 0.045 * env - 0.06;
    }
  } else if (Math.abs(Q.hy) > 0.2) Q.hy *= 0.5;
  const i = TALK_ARM[kind];
  if (i === undefined || Q.held[i] || Q.bar || Q.expr === 'yawn') return;
  // a loose open hand, beating and circling in front of the chest
  const beat = Math.sin(t * 0.0069 + s * 4);
  const o = Q.arms[i];
  o[0] = -0.95 + beat * 0.2 + Math.sin(t * 0.0023 + s) * 0.12;
  o[1] = 0.32 + Math.sin(t * 0.0041 + s * 2) * 0.12;
  o[2] = -1.45 + Math.cos(t * 0.0069 + s * 4) * 0.28;
  o[3] = 0;
  o[4] = 0.25;
  Q.grip[i] = 0.08;
  Q.wrist[i] = -0.35 + beat * 0.3;
}

const _sv = new THREE.Vector3();
const hp = (Q) => Q.pitch + Q.tx + Q.hx;
const hr = (Q) => Q.roll + Q.tz + Q.hz;
const hy = (Q) => Q.base + Q.lift + Q.hipY;
const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);
const RING_GEO = new THREE.RingGeometry(0.46, 0.55, 48);
const FLASH_GEO = new THREE.RingGeometry(0.12, 0.62, 40);
const STEAM_GEO = new THREE.IcosahedronGeometry(1, 1);
const DROP_GEO = (() => {
  const g = lathe(
    [
      [0.0005, -0.02],
      [0.012, -0.012],
      [0.014, -0.004],
      [0.008, 0.008],
      [0.0005, 0.02],
    ],
    { seg: 10, n: 8 },
  );
  return g;
})();
const SPARK_GEO = new THREE.OctahedronGeometry(0.03, 0);
const STAR_GEO = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.022 : 0.05;
    const a = (i / 10) * PI * 2 + PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
})();

function instanced(geo, material, max) {
  const m = new THREE.InstancedMesh(geo, material, max);
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = false;
  return m;
}

let blobMat = null;
function blobMaterial() {
  if (blobMat) return blobMat;
  const tex = canvasTex(
    128,
    128,
    (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(0,0,0,0.7)');
      grd.addColorStop(0.45, 'rgba(0,0,0,0.38)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { srgb: false },
  );
  blobMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.7 });
  return blobMat;
}
