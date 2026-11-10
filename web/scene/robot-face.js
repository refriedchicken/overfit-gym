// Clanker face screen: a parametric, glowing LED face drawn on a small canvas.
// Every expression is a pure function of its parameters, and the robot only
// redraws when the quantized parameters change, so capture frames stay stable.

import { LOOK } from '../look.js';

const PI = Math.PI;
const F80 = LOOK === 'film80';
export const FACE_W = 256;
export const FACE_H = 160;

export const MOOD = {
  norm: '#73f4ff',
  pass: '#8dff9f',
  fail: '#ff5b4f',
  stall: '#ffc44d',
  sleep: '#93a6ff',
  zen: '#dcaeff',
  joy: '#ffe36b',
};

function rr(g, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

// eye centres and size (canvas px)
const EY = 64;
const EX = [84, 172];
const EW = 36;
const EH = 52;

/**
 * Pill eye with lids. lidT/lidB: fraction of the eye hidden from top / bottom.
 * tilt > 0 lowers the inner corner (angry), < 0 lowers the outer corner (sad).
 */
function pill(g, x, y, s, open, lidT, lidB, tilt, glint) {
  const h = EH * open;
  if (h < 7) {
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(x - EW / 2 + 2, y + 4);
    g.quadraticCurveTo(x, y + 8, x + EW / 2 - 2, y + 4);
    g.stroke();
    return;
  }
  const top = y - h / 2;
  const bot = y + h / 2;
  const xin = x - s * (EW / 2 + 4);
  const xout = x + s * (EW / 2 + 4);
  g.save();
  g.beginPath();
  g.moveTo(xout, top + lidT * h - tilt * 14);
  g.lineTo(xin, top + lidT * h + tilt * 14);
  g.lineTo(xin, bot - lidB * h);
  g.lineTo(xout, bot - lidB * h);
  g.closePath();
  g.clip();
  rr(g, x - EW / 2, top, EW, h, EW / 2);
  g.fill();
  g.restore();
  if (glint && open > 0.55 && lidT < 0.4) {
    g.save();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.ellipse(x + 7, top + lidT * h + 12, 5, 7, 0.3, 0, PI * 2);
    g.fill();
    g.restore();
  }
}

function arcEye(g, x, y, up = true, w = 17) {
  g.lineWidth = 9;
  g.beginPath();
  if (up) g.arc(x, y + 10, w, PI * 1.12, PI * 1.88);
  else g.arc(x, y - 8, w, PI * 0.15, PI * 0.85);
  g.stroke();
}

function chevron(g, x, y, s, k = 1) {
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(x + s * 14 * k, y - 14);
  g.lineTo(x - s * 12 * k, y);
  g.lineTo(x + s * 14 * k, y + 14);
  g.stroke();
}

function ring(g, x, y, r, pupil, px = 0, py = 0) {
  g.lineWidth = 6;
  g.beginPath();
  g.arc(x, y, r, 0, PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(x + px, y + py, pupil, 0, PI * 2);
  g.fill();
}

function spiral(g, x, y, ph) {
  g.lineWidth = 5;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = i * 0.42 + ph * PI * 2;
    const r = 2 + i * 0.52;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();
}

function cross(g, x, y) {
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(x - 14, y - 14);
  g.lineTo(x + 14, y + 14);
  g.moveTo(x + 14, y - 14);
  g.lineTo(x - 14, y + 14);
  g.stroke();
}

function heart(g, x, y, k) {
  g.beginPath();
  g.moveTo(x, y + 14 * k);
  g.bezierCurveTo(x - 26 * k, y - 4 * k, x - 12 * k, y - 22 * k, x, y - 8 * k);
  g.bezierCurveTo(x + 12 * k, y - 22 * k, x + 26 * k, y - 4 * k, x, y + 14 * k);
  g.fill();
}

// ---------- mouths ----------
const MX = 128;
const MY = 122;

function smile(g, w, curve, lw = 7) {
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(MX - w, MY - curve * 0.3);
  g.quadraticCurveTo(MX, MY + curve, MX + w, MY - curve * 0.3);
  g.stroke();
}

function openSmile(g, w, h) {
  g.beginPath();
  g.moveTo(MX - w, MY - 8);
  g.quadraticCurveTo(MX, MY - 2, MX + w, MY - 8);
  g.quadraticCurveTo(MX + w * 0.8, MY + h, MX, MY + h);
  g.quadraticCurveTo(MX - w * 0.8, MY + h, MX - w, MY - 8);
  g.fill();
  // tongue
  g.save();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,120,140,0.9)';
  g.beginPath();
  g.ellipse(MX, MY + h * 0.62, w * 0.42, h * 0.3, 0, PI, 0);
  g.fill();
  g.restore();
}

function wave(g, w, amp, ph, lw = 6) {
  g.lineWidth = lw;
  g.beginPath();
  for (let i = 0; i <= 16; i++) {
    const x = MX - w + (i / 16) * w * 2;
    const y = MY + Math.sin(i * 1.3 + ph * PI * 2) * amp;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

function teeth(g, w, h, ph) {
  rr(g, MX - w, MY - h / 2, w * 2, h, 6);
  g.lineWidth = 5;
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  const n = 5;
  for (let i = 1; i < n; i++) {
    const x = MX - w + (i / n) * w * 2;
    g.moveTo(x, MY - h / 2 + 1);
    g.lineTo(x, MY + h / 2 - 1);
  }
  g.moveTo(MX - w + 2, MY + Math.sin(ph * PI * 2) * 1.5);
  g.lineTo(MX + w - 2, MY - Math.sin(ph * PI * 2) * 1.5);
  g.stroke();
}

function oMouth(g, rx, ry) {
  g.lineWidth = 6;
  g.beginPath();
  g.ellipse(MX, MY, rx, ry, 0, 0, PI * 2);
  g.stroke();
}

function tongue(g) {
  smile(g, 18, 4, 6);
  g.save();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,120,140,0.95)';
  rr(g, MX + 6, MY, 14, 16, 7);
  g.fill();
  g.restore();
}

// ---------- extras ----------

function sweatDrop(g, x, y) {
  g.save();
  g.fillStyle = '#9fd8ff';
  g.shadowColor = '#9fd8ff';
  g.beginPath();
  g.moveTo(x, y - 14);
  g.quadraticCurveTo(x + 10, y + 2, x, y + 8);
  g.quadraticCurveTo(x - 10, y + 2, x, y - 14);
  g.fill();
  g.restore();
}

function bang(g, x, y) {
  g.save();
  g.lineWidth = 7;
  for (const dx of [0, 16]) {
    g.beginPath();
    g.moveTo(x + dx, y - 22);
    g.lineTo(x + dx, y);
    g.stroke();
    g.beginPath();
    g.arc(x + dx, y + 10, 4, 0, PI * 2);
    g.fill();
  }
  g.restore();
}

function zzz(g, ph) {
  g.save();
  g.lineWidth = 4;
  const k = (ph % 1) * 10;
  for (let i = 0; i < 2; i++) {
    const s = 7 + i * 4;
    const x = 206 + i * 16;
    const y = 40 - i * 16 - k * 0.6;
    g.beginPath();
    g.moveTo(x - s, y - s);
    g.lineTo(x + s, y - s);
    g.lineTo(x - s, y + s);
    g.lineTo(x + s, y + s);
    g.stroke();
  }
  g.restore();
}

function sparkle(g, x, y, k) {
  g.beginPath();
  g.moveTo(x, y - 10 * k);
  g.quadraticCurveTo(x, y, x + 10 * k, y);
  g.quadraticCurveTo(x, y, x, y + 10 * k);
  g.quadraticCurveTo(x, y, x - 10 * k, y);
  g.quadraticCurveTo(x, y, x, y - 10 * k);
  g.fill();
}

/**
 * f: { expr, mood, open (0..1 blink), gx, gy (gaze -1..1), ph (0..1 wobble phase), extra, talk (mouth level 0..3 while speaking, else null) }
 */
export function drawFace(g, f) {
  const W = FACE_W;
  const H = FACE_H;
  const col = MOOD[f.mood] ?? MOOD.norm;
  g.clearRect(0, 0, W, H);
  // bezel-coloured surround so the plane corners vanish into the glass
  g.fillStyle = '#06080c';
  g.fillRect(0, 0, W, H);
  g.save();
  rr(g, 5, 5, W - 10, H - 10, 30);
  g.clip();
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1620');
  bg.addColorStop(1, '#070a0f');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // faint mood bloom behind the features
  const halo = g.createRadialGradient(W / 2, H * 0.55, 10, W / 2, H * 0.55, W * 0.6);
  halo.addColorStop(0, `${col}33`);
  halo.addColorStop(1, `${col}00`);
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);
  // LED pixel grid
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 8; y < H; y += 6) g.fillRect(0, y, W, 2);

  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = col;
  g.shadowBlur = 14;

  const open = f.open ?? 1;
  const gx = (f.gx ?? 0) * 12;
  const gy = (f.gy ?? 0) * 7;
  const ph = f.ph ?? 0;
  const L = EX[0] + gx;
  const R = EX[1] + gx;
  const Y = EY + gy;
  const eyes = (fn) => {
    fn(L, -1);
    fn(R, 1);
  };

  switch (f.expr) {
    case 'happy':
      eyes((x) => arcEye(g, x, Y));
      smile(g, 26, 16);
      break;
    case 'joy':
      eyes((x) => arcEye(g, x, Y - 2, true, 19));
      openSmile(g, 32, 30);
      g.save();
      g.shadowBlur = 8;
      sparkle(g, 30, 30, 1 + Math.sin(ph * PI * 2) * 0.3);
      sparkle(g, 228, 112, 1 - Math.sin(ph * PI * 2) * 0.3);
      g.restore();
      break;
    case 'proud':
    case 'smug':
      eyes((x, s) => pill(g, x, Y + 4, s, open * 0.9, 0.48, 0, -0.1, false));
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(MX - 22, MY - 2);
      g.quadraticCurveTo(MX + 4, MY + 10, MX + 26, MY - 10);
      g.stroke();
      break;
    case 'determined':
      eyes((x, s) => pill(g, x, Y + 2, s, open, 0.3, 0.08, 0.75, false));
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(MX - 18, MY);
      g.lineTo(MX + 18, MY);
      g.stroke();
      break;
    case 'tongue':
      eyes((x, s) => pill(g, x, Y + 2, s, open, 0.28, 0.12, 0.5, false));
      tongue(g);
      break;
    case 'strain':
      eyes((x, s) => chevron(g, x, Y + 2, s, 1 + Math.sin(ph * PI * 2) * 0.12));
      teeth(g, 30, 22, ph);
      if (f.extra !== 'none') sweatDrop(g, 226, 44 + (ph % 1) * 10);
      break;
    case 'wince':
      eyes((x, s) => chevron(g, x, Y + 2, s, 0.9));
      wave(g, 24, 4, ph);
      break;
    case 'panic':
      eyes((x) => ring(g, x, Y, 22, 5, Math.sin(ph * PI * 6) * 3, 0));
      g.beginPath();
      g.ellipse(MX, MY + 2, 20 + Math.sin(ph * PI * 4) * 2, 16, 0, 0, PI * 2);
      g.fill();
      bang(g, 216, 40);
      break;
    case 'nervous':
      eyes((x, s) => pill(g, x, Y, s, open * 0.85, 0.12, 0, -0.35, true));
      wave(g, 22, 4, ph, 5);
      sweatDrop(g, 32, 40 + (ph % 1) * 8);
      break;
    case 'dazed':
      eyes((x, s) => spiral(g, x, Y, ph * s));
      wave(g, 20, 5, ph, 5);
      break;
    case 'dead':
      eyes((x) => cross(g, x, Y));
      wave(g, 20, 4, ph, 5);
      break;
    case 'wow':
      eyes((x) => ring(g, x, Y, 20, 7, 0, 0));
      oMouth(g, 10, 12);
      break;
    case 'sleepy':
      eyes((x, s) => pill(g, x, Y + 8, s, open * 0.8, 0.62, 0, -0.15, false));
      smile(g, 12, 0, 5);
      if (f.extra === 'zzz') zzz(g, ph);
      break;
    case 'yawn':
      eyes((x) => arcEye(g, x, Y + 6, false, 15));
      g.beginPath();
      g.ellipse(MX, MY - 2, 16, 20, 0, 0, PI * 2);
      g.fill();
      break;
    case 'sip':
      eyes((x) => arcEye(g, x, Y + 6, false, 15));
      oMouth(g, 6, 6);
      break;
    case 'sad':
      eyes((x, s) => pill(g, x, Y + 6, s, open * 0.85, 0.22, 0, -0.7, false));
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(MX - 20, MY + 8);
      g.quadraticCurveTo(MX, MY - 8, MX + 20, MY + 8);
      g.stroke();
      if (f.extra === 'tear') sweatDrop(g, 70, 98 + (ph % 1) * 14);
      break;
    case 'zen':
      eyes((x) => arcEye(g, x, Y + 6, false, 16));
      smile(g, 14, 6, 5);
      break;
    case 'meh':
      eyes((x, s) => pill(g, x, Y + 6, s, open * 0.75, 0.5, 0, 0, false));
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(MX - 14, MY + 2);
      g.lineTo(MX + 14, MY - 2);
      g.stroke();
      break;
    case 'love':
      eyes((x) => heart(g, x, Y, 1.05 + Math.sin(ph * PI * 2) * 0.12));
      smile(g, 24, 14);
      break;
    default:
      // focus: tall pill eyes, small content line
      eyes((x, s) => pill(g, x, Y, s, open, 0, 0, 0, true));
      smile(g, 14, 4, 6);
  }
  // speaking: the mouth becomes a flapping LED bar (level 0..3), whatever the expression
  if (f.talk !== undefined && f.talk !== null && f.expr !== 'sip' && f.expr !== 'yawn') {
    g.save();
    g.shadowBlur = 0;
    g.fillStyle = '#0a0f16';
    g.fillRect(MX - 46, MY - 22, 92, 50);
    g.restore();
    const lv = f.talk;
    const mw = 25 - lv * 2.5;
    const mh = 5 + lv * 8.5;
    rr(g, MX - mw, MY + 3 - mh / 2, mw * 2, mh, Math.min(mh / 2, 13));
    g.fill();
    if (lv >= 2) {
      // a dark inside so an open mouth reads as open, not as a blob
      g.save();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(6,9,14,0.82)';
      rr(g, MX - mw + 6, MY + 4 - mh / 2 + 5, mw * 2 - 12, mh - 11, 7);
      g.fill();
      g.restore();
    }
  }
  g.restore();

  // glass glare: a soft diagonal sheen across the upper left
  g.save();
  rr(g, 5, 5, W - 10, H - 10, 30);
  g.clip();
  const glare = g.createLinearGradient(0, 0, W * 0.6, H);
  glare.addColorStop(0, 'rgba(255,255,255,0.10)');
  glare.addColorStop(0.35, 'rgba(255,255,255,0.03)');
  glare.addColorStop(0.36, 'rgba(255,255,255,0)');
  g.fillStyle = glare;
  g.fillRect(0, 0, W, H);
  if (F80) {
    // film80: the face is a little CRT. Scanlines, a shadow-mask shimmer, phosphor
    // falling off into the corners and a bulged-glass hot spot.
    g.fillStyle = 'rgba(0,0,0,0.34)';
    for (let y = 6; y < H; y += 4) g.fillRect(0, y, W, 1.6);
    g.fillStyle = 'rgba(0,0,0,0.1)';
    for (let x = 6; x < W; x += 3) g.fillRect(x, 0, 1, H);
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, W * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    const hot = g.createRadialGradient(W * 0.3, H * 0.24, 2, W * 0.3, H * 0.24, W * 0.3);
    hot.addColorStop(0, 'rgba(235,255,240,0.2)');
    hot.addColorStop(1, 'rgba(235,255,240,0)');
    g.fillStyle = hot;
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}
