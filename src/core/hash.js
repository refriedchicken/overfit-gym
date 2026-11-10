// Small deterministic helpers shared by the browser and Node.
// No dependencies, no platform APIs.

/** FNV-1a 32-bit hash of a string, returned as an unsigned integer. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hex form of fnv1a, zero padded to 8 chars. */
export function hashHex(str) {
  return fnv1a(str).toString(16).padStart(8, '0');
}

/** Seeded PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick from a list, keyed by a string. */
export function pickBy(key, list) {
  return list[fnv1a(key) % list.length];
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const ADJECTIVES = ['Brisk', 'Stoic', 'Chalky', 'Zesty', 'Plucky', 'Sturdy', 'Earnest', 'Dapper', 'Nimble', 'Burly', 'Gritty', 'Jolly'];
const ANIMALS = ['Quokka', 'Marmot', 'Ibis', 'Tern', 'Wombat', 'Otter', 'Heron', 'Lynx', 'Badger', 'Gecko', 'Puffin', 'Tapir'];

/**
 * Pseudonymous, stable display label for an opaque id. The label never
 * contains any part of the input, so it is safe to show for hashed ids.
 */
export function pseudonym(id) {
  const h = fnv1a(id);
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${ANIMALS[(h >>> 8) % ANIMALS.length]}`;
}
