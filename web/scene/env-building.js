// The building shell: two-tone plaster walls with a chair rail and baseboards,
// slim dark steel windows with depth, sills and glass that catches the sky, a
// roof eave and a cut-section cap along the wall tops so the cutaway reads as a
// real building, timber ledger beams, and soft sun shafts through the left windows.
import * as THREE from 'three';
import { mat, part, GEO, rbox, canvasTexture, wallTexture, glassTexture, F80 } from './materials.js';
import { cinderTexture, panelTexture } from './film80-tex.js';

const PI = Math.PI;
export const CUT = 0x3b3f46; // section colour where the diorama is sliced

const M = {
  frame: mat(0x2a2e35, { rough: 0.38, metal: 0.55 }),
  sill: mat(0xe9e2d6, { rough: 0.35 }),
  trim: mat(0xfaf8f4, { rough: 0.45 }),
  cut: mat(CUT, { rough: 0.85 }),
  roof: mat(0xc9c6bf, { rough: 0.95 }),
  fascia: mat(0xf4f1ea, { rough: 0.55 }),
  beam: mat(0xd9b88c, { rough: 0.6 }),
  lower: mat(0xdfe4e6, { rough: 0.85 }),
};
// film80: bronze-anodised window frames, dark stained timber, a sun-baked exterior
if (F80)
  Object.assign(M, {
    frame: mat(0x3a2e24, { rough: 0.5, metal: 0.6, raw: true }),
    sill: mat(0x5a3a22, { rough: 0.5, raw: true }),
    trim: over(0x3f2816, 0.5),
    beam: mat(0x4a2f1b, { rough: 0.65, raw: true }),
    roof: mat(0x77726a, { rough: 0.95, raw: true }),
    fascia: mat(0xa8977a, { rough: 0.7, raw: true }),
    base: over(0x141312, 0.7),
    burgundy: over(0x6e1c28, 0.8),
    mustard: over(0xc9932b, 0.8),
    teal: over(0x1f6f6c, 0.8),
  });
/** Thin trim that sits millimetres proud of a wall: pulled forward in depth so it survives the wide shot's depth precision. */
function over(color, roughness) {
  return new THREE.MeshStandardMaterial({ color, roughness, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -120 });
}
let clad80 = null;
/** film80 interior finishes, textured in world metres so the courses line up along a wall. */
function cladding() {
  if (clad80) return clad80;
  const ct = cinderTexture();
  const pt = panelTexture();
  clad80 = {
    block: new THREE.MeshStandardMaterial({ map: ct, bumpMap: ct.userData.bump, bumpScale: 1.6, roughness: 0.88, color: 0xffffff }),
    panel: new THREE.MeshStandardMaterial({ map: pt, bumpMap: pt.userData.bump, bumpScale: 1.2, roughness: 0.52, color: 0xffffff, envMapIntensity: 0.7 }),
  };
  return clad80;
}

let wallMat = null;
let glassMat = null;
function materials() {
  if (!wallMat) {
    const t = wallTexture();
    t.repeat.set(6, 2);
    wallMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, color: F80 ? 0xc9b592 : 0xffffff });
    glassMat = new THREE.MeshStandardMaterial({ color: 0xdff0fa, map: glassTexture(), transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.0, envMapIntensity: 1.6, depthWrite: false, blending: THREE.NormalBlending });
    // the streak map brightens, never darkens: add it on top of a faint tint
    glassMat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor.rgb += texture2D(map, vMapUv).rgb * 0.9; diffuseColor.a += texture2D(map, vMapUv).r * 0.25;\n#endif');
    };
  }
  return { wallMat, glassMat };
}

/**
 * A wall along x (axis 'x', at z = fixed) or along z (axis 'z', at x = fixed), with
 * window openings [a, b]. `outward` is the sign of the exterior side.
 */
export function wall(scene, { axis, fixed, from, to, h, openings = [], sill = 0.35, head = h - 0.5, outward }) {
  const { wallMat: wm, glassMat: gm } = materials();
  const T = 0.3;
  const inner = fixed; // interior face
  const mid = fixed + outward * (T / 2);
  const along = (a, b, y0, y1, depth, off, m, opts = {}) => {
    const len = b - a;
    const c = (a + b) / 2;
    const size = axis === 'x' ? [len, y1 - y0, depth] : [depth, y1 - y0, len];
    const pos = axis === 'x' ? [c, (y0 + y1) / 2, off] : [off, (y0 + y1) / 2, c];
    return part(scene, GEO.box, m, size, pos, { receive: true, cast: opts.cast ?? true });
  };
  const solid = [];
  let cur = from;
  for (const [a, b] of openings) {
    if (a > cur) solid.push([cur, a]);
    cur = b;
  }
  if (cur < to) solid.push([cur, to]);

  // structure
  for (const [a, b] of solid) along(a, b, 0, h, T, mid, wm);
  for (const [a, b] of openings) {
    along(a, b, 0, sill, T, mid, wm);
    along(a, b, head, h, T, mid, wm);
  }
  if (F80) {
    // painted cinderblock above dark wood panelling, a rubber cove base, and a
    // burgundy / mustard / teal racing stripe right round the room
    const C = cladding();
    const sheet = (a, b, y0, y1, m, tu, tv) => {
      const geo = new THREE.PlaneGeometry(b - a, y1 - y0);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (axis === 'x' ? a + uv.getX(i) * (b - a) : -(a + (1 - uv.getX(i)) * (b - a))) / tu, (y0 + uv.getY(i) * (y1 - y0)) / tv);
      const p = new THREE.Mesh(geo, m);
      const off = inner - outward * 0.004;
      if (axis === 'x') p.position.set((a + b) / 2, (y0 + y1) / 2, off);
      else {
        p.position.set(off, (y0 + y1) / 2, (a + b) / 2);
        p.rotation.y = PI / 2;
      }
      p.receiveShadow = true;
      p.castShadow = false;
      scene.add(p);
    };
    for (const [a, b] of solid) {
      sheet(a, b, 0.14, 1.3, C.panel, 1.6, 1.6);
      sheet(a, b, 1.3, h, C.block, 1.6, 0.8);
      along(a, b, 1.3, 1.38, 0.05, inner - outward * 0.025, M.trim, { cast: false });
      along(a, b, 0, 0.14, 0.03, inner - outward * 0.015, M.base, { cast: false });
    }
    for (const [a, b] of openings) {
      sheet(a, b, 0, sill, C.panel, 1.6, 1.6);
      sheet(a, b, head, h, C.block, 1.6, 0.8);
    }
    along(from, to, 4.2, 4.36, 0.012, inner - outward * 0.012, M.burgundy, { cast: false });
    along(from, to, 4.39, 4.46, 0.012, inner - outward * 0.012, M.mustard, { cast: false });
    along(from, to, 4.49, 4.56, 0.012, inner - outward * 0.012, M.teal, { cast: false });
  }
  for (const [a, b] of F80 ? [] : solid) {
    along(a, b, 0.16, 1.18, 0.012, inner - outward * 0.006, M.lower, { cast: false });
    along(a, b, 1.18, 1.24, 0.04, inner - outward * 0.02, M.trim, { cast: false });
    along(a, b, 0, 0.16, 0.035, inner - outward * 0.0175, M.trim, { cast: false });
  }
  // cut-section cap along the whole top, slightly proud on both sides
  along(from, to, h, h + 0.06, T + 0.04, mid, M.cut, { cast: false });

  // windows: slim steel frame with depth, mullions, a transom, sill board and glass
  for (const [a, b] of openings) {
    const H0 = sill;
    const H1 = head;
    const panes = Math.max(1, Math.round((b - a) / 1.45));
    const pw = (b - a) / panes;
    const fz = mid; // frame plane: middle of the wall
    const vert = (p, w) => part(scene, GEO.box, M.frame, axis === 'x' ? [w, H1 - H0, 0.14] : [0.14, H1 - H0, w], axis === 'x' ? [p, (H0 + H1) / 2, fz] : [fz, (H0 + H1) / 2, p], { cast: true });
    const horiz = (y, hh) => part(scene, GEO.box, M.frame, axis === 'x' ? [b - a, hh, 0.14] : [0.14, hh, b - a], axis === 'x' ? [(a + b) / 2, y, fz] : [fz, y, (a + b) / 2], { cast: true });
    for (let i = 0; i <= panes; i++) vert(a + i * pw, i === 0 || i === panes ? 0.1 : 0.06);
    horiz(H0 + 0.05, 0.1);
    horiz(H1 - 0.05, 0.1);
    const ty = H0 + (H1 - H0) * 0.74;
    horiz(ty, 0.06);
    // thin glazing bars in the transom
    for (let i = 0; i < panes; i++) {
      const p = a + (i + 0.5) * pw;
      part(scene, GEO.box, M.frame, axis === 'x' ? [0.03, H1 - ty - 0.1, 0.1] : [0.1, H1 - ty - 0.1, 0.03], axis === 'x' ? [p, (ty + H1 - 0.1) / 2 + 0.02, fz] : [fz, (ty + H1 - 0.1) / 2 + 0.02, p], { cast: true });
    }
    // interior sill board
    part(scene, rbox(axis === 'x' ? b - a + 0.16 : 0.26, 0.05, axis === 'x' ? 0.26 : b - a + 0.16, 0.012), M.sill, 1, axis === 'x' ? [(a + b) / 2, H0 + 0.025, inner - outward * 0.02] : [inner - outward * 0.02, H0 + 0.025, (a + b) / 2], { cast: false });
    const gp = part(scene, GEO.plane, gm, [b - a, H1 - H0, 1], axis === 'x' ? [(a + b) / 2, (H0 + H1) / 2, fz + outward * 0.01] : [fz + outward * 0.01, (H0 + H1) / 2, (a + b) / 2], { rot: axis === 'x' ? [0, 0, 0] : [0, PI / 2, 0], cast: false });
    gp.renderOrder = 4;
    gp.userData.keep = true;
  }
}

/** Dark section plate on a cut wall end (the open front of the diorama). */
function endCap(scene, x, z, axis, h) {
  part(scene, GEO.box, M.cut, axis === 'x' ? [0.02, h + 0.06, 0.34] : [0.34, h + 0.06, 0.02], [x, (h + 0.06) / 2, z], { cast: false });
}

/** Sun shaft: a soft additive sheet from a window's top edge down to where its light lands. */
function shaft(scene, material, p0, p1, h, sun) {
  const t = h / sun.y;
  const d = new THREE.Vector3(-sun.x * t, -h, -sun.z * t);
  const g = new THREE.BufferGeometry();
  const c = p1.clone().add(d);
  const e = p0.clone().add(d);
  g.setAttribute('position', new THREE.Float32BufferAttribute([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, c.x, c.y, c.z, e.x, e.y, e.z], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const m = new THREE.Mesh(g, material);
  m.renderOrder = 5;
  m.userData.keep = true;
  m.userData.noAO = true;
  scene.add(m);
}

export function buildShell(scene, room, sun) {
  const { x0, x1, z0, z1, h } = room;
  const W = x1 - x0;
  const D = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  // back wall (glass at both ends) and left wall (glass toward the back)
  const backOpen = [
    [x0 + 0.3, -10.05],
    [F80 ? 5.0 : 1.3, x1 - 0.35],
  ];
  const leftOpen = [[z0 + 0.35, -1.55]];
  wall(scene, { axis: 'x', fixed: z0, from: x0 - 0.3, to: x1, h, openings: backOpen, sill: 0.3, head: h - 0.45, outward: -1 });
  wall(scene, { axis: 'z', fixed: x0, from: z0, to: z1, h, openings: leftOpen, sill: 0.3, head: 3.95, outward: -1 });
  endCap(scene, x1 + 0.01, z0 - 0.15, 'x', h);
  endCap(scene, x0 - 0.15, z1 + 0.01, 'z', h);

  // roof eave outside the two walls: soffit, membrane top with gravel stop, white fascia
  const E = 1.25;
  const RY = h + 0.06;
  part(scene, GEO.box, M.roof, [W + 0.3 + E, 0.28, E], [cx - E / 2, RY + 0.14, z0 - 0.3 - E / 2], { cast: true, receive: true });
  part(scene, GEO.box, M.roof, [E, 0.28, D + 0.3], [x0 - 0.3 - E / 2, RY + 0.14, cz - 0.15], { cast: true, receive: true });
  part(scene, GEO.box, M.fascia, [W + 0.3 + E + 0.06, 0.34, 0.06], [cx - E / 2, RY + 0.12, z0 - 0.3 - E - 0.03], { cast: false });
  part(scene, GEO.box, M.fascia, [0.06, 0.34, D + 0.3 + E], [x0 - 0.3 - E - 0.03, RY + 0.12, cz - 0.15 - E / 2], { cast: false });
  // parapet lip on the inner edge of the eave
  part(scene, GEO.box, M.fascia, [W + 0.3, 0.12, 0.34], [cx - 0.15, RY + 0.34, z0 - 0.15], { cast: false });
  part(scene, GEO.box, M.fascia, [0.34, 0.12, D], [x0 - 0.15, RY + 0.34, cz], { cast: false });
  // eave cut ends at the open front
  part(scene, GEO.box, M.cut, [0.02, 0.4, E + 0.34], [x1 + 0.01, RY + 0.17, z0 - 0.3 - E / 2 + 0.17], { cast: false });
  part(scene, GEO.box, M.cut, [E + 0.34, 0.4, 0.02], [x0 - 0.3 - E / 2 + 0.17, RY + 0.17, z1 + 0.01], { cast: false });
  // timber ledger beams along the wall tops with joist ends: a ceiling, sliced off
  part(scene, GEO.box, M.beam, [W, 0.32, 0.22], [cx, h - 0.16, z0 + 0.11], { cast: false });
  part(scene, GEO.box, M.beam, [0.22, 0.32, D], [x0 + 0.11, h - 0.16, cz], { cast: false });
  for (let x = x0 + 1.4; x < x1 - 0.5; x += 2.4) {
    part(scene, GEO.box, M.beam, [0.14, 0.24, 0.5], [x, h - 0.12, z0 + 0.47], { cast: false });
    part(scene, GEO.box, M.cut, [0.14, 0.24, 0.01], [x, h - 0.12, z0 + 0.725], { cast: false });
  }
  for (let z = z0 + 1.4; z < z1 - 0.5; z += 2.4) {
    part(scene, GEO.box, M.beam, [0.5, 0.24, 0.14], [x0 + 0.47, h - 0.12, z], { cast: false });
    part(scene, GEO.box, M.cut, [0.01, 0.24, 0.14], [x0 + 0.725, h - 0.12, z], { cast: false });
  }

  // sun shafts through the left windows: two soft sheets per pane
  const shaftTex = canvasTexture(
    64,
    128,
    (g, w, hh) => {
      const grd = g.createLinearGradient(0, 0, 0, hh);
      grd.addColorStop(0, 'rgba(255,255,255,0.0)');
      grd.addColorStop(0.12, 'rgba(255,255,255,1)');
      grd.addColorStop(0.7, 'rgba(255,255,255,0.45)');
      grd.addColorStop(1, 'rgba(255,255,255,0.0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, hh);
      const side = g.createLinearGradient(0, 0, w, 0);
      side.addColorStop(0, 'rgba(0,0,0,1)');
      side.addColorStop(0.18, 'rgba(0,0,0,0)');
      side.addColorStop(0.82, 'rgba(0,0,0,0)');
      side.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = side;
      g.fillRect(0, 0, w, hh);
    },
    { srgb: false },
  );
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, color: F80 ? 0xffc48a : 0xffe9c4, transparent: true, opacity: F80 ? 0.045 : 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const [winA, winB] = leftOpen[0];
  const panes = Math.round((winB - winA) / 1.45);
  for (let i = 0; i < panes; i++) {
    const a = winA + ((winB - winA) * i) / panes + 0.06;
    const b = winA + ((winB - winA) * (i + 1)) / panes - 0.06;
    shaft(scene, shaftMat, new THREE.Vector3(x0, 3.88, a), new THREE.Vector3(x0, 3.88, b), 3.88, sun);
    shaft(scene, shaftMat, new THREE.Vector3(x0 - 0.12, 3.0, a + 0.1), new THREE.Vector3(x0 - 0.12, 3.0, b - 0.1), 3.0, sun);
    // film80: the air is thick with dust, so a low third sheet fills the beam out
    if (F80) shaft(scene, shaftMat, new THREE.Vector3(x0 - 0.06, 2.0, a + 0.16), new THREE.Vector3(x0 - 0.06, 2.0, b - 0.16), 2.0, sun);
  }

  return { wallMat, cutMat: M.cut, trim: M.trim };
}
