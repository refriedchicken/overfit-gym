// Model identities: who a clanker is, from the model its agent runs on.
//
// A model spec is "vendor:version" (for example "anthropic:5.2"). It never
// contains a family or product name: the version numbers are distinctive enough
// on their own, and the names below are only "adjacent" to each family (writing
// forms, space, noble gases, hitchhiking), so the gym never claims to be official.

import { fnv1a } from './hash.js';

export const SPEC_RE = /^[a-z]{2,12}:\d{1,2}(\.\d{1,2})?$/;

const VENDORS = {
  anthropic: {
    names: ['Saga', 'Ballad', 'Limerick', 'Ode', 'Novella', 'Stanza', 'Parable', 'Elegy', 'Canto', 'Folio', 'Prologue', 'Memoir', 'Epigraph', 'Footnote'],
    // warm orange kit on a cream chassis
    colors: { skin: 0xe9dcc6, top: 0xd97757, shorts: 0x2a211c, headband: 0xd97757, shoes: 0xf4efe6 },
    scale: 1.1,
  },
  openai: {
    names: ['Nova', 'Comet', 'Orbit', 'Quasar', 'Pulsar', 'Nebula', 'Vega', 'Kepler', 'Halley', 'Apogee', 'Zenith', 'Perihelion'],
    // blue kit on a silver chassis
    colors: { skin: 0xd5dde8, top: 0x2f6bff, shorts: 0x16203a, headband: 0xffffff, shoes: 0xe8f0ff },
    scale: 1.0,
  },
  google: {
    names: ['Neon', 'Xenon', 'Krypton', 'Helium', 'Radon', 'Argonaut'],
    // four-color block kit on a white chassis
    colors: { skin: 0xf1f3f4, top: 0x4285f4, shorts: 0xea4335, headband: 0xfbbc05, shoes: 0x34a853 },
    scale: 0.94,
  },
  xai: {
    names: ['Towel', 'Babel', 'Deep Thought', 'Vogon', 'Slartibartfast'],
    // monochrome
    colors: { skin: 0x1d1d1f, top: 0xf2f2f2, shorts: 0x101012, headband: 0xf2f2f2, shoes: 0xf2f2f2 },
    scale: 0.84,
  },
};

// Size is a pecking order by exact version; everything else falls back to the vendor size.
const SCALE = { 'anthropic:5.2': 1.45, 'anthropic:5.5': 1.28, 'openai:6': 1.14, 'openai:6.1': 1.04, 'google:4': 0.94, 'xai:4.7': 0.84 };

export const SCALE_BOUNDS = Object.freeze([0.8, 1.45]);

/**
 * Normalize a raw model id from telemetry (for example a session's model
 * string) into a spec, or null when the vendor can't be recognized.
 */
export function parseModelId(raw) {
  if (typeof raw !== 'string' || raw.length > 80) return null;
  const s = raw.toLowerCase();
  let vendor = null;
  if (/claude|fable|opus|sonnet|haiku/.test(s)) vendor = 'anthropic';
  else if (/gpt|codex|openai|^o\d/.test(s)) vendor = 'openai';
  else if (/gemini|antigravity/.test(s)) vendor = 'google';
  else if (/grok/.test(s)) vendor = 'xai';
  if (!vendor) return null;
  // the last "major[.-]minor" (or lone major) that looks like a version, ignoring dates
  const body = s.replace(/\b20\d{6}\b/g, '').replace(/\[[^\]]*\]/g, '');
  const m = [...body.matchAll(/(?<![\d.])(\d{1,2})(?:[.-](\d{1,2}))?(?![\d])/g)].pop();
  if (!m) return null;
  let version = m[2] !== undefined ? `${Number(m[1])}.${Number(m[2])}` : `${Number(m[1])}`;
  // family words that imply a point release when the id leaves it out
  if (vendor === 'openai' && version === '6' && /sol/.test(s)) version = '6.1';
  const spec = `${vendor}:${version}`;
  return SPEC_RE.test(spec) ? spec : null;
}

/**
 * Identity for an agent. `spec` may be null (unknown model): then there is no
 * identity and the caller keeps its neutral defaults.
 */
export function identityFor(spec, agentId) {
  if (typeof spec !== 'string' || !SPEC_RE.test(spec)) return null;
  const [vendor, version] = spec.split(':');
  const v = VENDORS[vendor];
  if (!v) return null;
  const name = v.names[fnv1a(String(agentId)) % v.names.length];
  return {
    spec,
    vendor,
    version,
    name,
    label: `${name} ${version}`,
    scale: Math.max(SCALE_BOUNDS[0], Math.min(SCALE_BOUNDS[1], SCALE[spec] ?? v.scale)),
    colors: v.colors,
  };
}

/** Vendor of a spec, or null. Used for banter rules: nobody ribs their own family. */
export function vendorOf(spec) {
  return typeof spec === 'string' && SPEC_RE.test(spec) ? spec.split(':')[0] : null;
}
