// The gym: room, zones, stations, robots, and how agents move between them.
// Contract (used by web/app.js): createWorld(canvas) -> { renderer, scene, camera,
// update(now, dtMs, views, {snap, global}), resize, anchors, pick, positionOf, reset, render }.
import * as THREE from 'three';
import { PALETTE, mat, part, GEO, rbox, canvasTexture, floorTexture, rubberTexture, concreteTexture, signTexture, neonTexture, decalTexture, boost, zoneTexture, makeEnvironment, mergeStatic, FONT, MONO, F80 } from './materials.js';
import { buildSet80, lights80, paintedSign80, neon80, drawScoreboard80, finishSet80 } from './film80-set.js';
import { lockers, coolant, plant, plateTree, kettlebell, dumbbellRack, rug, towelHook } from './props.js';
import { createRobot } from './robot.js';
import { ZONES, STATIONS, ROOM } from './stations.js';
import { pressPhase } from './rhythm.js';
import { createPost } from './post.js';
import { buildShell } from './env-building.js';
import { buildOutside, SKY } from './env-outside.js';

const PI = Math.PI;
const TRANSIENT = new Set(['fail', 'celebrate', 'slump', 'stalled']);
const TEST_WORK = new Set(['bench', 'coordinated', 'treadmill', 'wobble', 'machine']);
const STEP_OFF = new Set(['treadmill', 'wobble']);
const WALK_SPEED = 4.2;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = F80 ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = F80 ? 0.9 : 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY.horizon);
  scene.fog = F80 ? new THREE.Fog(SKY.haze, 34, 330) : new THREE.Fog(SKY.haze, 80, 200);
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = F80 ? 0.5 : 0.55;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  camera.position.set(18, 26, 30);
  camera.lookAt(-2.6, 0.4, -1.4);

  const post = createPost(renderer, scene, camera);
  const lights = buildLights(scene, post.quality);
  const scoreboard = buildRoom(scene, lights);
  buildZones(scene);
  const stations = buildStations(scene);
  // batch every static mesh built so far (room, zones, equipment); robots come later
  mergeStatic(scene, [...scene.children]);
  if (F80) finishSet80(renderer, scene);
  post.init();

  // ---------- robots ----------
  const robots = new Map(); // agentId -> rec
  // Capture mode keeps every robot alive in a pool (see prewarm) so object creation
  // order, and with it three.js draw-sort tie-breaks, never depends on seek history.
  const pool = new Map(); // agentId -> robot
  let pooled = false;
  let order = 0;
  const raycaster = new THREE.Raycaster();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  // What a robot is built from. If an agent's identity (kit, jersey) arrives after its robot
  // was built, the robot is rebuilt in place so it never keeps wearing a stranger's colours.
  const kitKey = (look) => `${look?.archetype}|${look?.skin}|${look?.vendor ?? ''}|${look?.jersey ?? ''}|${look?.outfit ? `${look.outfit.top},${look.outfit.shorts},${look.outfit.headband},${look.outfit.shoes}` : ''}`;

  function ensure(v) {
    let rec = robots.get(v.id);
    // (capture keeps its prewarmed pool untouched: there every robot wears its final identity from the first frame)
    if (rec && !pooled && rec.kit !== kitKey(v.look)) {
      const old = rec.robot;
      const robot = createRobot(v.look, { helper: !!v.helper });
      robot.root.position.copy(old.root.position);
      robot.root.rotation.copy(old.root.rotation);
      scene.remove(old.root);
      scene.add(robot.root);
      rec.robot = robot;
      rec.kit = kitKey(v.look);
    }
    if (!rec) {
      let robot = pool.get(v.id);
      if (!robot) {
        robot = createRobot(v.look, { helper: !!v.helper });
        scene.add(robot.root);
        if (pooled) pool.set(v.id, robot);
      }
      robot.root.rotation.set(0, 0, 0);
      const idx = order++;
      const home = stations.get('idle').slots[idx % stations.get('idle').slots.length];
      robot.root.position.copy(home.pos);
      rec = { robot, idx, kit: kitKey(v.look), target: home.pos.clone(), yaw: 0, face: 0, speed: 0, lastWork: null, info: { kind: 'idle' } };
      robots.set(v.id, rec);
    }
    return rec;
  }

  /** Preferred slot is idx % n; if taken this frame, the next free one; if all taken, queue. */
  function claim(st, rec, look) {
    const n = st.slots.length;
    // `seats`: the first few slots are the good ones (bar stools) and fill first
    const first = st.def.seats ?? n;
    // `tight`: slots this close together cannot take a big robot next to anybody, so it
    // looks for a slot with free neighbours and keeps them free
    const wide = !!st.def.tight && (look?.height ?? 1) > 1.2;
    const row = st.def.tight ?? 0;
    const free = (j) => j < 0 || j >= row || !st.occ[j];
    let i = rec.idx % first;
    let found = false;
    for (let pass = 0; pass < (wide ? 2 : 1) && !found; pass++) {
      // (a big robot settles for any free slot if no roomy one is left)
      for (let k = 0; k < n; k++) {
        const j = k < first ? (i + k) % first : k;
        if (st.used[j]) continue;
        if (wide && pass === 0 && j < row && !(free(j - 1) && free(j + 1))) continue;
        i = j;
        found = true;
        break;
      }
    }
    if (found) {
      st.used[i] = true;
      if (wide && i < row) {
        if (i > 0) st.used[i - 1] = true;
        if (i + 1 < row) st.used[i + 1] = true;
      }
      return { slot: st.slots[i], index: i, queued: false };
    }
    const q = st.queue++;
    const s = st.slots[0];
    // wait in line beside the first slot
    const off = new THREE.Vector3(1.1 + (q % 3) * 0.6, 0, 0.9 + Math.floor(q / 3) * 0.6).applyAxisAngle(Y, s.yaw);
    return { slot: { pos: s.pos.clone().add(off), yaw: s.yaw }, index: -1, queued: true };
  }

  const pending = [];

  function update(now, dtMs, views, { snap = false, global } = {}) {
    for (const st of stations.values()) {
      st.used.fill(false);
      st.occ.fill(null);
      st.queue = 0;
    }
    const seen = new Set();
    pending.length = 0;

    // pass 1: decide where everyone goes
    for (const v of views) {
      const rec = ensure(v);
      seen.add(v.id);
      let kind = v.kind;
      if (kind === 'bench' && v.look?.machine) kind = 'machine';
      if (kind === 'spotting' && v.parentId && robots.has(v.parentId)) {
        pending.push([v, rec]);
        continue;
      }
      let at = kind;
      if (TRANSIENT.has(kind)) at = rec.lastWork ?? (v.look?.machine ? 'machine' : 'bench');
      else if (TEST_WORK.has(kind)) rec.lastWork = kind;
      if (kind === 'spotting') at = kind = 'idle';
      let st = stations.get(at);
      if (!st) {
        // every non-test activity without its own station (lint, build, git, ci, ...) goes to the juice bar
        st = stations.get('lounge');
        at = kind = 'lounge';
      }
      const c = claim(st, rec, v.look);
      rec.target.copy(c.slot.pos);
      rec.yaw = c.slot.yaw;
      if (c.slot.pose && !TRANSIENT.has(kind)) kind = c.slot.pose;
      const stepOff = TRANSIENT.has(kind) && STEP_OFF.has(at);
      if (stepOff) rec.target.add(tmp.set(0.95, 0, -0.2).applyAxisAngle(Y, c.slot.yaw));
      else if (!c.queued) st.occ[c.index] = { v, robot: rec.robot, kind };
      rec.info.kind = kind;
      rec.info.at = at;
      rec.info.queued = c.queued;
      rec.info.lift = undefined;
      rec.view = v;
    }
    // helpers orbit their parent
    for (const [v, rec] of pending) {
      const p = robots.get(v.parentId);
      const i = v.helperIndex ?? 0;
      const ANG = [1.35, -1.35, 2.2, -2.2, 0.8, -0.8, 2.8, -2.8];
      const a = ANG[i % ANG.length] + p.yaw;
      const r = 1.0 + Math.floor(i / ANG.length) * 0.5;
      rec.target.set(p.target.x + Math.sin(a) * r, 0, p.target.z + Math.cos(a) * r);
      rec.yaw = Math.atan2(p.target.x - rec.target.x, p.target.z - rec.target.z);
      rec.info.kind = 'spotting';
      rec.info.at = 'spotting';
      rec.info.queued = false;
      rec.info.lift = undefined;
      rec.view = v;
    }
    // shared lift for the tandem bar
    const tandem = stations.get('coordinated');
    let lift = 0;
    for (const o of tandem.occ) if (o && o.kind === 'coordinated') lift = Math.max(lift, pressPhase(o.v.repAge, now));

    // pass 2: move and pose
    for (const v of views) {
      const rec = robots.get(v.id);
      const root = rec.robot.root;
      const pos = root.position;
      const d = tmp.copy(rec.target).sub(pos).setY(0);
      const dist = d.length();
      if (dtMs <= 0 && !snap) {
        // zero-length evaluation (capture): pose for `now` without advancing movement
      } else if (snap || dist < 0.02) {
        pos.copy(rec.target);
        rec.speed = 0;
        if (snap) root.rotation.y = rec.yaw;
        rec.face = rec.yaw;
      } else {
        const step = Math.min(dist, (WALK_SPEED * dtMs) / 1000);
        d.normalize();
        pos.addScaledVector(d, step);
        rec.speed = dist > 0.3 ? (step / Math.max(1, dtMs)) * 1000 : 0;
        rec.face = dist > 0.3 ? Math.atan2(d.x, d.z) : rec.yaw;
      }
      let dy = rec.face - root.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      root.rotation.y += snap ? dy : dy * Math.min(1, Math.max(0, dtMs) / 110);
      root.visible = true;
      if (rec.info.kind === 'coordinated') rec.info.lift = lift;
      rec.info.drop = 0;
      const args = (rec.info.args ??= {});
      args.kind = rec.info.kind;
      args.at = rec.info.at;
      args.queued = rec.info.queued;
      args.lift = rec.info.lift;
      args.repAge = v.repAge;
      args.repStatus = v.repStatus;
      args.speed = rec.speed;
      args.selected = v.selected;
      args.act = v.activity ?? null;
      args.wb = v.whiteboard ?? null;
      args.info = rec.info;
      rec.robot.update(v.look, now, args);
    }
    for (const [id, rec] of robots) if (!seen.has(id)) rec.robot.root.visible = false;

    // The tandem bar is one straight bar: the smallest lifter sets its height, and
    // everybody taller brings their hands down to it (two refinement passes, same `now`).
    for (let pass = 0; pass < 2; pass++) {
      let low = Infinity;
      let n = 0;
      for (const o of tandem.occ) {
        if (!o || o.kind !== 'coordinated') continue;
        o.handY = o.robot.handsMid(tmp).y;
        low = Math.min(low, o.handY);
        n++;
      }
      if (n < 2) break;
      for (const o of tandem.occ) {
        if (!o || o.kind !== 'coordinated' || o.handY - low < 0.012) continue;
        const rec = robots.get(o.v.id);
        rec.info.drop = (rec.info.drop ?? 0) + (o.handY - low) / o.robot.scale;
        o.robot.update(o.v.look, now, rec.info.args);
      }
    }

    // pass 3: equipment follows its users
    for (const st of stations.values()) {
      st.units.forEach((u, i) => {
        u.update?.(now, st.occ[i]);
        u.after?.(now, st.occ[i]);
      });
      st.shared?.update?.(now, st.occ);
      st.shared?.after?.(now, st.occ);
    }

    if (global) scoreboard.set(global);
    lights.update(now, camera);
    post.setTime(now);
  }

  function resize(w, h) {
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** Screen-space anchors above each visible robot's head. */
  function anchors(w, h) {
    const out = [];
    for (const [id, rec] of robots) {
      if (!rec.robot.root.visible) continue;
      rec.robot.headWorld(tmp);
      tmp.y += 0.32;
      const world = tmp.clone();
      tmp.project(camera);
      if (tmp.z > 1) continue;
      out.push({ id, x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h, world });
    }
    return out;
  }

  function pick(ndcX, ndcY) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    let best = null;
    for (const [id, rec] of robots) {
      if (!rec.robot.root.visible) continue;
      const hit = raycaster.intersectObjects(rec.robot.pickables, false)[0];
      if (hit && (!best || hit.distance < best.d)) best = { id, d: hit.distance };
    }
    return best?.id ?? null;
  }

  function positionOf(id, target) {
    const rec = robots.get(id);
    return rec ? target.copy(rec.robot.root.position) : null;
  }

  /** World yaw (radians, 0 = facing +z, same convention as rotation.y) the robot's chest and face point along, or null. */
  function facingOf(id) {
    const rec = robots.get(id);
    return rec && rec.robot.root.visible ? rec.robot.root.rotation.y : null;
  }

  // Autofocus for the close-up depth of field: the robot nearest the middle of the frame
  // (a speaking one wins ties by a wide margin), so the face being filmed is the sharp thing.
  const fdir = new THREE.Vector3();
  function autoFocus() {
    camera.getWorldDirection(fdir);
    let best = null;
    let bestScore = 0.16; // about 9 degrees off-axis at most (tangent)
    for (const rec of robots.values()) {
      const r = rec.robot;
      if (!r.root.visible) continue;
      r.headWorld(tmp);
      tmp.y -= 0.4 * r.scale;
      tmp.sub(camera.position);
      const depth = tmp.dot(fdir);
      if (depth < 1) continue;
      const off = Math.sqrt(Math.max(0, tmp.lengthSq() - depth * depth)) / depth;
      const score = off * (rec.view?.look?.speaking ? 0.45 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = depth;
      }
    }
    post.setAutoFocus(best);
  }

  function dropRobot(rec) {
    if (pooled) rec.robot.root.visible = false;
    else scene.remove(rec.robot.root);
  }

  function reset() {
    for (const rec of robots.values()) dropRobot(rec);
    robots.clear();
    order = 0;
  }

  /** Capture: build every robot up front, in the given order, hidden. Appearance depends only on the agent id. */
  function prewarm(list) {
    pooled = true;
    for (const { id, look, helper } of list) {
      if (pool.has(id)) continue;
      const robot = createRobot(look, { helper });
      robot.root.visible = false;
      scene.add(robot.root);
      pool.set(id, robot);
    }
  }

  /**
   * Capture support: the movement state that carries from one update to the next.
   * restore() puts it back and drops robots created since, so a zero-length
   * evaluation at an arbitrary time leaves no trace on the simulation.
   */
  function snapshot() {
    const recs = new Map();
    for (const [id, rec] of robots) {
      const r = rec.robot.root;
      recs.set(id, { x: r.position.x, y: r.position.y, z: r.position.z, ry: r.rotation.y, face: rec.face, speed: rec.speed, lastWork: rec.lastWork });
    }
    return { recs, order };
  }

  function restore(snap) {
    for (const [id, rec] of [...robots]) {
      const s = snap.recs.get(id);
      if (!s) {
        dropRobot(rec);
        robots.delete(id);
        continue;
      }
      rec.robot.root.position.set(s.x, s.y, s.z);
      rec.robot.root.rotation.y = s.ry;
      rec.face = s.face;
      rec.speed = s.speed;
      rec.lastWork = s.lastWork;
    }
    order = snap.order;
  }

  /** Station list for tools such as the pose gallery (not used by the app). */
  function stationInfo() {
    return STATIONS.map((s) => ({ kind: s.kind, name: s.name, zone: s.zone, x: s.slots[0][0], z: s.slots[0][1], yaw: s.slots[0][2] ?? 0, slots: s.slots.length }));
  }

  void tmp2;
  return {
    renderer,
    scene,
    camera,
    update,
    resize,
    anchors,
    pick,
    positionOf,
    facingOf,
    reset,
    prewarm,
    snapshot,
    restore,
    stationInfo,
    render() {
      autoFocus();
      post.render();
    },
    /** Depth-of-field focus distance in metres, or null for automatic (camera ray to chest height). */
    setFocus: post.setFocus,
    /** Render stats for the last frame: quality tier, draw calls, triangles. */
    stats: () => post.info(),
  };
}

const Y = new THREE.Vector3(0, 1, 0);

// ---------- lighting ----------

/** Unit vector toward the sun: high, from the front-left, so it pours through the left windows. */
const SUN = (F80 ? new THREE.Vector3(-0.82, 0.4, -0.13) : new THREE.Vector3(-0.42, 0.78, 0.46)).normalize();
const MOTE_FOCUS = new THREE.Vector3(-10.5, 1.5, 0);

/** Fit an orthographic shadow camera tightly around a world-space box, as seen from the light. */
function fitShadow(light, box) {
  const view = new THREE.Matrix4().lookAt(light.position, light.target.position, Y).invert();
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    v.sub(light.position).applyMatrix4(new THREE.Matrix4().extractRotation(view));
    lo.min(v);
    hi.max(v);
  }
  Object.assign(light.shadow.camera, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: Math.max(0.5, -hi.z - 1), far: -lo.z + 1 });
  light.shadow.camera.updateProjectionMatrix();
}

/** Soft round sprite for dust motes. */
function moteTexture() {
  return canvasTexture(
    32,
    32,
    (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { srgb: false },
  );
}

/** Drifting dust: positions are a pure function of `now`, so capture frames stay reproducible. */
function motes(scene, count, seed, box, { color, size, opacity }, out) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const base = [];
  for (let i = 0; i < count; i++) base.push([box[0] + rnd() * (box[3] - box[0]), box[1] + rnd() * (box[4] - box[1]), box[2] + rnd() * (box[5] - box[2]), rnd() * 100, 0.4 + rnd()]);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: moteTexture(), color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
  pts.frustumCulled = false;
  pts.userData.keep = true;
  pts.renderOrder = 6;
  scene.add(pts);
  out?.push(pts);
  const h = box[4] - box[1];
  return (now) => {
    const t = (now % 10_000_000) / 1000;
    for (let i = 0; i < count; i++) {
      const [x, y, z, ph, sp] = base[i];
      pos[i * 3] = x + Math.sin(t * 0.21 * sp + ph) * 0.18;
      pos[i * 3 + 1] = box[1] + ((((y - box[1] + t * 0.035 * sp + Math.sin(t * 0.5 + ph) * 0.05) % h) + h) % h);
      pos[i * 3 + 2] = z + Math.cos(t * 0.17 * sp + ph * 1.3) * 0.18;
    }
    geo.attributes.position.needsUpdate = true;
  };
}

function buildLights(scene, quality) {
  const { x0, x1, z0, z1, h } = ROOM;
  // sky from above, warm oak bounce from below
  scene.add(F80 ? new THREE.HemisphereLight(0xd2d6c0, 0x7a583a, 0.62) : new THREE.HemisphereLight(0xd6e8ff, 0xd8bf98, 1.05));
  const sun = F80 ? new THREE.DirectionalLight(0xffa85c, 6.5) : new THREE.DirectionalLight(0xffeccc, 3.6);
  const tgt = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
  sun.position.copy(tgt).addScaledVector(SUN, 45);
  sun.target.position.copy(tgt);
  sun.castShadow = true;
  const size = quality === 'low' ? 2048 : 4096;
  sun.shadow.mapSize.set(size, size);
  fitShadow(sun, new THREE.Box3(new THREE.Vector3(x0 - 1.8, -0.4, z0 - 1.8), new THREE.Vector3(x1 + 0.4, h + 0.8, z1 + 0.4)));
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 3.5;
  sun.shadow.blurSamples = 16;
  scene.add(sun, sun.target);
  // bounce off the oak floor and the bright walls, and cool skylight through the back windows
  const bounce = F80 ? new THREE.DirectionalLight(0xff9a55, 0.3) : new THREE.DirectionalLight(0xffdcb0, 0.4);
  bounce.position.set(6, -4, 10);
  scene.add(bounce);
  const sky = F80 ? new THREE.DirectionalLight(0x9fb8c8, 0.3) : new THREE.DirectionalLight(0xc4dcff, 0.55);
  sky.position.set(4, 10, -14);
  scene.add(sky);
  // film80: a ceiling the camera never sees (it only casts shadows), so the sun gets in
  // through the windows alone, and practicals: fluorescent tubes, tungsten, neon
  const practicals = F80 ? lights80(scene, ROOM) : null;
  // the production corner's one bare bulb
  const bulb = new THREE.PointLight(0xffb45a, 2.4, 4.8, 1.5);
  bulb.position.set(-11.1, 2.3, 5.75);
  scene.add(bulb);
  const bulbGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd28a).multiplyScalar(2.2), toneMapped: false });
  // a warm pool of light painted round the bulb on the wall and floor (the point light alone is lost in the daylight)
  const poolTex = canvasTexture(
    128,
    128,
    (g, w, hh) => {
      const grd = g.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,190,110,0.8)');
      grd.addColorStop(0.35, 'rgba(255,170,90,0.3)');
      grd.addColorStop(1, 'rgba(255,160,80,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, hh);
    },
    { srgb: false },
  );
  const pool = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4 });
  for (const [s, p, r] of [
    [[2.6, 2.6, 1], [x0 + 0.05, 2.1, 5.75], [0, PI / 2, 0]],
    [[3.2, 3.2, 1], [-11.0, 0.035, 5.85], [-PI / 2, 0, 0]],
  ]) {
    const m = part(scene, GEO.plane, pool, s, p, { rot: r, cast: false });
    m.renderOrder = 6;
    m.userData.keep = true;
    m.userData.noAO = true;
  }
  // dust in the sun shafts by the left windows, and in the production corner
  const dustPoints = [];
  const dust = [
    motes(scene, 160, 71, [x0 + 0.3, 0.3, z0 + 0.6, x0 + 3.6, 3.6, -1.8], { color: 0xfff1d0, size: 0.045, opacity: 0.6 }, dustPoints),
    motes(scene, 90, 13, [x0 + 0.3, 0.2, 4.5, x0 + 2.9, 2.6, z1 - 0.2], { color: 0xffd9a0, size: 0.05, opacity: 0.7 }, dustPoints),
  ];
  return {
    bulb,
    bulbGlow,
    update(now, cam) {
      // it has been flickering since the last release: an occasional soft dip, never a strobe.
      // Two slow waves (9 s and 3.4 s); the dip eases in and out over a few hundred ms.
      const t = (now % 10_000_000) / 1000;
      const f = Math.sin(t * 0.7) + Math.sin(t * 1.85);
      const dip = Math.min(1, Math.max(0, (f - 1.55) / 0.3));
      const k = 1 - 0.45 * dip * dip * (3 - 2 * dip);
      bulb.intensity = 2.4 * k;
      bulbGlow.color.setHex(0xffd28a).multiplyScalar(0.6 + 1.6 * k);
      pool.opacity = 0.35 + 0.65 * k;
      // motes are sub-pixel from the wide shot and would twinkle: show them only up close
      const near = !cam || cam.position.distanceTo(MOTE_FOCUS) < 20;
      for (const p of dustPoints) p.visible = near;
      if (near) for (const d of dust) d(now);
      practicals?.update(now);
    },
  };
}

// ---------- room ----------

/** Plane on the floor with world-space UVs (one texture repeat per `tile` metres). */
function floorPlane(w, d, x, z, y, material, tile, opts = {}) {
  const geo = new THREE.PlaneGeometry(w, d);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w + x - w / 2) / tile, (uv.getY(i) * d - z - d / 2) / tile);
  const m = new THREE.Mesh(geo, material);
  m.rotation.x = -PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.castShadow = false;
  if (opts.keep) m.userData.keep = true;
  return m;
}

function buildRoom(scene, lights) {
  const { x0, x1, z0, z1 } = ROOM;
  const W = x1 - x0;
  const D = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  // oak floor (texture: 4 m per repeat) on a slab whose cut edge shows at the open front
  const ftex = floorTexture();
  const floorMat = new THREE.MeshStandardMaterial({ map: ftex, bumpMap: ftex.userData.bump, bumpScale: F80 ? 0.7 : 1.4, roughness: F80 ? 0.45 : 0.48, metalness: 0.0, color: 0xffffff, envMapIntensity: F80 ? 0.25 : 0.55 });
  scene.add(floorPlane(W, D, cx, cz, 0, floorMat, 4, { keep: true }));
  // film80: the dark boards make depth ties with the pale slab visible from the wide shot, so the slab is pushed back in depth
  const slabM = F80 ? new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 200 }) : mat(0xd8cdbb, { rough: 0.9 });
  part(scene, GEO.box, slabM, [W + 0.6, 0.12, D + 0.6], [cx - 0.3 + 0.3, -0.065, cz], { cast: false, receive: true });
  part(scene, GEO.box, mat(0xb98a55, { rough: 0.6 }), [W + 0.02, 0.05, 0.04], [cx, -0.02, z1 + 0.02], { cast: false });
  part(scene, GEO.box, mat(0xb98a55, { rough: 0.6 }), [0.04, 0.05, D + 0.02], [x1 + 0.02, -0.02, cz], { cast: false });

  const shell = buildShell(scene, ROOM, SUN);
  buildOutside(scene, ROOM, SUN);
  // invisible shadow caster: the left wall carries on past the open front so the production corner stays in the shade
  const ghost = part(scene, GEO.box, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), [0.3, ROOM.h, 6], [x0 - 0.15, ROOM.h / 2, z1 + 3], { cast: true });
  ghost.userData.keep = true;
  ghost.userData.noAO = true;

  // ---------- signage ----------
  const set80 = F80 ? buildSet80(scene, ROOM) : null;
  const paint = (lines, w, hh, pos, rotY = 0, opts = {}) => {
    const tex = F80 ? paintedSign80(lines, { width: opts.width, height: opts.height, colors: opts.colors80 }) : signTexture(lines, opts);
    const m = part(scene, GEO.plane, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), [w, hh, 1], pos, { rot: [0, rotY, 0], cast: false });
    m.renderOrder = 3;
    return m;
  };
  /** Neon on a dark rounded backing board, standing off the wall on little posts. */
  const neon = (lines, w, hh, pos, rotY, { color, sub, width = 1024, height = 256, board = 0x1d2433 } = {}) => {
    const g = new THREE.Group();
    g.position.set(...pos);
    g.rotation.y = rotY;
    scene.add(g);
    if (board !== null) part(g, rbox(w + 0.22, hh + 0.2, 0.05, 0.06), mat(board, { rough: 0.5, metal: 0.2 }), 1, [0, 0, 0.045], { cast: false });
    const glowK = F80 ? 1.7 : 3;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) part(g, GEO.cylLo, mat(0xc3c9d3, { rough: 0.25, metal: 0.9 }), [0.03, 0.05, 0.03], [sx * (w / 2 - 0.05), sy * (hh / 2 - 0.04), 0.08], { rot: [PI / 2, 0, 0], cast: false });
    const tex = F80 ? neon80(lines, { width, height, color, sub }) : neonTexture(lines, { width, height, color, sub });
    const m = part(g, GEO.plane, boost(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }), glowK), [w, hh, 1], [0, 0, 0.075], { cast: false });
    m.renderOrder = 3;
    m.userData.keep = true;
    return g;
  };
  // back wall, above the test-writing wall
  paint(['WRITE ONE MORE TEST'], 6.0, F80 ? 0.72 : 0.6, [-4.7, F80 ? 3.86 : 3.92, z0 + 0.02], 0, { width: 1536, height: F80 ? 184 : 154, colors: ['#1f2a3a'] });
  // a blue neon underline tube on chrome stand-offs
  const tubeY = F80 ? 3.48 : 3.58;
  const tube = part(scene, GEO.cyl, boost(new THREE.MeshBasicMaterial({ color: F80 ? 0x3fe9ff : 0x3f9bff, toneMapped: false }), 2.2), [0.05, 5.6, 0.05], [-4.7, tubeY, z0 + 0.07], { rot: [0, 0, PI / 2], cast: false });
  tube.userData.keep = true;
  for (const dx of [-2.6, 0, 2.6]) part(scene, GEO.cylLo, mat(0xc3c9d3, { rough: 0.25, metal: 0.9 }), [0.02, 0.07, 0.02], [-4.7 + dx, tubeY, z0 + 0.035], { rot: [PI / 2, 0, 0], cast: false });
  // left wall: the band above the windows, and over the lockers
  paint(['RERUN CARDIO'], 4.4, 0.66, [x0 + 0.02, F80 ? 5.2 : 4.85, -4.9], PI / 2, { width: 1024, height: 154, colors: ['#1f2a3a', '#2f80ed'] });
  if (F80) {
    neon(['NO PAIN,', 'NO COVERAGE'], 2.9, 1.3, [x0, 5.18, 1.35], PI / 2, { color: '#ff3f9a', sub: '#3fe9ff', width: 896, height: 400, board: 0x120d0c });
    neon(['OVERFIT GYM', 'EST. 1984'], 3.2, 1.25, [3.17, 5.22, z0], 0, { color: '#3fe9ff', sub: '#ff3f9a', width: 1024, height: 400, board: 0x120d0c });
  } else neon(['NO PAIN,', 'NO COVERAGE'], 2.7, 1.25, [x0, 4.45, 1.35], PI / 2, { color: '#ff5c8a', sub: '#ff9fb8', width: 768, height: 384 });
  paint(['LOCKER ROOM', 'coolant break'], 2.9, 0.72, [x0 + 0.02, 2.75, 1.35], PI / 2, { width: 1024, height: 256, colors: ['#1f2a3a', '#6b7785'] });

  // the scoreboard billboard: ratio + test lines vs production lines
  const BW = 10.2;
  const BH = 1.5;
  const sbTex = canvasTexture(2048, Math.round((2048 * BH) / BW), null, { aniso: 8 });
  part(scene, rbox(BW + 0.24, BH + 0.24, 0.16, 0.06), mat(0x1b2028, { rough: 0.35, metal: 0.6 }), 1, [-4.7, 5.25, z0 + 0.08], { cast: true });
  for (const s of [-1, 1]) part(scene, GEO.box, mat(0xc3c9d3, { rough: 0.25, metal: 0.9 }), [0.06, 0.3, 0.06], [-4.7 + s * 4.6, 6.0, z0 + 0.06], { cast: false });
  const sbScreen = part(scene, GEO.plane, boost(new THREE.MeshBasicMaterial({ map: sbTex, toneMapped: false }), 2.2), [BW, BH, 1], [-4.7, 5.25, z0 + 0.165], { cast: false });
  sbScreen.userData.keep = true;
  let sbKey = '';
  const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '--');
  const scoreboard = {
    set({ value, sub, testLines, prodLines }) {
      const k = `${value}|${sub}|${testLines}|${prodLines}`;
      if (k === sbKey) return;
      sbKey = k;
      set80?.crt.set({ value, testLines, prodLines });
      sbTex.userData.redraw((c, w, hh) => {
        if (F80) return drawScoreboard80(c, w, hh, { value, sub, testLines, prodLines }, fmt);
        const bg = c.createLinearGradient(0, 0, 0, hh);
        bg.addColorStop(0, '#0e141c');
        bg.addColorStop(1, '#070a0e');
        c.fillStyle = bg;
        c.fillRect(0, 0, w, hh);
        c.fillStyle = 'rgba(255,255,255,0.035)';
        for (let y = 0; y < hh; y += 6) for (let x = 0; x < w; x += 6) c.fillRect(x, y, 2, 2);
        // left: the ratio
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        c.fillStyle = '#ffb238';
        c.font = `800 30px ${FONT}`;
        c.fillText('SCOREBOARD', 30, 46);
        c.fillStyle = '#7cf29a';
        c.shadowColor = '#7cf29a';
        c.shadowBlur = 16;
        c.font = `800 150px ${FONT}`;
        c.fillText(String(value), 30, 196, 560);
        c.shadowBlur = 0;
        c.fillStyle = '#d9e2ea';
        c.font = `600 22px ${MONO}`;
        c.fillText(String(sub), 30, 252, 600);
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(660, 24, 3, hh - 48);
        // right: lines written, tests vs production
        const tl = Number.isFinite(testLines) ? testLines : null;
        const pl = Number.isFinite(prodLines) ? prodLines : null;
        const max = Math.max(1, tl ?? 0, pl ?? 0);
        const bx = 700;
        const bw = w - bx - 250;
        const row = (y, label, n, color) => {
          c.textAlign = 'left';
          c.fillStyle = '#d9e2ea';
          c.font = `800 44px ${FONT}`;
          c.fillText(label, bx, y - 12);
          c.fillStyle = 'rgba(255,255,255,0.08)';
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
        row(100, 'TEST LINES WRITTEN', tl, '#3fd47a');
        row(232, 'PRODUCTION LINES', pl, '#ffb238');
      });
    },
  };
  scoreboard.set({ value: '--', sub: 'waiting for the first rep' });

  // ---------- locker room ----------
  const lk = lockers(7);
  lk.group.position.set(x0 + 0.3, 0, 3.4);
  lk.group.rotation.y = PI / 2;
  scene.add(lk.group);
  const cool = coolant();
  cool.group.position.set(x0 + 0.4, 0, -0.65);
  cool.group.rotation.y = PI / 2;
  scene.add(cool.group);
  const hooks = towelHook();
  hooks.group.position.set(x0 + 0.02, 0, -0.05);
  hooks.group.rotation.y = PI / 2;
  scene.add(hooks.group);

  // ---------- production corner ----------
  buildProdCorner(scene, lights);

  // ---------- greenery and a little decor ----------
  const deco = (obj, x, z, ry = 0) => {
    obj.group.position.set(x, 0, z);
    obj.group.rotation.y = ry;
    scene.add(obj.group);
    return obj;
  };
  deco(plant({ size: 1.2, seed: 1 }), x0 + 0.65, z0 + 0.65);
  deco(plant({ kind: 'snake', size: 1.2, seed: 2 }), -10.2, z0 + 0.55);
  deco(plant({ size: 1.3, seed: 3 }), 1.85, z0 + 0.7);
  deco(plant({ kind: 'snake', size: 1.3, seed: 4 }), x1 - 0.5, z0 + 0.55);
  deco(plant({ size: 1.1, seed: 6 }), -8.3, 3.0);
  deco(plant({ size: 1.0, seed: 7 }), x1 - 0.55, z1 - 0.55);
  deco(plant({ kind: 'snake', size: 1.0, seed: 8 }), -8.6, z1 - 0.45);
  deco(plant({ kind: 'snake', size: 0.9, seed: 11 }), x1 - 0.45, 2.55);
  deco(plateTree(), 2.35, -5.1);
  deco(kettlebell(PALETTE.coral), 2.25, -4.2);
  deco(kettlebell(PALETTE.lime, 0.8), 2.55, -3.95);
  deco(dumbbellRack(4), 2.2, -6.9, 0);

  // lounge rugs
  for (const [x, z, seed] of [
    [-6.5, 6.0, 1],
    [3.75, 6.0, 2],
  ])
    deco(rug(2.8, seed), x, z);
  void shell;
  return scoreboard;
}

/** The dusty, dim corner where production code gets written, by appointment. */
function buildProdCorner(scene, lights) {
  const { x0, z1 } = ROOM;
  const zA = 4.35;
  const dingy = mat(0x8d9183, { rough: 0.95 });
  // partition from the locker room and a dingy paint job on the left wall
  part(scene, GEO.box, dingy, [3.0, 2.7, 0.12], [x0 + 1.5, 1.35, zA], { receive: true });
  part(scene, GEO.box, mat(CUTCOLOR, { rough: 0.85 }), [3.0, 0.03, 0.14], [x0 + 1.5, 2.715, zA], { cast: false });
  part(scene, GEO.box, dingy, [0.02, 2.7, z1 - zA], [x0 + 0.02, 1.35, (zA + z1) / 2], { cast: false, receive: true });
  part(scene, GEO.box, mat(0x6f7364, { rough: 0.9 }), [0.04, 0.14, z1 - zA], [x0 + 0.04, 0.07, (zA + z1) / 2], { cast: false });
  // water stain and peeling patches on the dingy wall
  const stain = canvasTexture(256, 256, (c, w, h) => {
    let s = 17;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 14; i++) {
      const grd = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      grd.addColorStop(0, 'rgba(90,80,50,0.35)');
      grd.addColorStop(1, 'rgba(90,80,50,0)');
      c.save();
      c.translate(40 + rnd() * 180, 10 + rnd() * 120);
      c.scale(10 + rnd() * 40, 20 + rnd() * 70);
      c.fillStyle = grd;
      c.fillRect(-1, -1, 2, 2);
      c.restore();
    }
    for (let i = 0; i < 6; i++) {
      c.fillStyle = 'rgba(235,232,215,0.55)';
      c.beginPath();
      c.ellipse(rnd() * w, 120 + rnd() * 120, 6 + rnd() * 14, 4 + rnd() * 8, rnd() * 3, 0, PI * 2);
      c.fill();
    }
  });
  const sm = part(scene, GEO.plane, new THREE.MeshStandardMaterial({ map: stain, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), [2.6, 2.5, 1], [x0 + 0.035, 1.35, 5.8], { rot: [0, PI / 2, 0], cast: false });
  sm.renderOrder = 2;
  // the gloom: a soft dark falloff over floor and walls away from the bulb
  const gloomTex = canvasTexture(
    256,
    256,
    (c, w, h) => {
      const grd = c.createRadialGradient(w * 0.15, h * 0.5, 10, w * 0.15, h * 0.5, w * 0.95);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.35, 'rgba(14,16,24,0.3)');
      grd.addColorStop(1, 'rgba(14,16,24,0.62)');
      c.fillStyle = grd;
      c.fillRect(0, 0, w, h);
    },
    { srgb: false },
  );
  const gloomM = new THREE.MeshBasicMaterial({ map: gloomTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, fog: false });
  const gf = part(scene, GEO.plane, gloomM, [3.0, z1 - zA, 1], [x0 + 1.5, 0.03, (zA + z1) / 2], { rot: [-PI / 2, 0, 0], cast: false });
  gf.renderOrder = 4;
  gf.userData.noAO = true;
  // and up the two walls of the corner, darkest away from the bulb
  const gw = part(scene, GEO.plane, gloomM, [z1 - zA, 2.7, 1], [x0 + 0.04, 1.35, (zA + z1) / 2], { rot: [0, PI / 2, 0], cast: false });
  gw.renderOrder = 4;
  gw.userData.noAO = true;
  const gp = part(scene, GEO.plane, gloomM, [3.0, 2.7, 1], [x0 + 1.5, 1.35, zA + 0.065], { rot: [0, 0, 0], cast: false });
  gp.renderOrder = 4;
  gp.userData.noAO = true;
  // the crooked sign, on one nail
  const sign = new THREE.Group();
  sign.position.set(x0 + 0.05, 2.15, 5.85);
  sign.rotation.y = PI / 2;
  const board = new THREE.Group();
  board.rotation.z = -0.13;
  sign.add(board);
  const st = canvasTexture(512, 192, (c, w, hh) => {
    c.fillStyle = '#c8b48c';
    c.fillRect(0, 0, w, hh);
    c.fillStyle = 'rgba(90,70,40,0.25)';
    for (let i = 0; i < 9; i++) c.fillRect(0, i * 22 + 4, w, 2);
    c.fillStyle = '#2b2620';
    c.textAlign = 'center';
    c.font = `800 84px ${FONT}`;
    c.fillText('PRODUCTION CODE', w / 2, 96, w - 30);
    c.font = `600 30px ${MONO}`;
    c.fillText('by appointment', w / 2, 152);
  });
  part(board, rbox(1.62, 0.62, 0.04, 0.015), mat(0x8a6a44, { rough: 0.8 }), 1, [0, 0, 0.0]);
  part(board, GEO.plane, new THREE.MeshStandardMaterial({ map: st, roughness: 0.9 }), [1.56, 0.585, 1], [0, 0, 0.022], { cast: false });
  part(sign, GEO.sphereLo, mat(0x555555, { metal: 0.6 }), 0.04, [0, 0.42, 0.03], { cast: false });
  scene.add(sign);
  // the bare bulb on a wall arm, with a frayed cord
  part(scene, GEO.box, mat(0x3a3a3a, { metal: 0.5 }), [1.4, 0.03, 0.03], [x0 + 0.7, 2.75, 5.75], { cast: false });
  part(scene, GEO.cylLo, mat(0x222222), [0.012, 0.32, 0.012], [-11.1, 2.59, 5.75], { cast: false });
  part(scene, GEO.cyl, mat(0x6b5a3a, { metal: 0.6, rough: 0.5 }), [0.05, 0.06, 0.05], [-11.1, 2.42, 5.75], { cast: false });
  const bulb = part(scene, GEO.sphere, lights.bulbGlow, [0.11, 0.14, 0.11], [-11.1, 2.33, 5.75], { cast: false });
  bulb.userData.dyn = true;
  // cobwebs
  const web = canvasTexture(256, 256, (c, w, hh) => {
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 1.6;
    for (let i = 0; i <= 7; i++) {
      const a = (i / 7) * (PI / 2);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a) * w, Math.sin(a) * hh);
      c.stroke();
    }
    for (let r = 24; r < w; r += 26) {
      c.beginPath();
      for (let i = 0; i <= 7; i++) {
        const a = (i / 7) * (PI / 2);
        const rr = r * (i % 2 ? 0.9 : 1);
        if (i === 0) c.moveTo(rr, 0);
        else c.quadraticCurveTo(Math.cos(a - 0.1) * rr * 0.93, Math.sin(a - 0.1) * rr * 0.93, Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.stroke();
    }
  });
  const webM = new THREE.MeshBasicMaterial({ map: web, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  part(scene, GEO.plane, webM, [0.9, 0.9, 1], [x0 + 0.33, 2.38, zA + 0.33], { rot: [0, -PI / 4, PI / 2], cast: false });
  part(scene, GEO.plane, webM, [0.7, 0.7, 1], [x0 + 0.26, 0.3, 6.5], { rot: [0, PI / 2, PI], cast: false });
  part(scene, GEO.plane, webM, [0.6, 0.6, 1], [x0 + 0.45, 2.62, z1 - 0.3], { rot: [PI / 2, 0, -PI / 2], cast: false });
  // a dead plant, of course, and a box of old printouts
  const p = plant({ kind: 'dead', size: 0.9, seed: 4 });
  p.group.position.set(-10.0, 0, 6.8);
  scene.add(p.group);
  const boxM = mat(0xb08f5e, { rough: 0.9 });
  part(scene, rbox(0.5, 0.34, 0.4, 0.02), boxM, 1, [x0 + 0.4, 0.17, 6.75], { rot: [0, 0.2, 0] });
  part(scene, GEO.box, mat(0xeeeae0, { rough: 0.9 }), [0.42, 0.04, 0.32], [x0 + 0.4, 0.35, 6.75], { rot: [0, 0.25, 0], cast: false });
}
const CUTCOLOR = 0x3b3f46;

// ---------- zones ----------

function buildZones(scene) {
  for (const z of ZONES) {
    const [a, b, c, d] = z.rect;
    const w = c - a;
    const dd = d - b;
    if (z.floor === 'rubber' || z.floor === 'concrete') {
      const rubber = z.floor === 'rubber';
      const tex = rubber ? rubberTexture() : concreteTexture();
      const m = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex.userData.bump, bumpScale: rubber ? 0.8 : 0.6, roughness: rubber ? 0.82 : 0.95, color: rubber ? (F80 ? 0x6e6a66 : 0xffffff) : 0xb4b2aa, envMapIntensity: 0.4 });
      scene.add(floorPlane(w, dd, (a + c) / 2, (b + d) / 2, rubber ? 0.016 : 0.006, m, rubber ? 2 : 3));
      if (rubber) {
        // bevelled rubber edge so the mats sit on the oak instead of being painted on it
        const edge = mat(0x262c35, { rough: 0.9 });
        const t = 0.022;
        part(scene, GEO.box, edge, [w, t, 0.04], [(a + c) / 2, t / 2, b], { cast: false, receive: true });
        part(scene, GEO.box, edge, [w, t, 0.04], [(a + c) / 2, t / 2, d], { cast: false, receive: true });
        part(scene, GEO.box, edge, [0.04, t, dd], [a, t / 2, (b + d) / 2], { cast: false, receive: true });
        part(scene, GEO.box, edge, [0.04, t, dd], [c, t / 2, (b + d) / 2], { cast: false, receive: true });
      }
    }
    if (z.label) {
      const m = part(scene, GEO.plane, new THREE.MeshBasicMaterial({ map: zoneTexture(z.name, z.color), transparent: true, depthWrite: false, opacity: 0.8 }), [z.labelW, z.labelW / 8, 1], [z.label[0], 0.022, z.label[1]], { rot: [-PI / 2, 0, z.labelYaw ?? 0], cast: false });
      m.renderOrder = 3;
    }
  }
}

// ---------- stations ----------

function buildStations(scene) {
  const out = new Map();
  for (const def of STATIONS) {
    const zone = ZONES.find((z) => z.id === def.zone);
    const slots = def.slots.map(([x, z, yaw = 0, pose]) => ({ pos: new THREE.Vector3(x, 0, z), yaw, pose }));
    const units = def.unit
      ? slots.map((s, i) => {
          const u = def.unit(i) ?? { group: null };
          if (u.group) {
            u.group.position.copy(s.pos);
            u.group.rotation.y = s.yaw;
            scene.add(u.group);
          }
          return u;
        })
      : [];
    const shared = def.shared ? def.shared(slots) : null;
    if (shared) scene.add(shared.group);
    if (def.label) {
      const [x, z, w = 2, yaw = 0] = def.label;
      // the station name only: the gag does not need a footnote
      const tex = decalTexture(def.name, null, zone?.color ?? 0xffffff);
      const aspect = tex.image.width / tex.image.height;
      const m = part(scene, GEO.plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), [w, w / aspect, 1], [x, 0.026, z], { rot: [-PI / 2, 0, yaw], cast: false });
      m.renderOrder = 3;
    }
    out.set(def.kind, { def, slots, units, shared, used: new Array(slots.length).fill(false), occ: new Array(slots.length).fill(null), queue: 0 });
  }
  return out;
}
