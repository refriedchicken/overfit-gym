// Set dressing for the film80 look: practical lights (fluorescent tubes, tungsten
// pendants, neon), a mirrored wall, a CRT television showing the scoreboard, a
// boombox, a stack of VHS tapes, a payphone, a vending machine, a wall clock,
// posters, carpet, and a car park of boxy saloons outside. Only called when the
// look is active. Static props are plain meshes so world.js batches them.
import * as THREE from 'three';
import { mat, part, GEO, rbox, canvasTexture, boost, FONT, MONO } from './materials.js';
import { laminateTexture, carpetTexture, paintedSign80, neon80, poster80 } from './film80-tex.js';

export { paintedSign80, neon80 };

const PI = Math.PI;
const raw = (color, o = {}) => mat(color, { ...o, raw: true });
let K = null;
/** Shared film80 materials (built on first use). */
export function kit80() {
  if (K) return K;
  const lam = laminateTexture();
  K = {
    chrome: raw(0xd8dbde, { rough: 0.14, metal: 1 }),
    steel: raw(0x8d9094, { rough: 0.42, metal: 0.85 }),
    black: raw(0x141313, { rough: 0.6 }),
    vinyl: raw(0x18100f, { rough: 0.42 }),
    burgundy: raw(0x6a1a26, { rough: 0.5 }),
    teal: raw(0x1f6a68, { rough: 0.55 }),
    mustard: raw(0xc08e2a, { rough: 0.6 }),
    cream: raw(0xc9bd9e, { rough: 0.62 }),
    beige: raw(0xa8997a, { rough: 0.6, metal: 0.25 }),
    laminate: new THREE.MeshStandardMaterial({ map: lam, roughness: 0.42, color: 0xffffff, envMapIntensity: 0.8 }),
    tube: boost(new THREE.MeshBasicMaterial({ color: 0xcdffbe, toneMapped: false }), 1.4),
    tungsten: boost(new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false }), 1.8),
    red: boost(new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }), 2.4),
    green: boost(new THREE.MeshBasicMaterial({ color: 0x5cff7a, toneMapped: false }), 1.8),
    glass: new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0, envMapIntensity: 2.2, depthWrite: false }),
  };
  return K;
}

const keep = (m) => {
  m.userData.keep = true;
  return m;
};

// ---------- lights ----------

/**
 * Ceiling (shadow only), fluorescent strips with a faint green cast, tungsten
 * pendants over the juice bar and coloured spill from the neon.
 */
export function lights80(scene, room) {
  const { x0, x1, z0, z1, h } = room;
  const k = kit80();
  const roof = part(scene, GEO.box, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), [x1 - x0 + 3.2, 0.2, z1 - z0 + 3.2], [(x0 + x1) / 2 - 0.4, h + 0.55, (z0 + z1) / 2 - 0.4], { cast: true });
  roof.userData.keep = true;
  roof.userData.noAO = true;

  // bare-tube strip lights hung on rods from the (cut away) ceiling
  const strip = (x, y, z, ry, len = 2.4) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    part(g, GEO.box, k.cream, [len + 0.12, 0.07, 0.09], [0, 0, 0], { cast: false });
    for (const s of [-1, 1]) {
      part(g, GEO.cyl, k.tube, [0.042, len, 0.042], [0, -0.03, s * 0.085], { rot: [0, 0, PI / 2], cast: false });
      part(g, GEO.box, k.black, [0.03, 0.07, 0.24], [s * (len / 2 + 0.02), -0.02, 0], { cast: false });
      part(g, GEO.cylLo, k.black, [0.014, h - y, 0.014], [s * len * 0.36, (h - y) / 2, 0], { cast: false });
    }
    scene.add(g);
  };
  const Y = 4.5;
  const strips = [
    [-7.0, -3.3, 0],
    [-3.6, -3.3, 0],
    [-0.2, -3.3, 0],
    [-6.0, -6.3, 0],
    [-1.6, -6.3, 0],
    [-11.1, -4.25, PI / 2],
    [-11.0, 1.6, PI / 2],
    [5.6, -2.6, 0],
    [5.2, 0.3, 0],
    [5.6, -6.0, 0],
  ];
  for (const [x, z, ry] of strips) strip(x, Y, z, ry);
  const point = (color, intensity, x, y, z, dist = 12, decay = 1.7) => {
    const l = new THREE.PointLight(color, intensity, dist, decay);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  };
  // a handful of real lights stand in for the ten fixtures
  const FL = 0xdcf7c8;
  point(FL, 8, -5.3, Y - 0.3, -3.6, 13);
  point(FL, 7, -1.0, Y - 0.3, -5.0, 13);
  point(FL, 7, 5.5, Y - 0.3, -2.4, 13);
  point(FL, 4.5, -10.9, Y - 0.3, -1.2, 11);

  // tungsten pendants over the juice bar: enamel shades, a bare bulb just showing
  const bx = -1.775;
  const bz = 3.63;
  for (const dx of [-1.9, 0, 1.9]) {
    const g = new THREE.Group();
    g.position.set(bx + dx, 2.5, bz);
    part(g, GEO.cone, k.burgundy, [0.5, 0.26, 0.5], [0, 0, 0], { cast: false });
    part(g, GEO.cylLo, k.black, [0.05, 0.08, 0.05], [0, 0.16, 0], { cast: false });
    part(g, GEO.cylLo, k.black, [0.012, h - 2.7, 0.012], [0, 0.2 + (h - 2.7) / 2, 0], { cast: false });
    part(g, GEO.sphere, k.tungsten, [0.1, 0.13, 0.1], [0, -0.13, 0], { cast: false });
    part(g, GEO.disc, k.tungsten, [0.46, 0.46, 1], [0, -0.128, 0], { rot: [PI / 2, 0, 0], cast: false });
    scene.add(g);
  }
  point(0xffa04a, 3.5, bx, 2.25, bz + 0.3, 8, 1.8);
  point(0xffa04a, 2, bx + 4.6, 2.6, 5.6, 7, 1.8);
  // neon spill: hot pink off the left wall, electric cyan off the mirror wall
  point(0xff3f9a, 3.5, x0 + 1.2, 4.9, 1.35, 8, 1.8);
  point(0x3fe9ff, 3.5, 3.1, 4.6, z0 + 1.3, 8, 1.8);
  return { update() {} };
}

// ---------- props ----------

/** Wall-mounted CRT on a swivel bracket, a VCR on the shelf under it. Screen faces local +z. */
function crtTV() {
  const k = kit80();
  const g = new THREE.Group();
  // bracket: wall plate, arm, tray
  part(g, GEO.box, k.black, [0.3, 0.4, 0.03], [0, -0.1, -0.62], { cast: false });
  part(g, GEO.box, k.black, [0.06, 0.06, 0.5], [0, -0.38, -0.4]);
  part(g, GEO.box, k.black, [0.7, 0.03, 0.5], [0, -0.38, -0.02]);
  const tv = new THREE.Group();
  tv.rotation.x = 0.16;
  g.add(tv);
  part(tv, rbox(0.9, 0.7, 0.62, 0.04), k.laminate, 1, [0, 0, -0.06]);
  part(tv, rbox(0.86, 0.66, 0.04, 0.03), k.black, 1, [0, 0, 0.245], { cast: false });
  // speaker grille and controls down the right-hand side
  const side = canvasTexture(64, 256, (c, w, h) => {
    c.fillStyle = '#1a1816';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#0a0908';
    for (let y = 120; y < h - 12; y += 7) c.fillRect(10, y, w - 20, 3);
    for (const [y, r] of [
      [30, 15],
      [76, 15],
    ]) {
      c.fillStyle = '#b9b3a4';
      c.beginPath();
      c.arc(w / 2, y, r, 0, PI * 2);
      c.fill();
      c.fillStyle = '#2a2622';
      c.fillRect(w / 2 - 2, y - r, 4, r);
    }
    c.fillStyle = '#ff3a2a';
    c.fillRect(w / 2 - 4, 102, 8, 5);
  });
  part(tv, GEO.plane, new THREE.MeshStandardMaterial({ map: side, roughness: 0.6 }), [0.14, 0.58, 1], [0.34, 0, 0.268], { cast: false });
  const tex = canvasTexture(320, 240, null, { aniso: 4 });
  const screen = keep(part(tv, GEO.plane, boost(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 1.9), [0.64, 0.5, 1], [-0.07, 0, 0.268], { cast: false }));
  void screen;
  // VCR and tapes on the tray
  part(g, rbox(0.56, 0.1, 0.36, 0.012, 1), k.steel, 1, [0, -0.5, 0.0]);
  part(g, GEO.box, k.black, [0.3, 0.035, 0.01], [-0.08, -0.49, 0.181], { cast: false });
  part(g, GEO.box, k.green, [0.07, 0.02, 0.01], [0.19, -0.49, 0.182], { cast: false });
  part(g, GEO.box, k.black, [0.06, 0.26, 0.03], [0, -0.31, -0.02], { cast: false });
  let key = '';
  return {
    group: g,
    set({ value, testLines, prodLines }) {
      const kk = `${value}|${testLines}|${prodLines}`;
      if (kk === key) return;
      key = kk;
      tex.userData.redraw((c, w, h) => {
        c.fillStyle = '#030805';
        c.fillRect(0, 0, w, h);
        const P = '#7dffa0';
        c.shadowColor = '#39ff7a';
        c.shadowBlur = 7;
        c.fillStyle = P;
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        c.font = `700 16px ${MONO}`;
        c.fillText('OVERFIT-TV  CH 03', 18, 28);
        c.textAlign = 'right';
        c.fillText('LIVE', w - 18, 28);
        c.fillRect(18, 36, w - 36, 2);
        c.textAlign = 'center';
        c.font = `800 104px ${FONT}`;
        c.fillText(String(value), w / 2, 132, w - 40);
        c.font = `700 13px ${MONO}`;
        c.fillText('TEST LINES PER PRODUCTION LINE', w / 2, 154, w - 30);
        const n = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '--');
        const max = Math.max(1, Number.isFinite(testLines) ? testLines : 0, Number.isFinite(prodLines) ? prodLines : 0);
        const row = (y, label, v, col) => {
          c.fillStyle = col;
          c.shadowColor = col;
          c.textAlign = 'left';
          c.font = `700 14px ${MONO}`;
          c.fillText(label, 18, y);
          c.textAlign = 'right';
          c.fillText(n(v), w - 18, y);
          c.globalAlpha = 0.25;
          c.fillRect(70, y - 11, w - 150, 11);
          c.globalAlpha = 1;
          if (Number.isFinite(v)) c.fillRect(70, y - 11, Math.max(3, ((w - 150) * v) / max), 11);
        };
        row(186, 'TEST', testLines, P);
        row(212, 'PROD', prodLines, '#ffc24a');
        c.shadowBlur = 0;
        // scanlines, phosphor falloff into the corners, a soft reflection band
        c.fillStyle = 'rgba(0,0,0,0.38)';
        for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
        const vg = c.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.86);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.78)');
        c.fillStyle = vg;
        c.fillRect(0, 0, w, h);
        const gl = c.createLinearGradient(0, 0, w, h * 0.6);
        gl.addColorStop(0, 'rgba(190,255,215,0.12)');
        gl.addColorStop(0.4, 'rgba(190,255,215,0)');
        c.fillStyle = gl;
        c.fillRect(0, 0, w, h);
      });
    },
  };
}

/** A twin-cassette boombox, antenna up. Faces local +z. */
function boombox() {
  const k = kit80();
  const g = new THREE.Group();
  part(g, rbox(0.56, 0.3, 0.14, 0.025), k.steel, 1, [0, 0.15, 0]);
  const face = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = '#8f9296';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#17181a';
    c.fillRect(8, 8, w - 16, h - 16);
    for (const x of [112, w - 112]) {
      c.fillStyle = '#b9bcc0';
      c.beginPath();
      c.arc(x, 150, 92, 0, PI * 2);
      c.fill();
      c.fillStyle = '#0c0c0d';
      c.beginPath();
      c.arc(x, 150, 82, 0, PI * 2);
      c.fill();
      c.strokeStyle = '#3a3c40';
      c.lineWidth = 3;
      for (let r = 14; r < 80; r += 11) {
        c.beginPath();
        c.arc(x, 150, r, 0, PI * 2);
        c.stroke();
      }
      c.fillStyle = '#c9ccd0';
      c.beginPath();
      c.arc(x, 150, 16, 0, PI * 2);
      c.fill();
    }
    // tape deck, tuner dial, level meter
    c.fillStyle = '#c9ccd0';
    c.fillRect(206, 96, 100, 84);
    c.fillStyle = '#101112';
    c.fillRect(214, 106, 84, 50);
    c.fillStyle = '#e8e2cf';
    c.fillRect(224, 116, 64, 22);
    c.fillStyle = '#101112';
    for (const x of [240, 272]) {
      c.beginPath();
      c.arc(x, 127, 7, 0, PI * 2);
      c.fill();
    }
    c.fillStyle = '#e9dfb8';
    c.fillRect(150, 24, 212, 26);
    c.fillStyle = '#d0382b';
    c.fillRect(250, 22, 3, 30);
    c.fillStyle = '#101112';
    for (let i = 0; i < 20; i++) c.fillRect(156 + i * 10, 40, 2, 8);
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i < 5 ? '#5cff7a' : '#ff3a2a';
      c.fillRect(206 + i * 13, 64, 9, 14);
    }
    for (let i = 0; i < 6; i++) {
      c.fillStyle = '#d9dcdf';
      c.fillRect(208 + i * 17, 190, 13, 22);
    }
  });
  part(g, GEO.plane, new THREE.MeshStandardMaterial({ map: face, roughness: 0.4, metalness: 0.3 }), [0.54, 0.28, 1], [0, 0.15, 0.0715], { cast: false });
  // handle and antenna
  for (const s of [-1, 1]) part(g, GEO.box, k.black, [0.02, 0.08, 0.02], [s * 0.2, 0.33, 0], { cast: false });
  part(g, rbox(0.44, 0.025, 0.03, 0.01, 1), k.black, 1, [0, 0.375, 0], { cast: false });
  part(g, GEO.cylLo, k.chrome, [0.008, 0.52, 0.008], [0.22, 0.52, -0.04], { rot: [0, 0, -0.42], cast: false });
  return { group: g };
}

/** A leaning stack of VHS tapes with hand-written spine labels. */
function vhsStack() {
  const k = kit80();
  const g = new THREE.Group();
  const titles = ['TESTS VOL. 1', 'TESTS VOL. 2', 'REGRESSION II', 'DO NOT TAPE OVER', 'MOCKS: THE MOVIE'];
  const spine = canvasTexture(256, 160, (c, w, h) => {
    titles.forEach((t, i) => {
      c.fillStyle = '#0e0e0f';
      c.fillRect(0, i * 32, w, 32);
      c.fillStyle = ['#efe7d0', '#f2d98a', '#efe7d0', '#e8b0a8', '#bfe0d8'][i];
      c.fillRect(22, i * 32 + 6, w - 44, 20);
      c.fillStyle = '#1b2a6b';
      c.font = `700 15px ${MONO}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(t, w / 2, i * 32 + 17, w - 52);
    });
  });
  titles.forEach((_, i) => {
    const y = 0.0135 + i * 0.027;
    part(g, GEO.box, k.black, [0.19, 0.026, 0.105], [(i % 2) * 0.012 - 0.006, y, (i % 3) * 0.008], { rot: [0, (i - 2) * 0.07, 0], cast: i === titles.length - 1 });
    const geo = new THREE.PlaneGeometry(1, 1);
    const uv = geo.attributes.uv;
    for (let j = 0; j < uv.count; j++) uv.setY(j, 1 - (i + 1 - uv.getY(j)) / titles.length);
    const label = new THREE.Mesh(geo, mat(0xffffff, { rough: 0.7, map: spine, raw: true }));
    label.scale.set(0.185, 0.024, 1);
    label.rotation.y = (i - 2) * 0.07;
    label.position.set((i % 2) * 0.012 - 0.006 + Math.sin((i - 2) * 0.07) * 0.054, y, (i % 3) * 0.008 + Math.cos((i - 2) * 0.07) * 0.054);
    label.castShadow = false;
    g.add(label);
  });
  return { group: g };
}

/** Wall payphone with a privacy hood. Mounts flat; faces local +z. */
function payphone() {
  const k = kit80();
  const g = new THREE.Group();
  part(g, rbox(0.52, 0.86, 0.05, 0.02), k.steel, 1, [0, 0, 0.025]);
  for (const s of [-1, 1]) part(g, rbox(0.03, 0.86, 0.34, 0.012, 1), k.steel, 1, [s * 0.26, 0, 0.17]);
  part(g, rbox(0.55, 0.03, 0.34, 0.012, 1), k.steel, 1, [0, 0.43, 0.17]);
  part(g, rbox(0.3, 0.52, 0.13, 0.02), k.black, 1, [0, -0.02, 0.11]);
  const face = canvasTexture(128, 224, (c, w, h) => {
    c.fillStyle = '#161514';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#b9bcc0';
    c.fillRect(34, 12, 60, 16);
    c.fillStyle = '#0a0a0a';
    c.fillRect(58, 14, 12, 4);
    c.fillStyle = '#d9a531';
    c.fillRect(14, 40, 100, 26);
    c.fillStyle = '#1a1208';
    c.font = `800 13px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('CALL YOUR PM', w / 2, 51);
    c.font = `700 9px ${MONO}`;
    c.fillText('25¢ · no refunds', w / 2, 62);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = '#c9ccd0';
      c.fillRect(30 + (i % 3) * 25, 84 + Math.floor(i / 3) * 22, 18, 15);
      c.fillStyle = '#161514';
      c.font = `700 10px ${MONO}`;
      c.fillText('123456789*0#'[i], 39 + (i % 3) * 25, 95 + Math.floor(i / 3) * 22);
    }
    c.fillStyle = '#b9bcc0';
    c.fillRect(44, 186, 40, 22);
    c.fillStyle = '#0a0a0a';
    c.fillRect(50, 192, 28, 12);
  });
  part(g, GEO.plane, new THREE.MeshStandardMaterial({ map: face, roughness: 0.5, metalness: 0.2 }), [0.28, 0.5, 1], [0, -0.02, 0.1765], { cast: false });
  // handset on its cradle and the armoured cord
  part(g, rbox(0.055, 0.3, 0.05, 0.02), k.vinyl, 1, [-0.2, 0.04, 0.12]);
  for (const y of [0.17, -0.09]) part(g, rbox(0.075, 0.08, 0.07, 0.025), k.vinyl, 1, [-0.2, y, 0.13], { cast: false });
  part(g, GEO.torus, k.chrome, [0.3, 0.34, 0.6], [-0.1, -0.3, 0.1], { rot: [0, PI / 2, 0], cast: false });
  return { group: g };
}

/** Vending machine with a back-lit front. Faces local +z. */
function vending() {
  const k = kit80();
  const g = new THREE.Group();
  part(g, rbox(0.98, 1.86, 0.8, 0.03), k.burgundy, 1, [0, 0.95, 0], { receive: true });
  part(g, GEO.box, k.black, [0.94, 0.06, 0.74], [0, 0.03, 0], { cast: false });
  const tex = canvasTexture(384, 704, (c, w, h) => {
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#8f1422');
    bg.addColorStop(1, '#3d0812');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    // the wave
    c.fillStyle = '#f2e6cf';
    c.beginPath();
    c.moveTo(0, 250);
    c.bezierCurveTo(100, 150, 240, 330, w, 190);
    c.lineTo(w, 236);
    c.bezierCurveTo(240, 372, 100, 196, 0, 300);
    c.fill();
    c.save();
    c.translate(w / 2, 110);
    c.transform(1, -0.1, -0.2, 1, 0, 0);
    c.textAlign = 'center';
    c.fillStyle = '#f7ecd6';
    c.font = `800 120px ${FONT}`;
    c.fillText('TEST', 0, 0);
    c.fillText('COLA', 0, 300);
    c.restore();
    c.textAlign = 'center';
    c.fillStyle = '#f2d98a';
    c.font = `700 22px ${MONO}`;
    c.fillText('NOW WITH 100% COVERAGE', w / 2, 470, w - 30);
    c.fillStyle = '#f7ecd6';
    c.font = `700 17px ${MONO}`;
    c.fillText('0 calories · 0 features', w / 2, 500);
    // selection buttons, coin slot, hatch
    for (let i = 0; i < 5; i++) {
      c.fillStyle = '#1a1210';
      c.fillRect(34 + i * 66, 540, 52, 34);
      c.fillStyle = i === 3 ? '#ff5a3a' : '#e9dfb8';
      c.fillRect(38 + i * 66, 544, 44, 26);
    }
    c.fillStyle = '#12100f';
    c.fillRect(60, 612, w - 120, 70);
  });
  keep(part(g, GEO.plane, boost(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 1.35), [0.86, 1.6, 1], [0, 1.0, 0.402], { cast: false }));
  part(g, rbox(0.92, 1.66, 0.02, 0.01, 1), k.chrome, 1, [0, 1.0, 0.39], { cast: false });
  return { group: g };
}

/** School-style wall clock, stopped at 4:48. Faces local +z. */
function wallClock() {
  const k = kit80();
  const g = new THREE.Group();
  part(g, GEO.cyl, k.black, [0.66, 0.06, 0.66], [0, 0, 0.03], { rot: [PI / 2, 0, 0], cast: false });
  const face = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#e9e0c6';
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2, 0, PI * 2);
    c.fill();
    c.fillStyle = '#1b1512';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 30px ${FONT}`;
    for (let i = 1; i <= 12; i++) c.fillText(String(i), w / 2 + Math.sin((i / 12) * PI * 2) * 96, h / 2 - Math.cos((i / 12) * PI * 2) * 96);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * PI * 2;
      c.fillRect(w / 2 + Math.sin(a) * 118 - 1, h / 2 - Math.cos(a) * 118 - 1, 2, i % 5 ? 2 : 5);
    }
    c.font = `700 10px ${MONO}`;
    c.fillText('TEST O’CLOCK', w / 2, h * 0.66);
    const hand = (a, len, lw, col) => {
      c.strokeStyle = col;
      c.lineWidth = lw;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(w / 2 - Math.sin(a) * 12, h / 2 + Math.cos(a) * 12);
      c.lineTo(w / 2 + Math.sin(a) * len, h / 2 - Math.cos(a) * len);
      c.stroke();
    };
    hand(((4 + 48 / 60) / 12) * PI * 2, 58, 7, '#1b1512');
    hand((48 / 60) * PI * 2, 90, 5, '#1b1512');
    hand((17 / 60) * PI * 2, 100, 2, '#b5332a');
  });
  part(g, GEO.disc, new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 }), [0.58, 0.58, 1], [0, 0, 0.062], { cast: false });
  keep(part(g, GEO.sphere, k.glass, [0.6, 0.6, 0.05], [0, 0, 0.066], { cast: false })).renderOrder = 4;
  return { group: g };
}

/** A poster in a thin frame; faces local +z. */
function poster(kind, w = 0.72) {
  const g = new THREE.Group();
  const h = (w * 544) / 384;
  part(g, GEO.box, raw(0x1a1512, { rough: 0.6 }), [w + 0.04, h + 0.04, 0.02], [0, 0, 0.01], { cast: false });
  part(g, GEO.plane, new THREE.MeshStandardMaterial({ map: poster80(kind), roughness: 0.62 }), [w, h, 1], [0, 0, 0.022], { cast: false });
  return { group: g };
}

let mirrorMat = null;
/** Mirrored wall: three plate-glass panels in chrome trim. Its reflection is a cube map of the room taken once (finishSet80). */
function mirrorWall(scene, xa, xb, y0, y1, z) {
  const k = kit80();
  mirrorMat = new THREE.MeshStandardMaterial({ color: 0xe2ebe8, metalness: 1, roughness: 0.03, envMapIntensity: 1.5 });
  const n = 3;
  const pw = (xb - xa) / n;
  for (let i = 0; i < n; i++) keep(part(scene, GEO.box, mirrorMat, [pw - 0.03, y1 - y0, 0.02], [xa + (i + 0.5) * pw, (y0 + y1) / 2, z + 0.012], { cast: false })).userData.mirror = true;
  for (let i = 0; i <= n; i++) part(scene, GEO.box, k.chrome, [0.035, y1 - y0 + 0.07, 0.035], [xa + i * pw, (y0 + y1) / 2, z + 0.02], { cast: false });
  for (const y of [y0, y1]) part(scene, GEO.box, k.chrome, [xb - xa + 0.035, 0.035, 0.035], [(xa + xb) / 2, y, z + 0.02], { cast: false });
  return new THREE.Vector3((xa + xb) / 2, (y0 + y1) / 2, z);
}
let mirrorAt = null;

/**
 * Everything film80 adds inside the room. Returns { crt } so the scoreboard can
 * drive the television.
 */
export function buildSet80(scene, room) {
  const { x0, x1, z0, z1 } = room;
  const k = kit80();
  const put = (o, x, y, z, ry = 0) => {
    o.group.position.set(x, y, z);
    o.group.rotation.y = ry;
    scene.add(o.group);
    return o;
  };
  // carpet through the juice bar lounge, with a brass threshold strip where it meets the boards
  {
    const [a, b, c, d] = [-8.2, 2.3, 5.6, z1];
    const ct = carpetTexture();
    const geo = new THREE.PlaneGeometry(c - a, d - b);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (c - a), uv.getY(i) * (d - b));
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ct, bumpMap: ct.userData.bump, bumpScale: 0.6, roughness: 0.97, color: 0xffffff, envMapIntensity: 0.2 }));
    m.rotation.x = -PI / 2;
    m.position.set((a + c) / 2, 0.006, (b + d) / 2);
    m.receiveShadow = true;
    m.userData.keep = true;
    scene.add(m);
    const brass = raw(0xb08a3a, { rough: 0.35, metal: 1 });
    part(scene, GEO.box, brass, [c - a, 0.012, 0.05], [(a + c) / 2, 0.008, b], { cast: false });
    part(scene, GEO.box, brass, [0.05, 0.012, d - b], [a, 0.008, (b + d) / 2], { cast: false });
    part(scene, GEO.box, brass, [0.05, 0.012, d - b], [c, 0.008, (b + d) / 2], { cast: false });
  }
  // back wall, right of the chalkboards: clock, poster, payphone, then the mirrors
  put(wallClock(), 0.93, 3.7, z0 + 0.005);
  put(poster('eye', 0.66), 0.93, 2.62, z0 + 0.005);
  put(payphone(), 0.93, 1.38, z0 + 0.005);
  mirrorAt = mirrorWall(scene, 1.5, 4.85, 0.3, 3.85, z0);
  // left wall: posters either side of the locker sign, the television over the lockers' far end
  put(poster('pain'), x0 + 0.005, 3.0, -0.82, PI / 2);
  put(poster('green', 0.62), x0 + 0.005, 3.35, 3.2, PI / 2);
  const crt = put(crtTV(), x0 + 0.66, 3.25, 3.92, PI / 2 - 0.3);
  // the juice bar: boombox on the counter, tapes beside it
  put(boombox(), -1.775 - 2.52, 1.065, 3.63 - 0.05, 0.25);
  put(vhsStack(), -1.775 - 1.95, 0.94, 3.63 - 0.95, 0.5);
  put(vhsStack(), -1.775 + 2.3, 1.065, 3.63 + 0.12, -0.4);
  // vending machine under the back window, next to THE MACHINE
  put(vending(), 7.45, 0, z0 + 0.46);
  void x1;
  void k;
  return { crt };
}

/** One cube-map snapshot of the dressed, lit, empty room for the mirrors. Called once after the static batch. */
export function finishSet80(renderer, scene) {
  if (!mirrorMat || !mirrorAt) return;
  const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(0.3, 120, rt);
  cam.position.set(mirrorAt.x, 1.7, mirrorAt.z + 3.2);
  const hidden = [];
  scene.traverse((o) => {
    if (o.userData.mirror) hidden.push(o);
  });
  for (const o of hidden) o.visible = false;
  scene.updateMatrixWorld(true);
  cam.update(renderer, scene);
  for (const o of hidden) o.visible = true;
  renderer.setRenderTarget(null);
  mirrorMat.envMap = rt.texture;
  mirrorMat.needsUpdate = true;
}

/** film80 scoreboard face: an amber-and-red lamp matrix board. */
export function drawScoreboard80(c, w, hh, { value, sub, testLines, prodLines }, fmt) {
  c.fillStyle = '#0a0705';
  c.fillRect(0, 0, w, hh);
  const AMBER = '#ffb02e';
  const RED = '#ff3b24';
  const GREEN = '#7dff8a';
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = RED;
  c.font = `800 30px ${FONT}`;
  c.fillText('SCOREBOARD', 30, 46);
  c.fillStyle = AMBER;
  c.shadowColor = '#ff8a1a';
  c.shadowBlur = 18;
  c.font = `800 150px ${FONT}`;
  c.fillText(String(value), 30, 196, 560);
  c.shadowBlur = 0;
  c.fillStyle = '#e9d9b0';
  c.font = `600 22px ${MONO}`;
  c.fillText(String(sub), 30, 252, 600);
  c.fillStyle = 'rgba(255,200,120,0.16)';
  c.fillRect(660, 24, 3, hh - 48);
  const tl = Number.isFinite(testLines) ? testLines : null;
  const pl = Number.isFinite(prodLines) ? prodLines : null;
  const max = Math.max(1, tl ?? 0, pl ?? 0);
  const bx = 700;
  const bw = w - bx - 250;
  const row = (y, label, n, color) => {
    c.textAlign = 'left';
    c.fillStyle = '#e9d9b0';
    c.font = `800 44px ${FONT}`;
    c.fillText(label, bx, y - 12);
    c.fillStyle = 'rgba(255,200,120,0.09)';
    c.fillRect(bx, y, bw, 52);
    if (n !== null) {
      c.fillStyle = color;
      c.shadowColor = color;
      c.shadowBlur = 14;
      c.fillRect(bx, y, Math.max(6, (bw * n) / max), 52);
      c.shadowBlur = 0;
    }
    c.textAlign = 'right';
    c.fillStyle = color;
    c.font = `800 78px ${FONT}`;
    c.fillText(fmt(n ?? NaN), w - 30, y + 56);
  };
  row(100, 'TEST LINES WRITTEN', tl, GREEN);
  row(232, 'PRODUCTION LINES', pl, RED);
  // lamp matrix: knock the whole face back to a grid of round bulbs
  c.fillStyle = 'rgba(8,5,3,0.62)';
  for (let y = 0; y < hh; y += 6) c.fillRect(0, y + 4, w, 2);
  for (let x = 0; x < w; x += 6) c.fillRect(x + 4, 0, 2, hh);
}

// ---------- outside ----------

/** A boxy early-80s saloon or estate, nose toward local +x. */
function car(color, { wagon = false, wood = false } = {}) {
  const k = kit80();
  const g = new THREE.Group();
  const paint = raw(color, { rough: 0.32, metal: 0.45 });
  const glass = raw(0x1c2226, { rough: 0.12, metal: 0.6 });
  part(g, rbox(4.5, 0.6, 1.78, 0.07), paint, 1, [0, 0.62, 0]);
  const cl = wagon ? 2.9 : 2.1;
  const cx = wagon ? -0.62 : -0.3;
  part(g, rbox(cl, 0.52, 1.6, 0.09), paint, 1, [cx, 1.15, 0]);
  part(g, GEO.box, glass, [cl - 0.3, 0.36, 1.62], [cx, 1.17, 0], { cast: false });
  part(g, GEO.box, glass, [cl + 0.01, 0.36, 1.36], [cx, 1.17, 0], { cast: false });
  if (wood) part(g, GEO.box, k.laminate, [3.6, 0.3, 1.8], [-0.1, 0.62, 0], { cast: false });
  for (const s of [-1, 1]) {
    part(g, rbox(0.14, 0.16, 1.84, 0.03, 1), k.chrome, 1, [s * 2.26, 0.42, 0], { cast: false });
    for (const sz of [-1, 1]) {
      part(g, GEO.cyl, k.black, [0.66, 0.24, 0.66], [s * 1.42, 0.33, sz * 0.8], { rot: [PI / 2, 0, 0] });
      part(g, GEO.cyl, k.chrome, [0.36, 0.25, 0.36], [s * 1.42, 0.33, sz * 0.8], { rot: [PI / 2, 0, 0], cast: false });
    }
  }
  for (const sz of [-1, 1]) {
    part(g, GEO.box, raw(0xe9e2c8, { rough: 0.3 }), [0.04, 0.14, 0.3], [2.255, 0.7, sz * 0.62], { cast: false });
    part(g, GEO.box, raw(0x8a1a16, { rough: 0.35 }), [0.04, 0.14, 0.42], [-2.255, 0.7, sz * 0.58], { cast: false });
  }
  part(g, GEO.box, k.black, [0.04, 0.2, 0.9], [2.256, 0.68, 0], { cast: false });
  return g;
}

/** Sun-bleached asphalt with painted bays and a few parked cars. rect = [x0, z0, x1, z1] in world metres. */
export function buildLot80(group, [xa, za, xb, zb]) {
  const tex = canvasTexture(
    256,
    256,
    (g, w, h) => {
      let s = 77;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      g.fillStyle = '#5b5852';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const v = (50 + rnd() * 90) | 0;
        g.fillStyle = `rgba(${v},${v},${v - 6},${0.2 + rnd() * 0.4})`;
        g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
      }
      g.strokeStyle = 'rgba(28,26,24,0.7)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(20, 0);
      g.lineTo(70, 90);
      g.lineTo(60, 150);
      g.lineTo(140, 256);
      g.stroke();
      for (let i = 0; i < 6; i++) {
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        grd.addColorStop(0, 'rgba(20,18,16,0.45)');
        grd.addColorStop(1, 'rgba(20,18,16,0)');
        g.save();
        g.translate(rnd() * w, rnd() * h);
        g.scale(8 + rnd() * 22, 8 + rnd() * 16);
        g.fillStyle = grd;
        g.fillRect(-1, -1, 2, 2);
        g.restore();
      }
    },
    { repeat: [(xb - xa) / 6, (zb - za) / 6], aniso: 8 },
  );
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, zb - za), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  lot.rotation.x = -PI / 2;
  lot.position.set((xa + xb) / 2, -0.352, (za + zb) / 2);
  lot.userData.keep = true;
  group.add(lot);
  const line = raw(0xd9d2bc, { rough: 0.9 });
  const kerb = raw(0x9a948a, { rough: 0.9 });
  const bayX = xb - 5.1; // bays nose-in toward the building
  for (let z = za + 2; z <= zb - 2; z += 2.9) part(group, GEO.box, line, [5.2, 0.01, 0.12], [bayX + 2.3, -0.346, z], { cast: false });
  for (let z = za + 2; z <= zb - 2; z += 2.9) part(group, GEO.box, line, [5.2, 0.01, 0.12], [xa + 4.4, -0.346, z], { cast: false });
  part(group, GEO.box, kerb, [0.3, 0.16, zb - za], [xb + 0.15, -0.28, (za + zb) / 2], { cast: false });
  const shadow = new THREE.MeshBasicMaterial({ color: 0x14110e, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
  const park = (c, x, zi, ry, o) => {
    const g = car(c, o);
    const z = za + 2 + 2.9 * (zi + 0.5);
    g.position.set(x, -0.35, z);
    g.rotation.y = ry;
    group.add(g);
    // the low sun throws every car's shadow long across the tarmac
    const sh = part(group, GEO.plane, shadow, [7.4, 2.0, 1], [x + 2.0, -0.342, z + 0.35], { rot: [-PI / 2, 0, 0], cast: false });
    sh.renderOrder = 1;
  };
  park(0xa8946a, bayX + 2.4, 1, 0, {});
  park(0x5e1a20, bayX + 2.3, 2, 0, { wagon: true, wood: true });
  park(0x6f8794, bayX + 2.5, 4, 0, {});
  park(0x4a3626, bayX + 2.2, 6, 0, { wagon: true });
  park(0xb9b2a0, xa + 4.5, 2, PI, {});
  park(0x2f4a44, xa + 4.3, 5, PI, { wagon: true });
}
