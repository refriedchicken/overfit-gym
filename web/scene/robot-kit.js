// Building blocks for the clankers: sculpted geometry, a rigid-skinning rig that
// merges every part of one material into a single SkinnedMesh (a whole robot is a
// handful of draw calls), and procedural canvas atlases for paint, fabric and
// sneakers. Everything here is deterministic: seeded PRNGs only.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FONT, F80 } from './materials.js';

const PI = Math.PI;

/** mulberry32: small deterministic PRNG. */
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const css = (c) => `#${new THREE.Color(c).getHexString()}`;
const shade = (c, k) => {
  const col = new THREE.Color(c);
  if (k >= 0) col.lerp(new THREE.Color(0xffffff), k);
  else col.multiplyScalar(1 + k);
  return `#${col.getHexString()}`;
};
const lum = (c) => {
  const col = new THREE.Color(c);
  return col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
};

export function rrect(g, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

const textTex = [];
let fontsHooked = false;
/** Redraw every text-bearing atlas once the (self-hosted) fonts are in, so outfits never keep a fallback face. */
function hookFonts() {
  if (fontsHooked || typeof document === 'undefined' || !document.fonts) return;
  fontsHooked = true;
  // Capture mode draws frames only on seek, so a late texture redraw would make the
  // first frame differ from later ones: there the textures keep what they were built with
  // (the page should load its fonts before building the scene).
  if (/[?&]capture=1\b/.test(location.search)) return;
  try {
    if (document.fonts.status === 'loaded' && document.fonts.check(`64px ${FONT}`)) return;
  } catch {
    /* fall through to the async redraw */
  }
  const redraw = () => {
    for (const tex of textTex) {
      const g = tex.userData.ctx;
      g.clearRect(0, 0, g.canvas.width, g.canvas.height);
      tex.userData.draw(g, g.canvas.width, g.canvas.height);
      tex.needsUpdate = true;
    }
  };
  let loads = [document.fonts.ready];
  try {
    loads = [document.fonts.load(`64px ${FONT}`), document.fonts.ready];
  } catch {
    /* font list not parseable: ready alone */
  }
  Promise.all(loads).then(redraw, redraw);
}

/** Canvas texture drawn once. `text: true` registers it for a redraw after web fonts load. */
export function canvasTex(w, h, draw, { srgb = true, aniso = 8, text = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  tex.userData.ctx = g;
  tex.userData.draw = draw;
  if (text) {
    textTex.push(tex);
    hookFonts();
  }
  return tex;
}

// ---------- geometry ----------

const V2 = (x, y) => new THREE.Vector2(x, y);

/** Smooth lathe from a coarse [r, y] profile (bottom to top). Front (+z) sits at u = 0.5. */
export function lathe(profile, { seg = 28, n = 22, smooth = true } = {}) {
  let pts = profile.map(([r, y]) => V2(Math.max(0.0005, r), y));
  if (smooth && pts.length > 2) pts = new THREE.SplineCurve(pts).getSpacedPoints(n);
  return new THREE.LatheGeometry(pts, seg, PI, PI * 2);
}

export const rbox = (w, h, d, r = 0.03, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
export const capsule = (r, len, cap = 5, rad = 12) => new THREE.CapsuleGeometry(r, len, cap, rad);
export const sphere = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);
export const cyl = (rt, rb, h, seg = 18, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const torus = (r, tube, rs = 10, ts = 32, arc = PI * 2) => new THREE.TorusGeometry(r, tube, rs, ts, arc);

/** Helix tube (antenna spring). */
export function helix(r, h, turns, tube, seg = 64) {
  const curve = new THREE.Curve();
  curve.getPoint = (t, out = new THREE.Vector3()) => out.set(Math.cos(t * turns * PI * 2) * r, t * h, Math.sin(t * turns * PI * 2) * r);
  return new THREE.TubeGeometry(curve, seg, tube, 6, false);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Clone + transform: { p:[x,y,z], r:[x,y,z], s:number|[x,y,z] }. */
export function xf(geo, { p = null, r = null, s = null } = {}) {
  const g = geo.clone();
  _p.set(...(p ?? [0, 0, 0]));
  _q.setFromEuler(_e.set(...(r ?? [0, 0, 0])));
  if (Array.isArray(s)) _s.set(s[0], s[1], s[2]);
  else _s.setScalar(s ?? 1);
  g.applyMatrix4(_m.compose(_p, _q, _s));
  return g;
}

/** Remap every UV into an atlas rect [u0, v0, u1, v1]. */
export function fitUV(geo, rect) {
  const uv = geo.attributes.uv;
  if (!uv || !rect) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
  uv.needsUpdate = true;
  return geo;
}

/** Remap a box-like geometry's per-face groups (px, nx, py, ny, pz, nz) into atlas rects. */
export function boxUV(geo, rects) {
  const uv = geo.attributes.uv;
  const idx = geo.index;
  const done = new Uint8Array(uv.count);
  for (const grp of geo.groups) {
    const rect = rects[grp.materialIndex] ?? rects[0];
    for (let k = grp.start; k < grp.start + grp.count; k++) {
      const i = idx ? idx.getX(k) : k;
      if (done[i]) continue;
      done[i] = 1;
      uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function prep(geo) {
  let g = geo.index ? geo : geo.clone();
  if (!g.index) {
    const n = g.attributes.position.count;
    const a = new Uint32Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    g.setIndex(new THREE.BufferAttribute(a, 1));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position.clone());
  out.setAttribute('normal', g.attributes.normal.clone());
  out.setAttribute('uv', g.attributes.uv ? g.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  out.setIndex(g.index.clone());
  return out;
}

/**
 * Rigid-skinning rig. Parts are attached to bones; build() bakes them, groups by
 * material and returns one SkinnedMesh per material sharing a single Skeleton.
 */
export class Rig {
  constructor(root) {
    this.root = root;
    this.bones = [];
    this.parts = [];
  }
  bone(parent, x = 0, y = 0, z = 0, name = '') {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    this.bones.push(b);
    return b;
  }
  /** add(bone, geo, material, {p, r, s, uv: rect, box: rects}) */
  add(bone, geo, material, o = {}) {
    let g = o.p || o.r || o.s ? xf(geo, o) : geo.clone();
    if (o.box) boxUV(g, o.box);
    else if (o.uv) fitUV(g, o.uv);
    this.parts.push({ bone, geo: g, material });
    return g;
  }
  build({ cast = new Set() } = {}) {
    this.root.updateMatrixWorld(true);
    const byMat = new Map();
    for (const p of this.parts) {
      if (!byMat.has(p.material)) byMat.set(p.material, []);
      byMat.get(p.material).push(p);
    }
    const skeleton = new THREE.Skeleton(this.bones);
    const meshes = [];
    for (const [material, list] of byMat) {
      const geos = list.map((p) => {
        const g = prep(p.geo);
        g.applyMatrix4(p.bone.matrixWorld);
        const n = g.attributes.position.count;
        const bi = this.bones.indexOf(p.bone);
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          si[i * 4] = bi;
          sw[i * 4] = 1;
        }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        return g;
      });
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      const mesh = new THREE.SkinnedMesh(merged, material);
      mesh.frustumCulled = false;
      mesh.castShadow = cast.has(material);
      mesh.receiveShadow = false;
      this.root.add(mesh);
      mesh.bind(skeleton);
      meshes.push(mesh);
    }
    for (const p of this.parts) p.geo.dispose();
    this.parts.length = 0;
    return { skeleton, meshes };
  }
}

/** Static (non-skinned) merged mesh for gear pieces attached to one bone. */
export function gearMesh(parent, items, material, { cast = false } = {}) {
  const geos = items.map(([geo, o, rect]) => {
    const g = prep(xf(geo, o ?? {}));
    if (rect) fitUV(g, rect);
    return g;
  });
  const m = new THREE.Mesh(geos.length === 1 ? geos[0] : mergeGeometries(geos), material);
  m.castShadow = cast;
  parent.add(m);
  return m;
}

// ---------- atlases ----------

/** Paint atlas regions (UV rects, v up). Colour comes from the material; the map adds panel lines, rivets and veins. */
export const PAINT = {
  plain: [0.02, 0.02, 0.23, 0.23],
  torso: [0.25, 0, 1, 0.5],
  head: [0, 0.25, 0.25, 0.5],
  cannon: [0, 0.5, 0.5, 1],
  fore: [0.5, 0.5, 1, 1],
};

function groove(g, path, w = 3) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = w + 2;
  g.translate(1.5, 1.5);
  path();
  g.stroke();
  g.translate(-1.5, -1.5);
  g.strokeStyle = 'rgba(40,44,52,0.55)';
  g.lineWidth = w;
  path();
  g.stroke();
  g.restore();
}

function rivet(g, x, y, r = 5) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, 0.5, x, y, r);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.55, '#d9dce2');
  gr.addColorStop(1, '#6d727c');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, PI * 2);
  g.fill();
}

let paintTex = null;
/** Shared white paint atlas: multiply by the chassis colour. */
export function paintAtlas() {
  if (paintTex) return paintTex;
  const S = 1024;
  paintTex = canvasTex(S, S, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    const R = (rect) => [rect[0] * S, (1 - rect[3]) * S, (rect[2] - rect[0]) * S, (rect[3] - rect[1]) * S];
    // torso: side seams with rivets, waist and yoke lines, a front chest plate, back vents
    {
      const [x, y, w, h] = R(PAINT.torso);
      const vy = (v) => y + (1 - v) * h;
      const ux = (u) => x + u * w;
      for (const u of [0.25, 0.75]) {
        groove(g, () => {
          g.beginPath();
          g.moveTo(ux(u), vy(0.04));
          g.lineTo(ux(u), vy(0.86));
        });
        for (let v = 0.12; v < 0.84; v += 0.1) rivet(g, ux(u) + 12, vy(v), 4);
      }
      groove(g, () => {
        g.beginPath();
        g.moveTo(x, vy(0.18));
        g.lineTo(x + w, vy(0.18));
      });
      groove(g, () => {
        g.beginPath();
        g.moveTo(x, vy(0.86));
        g.bezierCurveTo(ux(0.3), vy(0.8), ux(0.4), vy(0.78), ux(0.5), vy(0.78));
        g.bezierCurveTo(ux(0.6), vy(0.78), ux(0.7), vy(0.8), x + w, vy(0.86));
      });
      // chest plate
      groove(g, () => {
        rrect(g, ux(0.4), vy(0.72), w * 0.2, h * 0.32, 26);
      });
      for (const [u, v] of [
        [0.41, 0.69],
        [0.59, 0.69],
        [0.41, 0.43],
        [0.59, 0.43],
      ])
        rivet(g, ux(u), vy(v), 5);
      // back vents
      for (const u0 of [0.0, 0.94]) {
        for (let i = 0; i < 4; i++) {
          groove(g, () => {
            g.beginPath();
            g.moveTo(ux(u0 + 0.012), vy(0.62 - i * 0.07));
            g.lineTo(ux(u0 + 0.048), vy(0.62 - i * 0.07));
          }, 6);
        }
      }
    }
    // head: an inset panel line on every face, rivets in the corners
    {
      const [x, y, w, h] = R(PAINT.head);
      groove(g, () => rrect(g, x + w * 0.09, y + h * 0.09, w * 0.82, h * 0.82, 30));
      for (const [a, b] of [
        [0.16, 0.16],
        [0.84, 0.16],
        [0.16, 0.84],
        [0.84, 0.84],
      ])
        rivet(g, x + a * w, y + b * h, 5);
    }
    // cannon (bicep): wandering vein panel lines along the length, cuff rings at each end
    {
      const [x, y, w, h] = R(PAINT.cannon);
      const r = rng(77);
      for (let k = 0; k < 7; k++) {
        let px = x + ((k + 0.5) / 7) * w;
        groove(g, () => {
          g.beginPath();
          g.moveTo(px, y + h * 0.12);
          for (let s = 1; s <= 10; s++) {
            px += (r() - 0.5) * 34;
            g.lineTo(px, y + h * 0.12 + (s / 10) * h * 0.76);
          }
        }, 4);
        if (k % 2 === 0) {
          const bx = x + ((k + 0.5) / 7) * w;
          const by = y + h * (0.35 + r() * 0.3);
          groove(g, () => {
            g.beginPath();
            g.moveTo(bx, by);
            g.quadraticCurveTo(bx + 30, by + 30, bx + 46, by + 90);
          }, 3);
        }
      }
      for (const v of [0.06, 0.94]) {
        groove(g, () => {
          g.beginPath();
          g.moveTo(x, y + h * v);
          g.lineTo(x + w, y + h * v);
        }, 5);
      }
    }
    // forearm: ribbed rings near the wrist, a rivet band near the elbow
    {
      const [x, y, w, h] = R(PAINT.fore);
      for (const v of [0.08, 0.14, 0.2]) {
        groove(g, () => {
          g.beginPath();
          g.moveTo(x, y + h * (1 - v));
          g.lineTo(x + w, y + h * (1 - v));
        }, 5);
      }
      groove(g, () => {
        g.beginPath();
        g.moveTo(x, y + h * 0.16);
        g.lineTo(x + w, y + h * 0.16);
      }, 4);
      for (let i = 0; i < 8; i++) rivet(g, x + ((i + 0.5) / 8) * w, y + h * 0.24, 6);
      for (const u of [0.5, 0.0]) {
        groove(g, () => {
          g.beginPath();
          g.moveTo(x + u * w + 16, y + h * 0.3);
          g.quadraticCurveTo(x + u * w + 40, y + h * 0.55, x + u * w + 20, y + h * 0.75);
        }, 3);
      }
    }
  });
  return paintTex;
}

const pcache = new Map();
function cached(key, make) {
  let v = pcache.get(key);
  if (!v) pcache.set(key, (v = make()));
  return v;
}

// ---------- fabric atlases ----------

/** Upper (shirt) atlas regions. */
export const TOP = {
  body: [0, 0, 0.75, 1],
  sleeve: [0.75, 0.5, 1, 1],
  band: [0.76, 0.27, 0.99, 0.48],
  trim: [0.76, 0.02, 0.99, 0.23],
};
/** Lower (shorts, socks, leggings, mat) atlas regions. */
export const LOW = {
  waist: [0, 0.75, 0.5, 1],
  leg: [0.5, 0.5, 1, 1],
  sock: [0, 0.5, 0.25, 0.75],
  legging: [0.25, 0.5, 0.5, 0.75],
  mat: [0, 0.25, 0.5, 0.5],
  black: [0.52, 0.27, 0.73, 0.48],
  white: [0.77, 0.27, 0.98, 0.48],
  tag: [0.52, 0.02, 0.73, 0.23],
};
/** Sneaker atlas regions. */
export const SHOE = {
  side: [0, 0.5, 0.5, 1],
  top: [0.5, 0.5, 1, 1],
  sole: [0, 0, 0.5, 0.5],
  plain: [0.52, 0.02, 0.98, 0.48],
};

function weave(g, x, y, w, h, alpha = 0.06) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = `rgba(0,0,0,${alpha})`;
  g.lineWidth = 1;
  for (let i = -h; i < w; i += 4) {
    g.beginPath();
    g.moveTo(x + i, y);
    g.lineTo(x + i + h, y + h);
    g.stroke();
  }
  g.strokeStyle = `rgba(255,255,255,${alpha * 0.8})`;
  for (let i = -h; i < w; i += 6) {
    g.beginPath();
    g.moveTo(x + i + h, y);
    g.lineTo(x + i, y + h);
    g.stroke();
  }
  g.restore();
}

function stitch(g, path, color = 'rgba(255,255,255,0.55)', w = 2) {
  g.save();
  g.setLineDash([7, 6]);
  g.strokeStyle = color;
  g.lineWidth = w;
  path();
  g.stroke();
  g.restore();
}


function label(g, text, x, y, size, fill, stroke, maxW) {
  g.save();
  g.font = `${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (stroke) {
    g.lineWidth = size * 0.14;
    g.strokeStyle = stroke;
    g.lineJoin = 'round';
    g.strokeText(text, x, y, maxW);
  }
  g.fillStyle = fill;
  g.fillText(text, x, y, maxW);
  g.restore();
}

/** Varsity numerals: fill, a contrast keyline and a heavy outer outline. */
function jerseyNum(g, text, x, y, size, maxW, light) {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.font = `800 ${size}px ${FONT}`;
  const k = Math.min(1, maxW / Math.max(1, g.measureText(text).width));
  const sz = size * Math.max(k, 0.62);
  g.font = `800 ${sz}px ${FONT}`;
  g.translate(x, y + sz * 0.04);
  if (k < 0.62) g.scale(k / 0.62, 1);
  const fill = light ? '#111216' : '#fdfaf2';
  const key = light ? '#fdfaf2' : '#111216';
  g.strokeStyle = light ? '#111216' : 'rgba(10,11,14,0.9)';
  g.lineWidth = sz * (light ? 0.2 : 0.17);
  g.strokeText(text, 0, 0);
  if (light) {
    g.strokeStyle = key;
    g.lineWidth = sz * 0.1;
    g.strokeText(text, 0, 0);
  }
  g.fillStyle = fill;
  g.fillText(text, 0, 0);
  g.restore();
}

/**
 * Shirt atlas for an archetype. u runs around the torso (front at 0.5), v up.
 * Tank and singlet arm holes are cut with alpha (the material alpha-tests).
 */
export function topAtlas(arch, top, band, num, kit = null) {
  const jersey = kit?.jersey ?? null;
  // a numbered kit is drawn at twice the resolution: the number has to survive a close-up
  const K = jersey ? 2 : 1;
  return cached(`top|${arch.id}|${top}|${band}|${num}|${jersey}|${kit?.accents?.join(',') ?? ''}`, () =>
    canvasTex(1024 * K, 512 * K, (g) => {
      const S = { w: 1024, h: 512 };
      g.setTransform(K, 0, 0, K, 0, 0);
      g.clearRect(0, 0, S.w, S.h);
      const R = (rect) => [rect[0] * S.w, (1 - rect[3]) * S.h, (rect[2] - rect[0]) * S.w, (rect[3] - rect[1]) * S.h];
      const topC = css(top);
      const bandC = css(band);
      const dark = lum(top) > 0.62;
      const ink = dark ? '#16181d' : '#f7f4ec';
      const inkStroke = dark ? null : 'rgba(10,12,16,0.55)';
      // ---- body ----
      {
        const [x, y, w, h] = R(TOP.body);
        const ux = (u) => x + u * w;
        const vy = (v) => y + (1 - v) * h;
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, shade(top, 0.08));
        grad.addColorStop(1, shade(top, -0.12));
        g.fillStyle = grad;
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h);
        // hem band
        g.fillStyle = shade(top, -0.22);
        g.fillRect(x, vy(0.06), w, h * 0.06);
        stitch(g, () => {
          g.beginPath();
          g.moveTo(x, vy(0.075));
          g.lineTo(x + w, vy(0.075));
        });
        // side seams
        for (const u of [0.25, 0.75]) {
          g.fillStyle = shade(top, -0.15);
          g.fillRect(ux(u) - 2, y, 4, h);
        }
        const t = arch.top;
        if (t === 'tank' || t === 'singlet') {
          // arm holes: deep stringer cut for the powerbuilder, a racer cut for the singlet
          const depth = t === 'tank' ? 0.62 : 0.42;
          const half = t === 'tank' ? 0.13 : 0.1;
          for (const u of [0.25, 0.75]) {
            g.save();
            g.globalCompositeOperation = 'destination-out';
            g.beginPath();
            g.ellipse(ux(u), vy(1.02), w * half, h * depth, 0, 0, PI * 2);
            g.fill();
            g.restore();
            g.save();
            g.strokeStyle = bandC;
            g.lineWidth = 10;
            g.beginPath();
            g.ellipse(ux(u), vy(1.02), w * half + 3, h * depth + 3, 0, 0, PI * 2);
            g.stroke();
            g.restore();
          }
          // neckline scoop front and back
          for (const u of [0.5, 0.0, 1.0]) {
            g.save();
            g.globalCompositeOperation = 'destination-out';
            g.beginPath();
            g.ellipse(ux(u), vy(1.0), w * 0.09, h * (t === 'tank' ? 0.2 : 0.16), 0, 0, PI * 2);
            g.fill();
            g.restore();
            g.save();
            g.strokeStyle = bandC;
            g.lineWidth = 9;
            g.beginPath();
            g.ellipse(ux(u), vy(1.0), w * 0.09 + 3, h * (t === 'tank' ? 0.2 : 0.16) + 3, 0, 0, PI * 2);
            g.stroke();
            g.restore();
          }
        } else {
          // crew neck ribbing
          g.fillStyle = shade(top, -0.2);
          g.fillRect(x, vy(1.0), w, h * 0.06);
          stitch(g, () => {
            g.beginPath();
            g.moveTo(x, vy(0.93));
            g.lineTo(x + w, vy(0.93));
          });
        }
        if (t === 'compression') {
          // flatlock panel seams: chevrons over the chest and a contrast side panel
          for (const u of [0.25, 0.75]) {
            g.fillStyle = shade(top, -0.3);
            g.fillRect(ux(u) - w * 0.035, y, w * 0.07, h);
            stitch(g, () => {
              g.beginPath();
              g.moveTo(ux(u) - w * 0.035, y);
              g.lineTo(ux(u) - w * 0.035, y + h);
              g.moveTo(ux(u) + w * 0.035, y);
              g.lineTo(ux(u) + w * 0.035, y + h);
            }, bandC, 3);
          }
          stitch(g, () => {
            g.beginPath();
            g.moveTo(ux(0.3), vy(0.88));
            g.lineTo(ux(0.5), vy(0.66));
            g.lineTo(ux(0.7), vy(0.88));
          }, bandC, 4);
        }
        if (t === 'long') {
          // soft wrap-front seam and a small lotus emblem
          stitch(g, () => {
            g.beginPath();
            g.moveTo(ux(0.42), vy(0.98));
            g.quadraticCurveTo(ux(0.52), vy(0.6), ux(0.6), vy(0.12));
          }, 'rgba(255,255,255,0.5)', 3);
        }
        // front graphic
        const fx = ux(0.5);
        if (jersey) {
          // the jersey number is drawn last, over everything (see below)
        } else if (arch.bib) {
          g.save();
          g.translate(fx, vy(0.5));
          g.fillStyle = '#f6f3ea';
          rrect(g, -78, -52, 156, 104, 10);
          g.fill();
          g.fillStyle = bandC;
          g.fillRect(-78, -52, 156, 18);
          g.fillStyle = '#9aa0aa';
          for (const [a, b] of [
            [-68, -42],
            [68, -42],
            [-68, 44],
            [68, 44],
          ]) {
            g.beginPath();
            g.arc(a, b, 4, 0, PI * 2);
            g.fill();
          }
          g.restore();
          label(g, '404', fx, vy(0.47), 78, '#15171c', null, 140);
          label(g, 'NOT FOUND 5K', fx, vy(0.6), 15, '#ffffff', null, 140);
        } else if (arch.decal) {
          label(g, arch.decal, fx, vy(0.55), arch.decalSize ?? 76, ink, inkStroke, w * 0.2);
          if (arch.sub) label(g, arch.sub, fx, vy(0.36), 22, ink, null, w * 0.2);
        }
        if (t === 'long') {
          g.save();
          g.translate(fx, vy(0.66));
          g.fillStyle = ink;
          for (const a of [-0.7, 0, 0.7]) {
            g.save();
            g.rotate(a);
            g.beginPath();
            g.ellipse(0, -16, 9, 20, 0, 0, PI * 2);
            g.fill();
            g.restore();
          }
          g.restore();
        }
        // back: a number and a name bar
        if (!jersey)
          for (const u of [0.0, 1.0]) {
            label(g, String(num), ux(u), vy(0.5), 96, ink, inkStroke, w * 0.16);
            label(g, 'TESTS', ux(u), vy(0.75), 26, ink, null, w * 0.16);
          }
      }
      // ---- sleeve: top colour, a band-colour cuff stripe at the bottom (v = 0) ----
      {
        const [x, y, w, h] = R(TOP.sleeve);
        g.fillStyle = topC;
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h);
        g.fillStyle = arch.top === 'long' ? shade(top, -0.2) : bandC;
        g.fillRect(x, y + h * 0.84, w, h * 0.12);
        stitch(g, () => {
          g.beginPath();
          g.moveTo(x, y + h * 0.8);
          g.lineTo(x + w, y + h * 0.8);
        });
      }
      if (F80) {
        // film80 wardrobe: windbreaker colour blocking (a raglan yoke and a racing
        // stripe in two loud accents), and the tee becomes a cropped, torn sweatshirt
        const NEON = [0xff3f9a, 0x2fd6e6, 0xf5d53a, 0x8a4fe0, 0xf2efe6, 0xff7a2a];
        const pick = (k) => NEON[(((top >>> 3) ^ (band >>> 5)) + k * 7 + num) % NEON.length];
        let a = pick(0);
        let b2 = pick(1);
        if (a === b2) b2 = pick(2);
        // a brand kit keeps its own colours: the yoke goes tone-on-tone, the stripes take the kit accents
        const acc = kit?.accents;
        if (acc) {
          a = acc[0];
          b2 = acc[1];
        }
        const yoke = acc ? new THREE.Color(top).multiplyScalar(0.8).getHex() : a;
        const [x, y, w, h] = R(TOP.body);
        const vy = (v) => y + (1 - v) * h;
        const edge = (u) => 0.8 + 0.06 * Math.cos(u * PI * 4);
        const band2 = (v0, v1, col) => {
          g.fillStyle = css(col);
          g.beginPath();
          for (let i = 0; i <= 48; i++) g.lineTo(x + (i / 48) * w, vy(edge(i / 48) + v1));
          for (let i = 48; i >= 0; i--) g.lineTo(x + (i / 48) * w, vy(edge(i / 48) + v0));
          g.closePath();
          g.fill();
        };
        g.save();
        g.beginPath();
        g.rect(x, y, w, h);
        g.clip();
        g.globalCompositeOperation = 'source-atop';
        const sleeved = arch.top === 'long' || arch.top === 'compression' || arch.top === 'tee';
        if (sleeved) band2(0, 0.4, yoke);
        band2(-0.045, -0.012, b2);
        band2(-0.085, -0.062, sleeved ? 0xf2efe6 : a);
        g.globalCompositeOperation = 'source-over';
        if (arch.top === 'tee' && !jersey) {
          // cropped and ripped: the hem is torn away in ragged bites
          const r = rng(num * 31 + 3);
          g.globalCompositeOperation = 'destination-out';
          g.beginPath();
          g.moveTo(x, y + h);
          for (let i = 0; i <= 40; i++) g.lineTo(x + (i / 40) * w, vy(0.3 + r() * 0.07 + (i % 9 === 4 ? 0.06 : 0)));
          g.lineTo(x + w, y + h);
          g.closePath();
          g.fill();
          g.globalCompositeOperation = 'source-over';
        }
        g.restore();
        if (sleeved) {
          const [sx, sy, sw, sh] = R(TOP.sleeve);
          g.fillStyle = css(yoke);
          g.fillRect(sx, sy, sw, sh * 0.5);
          g.fillStyle = css(b2);
          g.fillRect(sx, sy + sh * 0.5, sw, sh * 0.07);
        }
      }
      if (jersey) {
        // ---- jersey number: big condensed numerals, chest and back, outlined to read at any distance ----
        const [x, y, w, h] = R(TOP.body);
        const light = lum(top) > 0.62;
        const tank = arch.top === 'tank' || arch.top === 'singlet';
        for (const [u, v, size, maxW] of [
          [0.5, tank ? 0.44 : 0.46, 200, w * (tank ? 0.24 : 0.27)],
          [0.0, 0.6, 210, w * 0.28],
          [1.0, 0.6, 210, w * 0.28],
        ])
          jerseyNum(g, jersey, x + u * w, y + (1 - v) * h, size, maxW, light);
      }
      // ---- band (headband, sweatbands): terry stripes ----
      {
        const [x, y, w, h] = R(TOP.band);
        g.fillStyle = bandC;
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h, 0.12);
        g.fillStyle = lum(band) > 0.7 ? 'rgba(20,22,28,0.55)' : 'rgba(255,255,255,0.75)';
        g.fillRect(x, y + h * 0.22, w, h * 0.08);
        g.fillRect(x, y + h * 0.7, w, h * 0.08);
      }
      // ---- trim: plain band colour ----
      {
        const [x, y, w, h] = R(TOP.trim);
        g.fillStyle = bandC;
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h, 0.08);
      }
    }, { text: true }),
  );
}

export function lowAtlas(arch, shorts, band) {
  return cached(`low|${arch.id}|${shorts}|${band}`, () =>
    canvasTex(512, 512, (g) => {
      const S = 512;
      const R = (rect) => [rect[0] * S, (1 - rect[3]) * S, (rect[2] - rect[0]) * S, (rect[3] - rect[1]) * S];
      const sc = css(shorts);
      const bc = css(band);
      g.fillStyle = sc;
      g.fillRect(0, 0, S, S);
      // waist: waistband at the top, drawstring at the front (u = 0.5)
      {
        const [x, y, w, h] = R(LOW.waist);
        weave(g, x, y, w, h);
        g.fillStyle = shade(shorts, -0.3);
        g.fillRect(x, y, w, h * 0.34);
        stitch(g, () => {
          g.beginPath();
          g.moveTo(x, y + h * 0.36);
          g.lineTo(x + w, y + h * 0.36);
        });
        g.strokeStyle = '#f2efe6';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(x + w * 0.48, y + h * 0.2);
        g.quadraticCurveTo(x + w * 0.46, y + h * 0.5, x + w * 0.47, y + h * 0.66);
        g.moveTo(x + w * 0.52, y + h * 0.2);
        g.quadraticCurveTo(x + w * 0.55, y + h * 0.5, x + w * 0.53, y + h * 0.62);
        g.stroke();
        // side stripes
        for (const u of [0.25, 0.75]) {
          g.fillStyle = bc;
          g.fillRect(x + u * w - 7, y + h * 0.34, 14, h);
        }
      }
      // leg tube: outer stripe at u = 0.5 (the tube is rotated to face out), hem at the bottom
      {
        const [x, y, w, h] = R(LOW.leg);
        weave(g, x, y, w, h);
        g.fillStyle = bc;
        g.fillRect(x + w * 0.5 - 7, y, 14, h);
        g.fillStyle = 'rgba(255,255,255,0.8)';
        g.fillRect(x + w * 0.5 - 13, y, 3, h);
        g.fillRect(x + w * 0.5 + 10, y, 3, h);
        g.fillStyle = shade(shorts, -0.28);
        g.fillRect(x, y + h * 0.9, w, h * 0.1);
        stitch(g, () => {
          g.beginPath();
          g.moveTo(x, y + h * 0.88);
          g.lineTo(x + w, y + h * 0.88);
        });
        if (arch.split) {
          g.clearRect(x + w * 0.5 - 18, y + h * 0.62, 36, h * 0.38);
          g.save();
          g.beginPath();
          g.moveTo(x + w * 0.5 - 22, y + h);
          g.lineTo(x + w * 0.5, y + h * 0.6);
          g.lineTo(x + w * 0.5 + 22, y + h);
          g.closePath();
          g.globalCompositeOperation = 'destination-out';
          g.fill();
          g.restore();
        }
      }
      // sock: white with two band-colour stripes near the top (v = 1)
      {
        const [x, y, w, h] = R(LOW.sock);
        g.fillStyle = '#f4f2ec';
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h, 0.08);
        g.fillStyle = bc;
        g.fillRect(x, y + h * 0.1, w, h * 0.08);
        g.fillRect(x, y + h * 0.24, w, h * 0.08);
        g.fillStyle = '#dedbd2';
        g.fillRect(x, y, w, h * 0.06);
      }
      // leggings: shorts colour with a side stripe
      {
        const [x, y, w, h] = R(LOW.legging);
        g.fillStyle = sc;
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h);
        g.fillStyle = bc;
        g.fillRect(x + w * 0.5 - 4, y, 8, h);
      }
      // yoga mat roll: violet with stripes
      {
        const [x, y, w, h] = R(LOW.mat);
        g.fillStyle = '#8f6bff';
        g.fillRect(x, y, w, h);
        g.fillStyle = '#b79bff';
        for (let i = 0; i < 8; i++) g.fillRect(x + (i / 8) * w, y, 6, h);
        g.fillStyle = '#2b2236';
        g.fillRect(x, y + h * 0.18, w, h * 0.08);
        g.fillRect(x, y + h * 0.74, w, h * 0.08);
      }
      {
        const [x, y, w, h] = R(LOW.black);
        g.fillStyle = '#1b1c21';
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h, 0.1);
      }
      {
        const [x, y, w, h] = R(LOW.white);
        g.fillStyle = '#f4f2ec';
        g.fillRect(x, y, w, h);
      }
      // price tag
      {
        const [x, y, w, h] = R(LOW.tag);
        g.fillStyle = '#f7f1e1';
        g.fillRect(x, y, w, h);
        label(g, '$9.99', x + w / 2, y + h * 0.56, 34, '#e0453a', null, w * 0.9);
        g.fillStyle = '#16171b';
        g.beginPath();
        g.arc(x + w / 2, y + h * 0.18, 6, 0, PI * 2);
        g.fill();
      }
    }, { text: true }),
  );
}

export function shoeAtlas(shoe, band) {
  return cached(`shoe|${shoe}|${band}`, () =>
    canvasTex(512, 512, (g) => {
      const S = 512;
      const R = (rect) => [rect[0] * S, (1 - rect[3]) * S, (rect[2] - rect[0]) * S, (rect[3] - rect[1]) * S];
      const sc = css(shoe);
      const light = lum(shoe) > 0.7;
      const accent = light ? css(band) : '#f6f4ee';
      // side: shoe colour, a generic sweeping double band, heel counter, perforations
      {
        const [x, y, w, h] = R(SHOE.side);
        g.fillStyle = sc;
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h, 0.05);
        g.fillStyle = shade(shoe, -0.18);
        g.fillRect(x, y + h * 0.78, w, h * 0.22);
        g.save();
        g.strokeStyle = accent;
        g.lineCap = 'round';
        g.lineWidth = 16;
        g.beginPath();
        g.moveTo(x + w * 0.12, y + h * 0.72);
        g.bezierCurveTo(x + w * 0.4, y + h * 0.66, x + w * 0.6, y + h * 0.4, x + w * 0.86, y + h * 0.3);
        g.stroke();
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(x + w * 0.2, y + h * 0.86);
        g.bezierCurveTo(x + w * 0.45, y + h * 0.8, x + w * 0.65, y + h * 0.55, x + w * 0.88, y + h * 0.46);
        g.stroke();
        g.restore();
        g.fillStyle = 'rgba(0,0,0,0.22)';
        for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) g.fillRect(x + w * (0.1 + i * 0.05), y + h * (0.2 + j * 0.08), 4, 4);
        g.fillStyle = shade(shoe, -0.3);
        g.fillRect(x, y, w * 0.06, h);
        g.fillRect(x + w * 0.94, y, w * 0.06, h);
      }
      // top: tongue and criss-cross laces (box UVs run along x)
      {
        const [x, y, w, h] = R(SHOE.top);
        g.fillStyle = sc;
        g.fillRect(x, y, w, h);
        g.fillStyle = shade(shoe, -0.12);
        rrect(g, x + w * 0.3, y + h * 0.04, w * 0.4, h * 0.6, 30);
        g.fill();
        g.strokeStyle = '#f7f6f1';
        g.lineCap = 'round';
        g.lineWidth = 10;
        for (let i = 0; i < 4; i++) {
          const yy = y + h * (0.12 + i * 0.13);
          g.beginPath();
          g.moveTo(x + w * 0.32, yy);
          g.lineTo(x + w * 0.68, yy + h * 0.07);
          g.moveTo(x + w * 0.68, yy);
          g.lineTo(x + w * 0.32, yy + h * 0.07);
          g.stroke();
        }
        g.fillStyle = shade(shoe, -0.25);
        g.fillRect(x, y + h * 0.75, w, h * 0.25);
      }
      // sole: white rubber with a colour midsole line and tread at the bottom
      {
        const [x, y, w, h] = R(SHOE.sole);
        g.fillStyle = '#f5f3ee';
        g.fillRect(x, y, w, h);
        g.fillStyle = accent === '#f6f4ee' ? css(band) : sc;
        g.fillRect(x, y + h * 0.3, w, h * 0.1);
        g.fillStyle = '#c9c4b8';
        g.fillRect(x, y + h * 0.82, w, h * 0.18);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let i = 0; i < 24; i++) g.fillRect(x + (i / 24) * w, y + h * 0.84, 6, h * 0.16);
      }
      {
        const [x, y, w, h] = R(SHOE.plain);
        g.fillStyle = sc;
        g.fillRect(x, y, w, h);
        weave(g, x, y, w, h, 0.05);
      }
    }),
  );
}

// ---------- shared materials ----------

let shared = null;
export function sharedMats() {
  if (shared) return shared;
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  shared = {
    dark: phys({ color: 0x3a3f49, metalness: 0.85, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.3 }),
    chrome: phys({ color: 0xe6e9ee, metalness: 1, roughness: 0.16 }),
    glass: phys({ color: 0x06080c, metalness: 0.1, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.85 }),
    neoprene: phys({ color: 0x17181c, roughness: 0.7, sheen: 1, sheenColor: new THREE.Color(0x4a4f5c), sheenRoughness: 0.5 }),
    white: phys({ color: 0xf3f1ea, roughness: 0.85, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6 }),
    leather: phys({ color: 0x5d3418, roughness: 0.48, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
    gold: phys({ color: 0xffc94d, metalness: 1, roughness: 0.18 }),
    phones: phys({ color: 0x1b1d22, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    chalk: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.32, depthWrite: false }),
    steam: new THREE.MeshStandardMaterial({ color: 0xc9d2dc, roughness: 1, transparent: true, opacity: 0.2, depthWrite: false }),
    oil: phys({ color: 0x2b1b08, roughness: 0.05, metalness: 0.2, clearcoat: 1 }),
    spark: new THREE.MeshBasicMaterial({ color: 0xffd36b, toneMapped: false }),
    star: new THREE.MeshBasicMaterial({ color: 0xfff2a8, toneMapped: false }),
    flame: new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
    hidden: new THREE.MeshBasicMaterial({ visible: false }),
  };
  if (F80) {
    // film80: worn joints instead of showroom gloss, foam Walkman headphones
    Object.assign(shared.dark, { roughness: 0.52, clearcoat: 0.08, metalness: 0.75 });
    shared.dark.color.set(0x2f3136);
    shared.chrome.roughness = 0.26;
    shared.gold.roughness = 0.3;
    shared.foam = new THREE.MeshStandardMaterial({ color: 0xe8701a, roughness: 1 });
    shared.walkman = phys({ color: 0x2b4f86, metalness: 0.55, roughness: 0.38, clearcoat: 0.3 });
  }
  return shared;
}

/** Fabric material (sheen + alpha-tested cutouts) for an atlas. */
export function fabricMat(tex, sheenColor, key, fill = 0) {
  // `fill`: a little of the fabric's own colour as emission, so a brand kit keeps its hue under coloured light
  return cached(`fab|${key}|${fill}`, () => new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.84, metalness: 0, sheen: fill ? 0.45 : 1, sheenRoughness: 0.42, sheenColor: new THREE.Color(sheenColor).lerp(new THREE.Color(0xffffff), 0.45), alphaTest: 0.5, ...(fill > 0 ? { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: fill } : fill < 0 ? { color: 0xe9e6df } : {}) }));
}

export function shoeMat(tex, key, fill = 0) {
  return cached(`shoem|${key}|${fill}`, () => new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5, ...(fill > 0 ? { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: fill } : fill < 0 ? { color: 0xe9e6df } : {}) }));
}

/** Per-robot painted chassis (heat tint changes its colour). */
export function paintMat(color, brand = false) {
  const tex = paintAtlas();
  // a brand chassis is cleaner paint: less mirror, so cream, silver, white and black stay themselves under the warm set lights
  if (F80 && brand) return new THREE.MeshPhysicalMaterial({ color, map: tex, bumpMap: tex, bumpScale: 2.0, roughness: 0.56, metalness: 0.22, clearcoat: 0.3, clearcoatRoughness: 0.45 });
  // film80: brushed, painted sheet metal that has been knocked about; no toy-shop clearcoat
  if (F80) return new THREE.MeshPhysicalMaterial({ color, map: tex, bumpMap: tex, bumpScale: 2.4, roughness: 0.5, metalness: 0.55, clearcoat: 0.22, clearcoatRoughness: 0.5 });
  return new THREE.MeshPhysicalMaterial({ color, map: tex, bumpMap: tex, bumpScale: 1.6, roughness: 0.3, metalness: 0.28, clearcoat: 1, clearcoatRoughness: 0.09 });
}

export { css, shade, lum };
