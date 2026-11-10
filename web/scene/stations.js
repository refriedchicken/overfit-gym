// Station registry and gym layout. The floor is a daylit boutique gym that is
// overwhelmingly devoted to tests; production code gets one dusty corner and
// everything else an agent does happens at the juice bar.
import * as U from './props.js';

const PI = Math.PI;

/** Room bounds (metres). The camera looks in from the open +x/+z corner. */
export const ROOM = { x0: -12.5, x1: 8.6, z0: -8.2, z1: 7.2, h: 6.2 };

/**
 * Themed zones: floor rectangles [x0, z0, x1, z1].
 * floor: 'rubber' | 'oak' | 'concrete' (oak = no overlay).
 */
export const ZONES = [
  { id: 'test', name: 'TEST WING', color: 0x2f80ed, rect: [-12.5, -8.2, 8.6, 1.35], floor: 'oak', label: [-3.9, -1.05], labelW: 6.4 },
  { id: 'press', name: '', color: 0x2f80ed, rect: [-9.35, -4.25, 1.95, -2.3], floor: 'rubber' },
  { id: 'cardio', name: '', color: 0x2f80ed, rect: [-12.5, -6.95, -10.15, -1.85], floor: 'rubber' },
  { id: 'right', name: '', color: 0x2f80ed, rect: [2.75, -3.75, 8.6, 1.05], floor: 'rubber' },
  { id: 'lounge', name: 'JUICE BAR', color: 0xff8a5c, rect: [-8.2, 2.3, 5.6, 7.2], floor: 'oak' },
  { id: 'locker', name: 'LOCKER ROOM', color: 0x9aa7b4, rect: [-12.5, -1.0, -9.4, 3.95], floor: 'oak' },
  { id: 'prod', name: 'PRODUCTION CODE', color: 0x8a8f86, rect: [-12.5, 4.35, -9.5, 7.2], floor: 'concrete' },
];

const row = (n, x0, dx, z, yaw = 0) => Array.from({ length: n }, (_, i) => [x0 + i * dx, z, yaw]);

/**
 * kind: station key the world routes a view to. slots: [x, z, yaw, pose?] robot spots
 * (pose overrides the robot pose for that slot, used by the lounge).
 * unit(i): equipment per slot (robot-local frame). shared(slots): station-wide equipment.
 * label: [x, z, width, yaw] floor decal (omitted = no decal).
 */
export const STATIONS = [
  // ---------- TEST WING ----------
  {
    kind: 'write-tests',
    name: 'TEST-WRITING WALL',
    sub: "it('works') · it('still works')",
    zone: 'test',
    slots: row(4, -8.5, 2.6, -7.25, PI),
    unit: (i) => U.writeWallUnit(i),
  },
  { kind: 'bench', name: 'ASSERTION PRESS', sub: '1 rep = 1 test case', zone: 'test', slots: row(5, -8.2, 2.2, -3.3), unit: U.pressUnit, label: [-0.2, -1.85, 2.6] },
  { kind: 'treadmill', name: 'WHITEBOARD TREADMILLS', sub: 'rerun, no code change', zone: 'test', slots: [-5.95, -4.25, -2.55].map((z) => [-11.2, z, -PI / 2]), unit: U.treadmillUnit },
  { kind: 'wobble', name: 'FLAKY SLOT MACHINE', sub: 'fail, fail, pass', zone: 'test', slots: row(3, 4.0, 1.8, -2.85, -PI / 2), unit: U.slotUnit, label: [5.75, -1.55, 2.6] },
  { kind: 'machine', name: 'THE MACHINE', sub: 'heuristic: ceremony', zone: 'test', slots: [[5.5, -6.2, -0.3]], unit: U.machineUnit },
  { kind: 'coordinated', name: 'INTEGRATION TANDEM LIFT', sub: 'integration / e2e', zone: 'test', slots: row(3, 3.6, 1.5, 0.25), shared: U.tandemStation, label: [5.1, 1.75, 2.8] },
  // ---------- PRODUCTION CODE (one dusty desk, queue forms beside it) ----------
  { kind: 'edit', name: 'PRODUCTION CODE', sub: 'by appointment', zone: 'prod', slots: [[-11.35, 5.55, 0.95]], unit: U.prodDeskUnit },
  // ---------- JUICE BAR (every other activity) ----------
  {
    kind: 'lounge',
    name: 'JUICE BAR',
    sub: 'lint · build · git · ci · everything else',
    zone: 'lounge',
    slots: [
      ...row(4, -3.75, 1.15, 4.35, 0).map((s) => [...s, 'lounge-sit']),
      [-6.5, 5.45, 0, 'lounge'],
      [-6.5, 6.6, PI, 'lounge'],
      [3.75, 5.45, 0, 'lounge'],
      [3.75, 6.6, PI, 'lounge'],
    ],
    seats: 4,
    tight: 4,
    unit: (i) => (i < 4 ? U.stoolUnit() : i % 2 === 0 ? U.highTableUnit() : null),
    shared: U.juiceBar,
  },
  { kind: 'merge', name: 'PR BELL', sub: 'gh pr merge', zone: 'lounge', slots: [[1.35, 4.3, 0]], unit: U.bellUnit },
  // ---------- LOCKER ROOM ----------
  { kind: 'idle', name: 'LOCKER ROOM', sub: 'coolant break', zone: 'locker', tight: 4, slots: [0.1, 1.0, 1.9, 2.8].map((z) => [-11.25, z, PI / 2]), unit: U.seatUnit },
];

export const STATION_BY_KIND = new Map(STATIONS.map((s) => [s.kind, s]));
