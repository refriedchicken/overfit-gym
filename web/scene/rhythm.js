// Shared timing and equipment dimensions. Robot poses and station props both
// read these so a lever, bar or pedal moves in step with the robot using it.

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const ease = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
/** 0..1 sawtooth with the given period (ms). */
export const cyc = (now, period, offset = 0) => ((((now + offset) / period) % 1) + 1) % 1;
/** 0..1..0 smooth pump with the given period. */
export const pump = (now, period, offset = 0) => 0.5 - 0.5 * Math.cos(cyc(now, period, offset) * Math.PI * 2);
/** Sub-range of a cycle mapped to 0..1. */
export const span = (u, a, b) => clamp01((u - a) / (b - a));

/** Overhead press phase: 0 = racked at the shoulders, 1 = locked out. */
export const REP_MS = 900;
export function pressPhase(repAge, now) {
  if (repAge !== null && repAge !== undefined && repAge < REP_MS) return Math.sin((repAge / REP_MS) * Math.PI);
  return 0.06 + Math.sin(now * 0.003) * 0.03;
}

/** Flaky slot machine: lever pull, three reels stop red, red, green. */
export const SLOT_MS = 3400;
export const SLOT = { reach: 0.1, pull: 0.3, spinStart: 0.3, stops: [0.52, 0.64, 0.78], win: 0.8 };

/** Equipment dimensions robots are posed against (robot-local metres). */
export const DIM = {
  seat: 0.45, // locker bench, reading stool
  deck: 0.2, // treadmill belt height
  boardZ: 0.78, // whiteboard distance in front of a treadmill runner
  pullBar: 2.08,
  dipBar: 1.0,
  dipHalf: 0.42,
  bikeSeat: 0.82,
  rowSeat: 0.3,
  boxH: 0.6,
  boxZ: 0.8,
  scaleH: 0.1,
  benchTop: 0.45,
  laptopY: 1.02,
  pulldownSeat: 0.48,
};

/** Activity age with a looping fallback when no activity record is present. */
export function actAge(activity, now, period = 4000) {
  if (activity && Number.isFinite(activity.ageMs)) return activity.ageMs;
  return cyc(now, period) * period;
}
