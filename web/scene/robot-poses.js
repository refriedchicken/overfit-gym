// Pose library for the clankers. Every pose is a pure function of (pose scratch,
// context) where the context carries time, rep age, activity and a per-robot seed,
// so the same inputs always produce the same skeleton (capture-safe).
// Motion is written as eased keyframe curves with anticipation, overshoot and
// follow-through rather than plain sines.
import { lerp, ease, cyc, span, clamp01, pressPhase, SLOT, SLOT_MS, DIM, REP_MS } from './rhythm.js';

const PI = Math.PI;

// Skeleton dimensions (robot-local metres, before look.height scaling).
export const BODY = {
  HIP_Y: 0.5,
  THIGH: 0.21,
  SHIN: 0.2,
  FOOT: 0.09,
  SHOULDER_Y: 0.47,
  UPPER: 0.23,
  FORE: 0.22,
  HAND: 0.035,
  NECK_Y: 0.575,
};
const { HIP_Y, THIGH, SHIN, FOOT, SHOULDER_Y, UPPER, FORE, HAND } = BODY;

// ---------- easing + keyframes ----------

export const E = {
  lin: (t) => t,
  io: (t) => t * t * (3 - 2 * t),
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t * t,
  back: (t) => {
    const c = 2.2;
    const x = t - 1;
    return 1 + (c + 1) * x * x * x + c * x * x;
  },
  hold: () => 0,
};

/** Scalar keyframes: keys = [[u, value, ease?], ...] sorted by u; the ease shapes the segment arriving at that key. */
export function kf(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (u <= k[0]) {
      const a = keys[i - 1];
      const t = clamp01((u - a[0]) / (k[0] - a[0]));
      return a[1] + (k[1] - a[1]) * (k[2] ?? E.io)(t);
    }
  }
  return keys[keys.length - 1][1];
}

/** A short decaying wobble (follow-through) after an event `age` ms ago. */
export const settle = (age, freq = 0.025, decay = 220) => (age >= 0 && age < decay * 5 ? Math.sin(age * freq) * Math.exp(-age / decay) : 0);

// ---------- pose scratch ----------

export function newPose() {
  return {
    base: 0,
    lift: 0,
    plant: true,
    hipY: HIP_Y,
    pitch: 0,
    roll: 0,
    yaw: 0,
    offX: 0,
    offZ: 0,
    tx: 0,
    ty: 0,
    tz: 0,
    hx: 0,
    hy: 0,
    hz: 0,
    arms: [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
    legs: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    ankle: [NaN, NaN],
    grip: [0, 0],
    wrist: [0, 0],
    flare: 1,
    expr: 'focus',
    mood: 'norm',
    gx: 0,
    gy: 0,
    ph: 0,
    extra: '',
    blinkOk: true,
    bar: null,
    barAge: 0,
    held: [null, null],
    squeeze: 0,
    droop: 0,
    sparks: 0,
    stars: 0,
    hover: false,
    squash: 0,
    kick: 0,
    breath: 1,
  };
}

export function resetPose(P) {
  P.base = 0;
  P.lift = 0;
  P.plant = true;
  P.hipY = HIP_Y;
  P.pitch = P.roll = P.yaw = P.offX = P.offZ = 0;
  P.tx = P.ty = P.tz = P.hx = P.hy = P.hz = 0;
  setArms(P, [0.04, 0.12, -0.22, 0, 0]);
  setLegs(P, [0, 0.05, 0.03]);
  P.ankle[0] = P.ankle[1] = NaN;
  P.grip[0] = P.grip[1] = 0.35;
  P.wrist[0] = P.wrist[1] = 0;
  P.flare = 1;
  P.expr = 'focus';
  P.mood = 'norm';
  P.gx = P.gy = P.ph = 0;
  P.extra = '';
  P.blinkOk = true;
  P.bar = null;
  P.barAge = 0;
  P.held[0] = P.held[1] = null;
  P.squeeze = 0;
  P.droop = 0;
  P.sparks = 0;
  P.stars = 0;
  P.hover = false;
  P.squash = 0;
  P.kick = 0;
  P.breath = 1;
}

export function setArm(P, i, a) {
  const o = P.arms[i];
  o[0] = a[0];
  o[1] = a[1];
  o[2] = a[2];
  o[3] = a[3] ?? 0;
  o[4] = a[4] ?? 0;
}
export function setArms(P, a, b = a) {
  setArm(P, 0, a);
  setArm(P, 1, b);
}
export function setLeg(P, i, l) {
  const o = P.legs[i];
  o[0] = l[0];
  o[1] = l[1];
  o[2] = l[2];
}
export function setLegs(P, a, b = a) {
  setLeg(P, 0, a);
  setLeg(P, 1, b);
}
function mixArm(P, i, a, b, t) {
  const o = P.arms[i];
  for (let k = 0; k < 5; k++) o[k] = lerp(a[k] ?? 0, b[k] ?? 0, t);
}

/** Vertical extent from hip pivot to sole for a leg (keeps feet planted). */
function legDrop(l, pitch) {
  const a = pitch + l[0];
  return (THIGH * Math.cos(a) + SHIN * Math.cos(a + l[2])) * Math.cos(l[1]) + FOOT;
}
export function plantHips(P) {
  P.hipY = Math.max(legDrop(P.legs[0], P.pitch), legDrop(P.legs[1], P.pitch));
  P.plant = false;
}

// ---------- scale: robots come in very different sizes, the equipment does not ----------
// c.k is 1 / (the robot's world scale), so a world length L is L * c.k in robot-local units.

/** How much bigger than the nominal robot (the size the gym was built around): 0 at nominal and below, about 0.45 for the giant. */
const big = (c) => Math.max(0, 1 / (c.k * 1.18) - 1);
/** How much smaller than nominal: 0 at nominal and above, about 0.16 for the smallest. */
const small = (c) => Math.max(0, 1 - 1 / (c.k * 1.18));

/** Robot-local [y, z] of the shoulder line and the upper-body lean, for the pose as it stands. */
function shoulderAt(P) {
  const L = P.pitch + P.tx;
  const hip = P.plant ? Math.max(legDrop(P.legs[0], P.pitch), legDrop(P.legs[1], P.pitch)) : P.hipY;
  return [P.base + P.lift + hip + SHOULDER_Y * Math.cos(L), P.offZ + SHOULDER_Y * Math.sin(L), L];
}

/**
 * Two-bone reach in the sagittal plane: bend arm i so its hand (plus `ext` of whatever it
 * holds) lands on robot-local (y, z). Returns how far out of reach the target is (0 = reached).
 * Call it after the legs, lean and offsets are set.
 */
function reachTo(P, i, y, z, ext = 0) {
  const [sy, sz, L] = shoulderAt(P);
  const l1 = UPPER;
  const l2 = FORE + HAND + ext;
  const ty = y - sy;
  const tz = z - sz;
  const d = Math.hypot(ty, tz);
  const dc = Math.min(l1 + l2 - 0.004, Math.max(Math.abs(l1 - l2) + 0.02, d));
  const psi = Math.atan2(-tz, -ty);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc))));
  const e = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - dc * dc) / (2 * l1 * l2))));
  const o = P.arms[i];
  o[0] = psi + alpha - L;
  o[2] = -(PI - e);
  return Math.max(0, d - dc);
}

/** Activity age at the context's sample time. */
const aAge = (c, period) => {
  const a = c.act;
  if (a && Number.isFinite(a.ageMs)) return a.ageMs - c.shift;
  return cyc(c.t, period) * period;
};

// ---------- reusable motions ----------

/** Walk/jog with foot planting (the hips ride on the straighter leg), arm swing and a bob. */
export function walkCycle(P, c) {
  const ph = c.t * 0.0135 + c.seed * 3;
  for (let i = 0; i < 2; i++) {
    const th = ph + (i ? PI : 0);
    const s = Math.sin(th);
    setLeg(P, i, [-s * 0.5 - 0.04, 0.05, 0.1 + Math.max(0, Math.sin(th + 1.6)) * 0.95]);
    setArm(P, i, [s * 0.55, 0.14, -0.45 - Math.max(0, -s) * 0.35]);
    P.grip[i] = 0.7;
  }
  P.lift = Math.max(0, Math.sin(ph * 2 - 0.5)) * 0.018;
  P.tx = 0.08;
  P.ty = Math.sin(ph) * 0.08;
  P.hy = -P.ty * 0.7;
  P.expr = 'focus';
  P.gy = 0.2;
}

/** Overhead press: p = 0 racked at the shoulders, 1 locked out (bar positions depend on this mapping). */
function pressPose(P, p) {
  const e = clamp01(p);
  setArms(P, [lerp(-0.25, -2.95, e), lerp(0.62, 0.22, e), lerp(-2.45, -0.05, e)]);
  P.grip[0] = P.grip[1] = 1;
  P.wrist[0] = P.wrist[1] = lerp(0.6, 0.1, e);
  const k = 0.1 + (1 - e) * 0.14;
  setLegs(P, [-k * 0.5, 0.1, k]);
  P.tx = -0.03 - e * 0.05;
  P.hx = lerp(0.04, -0.14, e);
  P.flare = 0.15;
  P.expr = p > 0.25 ? 'strain' : 'determined';
}

function seated(P, c, seat) {
  P.plant = false;
  P.hipY = seat * c.k + 0.085;
  const sw = Math.sin(c.t * 0.003 + c.seed * 5) * 0.22;
  setLeg(P, 0, [-1.57, 0.1, 1.45 + sw]);
  setLeg(P, 1, [-1.57, 0.1, 1.45 - sw]);
}

const happyAfterRep = (P, c) => {
  if (c.repStatus === 'pass' && c.repAge > REP_HAPPY && c.repAge < 1500) {
    P.expr = c.repAge < 900 ? 'joy' : 'happy';
    P.mood = 'pass';
    P.kick += settle(c.repAge - REP_HAPPY, 0.03, 160) * 0.6;
    return true;
  }
  return false;
};

export const REP_HAPPY = 380;

/** Slot-machine lever in the robot's frame (world metres): pivot height and distance, knob radius, side offset. Mirrors slotUnit in props.js. */
const LEVER = { x: 0.25, y: 1.05, z: 0.33, len: 0.47 };
/** Hands hanging in front of the hips, holding a bar (the bottom of the tandem range for a robot much taller than its partners). */
const HANG = [-0.5, 0.2, -0.25];

// celebrate flex poses: right arm, left arm, legs, torso lean
const FLEX = [
  // double biceps
  { r: [0, 1.45, 0, 1.95], l: [0, 1.45, 0, 1.95], legs: [0, 0.16, 0.05], tx: -0.04, expr: 'joy' },
  // most muscular (crab)
  { r: [-0.55, 0.62, -1.3, -0.35], l: [-0.55, 0.62, -1.3, -0.35], legs: [-0.22, 0.2, 0.42], tx: 0.26, expr: 'proud' },
  // point at the sky, flex the other
  { r: [-3.0, 0.3, -0.05, 0], l: [0.05, 1.45, 0, 2.0], legs: [-0.05, 0.14, 0.1], tx: -0.08, expr: 'joy' },
];

// ---------- poses: one per station kind ----------
// Robot faces +z; arms[0] is the right arm (-x), arms[1] the left (+x).
// arm: [shoulder pitch (-: forward/up), abduction, elbow pitch (-: bend), elbow roll, shoulder yaw]
// leg: [hip pitch (-: forward), hip roll (+: out), knee bend]

export const POSES = {
  bench(P, c) {
    const age = c.repAge;
    P.bar = 'hands';
    if (c.repStatus === 'skip' && age < 1100) {
      // skipped test: shrug at the rack, bar stays racked
      const s = kf(age, [
        [0, 0],
        [220, 1, E.back],
        [800, 1],
        [1100, 0],
      ]);
      setArms(P, [lerp(0.04, -0.55, s), lerp(0.12, 0.85, s), lerp(-0.22, -1.35, s), 0, lerp(0, -0.4, s)]);
      P.grip[0] = P.grip[1] = 0;
      P.wrist[0] = P.wrist[1] = -0.6 * s;
      P.hz = 0.22 * s;
      P.tz = -0.05 * s;
      P.expr = 'meh';
      P.bar = 'rack';
      return;
    }
    const u = age / REP_MS;
    const fail = c.repStatus === 'fail' && u < 1.7;
    let p;
    let dip = 0;
    let shake = 0;
    if (fail) {
      // gets it most of the way, wobbles, sinks back
      p = kf(u, [
        [0, 0.06],
        [0.12, 0],
        [0.42, 0.78, E.out],
        [0.6, 0.66],
        [0.75, 0.72],
        [1.2, 0.08],
        [1.7, 0.06],
      ]);
      dip = kf(u, [
        [0, 0],
        [0.12, 1],
        [0.3, -0.2, E.out],
        [0.6, 0.6],
        [1.2, 0.8],
        [1.7, 0],
      ]);
      shake = u > 0.4 && u < 1.2 ? Math.sin(age * 0.055) * 0.022 : 0;
    } else if (u < 1.35) {
      // anticipation dip, explosive drive, lockout hold, controlled descent, rack settle
      p = kf(u, [
        [0, 0.06],
        [0.12, 0.0],
        [0.44, 1.0, E.out],
        [0.6, 0.98],
        [1.0, 0.06, E.io],
        [1.35, 0.06],
      ]);
      dip = kf(u, [
        [0, 0],
        [0.12, 1],
        [0.3, -0.35, E.out],
        [0.5, 0],
        [1.0, 0.4],
        [1.18, -0.1],
        [1.35, 0],
      ]);
      shake = u > 0.44 && u < 0.6 ? Math.sin(age * 0.06) * 0.008 : 0;
      if (u > 0.44) P.kick = settle(age - 0.44 * REP_MS, 0.035, 150) * 0.8;
    } else {
      // racked at the shoulders, breathing
      p = 0.06 + Math.sin(c.t * 0.003 + c.seed) * 0.02;
    }
    pressPose(P, p + shake);
    P.legs[0][2] += dip * 0.28;
    P.legs[1][2] += dip * 0.28;
    P.legs[0][0] -= dip * 0.14;
    P.legs[1][0] -= dip * 0.14;
    P.ph = cyc(c.t, 420);
    if (fail) {
      P.expr = u < 0.4 ? 'strain' : 'panic';
      P.mood = 'fail';
      P.ph = cyc(c.t, 300);
    } else if (!happyAfterRep(P, c)) {
      if (u < 0.12) P.expr = 'determined';
      else if (u < 0.62) P.expr = 'strain';
      else P.expr = u < 1.35 ? 'determined' : 'focus';
    }
  },

  fail(P, c) {
    const age = Number.isFinite(c.repAge) ? Math.max(0, c.repAge) : 3000;
    P.plant = false;
    P.mood = 'fail';
    P.flare = 0.4;
    const fall = kf(age, [
      [0, 0],
      [170, 0.1, E.in],
      [500, 1, E.in],
    ]);
    const land = age - 500;
    const bounce = land > 0 ? Math.abs(Math.sin(land * 0.02)) * Math.exp(-land / 140) * 0.07 : 0;
    P.hipY = lerp(HIP_Y - 0.02, 0.12, fall) + bounce;
    P.pitch = kf(age, [
      [0, 0],
      [170, 0.1],
      [470, -0.42, E.out],
      [700, -0.08, E.io],
      [1100, -0.16],
    ]);
    const kickUp = land > -60 && land < 500 ? Math.sin(clamp01((land + 60) / 560) * PI) : 0;
    setLeg(P, 0, [lerp(-0.12, -1.42, fall) - kickUp * 0.55, lerp(0.1, 0.36, fall), lerp(0.35, 0.2, fall) + kickUp * 0.2]);
    setLeg(P, 1, [lerp(-0.12, -1.36, fall) - kickUp * 0.4, lerp(0.1, 0.3, fall), lerp(0.35, 0.32, fall) + kickUp * 0.4]);
    if (age < 190) {
      // buckle: bar comes down onto the robot
      const b = age / 190;
      setArms(P, [lerp(-2.95, -2.2, b), lerp(0.22, 0.6, b), lerp(-0.05, -1.4, b)]);
      P.grip[0] = P.grip[1] = 1;
      P.bar = 'hands';
      P.expr = 'strain';
    } else if (age < 1050) {
      // flail: windmilling arms, open hands
      const w = (age - 190) * 0.028;
      const amp = 1 - clamp01((age - 700) / 350) * 0.6;
      setArm(P, 0, [-1.7 + Math.sin(w) * 1.3 * amp, 0.95 + Math.sin(w * 1.3) * 0.3, -0.3 - Math.max(0, Math.sin(w + 1)) * 0.6]);
      setArm(P, 1, [-1.7 + Math.sin(w + 2.2) * 1.3 * amp, 0.95 + Math.sin(w * 1.1 + 1) * 0.3, -0.3 - Math.max(0, Math.sin(w + 3)) * 0.6]);
      P.grip[0] = P.grip[1] = 0;
      P.bar = 'drop';
      P.barAge = age - 190;
      P.expr = 'panic';
      P.ph = cyc(c.t, 260);
      P.blinkOk = false;
    } else {
      // dazed: propped on its hands, head circling, stars
      const s = clamp01((age - 1050) / 350);
      const b = E.io(s);
      setArm(P, 0, [lerp(-1.0, 0.62, b), lerp(0.95, 0.38, b), lerp(-0.4, -0.15, b)]);
      setArm(P, 1, [lerp(-1.4, 0.6, b), lerp(0.95, 0.42, b), lerp(-0.4, -0.18, b)]);
      P.grip[0] = P.grip[1] = 0;
      P.bar = 'drop';
      P.barAge = age - 190;
      const ang = c.t * 0.006;
      P.hz = Math.sin(ang) * 0.16;
      P.hx = Math.cos(ang) * 0.1 - 0.04;
      P.expr = age < 2600 ? 'dazed' : 'dead';
      P.ph = cyc(c.t, 900);
      P.stars = age < 2600 ? 1 : 0;
      P.blinkOk = false;
    }
    P.tx = kf(age, [
      [0, 0],
      [500, -0.1],
      [900, 0.08],
    ]);
    P.sparks = age > 300 && age < 1500 ? 1 : 0;
    P.droop = clamp01(age / 600) * 0.7;
    if (land > 0) P.kick = settle(land, 0.04, 140) * 1.4;
    else P.kick = fall * 0.6;
  },

  stalled(P, c) {
    const t = c.t;
    const tremble = Math.sin(t * 0.047) * 0.011 + Math.sin(t * 0.071 + 1) * 0.006;
    const u = cyc(t, 2300, c.seed * 500);
    // slowly sinking, then a grunt shoves it back up a little
    const sag = kf(u, [
      [0, 0],
      [0.58, 0.09, E.in],
      [0.7, -0.03, E.out],
      [0.85, 0],
    ]);
    pressPose(P, 0.46 - sag + tremble);
    setLegs(P, [-0.42 - sag, 0.14, 0.85 + sag * 1.6]);
    P.bar = 'hands';
    P.expr = u > 0.58 && u < 0.72 ? 'wince' : 'strain';
    P.mood = 'stall';
    P.ph = cyc(t, 360);
    P.hz = tremble * 3;
    P.tz = tremble * 1.6;
    P.tx = 0.04 + sag * 0.8;
    P.kick = tremble * 6;
    P.blinkOk = false;
    P.breath = 2.4;
  },

  celebrate(P, c) {
    const T = 1500;
    const sh = c.seed * 700;
    const n = Math.floor((c.t + sh) / T);
    const u = cyc(c.t, T, sh);
    const cur = FLEX[((n % 3) + 3) % 3];
    const prev = FLEX[(((n - 1) % 3) + 3) % 3];
    const into = E.back(clamp01(u / 0.26));
    mixArm(P, 0, prev.r, cur.r, into);
    mixArm(P, 1, prev.l, cur.l, into);
    const lb = clamp01(u / 0.2);
    const legs = cur.legs.map((v, i) => lerp(prev.legs[i], v, lb));
    setLegs(P, legs);
    P.tx = lerp(prev.tx, cur.tx, into);
    // hop between poses: crouch, pop, land, absorb
    const hop = kf(u, [
      [0, 0],
      [0.06, -0.035],
      [0.17, 0.12, E.out],
      [0.3, 0, E.in],
      [0.36, -0.03],
      [0.46, 0],
    ]);
    P.lift = Math.max(0, hop);
    P.legs[0][2] += Math.max(0, -hop) * 6;
    P.legs[1][2] += Math.max(0, -hop) * 6;
    P.grip[0] = P.grip[1] = 1;
    P.squeeze = u > 0.3 ? 0.5 + Math.sin((u - 0.3) * 30) * 0.5 : 0;
    P.flare = 0.3;
    P.expr = u < 0.3 ? 'joy' : cur.expr;
    P.mood = 'pass';
    P.ph = cyc(c.t, 600);
    P.sparks = 0.6;
    P.kick = settle((u - 0.3) * T, 0.035, 160) * 0.8;
    P.hx = -0.08;
  },

  slump(P, c) {
    P.plant = false;
    const br = Math.sin(c.t * 0.0035 + c.seed);
    P.hipY = 0.13;
    setLeg(P, 0, [-1.4, 0.34, 0.5]);
    setLeg(P, 1, [-1.25, 0.24, 0.85]);
    P.tx = 0.5 + br * 0.04;
    P.hx = 0.42;
    P.hz = 0.12;
    setArm(P, 0, [-0.58 + br * 0.03, 0.08, -0.3]);
    setArm(P, 1, [-0.5 + br * 0.03, 0.14, -0.25]);
    P.grip[0] = P.grip[1] = 0.1;
    P.flare = 0.5;
    P.expr = cyc(c.t, 7000, c.seed * 900) < 0.6 ? 'sad' : 'sleepy';
    P.extra = 'tear';
    P.ph = cyc(c.t, 1400);
    P.mood = 'sleep';
    P.droop = 1;
    P.breath = 2;
  },

  treadmill(P, c) {
    P.base = DIM.deck * c.k;
    const ph = c.t * 0.0125 + c.seed * 6;
    // a big robot takes short, choppy steps: the belt is only so long
    const stride = 0.62 / (1 + big(c));
    for (let i = 0; i < 2; i++) {
      const th = ph + (i ? PI : 0);
      const s = Math.sin(th);
      setLeg(P, i, [-s * stride - 0.12, 0.04, 0.24 + Math.max(0, Math.sin(th + 1.9)) * 1.35]);
      setArm(P, i, [s * 0.75 - 0.15, 0.16, -1.6 + Math.max(0, -s) * 0.3]);
      P.grip[i] = 1;
    }
    P.lift = Math.max(0, Math.sin(ph * 2 - 0.6)) * 0.035;
    P.tx = 0.14;
    P.ty = Math.sin(ph) * 0.12;
    P.hy = -P.ty * 0.8;
    P.hx = -0.06;
    P.flare = 0.5;
    P.expr = 'determined';
    P.breath = 1.8;
    if (c.wb?.writing) {
      const k = c.t * 0.001;
      setArm(P, 0, [-1.9 + Math.sin(k * 19) * 0.12, 0.18 + Math.sin(k * 29) * 0.12, -0.14 + Math.cos(k * 19) * 0.16]);
      P.held[0] = 'marker';
      P.grip[0] = 1;
      P.wrist[0] = -0.4;
      P.tx = 0.24 + small(c) * 1.0;
      P.offZ = small(c) * 0.5;
      P.hx = -0.18;
      P.ty *= 0.4;
      P.hy = 0;
      P.gx = -0.3 + Math.sin(k * 19) * 0.2;
      P.gy = -0.4;
      P.expr = 'tongue';
      // the marker tip stays on the whiteboard whatever the robot's size: the giant writes along the top edge, the small one along the bottom
      const [sy] = shoulderAt(P);
      const wy = Math.max(1.22, Math.min(1.8, (sy + 0.12) / c.k));
      reachTo(P, 0, wy * c.k + Math.sin(k * 19) * 0.03, (DIM.boardZ - 0.065) * c.k, 0.1);
      P.arms[0][1] = 0.16 + Math.sin(k * 29) * 0.1;
      if (wy * c.k < sy) P.gy = 0.5;
    }
  },

  wobble(P, c) {
    const u = cyc(c.t, SLOT_MS, c.seed * 400);
    const reach = span(u, 0, SLOT.reach);
    const pull = span(u, SLOT.reach, SLOT.pull);
    const back = span(u, SLOT.pull, SLOT.pull + 0.12);
    // lever arm (keeps the lever timing in props.js)
    const shX = u < SLOT.reach ? lerp(-0.9, -2.35, E.back(reach)) : u < SLOT.pull ? lerp(-2.35, -0.95, E.io(pull)) : lerp(-0.95, -0.55, E.io(back));
    setArm(P, 0, [shX, 0.05, u < SLOT.pull ? -0.25 : lerp(-0.25, -1.3, back)]);
    P.grip[0] = u < SLOT.pull + 0.02 ? 1 : 0.4;
    // anticipation: rub hands, then the other hand braces on the cabinet
    setArm(P, 1, [-0.5 + Math.sin(c.t * 0.03) * 0.05 * (1 - reach), 0.22, -1.35]);
    const dip = u > SLOT.reach && u < SLOT.pull + 0.1 ? Math.sin(span(u, SLOT.reach, SLOT.pull + 0.1) * PI) : 0;
    setLegs(P, [-dip * 0.45, 0.1, dip * 0.9]);
    P.tx = dip * 0.18 - (u < SLOT.reach ? 0.06 * Math.sin(reach * PI) : 0);
    P.expr = u < SLOT.reach ? 'determined' : 'focus';
    // Size: a big robot stands back from the cabinet and off to the side so its lever
    // shoulder lines up with the lever; whatever is left is covered by reaching across.
    const B = big(c);
    P.offZ = -0.5 * B * c.k;
    const need = (c.sx ?? 0.33) / c.k - LEVER.x - 0.08;
    P.offX = Math.max(0, need) * 0.6 * c.k;
    if (u < SLOT.pull + 0.02) {
      // the hand rides the lever knob (same curve as the lever in props.js)
      const r = u < SLOT.reach ? 0 : -1.2 * ease(pull);
      const rest0 = P.arms[0][0];
      const rest2 = P.arms[0][2];
      const miss = reachTo(P, 0, (LEVER.y + LEVER.len * Math.cos(r)) * c.k, (LEVER.z + LEVER.len * Math.sin(r)) * c.k, 0.03);
      P.arms[0][1] = -Math.asin(Math.min(0.8, (Math.max(0, need) * 0.4 * c.k) / 0.45)) + 0.05;
      // too short to reach the top of the lever: up on tiptoe, straining
      if (miss > 0.01) {
        P.lift += Math.min(0.07, miss);
        P.ankle[0] = P.ankle[1] = 0.5;
        P.hx -= 0.2;
      }
      if (u < SLOT.reach) {
        const a = E.back(reach);
        P.arms[0][0] = lerp(rest0 + 1.4, P.arms[0][0], a);
        P.arms[0][2] = lerp(rest2, P.arms[0][2], a);
      }
    }
    if (u > SLOT.pull + 0.04 && u < SLOT.win) {
      // spinning: hands clasped under the chin, swaying, eyes darting
      const k = clamp01((u - SLOT.pull - 0.04) / 0.08);
      const clasp = [-1.25, -0.12, -1.75, 0, 0.2];
      mixArm(P, 0, [-0.55, 0.05, -1.3], clasp, E.io(k));
      mixArm(P, 1, [-0.5, 0.22, -1.35], clasp, E.io(k));
      P.grip[0] = P.grip[1] = 0.6;
      P.roll = Math.sin(c.t * 0.012) * 0.05;
      P.tz = Math.sin(c.t * 0.012 + 1) * 0.07;
      P.expr = 'nervous';
      P.gx = Math.sin(c.t * 0.009) * 0.7;
      P.ph = cyc(c.t, 500);
      P.flare = 0.2;
      for (const st of [SLOT.stops[0], SLOT.stops[1]]) {
        const f = span(u, st, st + 0.06);
        const bump = f > 0 && f < 1 ? Math.sin(f * PI) : 0;
        if (bump > 0) {
          P.hx -= bump * 0.18;
          P.tx -= bump * 0.08;
          P.arms[0][1] += bump * 0.2;
          P.arms[1][1] += bump * 0.2;
          if (bump > 0.25) P.expr = 'wince';
          P.mood = 'fail';
          P.kick += bump * 0.8;
        }
      }
      if (u > SLOT.stops[1] + 0.06) P.mood = 'fail';
    }
    if (u >= SLOT.win) {
      const w = (u - SLOT.win) * SLOT_MS;
      P.expr = 'joy';
      P.mood = 'pass';
      P.ph = cyc(c.t, 500);
      const up = E.back(clamp01(w / 260));
      mixArm(P, 1, [-1.25, -0.12, -1.75], [-2.9, 0.35, -0.4 + Math.sin(c.t * 0.03) * 0.25], up);
      mixArm(P, 0, [-1.25, -0.12, -1.75], [-0.55, 0.55, -1.4, 0, 0], up);
      P.grip[0] = P.grip[1] = 1;
      P.lift = Math.abs(Math.sin(w * 0.012)) * 0.06;
      P.kick = settle(w, 0.035, 160);
      P.sparks = 0.5;
    }
  },

  coordinated(P, c) {
    const p = c.lift ?? pressPhase(c.repAge, c.t);
    // On the shared bar the smallest lifter sets the height. `drop` is how far (robot-local)
    // this robot's hands must come down to meet it: first by pressing less, then by
    // lowering the bar to a hang in front of the hips.
    const drop = c.drop ?? 0;
    let e = ease(p);
    const de = Math.min(e, drop / 0.4);
    e -= de;
    pressPose(P, e);
    const hang = clamp01((drop - de * 0.4) / 0.55);
    if (hang > 0) {
      const h = E.io(hang);
      mixArm(P, 0, P.arms[0], HANG, h);
      mixArm(P, 1, P.arms[1], HANG, h);
      P.wrist[0] = P.wrist[1] = lerp(P.wrist[0], 0.2, h);
      P.tx = lerp(P.tx, 0.1, h);
      P.hx = lerp(P.hx, 0.2, h);
      P.gy = 0.5 * h;
    }
    P.expr = drop > 0.15 ? 'meh' : p > 0.3 ? 'strain' : 'determined';
    P.ph = cyc(c.t, 420);
    happyAfterRep(P, c);
  },

  spotting(P, c) {
    if (c.helper) {
      P.plant = false;
      P.hover = true;
      P.hipY = HIP_Y + 0.6 + Math.sin(c.t * 0.004 + c.seed * 3) * 0.06;
      setLegs(P, [0.15, 0.06, 0.4]);
      setArm(P, 0, [-1.3 + Math.sin(c.t * 0.005) * 0.1, 0.28, -0.5]);
      setArm(P, 1, [-1.3 + Math.sin(c.t * 0.005 + 1.3) * 0.1, 0.28, -0.5]);
      P.grip[0] = P.grip[1] = 0.15;
      P.tx = 0.12;
      P.hx = -0.22;
      P.roll = Math.sin(c.t * 0.003 + c.seed * 2) * 0.08;
      P.pitch = 0.06 + Math.sin(c.t * 0.0023 + c.seed) * 0.04;
      P.expr = cyc(c.t, 5200, c.seed * 900) < 0.25 ? 'happy' : 'determined';
    } else {
      setArms(P, [-1.2, 0.3, -0.6]);
      setLegs(P, [-0.3, 0.16, 0.55]);
      P.grip[0] = P.grip[1] = 0.15;
      P.tx = 0.2;
      P.expr = 'focus';
    }
    P.flare = 0.3;
  },

  machine(P, c) {
    const k = c.t * 0.006;
    setArm(P, 0, [-1.15 + Math.sin(k) * 0.32, 0.14, -0.55 - Math.cos(k) * 0.35]);
    setArm(P, 1, [0.35, 0.75, 0, -1.7]);
    P.grip[0] = 1;
    P.grip[1] = 0.5;
    setLegs(P, [-0.1, 0.13, 0.12], [0.05, 0.16, 0.05]);
    P.tx = 0.08 + Math.sin(k) * 0.02;
    P.ty = Math.sin(k) * 0.05;
    P.hy = 0.15;
    P.lift = Math.abs(Math.sin(k * 0.5)) * 0.01;
    P.expr = 'smug';
    P.gx = 0.3;
    // the crank hand stays on the handle at any size; a big robot stands back and stoops to it
    const B = big(c);
    P.offZ = -0.5 * B * c.k;
    P.tx += 0.5 * B;
    reachTo(P, 0, (1.0 + 0.32 * Math.cos(k) - 0.08 * Math.sin(k)) * c.k, (0.42 + 0.32 * Math.sin(k) + 0.08 * Math.cos(k)) * c.k, 0.02);
  },

  idle(P, c) {
    seated(P, c, DIM.seat);
    const T = 5600;
    const sh = c.seed * 900;
    const u = cyc(c.t, T, sh);
    const n = Math.floor((c.t + sh) / T);
    const sip = Math.sin(span(u, 0.55, 0.85) * PI);
    setArm(P, 1, [lerp(-0.7, -2.15, sip), 0.25, lerp(-1.4, -2.1, sip)]);
    setArm(P, 0, [-0.65, 0.12, -0.55]);
    P.held[1] = 'can';
    P.grip[1] = 1;
    P.grip[0] = 0.2;
    P.hy = Math.sin(c.t * 0.0005 + c.seed * 4) * 0.35;
    P.gx = Math.sin(c.t * 0.0005 + c.seed * 4 + 0.4) * 0.6;
    P.hx = -sip * 0.3 + 0.06;
    P.tx = 0.06;
    P.expr = sip > 0.3 ? 'sip' : 'sleepy';
    P.mood = sip > 0.3 ? 'norm' : 'sleep';
    P.ph = cyc(c.t, 2400);
    if ((c.lk?.fatigue ?? 0) > 0.4) P.extra = 'zzz';
    // every third loop: a big stretch and a yawn
    if (n % 3 === 0) {
      const s = kf(u, [
        [0.08, 0],
        [0.2, 1, E.back],
        [0.4, 1],
        [0.5, 0],
      ]);
      if (s > 0) {
        mixArm(P, 0, P.arms[0], [-2.9, 0.45, -0.35], s);
        mixArm(P, 1, P.arms[1], [-2.85, 0.45, -0.6], s);
        P.tx = lerp(P.tx, -0.12, s);
        P.hx = lerp(P.hx, -0.2, s);
        if (s > 0.5) {
          P.expr = 'yawn';
          P.mood = 'sleep';
        }
      }
    }
  },

  wait(P, c) {
    // hands on hips, foot tap, a glance at the wrist
    setArms(P, [0.3, 0.8, -0.1, -1.9]);
    P.grip[0] = P.grip[1] = 1;
    const tap = Math.max(0, Math.sin(c.t * 0.012)) * 0.25;
    setLeg(P, 0, [-tap * 0.4, 0.06, tap]);
    setLeg(P, 1, [0, 0.06, 0.02]);
    const u = cyc(c.t, 4200, c.seed * 600);
    const look = kf(u, [
      [0.55, 0],
      [0.62, 1, E.back],
      [0.82, 1],
      [0.9, 0],
    ]);
    if (look > 0) {
      mixArm(P, 1, P.arms[1], [-1.2, 0.2, -1.6, 0.4, 0.3], look);
      P.hx = 0.3 * look;
      P.gy = 0.7 * look;
    }
    P.expr = 'meh';
    P.hz = Math.sin(c.t * 0.002) * 0.06;
  },

  merge(P, c) {
    const u = cyc(c.t, 1500, c.seed * 200);
    const yank = u < 0.35 ? E.back(u / 0.35) : 1 - E.io((u - 0.35) / 0.65);
    setArm(P, 1, [lerp(-2.55, -1.05, yank), 0.35, lerp(-0.15, -0.6, yank)]);
    setArm(P, 0, [-2.6 + Math.sin(c.t * 0.025) * 0.25, 0.4, -0.6 + Math.sin(c.t * 0.025) * 0.4]);
    P.grip[0] = P.grip[1] = 1;
    P.lift = Math.abs(Math.sin(c.t * 0.009)) * 0.05;
    P.legs[0][2] += yank * 0.2;
    P.legs[1][2] += yank * 0.2;
    P.expr = 'joy';
    P.mood = 'pass';
    P.ph = cyc(c.t, 600);
    P.sparks = aAge(c, 5000) < 3000 ? 0.8 : 0.3;
    P.kick = settle(u * 1500 - 0.35 * 1500, 0.035, 160);
    // a tall robot stands clear of the bell rather than wearing it
    P.offX = -1.25 * big(c) * c.k;
    P.offZ = -0.3 * big(c) * c.k;
  },

  edit(P, c) {
    // sad hunt-and-peck at the production laptop, the odd sigh
    const peck = cyc(c.t, 520, c.seed * 300);
    const hit = kf(peck, [
      [0, 0],
      [0.25, 1, E.out],
      [0.4, 0, E.in],
    ]);
    const which = Math.floor((c.t + c.seed * 300) / 520) % 3 === 0 ? 1 : 0;
    for (let i = 0; i < 2; i++) setArm(P, i, [-0.82, 0.24, -0.95 + (i === which ? hit * 0.18 : 0), 0, 0.15]);
    P.grip[0] = P.grip[1] = 0.6;
    setLegs(P, [0, 0.08, 0.06]);
    const sigh = kf(cyc(c.t, 4600, c.seed * 700), [
      [0, 0],
      [0.1, 1, E.io],
      [0.22, 0, E.io],
    ]);
    P.tx = 0.14 - sigh * 0.08;
    P.hx = 0.34 - sigh * 0.2;
    P.arms[0][1] += sigh * 0.08;
    P.arms[1][1] += sigh * 0.08;
    P.expr = sigh > 0.4 ? 'meh' : 'sad';
    P.gy = 0.6;
    P.mood = 'sleep';
    P.flare = 0.4;
    // hands on the keyboard at any size: the giant stands back and hunches over the little desk
    const B = big(c);
    P.offZ = -0.55 * B * c.k;
    P.tx += 0.5 * B;
    P.hx += 0.25 * B;
    P.offX = 0.3 * B * c.k;
    for (let i = 0; i < 2; i++) reachTo(P, i, (1.04 - (i === which ? hit * 0.035 : 0)) * c.k, 0.41 * c.k);
  },

  'write-tests'(P, c) {
    const age = aAge(c, 5200);
    const fresh = age < 2600;
    const sp = fresh ? 1.7 : 1;
    const T = 8200;
    const sh = c.seed * 700;
    const u = cyc(c.t, T, sh);
    const k = c.t * 0.001 * sp;
    // writing lines (u < 0.62), step back to admire, step in and tap the board twice
    const back = kf(u, [
      [0.62, 0],
      [0.68, 1, E.io],
      [0.84, 1],
      [0.9, 0, E.io],
    ]);
    const writing = back < 0.02 && !(u > 0.84 && u < 0.97);
    if (writing || fresh) {
      const lu = (u < 0.62 ? u / 0.62 : 0) * 3;
      const line = lu % 1;
      const row = Math.floor(lu);
      const ret = line > 0.9 ? E.io((line - 0.9) / 0.1) : 0; // carriage return
      const x = lerp(line, 0, ret);
      setArm(P, 0, [-2.05 - x * 0.3 + row * 0.12 + Math.sin(k * 23) * 0.08, 0.12 + Math.sin(k * 31) * 0.09 - x * 0.18, -0.35 + Math.cos(k * 23) * 0.12]);
      P.offX = -0.18 + x * 0.36;
      P.hx = -0.24 + x * 0.1 + row * 0.06;
      P.gx = -0.5 + x;
      P.gy = -0.3;
      P.lift = Math.abs(Math.sin(k * 9)) * 0.012;
      if (fresh) {
        // dual-wielding: the second marker joins in
        setArm(P, 1, [-1.95 - x * 0.2 + Math.cos(k * 21) * 0.08, 0.2 + Math.sin(k * 27) * 0.08, -0.4 + Math.sin(k * 21) * 0.12]);
        P.held[1] = 'marker';
        P.grip[1] = 1;
        P.expr = 'tongue';
      } else {
        setArm(P, 1, [-0.35, 0.3, -1.25]);
        P.expr = 'focus';
      }
    } else {
      // admire: hands on hips, a satisfied nod; then the double tap
      setArms(P, [0.3, 0.8, -0.1, -1.9]);
      P.offZ = -0.32 * back;
      const nod = Math.sin(span(u, 0.7, 0.82) * PI * 3) * 0.12;
      P.hx = -0.1 + nod;
      P.hz = 0.12 * back;
      P.expr = 'proud';
      if (u > 0.84 && u < 0.97) {
        const tu = span(u, 0.84, 0.97);
        const tap = Math.max(0, Math.sin(tu * PI * 4)) * (tu < 0.5 ? 1 : 0.6);
        setArm(P, 0, [-1.75, 0.15, lerp(-0.9, -0.05, tap)]);
        P.expr = 'determined';
        P.kick = tap * 0.3;
      }
      P.grip[1] = 1;
    }
    P.held[0] = 'marker';
    P.grip[0] = 1;
    P.wrist[0] = -0.5;
    P.tx = 0.06;
    P.hy = -0.1;
    setLegs(P, [0, 0.12, 0.05], [-0.08, 0.1, 0.12]);
    if (writing || fresh) {
      // the marker tip stays on the board: a small robot steps right up to it and writes low, a big one writes high
      const wall = 0.7 * c.k;
      P.offZ = Math.max(0, wall - 0.52);
      const sy = shoulderAt(P)[0];
      const a0 = P.arms[0][0];
      reachTo(P, 0, sy + 0.2 - (a0 + 2.05) * 0.3, wall + Math.cos(k * 23) * 0.006, 0.1);
      if (fresh) reachTo(P, 1, sy + 0.12 + Math.sin(k * 21) * 0.04, wall, 0.1);
    }
    if (back > 0) {
      // step back with a foot lift
      const st = Math.sin(span(u, 0.62, 0.68) * PI) + Math.sin(span(u, 0.84, 0.9) * PI);
      P.legs[1][0] -= st * 0.4;
      P.legs[1][2] += st * 0.7;
    }
  },

  lounge(P, c) {
    // standing at a high-top: sip, hand on hip, weight shift, the odd laugh
    const u = cyc(c.t, 6200, c.seed * 900);
    const sip = Math.sin(span(u, 0.5, 0.82) * PI);
    setArm(P, 1, [lerp(-0.85, -2.2, sip), 0.22, lerp(-1.35, -2.1, sip)]);
    setArm(P, 0, [0.3, 0.8, -0.1, -1.9]);
    P.held[1] = 'cup';
    P.grip[1] = 1;
    P.grip[0] = 1;
    const shift = Math.sin(c.t * 0.0011 + c.seed * 2);
    setLegs(P, [0.05 + shift * 0.04, 0.12, 0.04 + Math.max(0, shift) * 0.15], [-0.12 - shift * 0.04, 0.16, 0.18 + Math.max(0, -shift) * 0.15]);
    P.roll = 0.03 + shift * 0.025;
    P.hx = -sip * 0.3;
    P.hy = Math.sin(c.t * 0.0007 + c.seed * 4) * 0.35;
    P.gx = P.hy;
    const laugh = kf(u, [
      [0.1, 0],
      [0.15, 1, E.back],
      [0.3, 1],
      [0.36, 0],
    ]);
    if (laugh > 0) {
      P.hx -= laugh * 0.2;
      P.tx = -laugh * 0.06 + Math.sin(c.t * 0.05) * 0.015 * laugh;
      P.expr = 'joy';
      P.ph = cyc(c.t, 600);
    } else P.expr = sip > 0.3 ? 'sip' : 'smug';
  },

  'lounge-sit'(P, c) {
    seated(P, c, DIM.seat);
    const u = cyc(c.t, 5400, c.seed * 900);
    const sip = Math.sin(span(u, 0.55, 0.85) * PI);
    setArm(P, 1, [lerp(-0.7, -2.15, sip), 0.25, lerp(-1.4, -2.1, sip)]);
    setArm(P, 0, [0.35, 0.55, -0.4]);
    P.held[1] = 'cup';
    P.grip[1] = 1;
    P.tx = -0.08;
    P.hx = -sip * 0.3;
    P.hy = Math.sin(c.t * 0.0006 + c.seed * 3) * 0.4;
    P.gx = P.hy;
    P.expr = sip > 0.3 ? 'sip' : 'smug';
    P.mood = 'norm';
  },
};

export const KNOWN = new Set(Object.keys(POSES));
