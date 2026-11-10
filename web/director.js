// Camera: user orbit, follow-selected, and a deterministic cinematic director.
// Director shots are a pure function of the playhead and the caption
// timeline, so the same replay yields the same camera moves.
import * as THREE from 'three';

const CENTER = new THREE.Vector3(0.9, 0.4, -2.0);
const HOME = { yaw: 0.6, elev: 0.66, radius: 43.5 };
const SHOT_MS = 6500;

export function createDirector(world, canvas) {
  const cam = world.camera;
  const orbit = { ...HOME, target: CENTER.clone() };
  const goal = { yaw: orbit.yaw, elev: orbit.elev, radius: orbit.radius, target: CENTER.clone() };
  let mode = 'orbit'; // 'orbit' | 'director'
  let follow = null;
  let dragging = null;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    if (mode !== 'orbit') return;
    goal.yaw -= dx * 0.005;
    goal.elev = Math.min(1.35, Math.max(0.18, goal.elev + dy * 0.004));
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = dragging && !dragging.moved;
    dragging = null;
    if (wasClick) canvas.dispatchEvent(new CustomEvent('gym-click', { detail: { x: e.offsetX, y: e.offsetY } }));
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (mode !== 'orbit') return;
      goal.radius = Math.min(60, Math.max(7, goal.radius * (1 + Math.sign(e.deltaY) * 0.08)));
    },
    { passive: false },
  );

  function place(o) {
    cam.position.set(
      o.target.x + Math.sin(o.yaw) * Math.cos(o.elev) * o.radius,
      o.target.y + Math.sin(o.elev) * o.radius,
      o.target.z + Math.cos(o.yaw) * Math.cos(o.elev) * o.radius,
    );
    cam.lookAt(o.target);
  }

  const tmp = new THREE.Vector3();

  /** Deterministic shot for time `now`. */
  function shotAt(now, t0, focusId) {
    const i = Math.floor((now - t0) / SHOT_MS);
    const u = ((now - t0) % SHOT_MS) / SHOT_MS;
    const type = ['wide', 'focus', 'low', 'focus', 'sweep'][((i % 5) + 5) % 5];
    const target = CENTER.clone();
    if (type !== 'wide' && type !== 'sweep' && focusId && world.positionOf(focusId, tmp)) target.copy(tmp).setY(1.0);
    switch (type) {
      case 'wide':
        return { yaw: 0.5 + u * 0.3, elev: 0.64, radius: 38 - u * 4, target };
      case 'focus':
        return { yaw: 0.35 + Math.sin(i) * 0.4 + u * 0.25, elev: 0.62, radius: 11 - u * 1.5, target };
      case 'low':
        return { yaw: -0.25 + u * 0.5, elev: 0.48, radius: 9, target };
      default:
        return { yaw: 1.1 - u * 0.9, elev: 0.48, radius: 18, target: new THREE.Vector3(-4 + u * 9, 0.8, -3.5) };
    }
  }

  // ---------- cue sheet: hard cuts on scripted times ----------
  let cues = null;

  /** Shot for a scripted cue. `u` is 0..1 progress to the next cue; `len` its length in s. */
  function cueShot(cue, u, len) {
    const target = CENTER.clone();
    const has = cue.agent && world.positionOf(cue.agent, tmp);
    if (has) target.copy(tmp).setY(Math.max(0.9, (cue.height ?? 1) * 1.05));
    // a slow push or drift, scaled so long shots don't travel further than short ones
    const d = Math.min(1, len / 6) * u;
    // Shoot the face: a three-quarter view from in front of the robot when the world
    // knows which way it faces. Robots working at a wall get a side angle instead.
    const facing = has && typeof world.facingOf === 'function' ? world.facingOf(cue.agent) : null;
    let side = cue.yaw ?? 0.42;
    if (facing !== null && cue.yaw === undefined) {
      const lean = cue.agent.length % 2 ? 0.5 : -0.5; // alternate sides per robot, stable
      const front = facing + lean;
      // never put the camera behind the back or left walls: keep it inside the open side of the room
      // The room is cut away toward +x and +z, so the camera must stay in that quadrant:
      // any other direction puts it behind the back or left wall.
      const open = Math.atan2(Math.sin(front - HOME.yaw), Math.cos(front - HOME.yaw));
      side = Math.max(0.08, Math.min(1.42, HOME.yaw + open));
    }
    // the dashboard shot: the app's own framing, sized to sit between the side panels
    if (cue.hud) return { yaw: HOME.yaw - 0.04 + d * 0.08, elev: HOME.elev, radius: HOME.radius - d * 2, target };
    switch (has ? cue.shot : cue.shot === 'sweep' ? 'sweep' : 'wide') {
      case 'close':
        return { yaw: side + d * 0.12, elev: 0.3, radius: 6.4 - d * 0.7, target };
      case 'focus':
        return { yaw: side + d * 0.2, elev: 0.5, radius: 10.5 - d * 1.4, target };
      case 'low':
        return { yaw: -0.22 + d * 0.4, elev: 0.14, radius: 8.2 - d * 0.6, target };
      case 'orbit':
        return { yaw: side - 0.5 + d * 1.1, elev: 0.36, radius: 9, target };
      case 'sweep':
        return { yaw: 1.05 - d * 0.8, elev: 0.44, radius: 19, target: new THREE.Vector3(-4 + d * 9, 0.9, -3.5) };
      default:
        return { yaw: HOME.yaw - 0.1 + d * 0.22, elev: 0.6, radius: 37 - d * 3.5, target };
    }
  }

  function activeCue(tSec) {
    let lo = 0;
    let hi = cues.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cues[mid].t <= tSec) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  return {
    /** The scripted cue active at `now`, or null. */
    cueAt(now, t0) {
      return cues ? cues[activeCue((now - t0) / 1000)] : null;
    },
    /** Install a cue sheet [{ t (s), shot, agent? }] sorted by t, or null to return to the automatic director. */
    setCues(list, endSec = 0) {
      cues = list && list.length ? list.map((c, i) => ({ ...c, end: list[i + 1]?.t ?? endSec })) : null;
    },
    get mode() {
      return mode;
    },
    setMode(m) {
      mode = m;
    },
    follow(id) {
      follow = id;
      if (id) goal.radius = Math.min(goal.radius, 14);
    },
    get following() {
      return follow;
    },
    reset() {
      Object.assign(goal, HOME);
      goal.target.copy(CENTER);
      follow = null;
    },
    get dragging() {
      return !!dragging?.moved;
    },
    update(now, t0, dtMs, focusId) {
      if (mode === 'director') {
        let s;
        if (cues) {
          const tSec = (now - t0) / 1000;
          const cue = cues[activeCue(tSec)];
          const len = Math.max(0.5, cue.end - cue.t);
          s = cueShot(cue, Math.min(1, Math.max(0, (tSec - cue.t) / len)), len);
        } else s = shotAt(now, t0, focusId);
        place(s);
        Object.assign(orbit, { yaw: s.yaw, elev: s.elev, radius: s.radius });
        orbit.target.copy(s.target);
        return;
      }
      if (follow && world.positionOf(follow, tmp)) goal.target.copy(tmp).setY(0.9);
      else if (!follow) goal.target.lerp(CENTER, 0.05);
      const k = Math.min(1, dtMs / 160);
      orbit.yaw += (goal.yaw - orbit.yaw) * k;
      orbit.elev += (goal.elev - orbit.elev) * k;
      orbit.radius += (goal.radius - orbit.radius) * k;
      orbit.target.lerp(goal.target, k);
      place(orbit);
    },
  };
}
