// The world outside the gym: a gradient sky with a sun disc, a mown lawn the
// building sits on, a paved apron along the open cutaway sides, hedges under the
// windows, layered stylised trees and rolling hills fading into haze.
// Everything is seeded; nothing here animates.
import * as THREE from 'three';
import { mat, grassTexture, canvasTexture, F80 } from './materials.js';
import { buildLot80 } from './film80-set.js';

// film80: golden hour, a smoggy amber horizon under a dusty blue zenith
export const SKY = F80 ? { zenith: 0x5a7fa6, horizon: 0xf6c98e, haze: 0xdcae80, ground: 0x8a8a54 } : { zenith: 0x6fa8dc, horizon: 0xeaf0f0, haze: 0xdfe8ea, ground: 0x8dbb6b };
/** film80 car park outside the left windows: [x0, z0, x1, z1] relative to the room's left wall. */
const LOT = [-27, -13, -2.3, 11.5];

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Sky dome: zenith-to-horizon gradient, warm glow and a soft sun disc toward `sunDir`. */
function skyDome(sunDir) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      sun: { value: sunDir.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 c = mix(horizon, zenith, pow(smoothstep(-0.02, 0.75, h), 0.7));
        float s = max(dot(d, sun), 0.0);
        c += vec3(1.0, 0.86, 0.62) * pow(s, 8.0) * ${F80 ? '0.75' : '0.28'};
        c += vec3(1.0, 0.93, 0.8) * pow(s, 90.0) * 0.6;
        c = mix(c, vec3(1.25, 1.18, 1.05), smoothstep(0.9993, 0.9997, s));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), m);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.userData.keep = true;
  dome.userData.noAO = true;
  return dome;
}

/** Round, slightly lumpy canopy (icosahedron, flat shaded) for instancing. */
function canopyGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const r = rng(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) seen.set(key, (k = 0.86 + r() * 0.24));
    v.multiplyScalar(k);
    v.y *= 0.92;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildOutside(scene, room, sunDir) {
  const { x0, x1, z0, z1 } = room;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const group = new THREE.Group();
  group.name = 'outside';
  scene.add(group);
  group.add(skyDome(sunDir));

  // lawn: one big disc, the building's foundation sits 0.35 m proud of it
  const gt = grassTexture();
  gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
  gt.repeat.set(48, 48);
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(190, 64), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95, color: F80 ? 0xb9b08c : 0xffffff }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(cx, -0.36, cz);
  lawn.receiveShadow = false; // the hidden shade wall at the production corner must not show outside
  lawn.userData.keep = true;
  group.add(lawn);

  // paved apron along the open sides and a path off toward the camera
  const paverTex = canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#c9c1b2';
      g.fillRect(0, 0, w, h);
      const r = rng(41);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const t = r() * 14;
          g.fillStyle = `rgb(${(196 + t) | 0},${(188 + t) | 0},${(174 + t) | 0})`;
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        }
      for (let i = 0; i < 1500; i++) {
        g.fillStyle = `rgba(120,110,95,${r() * 0.15})`;
        g.fillRect(r() * w, r() * h, 1.5, 1.5);
      }
    },
    { repeat: [1, 1] },
  );
  const paver = new THREE.MeshStandardMaterial({ map: paverTex, roughness: 0.9, color: F80 ? 0xa89c88 : 0xffffff });
  const apron = (w, d, x, z) => {
    const geo = new THREE.PlaneGeometry(w, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 2), uv.getY(i) * (d / 2));
    paverTex.wrapS = paverTex.wrapT = THREE.RepeatWrapping;
    const m = new THREE.Mesh(geo, paver);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, -0.345, z);
    m.receiveShadow = false;
    group.add(m);
  };
  apron(x1 - x0 + 4.4, 2.6, cx + 0.9, z1 + 1.65);
  apron(2.6, z1 - z0 + 1.6, x1 + 1.65, cz - 0.5);
  apron(2.2, 9, 3.5, z1 + 7.4);

  // foundation band between the floor slab and the lawn
  // film80: the band's top is coplanar with the floor boards; against dark boards the
  // depth fight shows, so it sits a little lower and is pushed back in depth
  const found = F80 ? new THREE.MeshStandardMaterial({ color: 0x7d7468, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 200 }) : mat(0xb9b2a5, { rough: 0.95 });
  const band = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, F80 ? 0.3 : 0.36, d), found);
    m.position.set(x, F80 ? -0.21 : -0.18, z);
    m.receiveShadow = true;
    group.add(m);
  };
  band(x1 - x0 + 0.6, z1 - z0 + 0.6, cx, cz);

  // ---------- trees: instanced canopies and trunks ----------
  const r = rng(907);
  const trees = [];
  const place = (x, z, s, kind = 'round') => {
    // keep the open front and the camera side clear
    if (x > x0 - 2 && z > z0 - 2) return;
    if (F80 && x > x0 + LOT[0] - 1 && x < x0 + LOT[2] + 1 && z > LOT[1] - 1 && z < LOT[3] + 1) return;
    trees.push({ x, z, s, kind, tone: r() });
  };
  // a near row behind the back windows and outside the left windows
  for (let x = x0 - 1; x < x1 + 6; x += 3.2 + r() * 2.2) place(x + r(), z0 - 5 - r() * 3, 1.0 + r() * 0.55, r() < 0.25 ? 'cone' : 'round');
  for (let z = z0 - 1; z < z1 + 8; z += 3.4 + r() * 2.4) place(x0 - 5 - r() * 3, z + r(), 1.0 + r() * 0.55, r() < 0.3 ? 'cone' : 'round');
  // middle and far bands
  for (let i = 0; i < 70; i++) {
    const a = -Math.PI * 0.05 + r() * Math.PI * 1.1; // from the -x side round to the back
    const d = 22 + r() * 40;
    place(cx - Math.cos(a) * d * 1.1, cz - Math.sin(a) * d, 1.2 + r() * 1.0, r() < 0.3 ? 'cone' : 'round');
  }
  // a few far trees on the camera side, off to the flanks, for depth when orbiting
  for (let i = 0; i < 26; i++) {
    const a = Math.PI * 1.1 + r() * Math.PI * 0.8;
    const d = 45 + r() * 40;
    trees.push({ x: cx - Math.cos(a) * d, z: cz - Math.sin(a) * d, s: 1.4 + r() * 1.0, kind: r() < 0.3 ? 'cone' : 'round', tone: r() });
  }

  const greens = [0x5c9a4a, 0x6eaa52, 0x4f8a45, 0x7cb35a, 0x5a8f3e];
  const roundGeo = canopyGeometry(11);
  const coneGeo = new THREE.ConeGeometry(0.75, 2.2, 7, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 1, 6);
  const leafM = new THREE.MeshStandardMaterial({ color: F80 ? 0xa9a888 : 0xffffff, roughness: 0.85, flatShading: true });
  const trunkM = mat(0x7a5a3e, { rough: 0.9 });
  const rounds = trees.filter((t) => t.kind === 'round');
  const cones = trees.filter((t) => t.kind === 'cone');
  // each round tree is two or three canopy lumps
  const lumps = [];
  for (const t of rounds) {
    const n = 2 + Math.floor(t.tone * 2);
    for (let k = 0; k < n; k++) {
      const a = k * 2.3 + t.tone * 6;
      const off = k === 0 ? 0 : 0.45 * t.s;
      lumps.push({ x: t.x + Math.cos(a) * off, y: t.s * (1.75 + (k === 0 ? 0.35 : 0)), z: t.z + Math.sin(a) * off, s: t.s * (k === 0 ? 0.95 : 0.7), tone: (t.tone + k * 0.37) % 1 });
    }
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const inst = (geo, material, list, fn, { cast = false } = {}) => {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((t, i) => {
      const { p, s, c } = fn(t);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
      if (c !== undefined) im.setColorAt(i, col.setHex(c));
    });
    im.castShadow = cast;
    im.receiveShadow = false;
    im.userData.keep = true;
    group.add(im);
    return im;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  inst(roundGeo, leafM, lumps, (t) => ({ p: V(t.x, t.y - 0.36, t.z), s: V(t.s, t.s, t.s), c: greens[Math.floor(t.tone * greens.length)] }), { cast: true });
  inst(coneGeo, leafM, cones, (t) => ({ p: V(t.x, t.s * 1.75 - 0.36, t.z), s: V(t.s, t.s * 1.1, t.s), c: [0x3f7a4a, 0x4a8a52, 0x356b40][Math.floor(t.tone * 3)] }), { cast: true });
  inst(trunkGeo, trunkM, trees, (t) => ({ p: V(t.x, t.s * 0.5 - 0.36, t.z), s: V(t.s, t.s * 1.1, t.s) }));

  // hedges under the windows (outside the back and left walls)
  const hedgeGeo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const hedgeM = new THREE.MeshStandardMaterial({ color: F80 ? 0x4f6f3e : 0x5f9a4c, roughness: 0.9 });
  const hedges = [];
  for (let x = x0 + 0.4; x < x1 - 0.4; x += 2.1) hedges.push({ x: x + 1, z: z0 - 1.25, w: 1.9, d: 0.9 });
  for (let z = z0 + 0.4; z < z1 - 0.4; z += 2.1) hedges.push({ x: x0 - 1.25, z: z + 1, w: 0.9, d: 1.9 });
  inst(hedgeGeo, hedgeM, hedges, (t) => ({ p: V(t.x, 0.05, t.z), s: V(t.w, 0.85, t.d) }));
  // round shrubs on top of the hedge boxes soften them
  const shrubs = hedges.flatMap((t, i) => [0, 1].map((k) => ({ x: t.x + (t.w > 1 ? (k - 0.5) * 0.9 : 0), z: t.z + (t.d > 1 ? (k - 0.5) * 0.9 : 0), s: 0.55 + ((i * 7 + k * 3) % 5) * 0.04 })));
  inst(roundGeo, leafM, shrubs, (t) => ({ p: V(t.x, 0.42, t.z), s: V(t.s, t.s * 0.75, t.s), c: 0x649f4f }));

  // rolling hills: wide low domes far out, fading into the haze by fog
  const hillGeo = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const hillM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: false });
  const hills = [];
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * 0.15 + (i / 15) * Math.PI * 1.3 + r() * 0.1;
    const d = 95 + r() * 55;
    hills.push({ x: cx - Math.cos(a) * d, z: cz - Math.sin(a) * d, w: 30 + r() * 30, h: 8 + r() * 12, c: [0x7fae6a, 0x8bb978, 0x749f63, 0x97bf84][i % 4] });
  }
  inst(hillGeo, hillM, hills, (t) => ({ p: V(t.x, -0.4, t.z), s: V(t.w, t.h, t.w * 0.7), c: t.c }));

  if (F80) buildLot80(group, [x0 + LOT[0], LOT[1], x0 + LOT[2], LOT[3]]);
  return group;
}
