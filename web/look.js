// Which art direction to render. One codebase, several looks:
//   film80   a 1980s gym shot on 35mm film (the standard look)
//   default  the bright daytime gym (?look=default)
// Resolution order: ?look=NAME in the URL, then the server's per-hostname default
// (/api/config), then film80. Resolved once at load so every scene module agrees,
// and so capture mode stays deterministic.

export const LOOKS = Object.freeze(['default', 'film80']);

async function resolve() {
  if (typeof location === 'undefined') return 'film80';
  const q = new URLSearchParams(location.search).get('look');
  if (LOOKS.includes(q)) return q;
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    const { look } = await r.json();
    if (LOOKS.includes(look)) return look;
  } catch {
    /* no server config: standard look */
  }
  return 'film80';
}

export const LOOK = await resolve();
if (typeof document !== 'undefined') document.documentElement.dataset.look = LOOK;
