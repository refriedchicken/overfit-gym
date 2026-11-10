// Deterministic, bounded agent appearance derived from state + time.
// Same inputs always produce the same look; every output is clamped.

import { clamp, fnv1a } from './hash.js';
import { identityFor } from './identity.js';
import { sayTtlMs } from './captions.js';
import { ceremonyHeuristic, testsPerProdLine } from './metrics.js';
import { activityAt, fatigueAt, DEFAULTS } from './reducer.js';

export const BOUNDS = Object.freeze({
  muscle: [0, 1],
  fatigue: [0, 1],
  bicep: [1, 2.8], // scale multiplier for the absurd arms
  chest: [1, 1.55],
  gearSlots: 6,
  height: [0.8, 1.5],
});

/**
 * Gear unlocks, in display order. Each has a rule over agent totals and an
 * honest description of what triggered it.
 */
export const GEAR = Object.freeze([
  { id: 'sweatband', label: 'Sweatband', why: '10+ test executions', test: (t) => t.executions >= 10 },
  { id: 'headphones', label: 'Headphones', why: '3+ test runs', test: (t) => t.runs >= 3 },
  { id: 'wraps', label: 'Wrist wraps', why: '3+ reruns of the same target', test: (t) => t.reruns >= 3 },
  { id: 'chalk', label: 'Chalk cloud', why: '5+ failed executions', test: (t) => t.fail >= 5 },
  { id: 'sleeves', label: 'Knee sleeves', why: '5+ integration-tagged executions (heuristic tag)', test: (t) => t.integration >= 5 },
  { id: 'belt', label: 'Lifting belt', why: '50+ test executions', test: (t) => t.executions >= 50 },
  { id: 'whistle', label: 'Coach whistle', why: 'spawned helper agents', test: (t) => t.spawns >= 1 },
  { id: 'chain', label: 'Participation chain', why: '200+ test executions', test: (t) => t.executions >= 200 },
]);

export const RANKS = Object.freeze([
  { min: 0, title: 'Walk-in' },
  { min: 1, title: 'Regular' },
  { min: 5, title: 'Rep Enthusiast' },
  { min: 20, title: 'Gym Rat' },
  { min: 60, title: 'Overfit Champion' },
]);

// Clanker chassis finishes (robot "skin") and gym outfit palettes.
const SKIN = [0xc9ced6, 0x9aa3b0, 0xe8c07a, 0x7fb3c8, 0xd98c6c, 0xb8a5d9];

export const ARCHETYPES = Object.freeze(['powerbuilder', 'cardio', 'yogi', 'crossfit', 'rookie']);
const SHORTS = [0x1d1f26, 0x26324d, 0x3b2a4d, 0x2c3e2f, 0x4a2b2b, 0x0f3b46];
const HEADBAND = [0xff4d4d, 0xffb238, 0x59f0d2, 0xf15bb5, 0x7cf29a, 0xffffff];
const SHOES = [0xf2f2f2, 0x7cf29a, 0xff6b35, 0x00bbf9, 0xfee440, 0x9b5de5];
const SHIRT = [0x2ec4b6, 0xff6b35, 0x9b5de5, 0x00bbf9, 0xf15bb5, 0xfee440, 0x8ac926, 0xef476f];

function rankFor(ratio) {
  // Rank tracks effort per production line when known, otherwise raw volume / 10.
  const v = ratio.state === 'ok' ? ratio.value : ratio.numerator / 10;
  let title = RANKS[0].title;
  for (const r of RANKS) if (v >= r.min) title = r.title;
  return title;
}

/**
 * Compute the look for one agent at `now`.
 */
export function lookFor(state, agent, now, opts = DEFAULTS) {
  const t = agent.totals;
  const h = fnv1a(agent.id);
  const muscle = clamp(1 - Math.exp(-t.executions / 120), ...BOUNDS.muscle);
  const fatigue = clamp(fatigueAt(agent, now, opts), ...BOUNDS.fatigue);
  const activity = activityAt(state, agent, now, opts);
  const gear = GEAR.filter((g) => g.test(t))
    .slice(0, BOUNDS.gearSlots)
    .map((g) => g.id);
  const ratio = testsPerProdLine({ executions: t.executions, unique: agent.unique.size, diffs: agent.diff ? [agent.diff] : [] });
  // A known model sets the kit colors, the jersey number and the pecking-order size.
  const idn = identityFor(agent.model, agent.id);
  const kit = idn
    ? { top: idn.colors.top, shorts: idn.colors.shorts, headband: idn.colors.headband, shoes: idn.colors.shoes }
    : { top: SHIRT[(h >>> 4) % SHIRT.length], shorts: SHORTS[(h >>> 9) % SHORTS.length], headband: HEADBAND[(h >>> 14) % HEADBAND.length], shoes: SHOES[(h >>> 17) % SHOES.length] };
  const wobble = ((h >>> 12) % 11) / 100; // 0 .. 0.10 of individual variation
  return {
    archetype: ARCHETYPES[(h >>> 20) % ARCHETYPES.length],
    outfit: kit,
    skin: idn ? idn.colors.skin : SKIN[h % SKIN.length],
    shirt: kit.top,
    height: idn ? clamp(idn.scale * (0.98 + wobble * 0.4), ...BOUNDS.height) : 0.95 + wobble, // identity sets the pecking order
    vendor: idn?.vendor ?? null,
    jersey: idn?.version ?? null,
    speaking: !!agent.lastSay && now >= agent.lastSay.ts && now - agent.lastSay.ts < sayTtlMs(agent.lastSay.text),
    muscle,
    fatigue,
    bicep: clamp(1 + muscle * 1.8, ...BOUNDS.bicep),
    chest: clamp(1 + muscle * 0.55, ...BOUNDS.chest),
    slump: fatigue * 0.35, // radians of forward lean
    sweat: Math.round(fatigue * 8),
    gear,
    activity,
    machine: ceremonyHeuristic(agent.diff),
    rank: rankFor(ratio),
    isHelper: !!agent.parent,
  };
}
