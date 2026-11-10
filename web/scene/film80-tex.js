// Procedural textures and sign painting for the film80 look (a 1980s gym on 35mm):
// painted cinderblock, dark wood panelling, wood-grain laminate, low-pile carpet,
// hand-painted signs, script neon and motivational posters. Only built when the
// look is active; all seeded, nothing animates.
import * as THREE from 'three';
import { canvasPair, canvasTexture, FONT, MONO } from './materials.js';

const PI = Math.PI;
const once = (make) => {
  let v = null;
  return () => (v ??= make());
};
const seeded = (seed) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

/** Painted cinderblock, running bond: 512 x 256 px = 1.6 x 0.8 m (blocks 0.4 x 0.2 m). */
export const cinderTexture = once(() =>
  canvasPair(
    512,
    256,
    4242,
    (g, b, w, h, rnd) => {
      g.fillStyle = '#d9c9a8';
      g.fillRect(0, 0, w, h);
      const bw = w / 4;
      const bh = h / 4;
      for (let r = 0; r < 4; r++)
        for (let c = -1; c < 4; c++) {
          const x = c * bw + (r % 2 ? bw / 2 : 0);
          const y = r * bh;
          const t = rnd();
          g.fillStyle = `rgba(${t < 0.5 ? '90,70,40' : '255,246,220'},${0.03 + rnd() * 0.07})`;
          g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
          // mortar joint: a shadowed groove with a painted-over highlight
          g.fillStyle = 'rgba(70,56,36,0.5)';
          g.fillRect(x, y, bw, 3);
          g.fillRect(x, y, 3, bh);
          g.fillStyle = 'rgba(255,248,226,0.3)';
          g.fillRect(x + 3, y + 3, bw - 3, 1.5);
          b.fillStyle = '#303030';
          b.fillRect(x - 1, y - 1, bw + 2, 5);
          b.fillRect(x - 1, y - 1, 5, bh + 2);
        }
      // the pitted face of the block showing through thick paint
      for (let i = 0; i < 5200; i++) {
        const v = rnd();
        const x = rnd() * w;
        const y = rnd() * h;
        g.fillStyle = v < 0.6 ? `rgba(80,62,40,${0.05 + rnd() * 0.1})` : `rgba(255,250,235,${0.05 + rnd() * 0.08})`;
        g.fillRect(x, y, 1.6, 1.6);
        const k = (95 + rnd() * 70) | 0;
        b.fillStyle = `rgb(${k},${k},${k})`;
        b.fillRect(x, y, 2, 2);
      }
      // grime that settles in streaks
      for (let i = 0; i < 16; i++) {
        const x = rnd() * w;
        const grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, 'rgba(90,70,44,0)');
        grd.addColorStop(0.5, `rgba(90,70,44,${0.03 + rnd() * 0.05})`);
        grd.addColorStop(1, 'rgba(90,70,44,0)');
        g.fillStyle = grd;
        g.fillRect(x, 0, 10 + rnd() * 30, h);
      }
    },
    { aniso: 8 },
  ),
);

/** Dark walnut wall panelling with V-grooves every 0.2 m: 512 px = 1.6 m. */
export const panelTexture = once(() =>
  canvasPair(
    512,
    512,
    808,
    (g, b, w, h, rnd) => {
      const n = 8;
      const pw = w / n;
      for (let i = 0; i < n; i++) {
        const t = rnd();
        const R = 92 + t * 26;
        const G = 56 + t * 16;
        const B = 30 + t * 10;
        g.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
        g.fillRect(i * pw, 0, pw, h);
        for (let k = 0; k < 22; k++) {
          const dark = rnd() < 0.7;
          g.strokeStyle = dark ? `rgba(38,20,8,${0.1 + rnd() * 0.22})` : `rgba(190,130,70,${0.05 + rnd() * 0.1})`;
          g.lineWidth = 0.6 + rnd() * 2.2;
          const x = i * pw + 3 + rnd() * (pw - 6);
          const sway = rnd() * 10 - 5;
          g.beginPath();
          g.moveTo(x, 0);
          g.bezierCurveTo(x + sway, h * 0.3, x - sway, h * 0.7, x, h);
          g.stroke();
        }
        if (rnd() < 0.5) {
          const kx = i * pw + pw * (0.3 + rnd() * 0.4);
          const ky = rnd() * h;
          for (let k = 0; k < 5; k++) {
            g.strokeStyle = `rgba(34,18,8,${0.3 - k * 0.04})`;
            g.lineWidth = 1.4;
            g.beginPath();
            g.ellipse(kx, ky, 3 + k * 3, 8 + k * 9, 0, 0, PI * 2);
            g.stroke();
          }
        }
        g.fillStyle = 'rgba(14,7,3,0.85)';
        g.fillRect(i * pw, 0, 4, h);
        g.fillStyle = 'rgba(210,150,90,0.16)';
        g.fillRect(i * pw + 4, 0, 2, h);
        b.fillStyle = '#101010';
        b.fillRect(i * pw - 1, 0, 6, h);
      }
    },
    { aniso: 8 },
  ),
);

/** Wood-grain laminate (counter fronts, TV cabinets, consoles): straight printed grain, slightly orange. */
export const laminateTexture = once(() =>
  canvasTexture(
    256,
    256,
    (g, w, h) => {
      const rnd = seeded(97);
      g.fillStyle = '#8a5a32';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = rnd() < 0.6 ? `rgba(52,28,12,${0.08 + rnd() * 0.2})` : `rgba(200,140,80,${0.06 + rnd() * 0.12})`;
        g.lineWidth = 0.5 + rnd() * 1.8;
        const y = rnd() * h;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + rnd() * 5 - 2.5, w * 0.7, y + rnd() * 5 - 2.5, w, y);
        g.stroke();
      }
    },
    { repeat: [1, 1], aniso: 8 },
  ),
);

/** Low-pile contract carpet, teal with a small burgundy and mustard fleck: 256 px = 1 m. */
export const carpetTexture = once(() =>
  canvasPair(
    256,
    256,
    313,
    (g, b, w, h, rnd) => {
      g.fillStyle = '#2f5f5e';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 16000; i++) {
        const v = rnd();
        g.fillStyle = v < 0.5 ? `rgba(18,44,46,${0.3 + rnd() * 0.4})` : v < 0.86 ? `rgba(86,140,134,${0.2 + rnd() * 0.35})` : v < 0.94 ? 'rgba(126,40,52,0.7)' : 'rgba(200,150,52,0.6)';
        const x = rnd() * w;
        const y = rnd() * h;
        g.fillRect(x, y, 1.6, 1.6);
        const k = (80 + rnd() * 110) | 0;
        b.fillStyle = `rgb(${k},${k},${k})`;
        b.fillRect(x, y, 2, 2);
      }
      // a faint woven lattice
      g.strokeStyle = 'rgba(14,34,36,0.16)';
      g.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        g.beginPath();
        g.moveTo(i * 32, 0);
        g.lineTo(i * 32, h);
        g.moveTo(0, i * 32);
        g.lineTo(w, i * 32);
        g.stroke();
      }
      // worn, flattened traffic patches
      for (let i = 0; i < 7; i++) {
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        grd.addColorStop(0, 'rgba(150,150,130,0.16)');
        grd.addColorStop(1, 'rgba(150,150,130,0)');
        g.save();
        g.translate(rnd() * w, rnd() * h);
        g.scale(30 + rnd() * 50, 20 + rnd() * 40);
        g.fillStyle = grd;
        g.fillRect(-1, -1, 2, 2);
        g.restore();
      }
    },
    { aniso: 8 },
  ),
);

/** Slightly uneven brush edge: jitter a fill by redrawing it with tiny offsets. */
function brushText(g, text, x, y, maxW, fill, rnd) {
  g.fillStyle = fill;
  g.fillText(text, x, y, maxW);
  g.globalAlpha = 0.5;
  for (let i = 0; i < 3; i++) g.fillText(text, x + rnd() * 2 - 1, y + rnd() * 2 - 1, maxW);
  g.globalAlpha = 1;
}

/**
 * Sign-writer's lettering on transparent: slanted condensed caps with a hard drop
 * shadow, an outline and a swoosh underline. colors: [main, shadow, sub].
 */
export function paintedSign80(lines, { width = 1024, height = 256, colors = ['#7a1f2b', '#d9a531', '#1f5f5c'], swoosh = true } = {}) {
  return canvasTexture(width, height, (g) => {
    const rnd = seeded(lines.join('').length * 131 + 7);
    const n = lines.length;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const big = i === 0;
      const size = big ? Math.floor(height * (n > 1 ? 0.5 : 0.66)) : Math.floor(height * 0.2);
      const y = n === 1 ? height * 0.46 : big ? height * 0.36 : height * 0.82;
      g.save();
      g.translate(width / 2, y);
      if (big) g.transform(1, 0, -0.2, 1, 0, 0);
      g.font = `${big ? '800' : '700'} ${size}px ${big ? FONT : MONO}`;
      const maxW = width - 110;
      if (big) {
        const off = Math.max(4, size * 0.07);
        g.fillStyle = colors[1];
        g.fillText(line, off, off, maxW);
        g.lineJoin = 'round';
        g.strokeStyle = 'rgba(20,10,6,0.55)';
        g.lineWidth = Math.max(2, size * 0.03);
        g.strokeText(line, 0, 0, maxW);
        brushText(g, line, 0, 0, maxW, colors[0], rnd);
        // dry-brush highlights across the top of the letters
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = 'rgba(255,240,220,0.14)';
        g.fillRect(-width / 2, -size * 0.42, width, size * 0.22);
        g.globalCompositeOperation = 'source-over';
      } else {
        g.fillStyle = colors[2] ?? colors[0];
        g.fillText(line, 0, 0, maxW);
      }
      g.restore();
    });
    if (swoosh) {
      const y = n === 1 ? height * 0.86 : height * 0.63;
      g.strokeStyle = colors[1];
      g.lineCap = 'round';
      g.lineWidth = Math.max(4, height * 0.035);
      g.beginPath();
      g.moveTo(width * 0.12, y + 4);
      g.quadraticCurveTo(width * 0.5, y - 10, width * 0.9, y - 2);
      g.stroke();
    }
    // weathering: knock tiny chips out of the paint
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.5})`;
      g.fillRect(rnd() * width, rnd() * height, 1 + rnd() * 3, 1 + rnd() * 2);
    }
    g.globalCompositeOperation = 'source-over';
  });
}

/**
 * 1980s neon: slanted double-stroke tube lettering with a hot core and a halo, on
 * transparent. Second line is a thin single tube in the `sub` colour.
 */
export function neon80(lines, { width = 1024, height = 384, color = '#ff3f9a', sub = '#3fe9ff', underline = true } = {}) {
  const hot = (c) => `#${new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.72).getHexString()}`;
  return canvasTexture(width, height, (g) => {
    const n = lines.length;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineCap = 'round';
    lines.forEach((line, i) => {
      const big = i === 0;
      const size = Math.floor(height * (n > 1 ? (big ? 0.42 : 0.3) : 0.6));
      const y = n === 1 ? height * 0.46 : big ? height * 0.3 : height * 0.68;
      const col = big ? color : sub;
      g.save();
      g.translate(width / 2, y);
      g.transform(1, 0, -0.22, 1, 0, 0);
      g.font = `800 ${size}px ${FONT}`;
      const maxW = width - 150;
      const tube = Math.max(3, size * 0.055);
      // glow, tube, hot core: the letters are outlines, like bent glass
      g.shadowColor = col;
      g.shadowBlur = size * 0.32;
      g.strokeStyle = col;
      g.lineWidth = tube * 1.5;
      g.strokeText(line, 0, 0, maxW);
      g.shadowBlur = size * 0.1;
      g.strokeText(line, 0, 0, maxW);
      g.shadowBlur = 0;
      g.strokeStyle = hot(col);
      g.lineWidth = tube * 0.6;
      g.strokeText(line, 0, 0, maxW);
      g.restore();
    });
    if (underline) {
      const y = height * 0.9;
      for (const [c, lw, blur] of [
        [sub, 9, 26],
        [hot(sub), 3.5, 0],
      ]) {
        g.shadowColor = sub;
        g.shadowBlur = blur;
        g.strokeStyle = c;
        g.lineWidth = lw;
        g.beginPath();
        g.moveTo(width * 0.14, y);
        g.lineTo(width * 0.82, y);
        g.quadraticCurveTo(width * 0.9, y, width * 0.88, y - 26);
        g.stroke();
      }
      g.shadowBlur = 0;
    }
  });
}

/** Chrome-gradient slanted title, the kind every 1984 poster had. */
function chromeTitle(g, text, x, y, size, maxW) {
  g.save();
  g.translate(x, y);
  g.transform(1, 0, -0.18, 1, 0, 0);
  g.font = `800 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = '#150a1c';
  g.lineWidth = size * 0.14;
  g.strokeText(text, 0, 0, maxW);
  g.strokeStyle = '#ff3f9a';
  g.lineWidth = size * 0.06;
  g.strokeText(text, 0, 0, maxW);
  const grd = g.createLinearGradient(0, -size * 0.45, 0, size * 0.45);
  grd.addColorStop(0, '#2a5bd0');
  grd.addColorStop(0.42, '#eaf6ff');
  grd.addColorStop(0.5, '#3a2416');
  grd.addColorStop(0.56, '#b0672a');
  grd.addColorStop(1, '#ffe9a8');
  g.fillStyle = grd;
  g.fillText(text, 0, 0, maxW);
  g.restore();
}

/**
 * Motivational posters, printed and a bit sun-faded. kind:
 *   'eye'    EYE OF THE TEST: a sunset, a grid and one unblinking eye
 *   'pain'   NO PAIN NO COVERAGE: a barbell over racing stripes
 *   'green'  GREEN IS GOOD: a wall-street style check mark
 */
export function poster80(kind) {
  return canvasTexture(384, 544, (g, w, h) => {
    const rnd = seeded(kind.length * 977 + 5);
    if (kind === 'eye') {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.66);
      sky.addColorStop(0, '#1a1038');
      sky.addColorStop(0.55, '#7a1f5c');
      sky.addColorStop(1, '#ff8a3a');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      // striped sun
      g.save();
      g.beginPath();
      g.arc(w / 2, h * 0.5, 120, PI, 0);
      g.clip();
      const sun = g.createLinearGradient(0, h * 0.5 - 120, 0, h * 0.5);
      sun.addColorStop(0, '#ffe36b');
      sun.addColorStop(1, '#ff3f7a');
      g.fillStyle = sun;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#5a1650';
      for (let i = 0; i < 6; i++) g.fillRect(0, h * 0.5 - 14 - i * 19, w, 3 + i * 0.6 > 6 ? 2 : 6 - i);
      g.restore();
      // the eye
      g.fillStyle = '#12091f';
      g.beginPath();
      g.moveTo(w / 2 - 78, h * 0.4);
      g.quadraticCurveTo(w / 2, h * 0.4 - 56, w / 2 + 78, h * 0.4);
      g.quadraticCurveTo(w / 2, h * 0.4 + 50, w / 2 - 78, h * 0.4);
      g.fill();
      g.fillStyle = '#7cf29a';
      g.beginPath();
      g.arc(w / 2, h * 0.4, 25, 0, PI * 2);
      g.fill();
      g.fillStyle = '#12091f';
      g.beginPath();
      g.arc(w / 2, h * 0.4, 10, 0, PI * 2);
      g.fill();
      // perspective grid
      g.fillStyle = '#12091f';
      g.fillRect(0, h * 0.5, w, h * 0.5);
      g.strokeStyle = '#ff3f9a';
      g.lineWidth = 1.6;
      for (let i = -8; i <= 8; i++) {
        g.beginPath();
        g.moveTo(w / 2 + i * 14, h * 0.5);
        g.lineTo(w / 2 + i * 90, h);
        g.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const y = h * 0.5 + (i * i * 3.2 + 4);
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      chromeTitle(g, 'EYE OF', w / 2, h * 0.74, 78, w - 50);
      chromeTitle(g, 'THE TEST', w / 2, h * 0.87, 86, w - 40);
    } else if (kind === 'pain') {
      g.fillStyle = '#e9dcc0';
      g.fillRect(0, 0, w, h);
      const bands = ['#7a1f2b', '#d9a531', '#1f6f6c'];
      bands.forEach((c, i) => {
        g.fillStyle = c;
        g.save();
        g.translate(0, h * 0.2 + i * 46);
        g.transform(1, -0.3, 0, 1, 0, 0);
        g.fillRect(-20, 60, w + 40, 34);
        g.restore();
      });
      // barbell silhouette
      g.fillStyle = '#1b1512';
      g.fillRect(40, h * 0.46, w - 80, 10);
      for (const s of [-1, 1]) {
        g.fillRect(w / 2 + s * 130 - 9, h * 0.46 - 52, 18, 114);
        g.fillRect(w / 2 + s * 108 - 6, h * 0.46 - 38, 12, 86);
      }
      g.textAlign = 'center';
      g.fillStyle = '#1b1512';
      g.font = `800 96px ${FONT}`;
      g.save();
      g.translate(w / 2, h * 0.7);
      g.transform(1, 0, -0.16, 1, 0, 0);
      g.fillText('NO PAIN', 0, 0, w - 40);
      g.fillStyle = '#7a1f2b';
      g.fillText('NO COVERAGE', 0, 92, w - 40);
      g.restore();
      g.fillStyle = '#1b1512';
      g.font = `700 17px ${MONO}`;
      g.fillText('100% OR GO HOME', w / 2, h - 26);
    } else {
      g.fillStyle = '#0f2a22';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(124,242,154,0.14)';
      g.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        g.beginPath();
        g.moveTo(0, i * 48);
        g.lineTo(w, i * 48);
        g.moveTo(i * 36, 0);
        g.lineTo(i * 36, h);
        g.stroke();
      }
      g.strokeStyle = '#59e07f';
      g.lineWidth = 34;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(90, 220);
      g.lineTo(160, 290);
      g.lineTo(300, 120);
      g.stroke();
      chromeTitle(g, 'GREEN', w / 2, h * 0.7, 110, w - 50);
      chromeTitle(g, 'IS GOOD', w / 2, h * 0.86, 84, w - 50);
      g.fillStyle = '#c9e8d2';
      g.textAlign = 'center';
      g.font = `700 16px ${MONO}`;
      g.fillText('1,204 passing · 0 shipped', w / 2, 44);
    }
    // print wear: fold lines, faded corners, tape
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(0, h / 2 - 1, w, 2);
    g.fillRect(w / 2 - 1, 0, 2, h);
    const fade = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.75);
    fade.addColorStop(0, 'rgba(255,240,210,0)');
    fade.addColorStop(1, 'rgba(255,240,210,0.2)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(255,250,235,${rnd() * 0.12})`;
      g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
    }
    g.strokeStyle = 'rgba(245,238,220,0.9)';
    g.lineWidth = 7;
    g.strokeRect(3.5, 3.5, w - 7, h - 7);
  });
}
