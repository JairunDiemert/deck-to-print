/* Builds data/precons.json: which official preconstructed Commander deck goes with which commander.
   The data is MTGJSON's open deck data (https://mtgjson.com/data-models/deck/, MIT licence).
   Deck files are kept in .cache/mtgjson so a second run only fetches decks that are new.

   Run: node tools/precons.mjs            (then: npm run build) */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = process.env.MTGJSON_CACHE || path.join(root, '.cache', 'mtgjson');
const BASE = 'https://mtgjson.com/api/v5/';
const AGENT = 'deck-to-print index build (github.com/JairunDiemert/deck-to-print)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function load(rel, fresh) {
  const file = path.join(cache, rel);
  if (!fresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const res = await fetch(BASE + rel, { headers: { 'User-Agent': AGENT } });
  if (!res.ok) throw new Error('Could not fetch ' + rel + ' (' + res.status + ')');
  const text = await res.text();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  await sleep(150);
  return JSON.parse(text);
}

const list = await load('DeckList.json', process.argv.includes('--refresh'));
const wanted = list.data.filter((d) => d.type === 'Commander Deck' && /^[A-Za-z0-9_]+$/.test(d.fileName));
const decks = [];
const skipped = [];
for (const d of wanted) {
  const deck = (await load('decks/' + d.fileName + '.json')).data;
  const commanders = (deck.commander || []).map((c) => c.name);
  const size = (deck.commander || []).concat(deck.mainBoard || []).reduce((n, c) => n + (c.count || 1), 0);
  if (!commanders.length || size < 60) { skipped.push(d.fileName + ' (' + commanders.length + ' commanders, ' + size + ' cards)'); continue; }
  decks.push({ file: d.fileName, name: d.name, code: d.code, date: d.releaseDate || '', commanders, size });
}

/* The same deck is often listed more than once: a Collector's Edition with the same cards, or a later
   reprint in an anthology. Keep one: the regular edition, from its first release. */
const collectors = /\s*Collector['\u2019]s Edition\s*/i;
const best = new Map();
for (const d of decks) {
  const key = d.name.replace(collectors, ' ').replace(/\s+/g, ' ').trim().toLowerCase() + '|' + d.commanders.join('|');
  const seen = best.get(key);
  const rank = (x) => (collectors.test(x.name) ? '1' : '0') + x.date;
  if (!seen || rank(d) < rank(seen)) best.set(key, d);
}
const kept = Array.from(best.values());
kept.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));

const out = { source: 'MTGJSON', version: list.meta.date, decks: kept.map((d) => [d.file, d.name, d.code, d.date, d.commanders, d.size]) };
await mkdir(path.join(root, 'data'), { recursive: true });
await writeFile(path.join(root, 'data', 'precons.json'), JSON.stringify(out) + '\n');
console.log('decks in MTGJSON:', wanted.length, '| kept:', kept.length, '| skipped:', skipped.length ? skipped.join('; ') : 'none');
console.log('commanders covered:', new Set(kept.flatMap((d) => d.commanders)).size, '| data version', list.meta.date);
