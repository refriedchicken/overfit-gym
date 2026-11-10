// Shared palette, cached materials, unit geometries and procedural canvas
// textures for the gym. Everything is generated here: no image files, no fonts
// beyond the system stack.
import * as THREE from 'three';
import { LOOK } from '../look.js';

/** True for the alternate "1980s gym on 35mm film" art direction. Every film80 branch in the scene is gated on this. */
export const F80 = LOOK === 'film80';

export const PALETTE = {
  room: 0xdfe9f1, // sky haze behind the diorama
  floor: 0xd9bc90,
  floorLine: 0x2b3442,
  wall: 0xf3eee5,
  wallLow: 0xe6dccb,
  wallTrim: 0xffffff,
  ink: 0x1f2a3a, // painted lettering
  charcoal: 0x1b1d22,
  graphite: 0x2b2f37,
  steel: 0xc3c9d3,
  chrome: 0xe6eaf0,
  rubber: 0x2f3742,
  plate: 0x1b1c20,
  plateRim: 0xff5a36,
  pass: 0x3fd47a,
  fail: 0xff4d4d,
  skip: 0x9aa0aa,
  stall: 0xffb238,
  wobble: 0xc17cff,
  gold: 0xf4c430,
  wood: 0x9a6a3f,
  amber: 0xffb238,
  lime: 0xb8f25c,
  coral: 0xff6b5a,
  violet: 0x9b6bff,
  cyan: 0x3fd0c0,
  sky: 0x8fc3ea,
  leaf: 0x3f8f4e,
  zone: { test: 0x2f80ed, prod: 0x8a8f86, lounge: 0xff8a5c, locker: 0x9aa7b4 },
  mat: { sets: 0x3a2f5b, tread: 0x1f4d4a, flaky: 0x5b2d3a, rack: 0x2f3f5f, machine: 0x4a3a22, lobby: 0x2b2b2b },
};

// film80: burgundy / teal / mustard colour blocking, chrome and black vinyl, nothing candy-bright
if (F80)
  Object.assign(PALETTE, {
    wall: 0xd8c8a6,
    wallLow: 0x5a3a22,
    wallTrim: 0x4a2e1a,
    ink: 0x5a1a22,
    steel: 0xb4b6b8,
    chrome: 0xdcdfe2,
    rubber: 0x1c1c1e,
    plateRim: 0xb5332a,
    gold: 0xd9a531,
    wood: 0x6b4426,
    amber: 0xd9952a,
    lime: 0xa9b84a,
    coral: 0xc2473d,
    violet: 0x6e4a8a,
    cyan: 0x2f8f8a,
    leaf: 0x3a6b3c,
    zone: { test: 0x1f7a78, prod: 0x77786c, lounge: 0xc98a2b, locker: 0x8a7a66 },
  });

export const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

// Load the self-hosted faces before any canvas texture is drawn (top-level await:
// importers, including capture mode, only run once the fonts are in), so signs never
// render in a fallback font and the first capture frame matches every later one.
const FONT_FILES = [
  ['Barlow Condensed', 'BarlowCondensed-Bold.woff2', '700'],
  ['Barlow Condensed', 'BarlowCondensed-ExtraBold.woff2', '800'],
  ['JetBrains Mono', 'JetBrainsMono-Variable.woff2', '100 800'],
];
async function loadFonts() {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  const load = Promise.all(
    FONT_FILES.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(${new URL(`../fonts/${file}`, import.meta.url)})`, { weight });
      await face.load();
      document.fonts.add(face);
    }),
  );
  // also pull in every weight the HUD declares in CSS, so no text anywhere swaps fonts after the first frame
  const css = Promise.all([...['500', '700', '800', '900'].map((w) => document.fonts.load(`${w} 16px "Barlow Condensed"`)), document.fonts.load('400 16px "JetBrains Mono"'), document.fonts.load('700 16px "JetBrains Mono"')]);
  const all = Promise.all([load, css]).then(() => document.fonts.ready);
  // capture waits as long as it takes (identical frames matter more than start-up time); live gives up after 4 s
  const capture = typeof location !== 'undefined' && new URLSearchParams(location.search).get('capture') === '1';
  await (capture ? all : Promise.race([all, new Promise((r) => setTimeout(r, 4000))]));
}
await loadFonts().catch(() => {});

const hex = (c) => `#${new THREE.Color(c).getHexString()}`;
export const css = hex;

// ---------- materials ----------

const cache = new Map();
const _hsl = { h: 0, s: 0, l: 0 };
/**
 * film80 "more real" pass over a toy colour: less saturated, whites pulled down to a
 * warm off-white, plastics rougher, metals a little worn. Returns [Color, roughness].
 */
export function realColor(color, rough = 0.7, metal = 0.05) {
  const c = new THREE.Color(color);
  c.getHSL(_hsl);
  const l = _hsl.l < 0.5 ? _hsl.l * 0.92 : 0.46 + (_hsl.l - 0.5) * 0.62;
  c.setHSL(_hsl.h, _hsl.s * (metal > 0.6 ? 0.8 : 0.62), l);
  c.r *= 1.0;
  c.g *= 0.965;
  c.b *= 0.9;
  return [c, metal > 0.6 ? Math.min(1, rough + 0.1) : Math.min(1, rough * 0.75 + 0.27)];
}
/** Cached MeshStandardMaterial. Same args return the same instance (cheap to share). `raw` skips the film80 colour pass. */
export function mat(color, { rough = 0.7, metal = 0.05, emissive = 0x000000, ei = 1, map = null, env = 1, raw = false } = {}) {
  const key = `${color}-${rough}-${metal}-${emissive}-${ei}-${map?.uuid ?? ''}-${env}${raw ? '-raw' : ''}`;
  let m = cache.get(key);
  if (!m && F80 && !raw) {
    const [c, r] = realColor(color, rough, metal);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: metal, emissive, emissiveIntensity: ei * 0.8, map, envMapIntensity: env });
    cache.set(key, m);
  }
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei, map, envMapIntensity: env });
    cache.set(key, m);
  }
  return m;
}

/** Cached unlit material (screens, neon, labels). */
export function glow(color, { opacity = 1, map = null, additive = false } = {}) {
  const key = `g-${color}-${opacity}-${map?.uuid ?? ''}-${additive}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, map, transparent: opacity < 1 || !!map || additive, opacity, toneMapped: false, depthWrite: !additive && opacity >= 1, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    cache.set(key, m);
  }
  return m;
}

const boosted = [];
/**
 * Push an unlit material's colour above 1 so bloom picks it up (screens, neon,
 * LED strips). setBoost(false) restores plain colours for the low tier, which
 * has no tone mapping to bring HDR colours back into range.
 */
export function boost(material, k) {
  boosted.push([material, material.color.clone(), k]);
  material.color.multiplyScalar(k);
  return material;
}
export function setBoost(on) {
  for (const [m, base, k] of boosted) m.color.copy(base).multiplyScalar(on ? k : 1);
}

export function mesh(geo, material, { cast = true, receive = false } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ---------- unit geometries (shared; scale meshes instead of new geometry) ----------

export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new THREE.CylinderGeometry(0.32, 0.5, 1, 16),
  sphere: new THREE.SphereGeometry(0.5, 18, 12),
  sphereLo: new THREE.SphereGeometry(0.5, 8, 6),
  plane: new THREE.PlaneGeometry(1, 1),
  disc: new THREE.CircleGeometry(0.5, 28),
  torus: new THREE.TorusGeometry(0.5, 0.08, 8, 28),
  ring: new THREE.RingGeometry(0.42, 0.5, 40),
};

/**
 * Add a scaled, positioned mesh of a unit geometry to `parent`.
 * part(parent, GEO.box, material, [sx,sy,sz], [x,y,z], {rot:[x,y,z], cast, receive})
 */
export function part(parent, geo, material, s, p, { rot = null, cast = true, receive = false } = {}) {
  const m = mesh(geo, material, { cast, receive });
  if (Array.isArray(s)) m.scale.set(s[0], s[1], s[2]);
  else m.scale.setScalar(s);
  if (p) m.position.set(p[0], p[1], p[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

const rcache = new Map();
/** Rounded box geometry (cached by dimensions). Normals point away from the inner box. */
export function rbox(w, h, d, r = 0.04, seg = 3) {
  const key = `${w}|${h}|${d}|${r}|${seg}`;
  let g = rcache.get(key);
  if (g) return g;
  const n = seg * 2 + 1;
  g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  const rr = Math.min(r, half[0], half[1], half[2]);
  const v = [0, 0, 0];
  const inner = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    for (let a = 0; a < 3; a++) {
      const k = Math.round((pos.getComponent(i, a) + 0.5) * n);
      v[a] = k <= seg ? -half[a] + rr * (k / seg) : half[a] - rr + rr * ((k - seg - 1) / seg);
      inner[a] = Math.max(-half[a] + rr, Math.min(half[a] - rr, v[a]));
    }
    let dx = v[0] - inner[0];
    let dy = v[1] - inner[1];
    let dz = v[2] - inner[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L;
    dy /= L;
    dz /= L;
    pos.setXYZ(i, inner[0] + dx * rr, inner[1] + dy * rr, inner[2] + dz * rr);
    nor.setXYZ(i, dx, dy, dz);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  rcache.set(key, g);
  return g;
}

// ---------- canvas textures ----------

/** A canvas texture with a `redraw(fn)` hook: fn(ctx, w, h). */
export function canvasTexture(width, height, draw, { repeat = null, srgb = true, aniso = 4 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  const ctx = c.getContext('2d');
  tex.userData.redraw = (fn) => {
    ctx.clearRect(0, 0, width, height);
    fn(ctx, width, height);
    tex.needsUpdate = true;
  };
  if (draw) tex.userData.redraw(draw);
  return tex;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Legacy helper kept for compatibility: centred text lines on a solid card. */
export function textTexture(lines, { width = 512, height = 128, bg = '#111318', fg = '#f2e9d8', accent = '#ffb238', font = FONT } = {}) {
  const draw = (ls) => (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, width, height);
    g.fillStyle = accent;
    g.fillRect(0, height - 8, width, 8);
    const n = ls.length;
    ls.forEach((line, i) => {
      const big = i === 0;
      const size = big ? Math.floor(height / (n > 1 ? 2.4 : 1.6)) : Math.floor(height / (n * 1.9));
      g.font = `${big ? '800 ' : '600 '}${size}px ${font}`;
      g.fillStyle = big ? fg : accent;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const y = n === 1 ? height / 2 : big ? height * 0.36 : height * (0.36 + (i * 0.5) / (n - 0.5));
      g.fillText(line, width / 2, y, width - 24);
    });
  };
  const tex = canvasTexture(width, height, draw(lines));
  const redraw = tex.userData.redraw;
  tex.userData.redraw = (ls) => redraw(draw(ls));
  return tex;
}

/** Floor decal: station pun name in a painted stencil box. */
export function decalTexture(text, sub, color) {
  const w = 1024;
  const h = sub ? 300 : 220;
  return canvasTexture(w, h, (g) => {
    const c = hex(color);
    g.strokeStyle = c;
    g.lineWidth = 12;
    roundRect(g, 10, 10, w - 20, h - 20, 26);
    g.fillStyle = 'rgba(27,35,50,0.86)';
    g.fill();
    g.stroke();
    g.fillStyle = '#f4ecdc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${sub ? 132 : 140}px ${FONT}`;
    g.fillText(text, w / 2, sub ? 112 : h / 2 + 4, w - 70);
    if (sub) {
      g.fillStyle = c;
      g.font = `600 64px ${MONO}`;
      g.fillText(sub, w / 2, 228, w - 80);
    }
  });
}

/** Big painted zone name on the floor (no box). */
export function zoneTexture(text, color) {
  return canvasTexture(2048, 256, (g, w, h) => {
    g.fillStyle = hex(color);
    g.globalAlpha = 0.9;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 200px ${FONT}`;
    // letter-spaced stencil
    const chars = text.split('');
    const spacing = 18;
    const widths = chars.map((ch) => g.measureText(ch).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0) - spacing;
    const scale = Math.min(1, (w - 40) / total);
    g.save();
    g.translate(w / 2 - (total * scale) / 2, h / 2);
    g.scale(scale, 1);
    let x = 0;
    g.textAlign = 'left';
    chars.forEach((ch, i) => {
      g.fillText(ch, x, 8);
      x += widths[i];
    });
    g.restore();
  });
}

/**
 * Two same-sized canvases drawn in one pass (colour + bump), so grooves and
 * grain line up exactly. draw(g, b, w, h, rnd): b is the height map (grey = flat).
 */
export function canvasPair(width, height, seed, draw, { repeat = [1, 1], aniso = 8 } = {}) {
  const color = document.createElement('canvas');
  const bump = document.createElement('canvas');
  color.width = bump.width = width;
  color.height = bump.height = height;
  const g = color.getContext('2d');
  const b = bump.getContext('2d');
  b.fillStyle = '#808080';
  b.fillRect(0, 0, width, height);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  draw(g, b, width, height, rnd);
  const mk = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = aniso;
    return t;
  };
  const map = mk(color, true);
  map.userData.bump = mk(bump, false);
  return map;
}

let floorTex = null;
/**
 * Light oak plank floor: 2048 px = 4 m, planks 0.18 m wide with staggered butt
 * joints, per-plank tone, grain, knots and bevelled seams. userData.bump holds the
 * matching height map.
 */
export function floorTexture() {
  if (floorTex) return floorTex;
  floorTex = canvasPair(2048, 2048, 1337, (g, b, w, h, rnd) => {
    const rows = 22;
    const ph = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * ph;
      let x = -rnd() * 700;
      while (x < w) {
        const len = 520 + rnd() * 820;
        const tone = rnd();
        const warm = rnd() * 10;
        const R = 222 + tone * 22 + warm;
        const G = 192 + tone * 22 + warm * 0.3;
        const B = 152 + tone * 22 - warm * 0.5;
        const grd = g.createLinearGradient(x, y, x + len, y);
        grd.addColorStop(0, `rgb(${R | 0},${G | 0},${B | 0})`);
        grd.addColorStop(0.5, `rgb(${(R + 6) | 0},${(G + 5) | 0},${(B + 3) | 0})`);
        grd.addColorStop(1, `rgb(${(R - 5) | 0},${(G - 5) | 0},${(B - 4) | 0})`);
        g.fillStyle = grd;
        g.fillRect(x, y, len, ph);
        // grain: long, slightly wavy strokes; cathedral arcs on some planks
        for (let k = 0; k < 16; k++) {
          const a = 0.04 + rnd() * 0.09;
          g.strokeStyle = `rgba(140,92,48,${a})`;
          g.lineWidth = 0.8 + rnd() * 2.2;
          g.beginPath();
          const yy = y + 5 + rnd() * (ph - 10);
          g.moveTo(x, yy);
          g.bezierCurveTo(x + len * 0.3, yy + rnd() * 8 - 4, x + len * 0.7, yy + rnd() * 8 - 4, x + len, yy + rnd() * 4 - 2);
          g.stroke();
          b.strokeStyle = `rgba(110,110,110,${a * 2})`;
          b.lineWidth = g.lineWidth;
          b.stroke();
        }
        if (rnd() < 0.45) {
          const cx = x + len * (0.25 + rnd() * 0.5);
          for (let k = 0; k < 5; k++) {
            g.strokeStyle = `rgba(150,98,52,${0.08 + k * 0.012})`;
            g.lineWidth = 1.4;
            g.beginPath();
            g.ellipse(cx, y + ph * 0.5, 60 + k * 26, ph * (0.18 + k * 0.06), 0, Math.PI * 0.65, Math.PI * 1.35);
            g.stroke();
          }
        }
        if (rnd() < 0.18) {
          const kx = x + rnd() * len;
          const ky = y + ph * (0.3 + rnd() * 0.4);
          const kg = g.createRadialGradient(kx, ky, 0, kx, ky, 12);
          kg.addColorStop(0, 'rgba(96,60,30,0.55)');
          kg.addColorStop(1, 'rgba(96,60,30,0)');
          g.fillStyle = kg;
          g.beginPath();
          g.ellipse(kx, ky, 16, 7, 0, 0, Math.PI * 2);
          g.fill();
        }
        // butt joint: dark seam with a bevel highlight
        g.fillStyle = 'rgba(92,60,32,0.55)';
        g.fillRect(x, y, 3, ph);
        g.fillStyle = 'rgba(255,240,215,0.22)';
        g.fillRect(x + 3, y, 2, ph);
        b.fillStyle = '#1a1a1a';
        b.fillRect(x - 1, y, 4, ph);
        b.fillStyle = '#5a5a5a';
        b.fillRect(x + 3, y, 3, ph);
        x += len;
      }
      g.fillStyle = 'rgba(92,60,32,0.5)';
      g.fillRect(0, y, w, 3);
      g.fillStyle = 'rgba(255,244,222,0.24)';
      g.fillRect(0, y + 3, w, 2);
      b.fillStyle = '#1a1a1a';
      b.fillRect(0, y - 1, w, 4);
      b.fillStyle = '#5a5a5a';
      b.fillRect(0, y + 3, w, 3);
    }
    if (F80) {
      // decades of sneakers: an amber varnish gone dark, dull traffic patches, black scuffs
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = '#c98f55';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) {
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        grd.addColorStop(0, 'rgba(120,96,72,0.5)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.save();
        g.translate(rnd() * w, rnd() * h);
        g.rotate(rnd() * 3);
        g.scale(60 + rnd() * 200, 30 + rnd() * 90);
        g.fillStyle = grd;
        g.fillRect(-1, -1, 2, 2);
        g.restore();
      }
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = `rgba(20,14,10,${0.12 + rnd() * 0.25})`;
        g.lineWidth = 1 + rnd() * 3;
        const x = rnd() * w;
        const y = rnd() * h;
        const a = rnd() * 6.3;
        const len = 20 + rnd() * 90;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + rnd() * 10, y + Math.sin(a) * len * 0.5 + rnd() * 10, x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = `rgba(255,236,200,${0.05 + rnd() * 0.08})`;
        g.lineWidth = 6 + rnd() * 16;
        g.beginPath();
        const x = rnd() * w;
        const y = rnd() * h;
        g.moveTo(x, y);
        g.lineTo(x + 100 + rnd() * 300, y + rnd() * 60 - 30);
        g.stroke();
      }
    }
  });
  return floorTex;
}

let rubberTex = null;
/** Slate rubber gym tiles (1 m) with coloured EPDM fleck and bevelled seams. 512 px = 2 m. */
export function rubberTexture() {
  if (rubberTex) return rubberTex;
  rubberTex = canvasPair(512, 512, 99, (g, b, w, h, rnd) => {
    g.fillStyle = '#353d49';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 60 + Math.floor(rnd() * 70);
      const x = rnd() * w;
      const y = rnd() * h;
      const s = 1 + rnd() * 1.6;
      g.fillStyle = `rgba(${v},${v + 6},${v + 16},${0.25 + rnd() * 0.45})`;
      g.fillRect(x, y, s, s);
    }
    const flecks = ['#4f8fe0', '#8fb8f0', '#d7dee8', '#3fb3a0'];
    for (let i = 0; i < 700; i++) {
      g.fillStyle = flecks[i % flecks.length];
      g.globalAlpha = 0.35 + rnd() * 0.4;
      g.fillRect(rnd() * w, rnd() * h, 1.5 + rnd() * 1.5, 1.5 + rnd() * 1.5);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 3000; i++) {
      const v = 100 + rnd() * 80;
      b.fillStyle = `rgb(${v},${v},${v})`;
      b.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    // tiles differ slightly in tone
    g.fillStyle = 'rgba(255,255,255,0.035)';
    g.fillRect(0, 0, w / 2, h / 2);
    g.fillRect(w / 2, h / 2, w / 2, h / 2);
    for (const p of [0, w / 2]) {
      g.fillStyle = '#1e232b';
      g.fillRect(p, 0, 3, h);
      g.fillRect(0, p, w, 3);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(p + 3, 0, 1, h);
      g.fillRect(0, p + 3, w, 1);
      b.fillStyle = '#202020';
      b.fillRect(p - 1, 0, 5, h);
      b.fillRect(0, p - 1, w, 5);
    }
  });
  return rubberTex;
}

let concreteTex = null;
/** Tired grey concrete with stains, cracks and grime: the production corner. */
export function concreteTexture() {
  if (concreteTex) return concreteTex;
  concreteTex = canvasPair(512, 512, 5, (g, b, w, h, rnd) => {
    g.fillStyle = '#86847c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      const v = 70 + Math.floor(rnd() * 70);
      grd.addColorStop(0, `rgba(${v},${v - 4},${v - 12},0.4)`);
      grd.addColorStop(1, `rgba(${v},${v - 4},${v - 12},0)`);
      g.save();
      g.translate(rnd() * w, rnd() * h);
      g.scale(14 + rnd() * 70, 10 + rnd() * 50);
      g.fillStyle = grd;
      g.fillRect(-1, -1, 2, 2);
      g.restore();
    }
    for (let i = 0; i < 5000; i++) {
      const v = 90 + Math.floor(rnd() * 90);
      g.fillStyle = `rgba(${v},${v},${v - 8},0.3)`;
      const x = rnd() * w;
      const y = rnd() * h;
      g.fillRect(x, y, 1.5, 1.5);
      b.fillStyle = `rgb(${v},${v},${v})`;
      b.fillRect(x, y, 1.5, 1.5);
    }
    // a coffee ring and a crack
    g.strokeStyle = 'rgba(70,52,34,0.35)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(330, 140, 26, 0, Math.PI * 1.7);
    g.stroke();
    for (const ctx of [g, b]) {
      ctx.strokeStyle = ctx === g ? 'rgba(48,46,42,0.6)' : '#202020';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(30, 470);
      ctx.lineTo(120, 380);
      ctx.lineTo(150, 392);
      ctx.lineTo(260, 260);
      ctx.lineTo(300, 250);
      ctx.stroke();
    }
  });
  return concreteTex;
}

let slatTex = null;
/** Vertical oak slat panelling for the wainscot band: 512 px = 1.6 m wide. */
export function slatTexture() {
  if (slatTex) return slatTex;
  slatTex = canvasPair(512, 256, 77, (g, b, w, h, rnd) => {
    const n = 16;
    const sw = w / n;
    for (let i = 0; i < n; i++) {
      const tone = rnd();
      g.fillStyle = `rgb(${(206 + tone * 22) | 0},${(164 + tone * 20) | 0},${(112 + tone * 18) | 0})`;
      g.fillRect(i * sw, 0, sw, h);
      for (let k = 0; k < 5; k++) {
        g.strokeStyle = `rgba(130,84,40,${0.06 + rnd() * 0.08})`;
        g.lineWidth = 1 + rnd();
        const xx = i * sw + 3 + rnd() * (sw - 6);
        g.beginPath();
        g.moveTo(xx, 0);
        g.bezierCurveTo(xx + rnd() * 3 - 1.5, h * 0.3, xx + rnd() * 3 - 1.5, h * 0.7, xx, h);
        g.stroke();
      }
      g.fillStyle = 'rgba(60,38,18,0.75)';
      g.fillRect(i * sw + sw - 6, 0, 6, h);
      g.fillStyle = 'rgba(255,240,215,0.25)';
      g.fillRect(i * sw, 0, 2, h);
      b.fillStyle = '#ffffff';
      b.fillRect(i * sw, 0, sw - 6, h);
      b.fillStyle = '#000000';
      b.fillRect(i * sw + sw - 6, 0, 6, h);
    }
  });
  return slatTex;
}

let brushedTex = null;
/** Brushed-metal roughness streaks (use as roughnessMap; greyscale). */
export function brushedTexture() {
  if (brushedTex) return brushedTex;
  brushedTex = canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = 'rgb(90,90,90)';
      g.fillRect(0, 0, w, h);
      let s = 31;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 900; i++) {
        const v = 60 + Math.floor(rnd() * 90);
        g.fillStyle = `rgba(${v},${v},${v},0.5)`;
        g.fillRect(0, rnd() * h, w, 0.6 + rnd() * 1.2);
      }
    },
    { repeat: [2, 2], srgb: false },
  );
  return brushedTex;
}

let grassTex = null;
/** Mown lawn with soft stripes and clover speckle: 512 px = 8 m. */
export function grassTexture() {
  if (grassTex) return grassTex;
  grassTex = canvasTexture(
    512,
    512,
    (g, w, h) => {
      let s = 2024;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      g.fillStyle = '#76995c';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,220,0.07)';
      for (let i = 0; i < 4; i++) g.fillRect(i * 128, 0, 64, h);
      for (let i = 0; i < 12000; i++) {
        const t = rnd();
        g.fillStyle = t < 0.5 ? `rgba(66,${(110 + rnd() * 40) | 0},54,0.35)` : `rgba(${(150 + rnd() * 40) | 0},${(180 + rnd() * 30) | 0},120,0.3)`;
        g.fillRect(rnd() * w, rnd() * h, 1.5, 2.5);
      }
      for (let i = 0; i < 40; i++) {
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        const dark = rnd() < 0.5;
        grd.addColorStop(0, dark ? 'rgba(70,115,50,0.3)' : 'rgba(170,200,110,0.22)');
        grd.addColorStop(1, dark ? 'rgba(70,115,50,0)' : 'rgba(170,200,110,0)');
        g.save();
        g.translate(rnd() * w, rnd() * h);
        g.scale(20 + rnd() * 50, 20 + rnd() * 50);
        g.fillStyle = grd;
        g.fillRect(-1, -1, 2, 2);
        g.restore();
      }
    },
    { repeat: [1, 1], aniso: 8 },
  );
  return grassTex;
}

let glassTex = null;
/** Faint diagonal reflection streaks for window glass (use as alphaMap-ish map on a white glass). */
export function glassTexture() {
  if (glassTex) return glassTex;
  glassTex = canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(-0.7);
      for (const [x, ww, a] of [
        [-90, 26, 0.55],
        [-50, 8, 0.4],
        [30, 40, 0.35],
        [90, 10, 0.3],
      ]) {
        const grd = g.createLinearGradient(x, 0, x + ww, 0);
        grd.addColorStop(0, 'rgba(255,255,255,0)');
        grd.addColorStop(0.5, `rgba(255,255,255,${a})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x, -h, ww, h * 2);
      }
      g.restore();
    },
    { srgb: false },
  );
  return glassTex;
}

/**
 * Neon tube lettering on transparent: crisp core plus a soft halo. Pair with an
 * additive or premultiplied material whose colour is > 1 so bloom catches it.
 */
export function neonTexture(lines, { width = 1024, height = 256, color = '#59b8ff', font = FONT, sub = null } = {}) {
  const tint = (hexc) => {
    const c = new THREE.Color(hexc).lerp(new THREE.Color(0xffffff), 0.55);
    return `#${c.getHexString()}`;
  };
  return canvasTexture(width, height, (g) => {
    const n = lines.length;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const big = i === 0;
      const size = big ? Math.floor(height * (n > 1 ? 0.5 : 0.7)) : Math.floor(height * 0.26);
      const y = n === 1 ? height / 2 + 4 : big ? height * 0.38 : height * 0.8;
      const col = !big && sub ? sub : color;
      g.font = `${big ? '800 ' : '700 '}${size}px ${big ? font : MONO}`;
      // halo, then the tube: saturated rim, pale hot core
      g.shadowColor = col;
      g.shadowBlur = size * 0.3;
      g.fillStyle = col;
      g.fillText(line, width / 2, y, width - 60);
      g.shadowBlur = size * 0.08;
      g.fillText(line, width / 2, y, width - 60);
      g.shadowBlur = 0;
      g.fillStyle = tint(col);
      g.save();
      g.translate(width / 2, y);
      g.scale(0.985, 0.94);
      g.fillText(line, 0, 0, width - 60);
      g.restore();
    });
  });
}

let woodTex = null;
export function woodTexture() {
  if (woodTex) return woodTex;
  woodTex = canvasTexture(
    256,
    256,
    (g, w, h) => {
      const planks = 6;
      let s = 42;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < planks; i++) {
        const y = (i * h) / planks;
        const base = 120 + Math.floor(rnd() * 30);
        g.fillStyle = `rgb(${base + 40},${base - 5},${base - 50})`;
        g.fillRect(0, y, w, h / planks);
        for (let k = 0; k < 18; k++) {
          g.strokeStyle = `rgba(70,40,20,${0.08 + rnd() * 0.12})`;
          g.lineWidth = 1 + rnd() * 2;
          g.beginPath();
          const yy = y + rnd() * (h / planks);
          g.moveTo(0, yy);
          g.bezierCurveTo(w * 0.3, yy + rnd() * 6 - 3, w * 0.6, yy + rnd() * 6 - 3, w, yy);
          g.stroke();
        }
        g.fillStyle = 'rgba(30,18,10,0.7)';
        g.fillRect(0, y, w, 2);
        g.fillRect(Math.floor(rnd() * w), y, 2, h / planks);
      }
    },
    { repeat: [1, 1] },
  );
  return woodTex;
}

let wallTex = null;
/** Warm white plaster with a faint trowel texture. */
export function wallTexture() {
  if (wallTex) return wallTex;
  wallTex = canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#f4efe6';
      g.fillRect(0, 0, w, h);
      let s = 7;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(${200 + rnd() * 40},${190 + rnd() * 40},${170 + rnd() * 40},0.07)`;
        g.beginPath();
        g.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 26, 3 + rnd() * 10, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
    },
    { repeat: [8, 2] },
  );
  return wallTex;
}

/** Vertical sky gradient for scene.background. */
export function skyTexture() {
  const t = canvasTexture(16, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#a9d1f0');
    grd.addColorStop(0.55, '#d9e9f3');
    grd.addColorStop(1, '#f3efe6');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  return t;
}

/** What you see through the windows: sky, soft clouds, a tree line and lawn. */
export function backdropTexture(seed = 3) {
  return canvasTexture(1024, 512, (g, w, h) => {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#6fb1e6');
    grd.addColorStop(0.5, '#b9dcf3');
    grd.addColorStop(0.64, '#e6f1f6');
    grd.addColorStop(0.66, '#9bc48a');
    grd.addColorStop(1, '#86b56f');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // clouds
    for (let i = 0; i < 9; i++) {
      const cx = rnd() * w;
      const cy = 40 + rnd() * 180;
      for (let k = 0; k < 6; k++) {
        const r = 18 + rnd() * 30;
        const c = g.createRadialGradient(cx + k * 22 - 50, cy + rnd() * 10, 0, cx + k * 22 - 50, cy, r);
        c.addColorStop(0, 'rgba(255,255,255,0.85)');
        c.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = c;
        g.fillRect(cx + k * 22 - 50 - r, cy - r, r * 2, r * 2);
      }
    }
    // tree line
    const hz = h * 0.66;
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w;
      const r = 20 + rnd() * 34;
      const tone = rnd();
      g.fillStyle = `rgb(${(60 + tone * 40) | 0},${(120 + tone * 40) | 0},${(70 + tone * 30) | 0})`;
      g.beginPath();
      g.arc(x, hz - r * 0.55, r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#8fbd76';
    g.fillRect(0, hz, w, h - hz);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 12; i++) g.fillRect(0, hz + 10 + i * 14, w, 5);
  });
}

/**
 * Painted wall lettering (vinyl style) on transparent: one or two lines.
 * colors: [main, sub].
 */
export function signTexture(lines, { width = 1024, height = 256, colors = ['#1f2a3a', '#2f80ed'], font = FONT, align = 'center', bg = null } = {}) {
  return canvasTexture(width, height, (g) => {
    if (bg) {
      g.fillStyle = bg;
      roundRect(g, 6, 6, width - 12, height - 12, 18);
      g.fill();
    }
    const n = lines.length;
    g.textAlign = align;
    g.textBaseline = 'middle';
    const x = align === 'center' ? width / 2 : align === 'left' ? 28 : width - 28;
    lines.forEach((line, i) => {
      const big = i === 0;
      const size = big ? Math.floor(height * (n > 1 ? 0.52 : 0.72)) : Math.floor(height * 0.24);
      g.font = `${big ? '800 ' : '700 '}${size}px ${big ? font : MONO}`;
      g.fillStyle = colors[i] ?? colors[colors.length - 1];
      const y = n === 1 ? height / 2 + 4 : big ? height * 0.38 : height * 0.8;
      g.fillText(line, x, y, width - 56);
    });
  });
}

let blobTex = null;
/** Soft radial contact shadow. */
export function blobTexture() {
  if (blobTex) return blobTex;
  blobTex = canvasTexture(
    128,
    128,
    (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(0,0,0,0.75)');
      grd.addColorStop(0.45, 'rgba(0,0,0,0.42)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { srgb: false },
  );
  return blobTex;
}

/**
 * Procedural environment map for reflections: a bright daylit room with big
 * window panels, an oak floor and a warm sun patch.
 */
export function makeEnvironment(renderer) {
  if (F80) return makeEnvironment80(renderer);
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: 0xe9e4da, side: THREE.BackSide }));
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0xb8956a }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -5.9;
  env.add(floor);
  const panels = [
    [0xffffff, 10, 6, [0, 5.9, 0], [Math.PI / 2, 0, 0], 1.6], // skylight
    [0xbfe0ff, 20, 7, [0, 1, -14.9], [0, 0, 0], 2.4], // back windows
    [0xbfe0ff, 20, 7, [-14.9, 1, 0], [0, Math.PI / 2, 0], 2.2], // left windows
    [0xfff0d8, 8, 4, [14.9, 2, 4], [0, -Math.PI / 2, 0], 2.6], // sun side
    [0xffe6c0, 6, 6, [4, -5.85, 4], [-Math.PI / 2, 0, 0], 1.6], // sun patch on floor
    [0xff8a5c, 3, 1, [3, 0, 14.9], [0, Math.PI, 0], 1.2],
    [0x2f80ed, 3, 1, [-5, 0, 14.9], [0, Math.PI, 0], 1.2],
  ];
  for (const [c, w, h, p, r, k] of panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...p);
    m.rotation.set(...r);
    env.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.04);
  pmrem.dispose();
  return rt.texture;
}

/** film80 reflections: a dim wood-and-cinderblock room, one hot amber window wall, fluorescent strips, pink and cyan neon. */
function makeEnvironment80(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: 0x4a3c2e, side: THREE.BackSide })));
  const panels = [
    [0x8a5a34, 30, 30, [0, -5.9, 0], [-Math.PI / 2, 0, 0], 0.7], // varnished floor
    [0x2a2622, 30, 30, [0, 5.9, 0], [Math.PI / 2, 0, 0], 0.5], // dark ceiling void
    [0xffb866, 18, 5, [-14.9, 1, -4], [0, Math.PI / 2, 0], 5.5], // low sun through the left windows
    [0xffd9a0, 12, 5, [5, 1, -14.9], [0, 0, 0], 2.2], // back windows, golden sky
    [0xffc27a, 7, 5, [-6, -5.85, -3], [-Math.PI / 2, 0, 0], 2.4], // sun patch on the floor
    [0xff4f9a, 4, 0.7, [-14.8, 3, 3], [0, Math.PI / 2, 0], 4.0], // pink neon
    [0x46e6ff, 5, 0.7, [4, 3.4, -14.8], [0, 0, 0], 4.0], // cyan neon
    [0xffb060, 5, 1.2, [-2, 0.5, 14.8], [0, Math.PI, 0], 1.8], // tungsten at the juice bar
  ];
  for (let i = 0; i < 4; i++) panels.push([0xe6ffd9, 1.6, 9, [-9 + i * 6, 5.85, -2], [Math.PI / 2, 0, 0], 5.0]); // fluorescent rows
  for (const [c, w, h, p, r, k] of panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...p);
    m.rotation.set(...r);
    env.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.04);
  pmrem.dispose();
  return rt.texture;
}

// ---------- static batching ----------

/** Mark an object (and its subtree) as animated so mergeStatic leaves it alone. */
export const dyn = (o) => {
  o.userData.dyn = true;
  return o;
};

/**
 * Merge every static, visible mesh under `roots` into one mesh per
 * (material, shadow flags). Animated subtrees must be tagged with dyn().
 * Cuts the gym's equipment from ~1500 draw calls to a few hundred.
 */
export function mergeStatic(scene, roots) {
  scene.updateMatrixWorld(true);
  const buckets = new Map();
  const victims = [];
  const walk = (o) => {
    if (o.userData.dyn || !o.visible) return;
    if (o.isMesh && o.children.length === 0 && !o.userData.keep) {
      const g = o.geometry;
      if (g.attributes.position && g.attributes.normal && g.attributes.uv) {
        const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { material: o.material, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder, items: [] }));
        b.items.push(o);
        victims.push(o);
        return;
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const r of roots) walk(r);
  const n3 = new THREE.Matrix3();
  for (const b of buckets.values()) {
    if (b.items.length < 2) {
      victims.splice(victims.indexOf(b.items[0]), 1);
      continue;
    }
    let nv = 0;
    let ni = 0;
    for (const m of b.items) {
      nv += m.geometry.attributes.position.count;
      ni += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3);
    const nor = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const idx = new Uint32Array(ni);
    let vo = 0;
    let io = 0;
    const v = new THREE.Vector3();
    for (const m of b.items) {
      const g = m.geometry;
      const P = g.attributes.position;
      const N = g.attributes.normal;
      const UV = g.attributes.uv;
      n3.getNormalMatrix(m.matrixWorld);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
        pos.set([v.x, v.y, v.z], (vo + i) * 3);
        v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize();
        nor.set([v.x, v.y, v.z], (vo + i) * 3);
        uv[(vo + i) * 2] = UV.getX(i);
        uv[(vo + i) * 2 + 1] = UV.getY(i);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
      else for (let i = 0; i < P.count; i++) idx[io++] = i + vo;
      vo += P.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, b.material);
    merged.castShadow = b.cast;
    merged.receiveShadow = b.receive;
    merged.renderOrder = b.order;
    merged.matrixAutoUpdate = false;
    scene.add(merged);
  }
  for (const m of victims) m.parent?.remove(m);
}
