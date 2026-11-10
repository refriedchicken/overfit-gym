// Export a replay bundle (JSONL) and optional recap card, local files only.
//
//   node scripts/export-replay.mjs --seed 7 --out replays/demo-7.jsonl
//   node scripts/export-replay.mjs --in data/events.jsonl --out replays/live.jsonl
//   node scripts/export-replay.mjs --verify replays/demo-7.jsonl
//   add --recap replays/demo-7.html to also write the recap card
//
// --in reads one event per line (the server's data/events.jsonl) and exports it
// as a LIVE replay. Without --in, the seeded synthetic demo is exported.

import fs from 'node:fs';
import path from 'node:path';
import { generateDemo } from '../src/core/demo.js';
import { exportReplay, importReplay, computeRecap, renderRecapHtml } from '../src/core/replay-export.js';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const log = (lvl, msg) => console.log(`${new Date().toISOString()} | ${lvl} | ${msg}`);
const fail = (msg) => {
  log('ERROR', msg);
  process.exit(1);
};

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, text);
}

try {
  const verify = arg('--verify');
  let bundle;
  if (verify) {
    bundle = importReplay(fs.readFileSync(verify, 'utf8'));
    log('INFO', `verified ${bundle.header.eventCount} events, ${bundle.header.source}, hash ${bundle.header.stateHash}`);
  } else {
    const out = arg('--out');
    if (!out) fail('usage: export-replay.mjs [--seed N | --in events.jsonl] --out file.jsonl [--recap file.html] | --verify file.jsonl');
    const input = arg('--in');
    let text;
    if (input) {
      const events = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      text = exportReplay(events.flat(), { seed: null, source: 'live' });
    } else {
      const seed = Number(arg('--seed') ?? 7);
      if (!Number.isInteger(seed) || seed < 1 || seed > 99999) fail('--seed must be an integer 1..99999');
      text = exportReplay(generateDemo(seed), { seed, source: 'synthetic' });
    }
    writeFile(out, text);
    bundle = importReplay(text);
    log('INFO', `wrote ${out} (${bundle.header.eventCount} events, ${bundle.header.source}, hash ${bundle.header.stateHash})`);
  }
  const recapOut = arg('--recap');
  if (recapOut) {
    writeFile(recapOut, renderRecapHtml(computeRecap(bundle)));
    log('INFO', `wrote recap card ${recapOut}`);
  }
} catch (err) {
  fail(err.message);
}
