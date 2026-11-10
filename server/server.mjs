// Overfit Gym local server.
//
// - Serves the web app (web/) and the shared core modules (src/core/ at /core/).
// - POST /api/events   accepts normalized events (JSON only, size limited)
// - GET  /api/events   returns the accepted log (for replay on page load)
// - GET  /api/stream   Server-Sent Events: every newly accepted event
// - GET  /api/health   counters for the connection-health indicator
// - GET  /api/config   per-hostname defaults (the art-direction "look")
//
// Security posture: binds to 127.0.0.1 by default, checks Host and Origin
// against an allowlist, never executes anything it receives, and only ever
// writes to one append-only JSONL file in the data directory.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBatch } from '../src/core/events.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 512 * 1024;
const MAX_LOG = 50_000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.jsonl': 'text/plain; charset=utf-8',
};
const STATIC_MOUNTS = [
  ['/core/', path.join(ROOT, 'src/core')],
  ['/replays/', path.join(ROOT, 'replays')], // local replay bundles (?replay=replays/x.jsonl)
  ['/', path.join(ROOT, 'web')],
];

function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function createGymServer(options = {}) {
  const env = { ...loadEnvFile(), ...process.env };
  const host = options.host ?? env.OVERFIT_HOST ?? '127.0.0.1';
  const dataDir = path.resolve(ROOT, options.dataDir ?? env.OVERFIT_DATA_DIR ?? './data');
  const persist = options.persist ?? true;
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(options.allowedHosts ?? (env.OVERFIT_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean))]);

  const log = [];
  const ids = new Set();
  const clients = new Set();
  const stats = { started: Date.now(), accepted: 0, duplicates: 0, rejected: 0, lastEventAt: null };
  const logFile = path.join(dataDir, 'events.jsonl');

  if (persist) {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-MAX_LOG);
      for (const line of lines) {
        try {
          const { events } = normalizeBatch(JSON.parse(line));
          for (const ev of events) if (!ids.has(ev.id)) (ids.add(ev.id), log.push(ev));
        } catch {
          // skip corrupt line
        }
      }
    }
  }

  // Optional per-hostname default look, e.g. OVERFIT_LOOK_HOSTS="gym80s.local=film80".
  // Lets one server show the same data in different art directions under different names.
  const lookByHost = new Map(
    (options.lookHosts ?? env.OVERFIT_LOOK_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim().split('='))
      .filter(([h, l]) => h && /^[a-z0-9-]{1,24}$/.test(l ?? ''))
      .map(([h, l]) => [h.toLowerCase(), l]),
  );

  function hostAllowed(req) {
    const h = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    return allowedHosts.has(h);
  }
  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser clients (reporters, curl)
    try {
      return allowedHosts.has(new URL(origin).hostname.toLowerCase().replace(/^::1$/, '[::1]'));
    } catch {
      return false;
    }
  }

  function send(res, status, body, headers = {}) {
    const json = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(json);
  }

  function accept(events) {
    const fresh = [];
    for (const ev of events) {
      if (ids.has(ev.id)) {
        stats.duplicates++;
        continue;
      }
      ids.add(ev.id);
      log.push(ev);
      fresh.push(ev);
    }
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    if (fresh.length) {
      stats.accepted += fresh.length;
      stats.lastEventAt = Date.now();
      if (persist) fs.appendFileSync(logFile, fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
      const payload = `event: events\ndata: ${JSON.stringify(fresh)}\n\n`;
      for (const c of clients) c.write(payload);
    }
    return fresh.length;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const tooBig = () => Object.assign(new Error('body too large'), { status: 413 });
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) {
        req.resume(); // drain so the 413 can be delivered
        return reject(tooBig());
      }
      let size = 0;
      let over = false;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) over = true; // keep draining, stop buffering
        else chunks.push(chunk);
      });
      req.on('end', () => (over ? reject(tooBig()) : resolve(Buffer.concat(chunks).toString('utf8'))));
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, urlPath) {
    for (const [prefix, dir] of STATIC_MOUNTS) {
      if (!urlPath.startsWith(prefix)) continue;
      let rel;
      try {
        rel = decodeURIComponent(urlPath.slice(prefix.length));
      } catch {
        return send(res, 400, { error: 'bad path encoding' });
      }
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(dir, rel);
      if (!file.startsWith(dir + path.sep)) return send(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const type = MIME[path.extname(file)];
      if (!type) return send(res, 403, { error: 'type not served' });
      const headers = { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' };
      // Byte ranges, so the browser can seek inside audio.
      const size = fs.statSync(file).size;
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (!(start <= end && start < size)) {
          res.writeHead(416, { 'content-range': `bytes */${size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
      return;
    }
    send(res, 404, { error: 'not found' });
  }

  const server = http.createServer(async (req, res) => {
    if (!hostAllowed(req)) return send(res, 421, { error: 'host not allowed' });
    if (!originAllowed(req)) return send(res, 403, { error: 'origin not allowed' });
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname === '/api/config' && req.method === 'GET') {
        const h = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
        return send(res, 200, { look: lookByHost.get(h) ?? null });
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, events: log.length, sse_clients: clients.size, ...stats, now: Date.now() });
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        return send(res, 200, { events: log });
      }
      if (url.pathname === '/api/events' && req.method === 'POST') {
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'content-type must be application/json' });
        const body = await readBody(req);
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          stats.rejected++;
          return send(res, 400, { error: 'invalid JSON' });
        }
        let result;
        try {
          result = normalizeBatch(parsed);
        } catch (err) {
          stats.rejected++;
          return send(res, 400, { error: err.message });
        }
        stats.rejected += result.errors.length;
        const added = accept(result.events);
        return send(res, result.events.length ? 202 : 400, { accepted: added, duplicates: result.events.length - added, errors: result.errors });
      }
      if (url.pathname === '/api/stream' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify({ events: log.length })}\n\n`);
        clients.add(res);
        const beat = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15_000);
        req.on('close', () => {
          clearInterval(beat);
          clients.delete(res);
        });
        return;
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      return send(res, err.status ?? 500, { error: err.status ? err.message : 'internal error' });
    }
  });

  return {
    server,
    log,
    listen(port = Number(options.port ?? env.OVERFIT_PORT ?? 4377)) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    close() {
      for (const c of clients) c.end();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gym = createGymServer();
  const addr = await gym.listen();
  console.log(`${new Date().toISOString()} | INFO | Overfit Gym on http://${addr.address}:${addr.port} (${gym.log.length} events loaded)`);
}
