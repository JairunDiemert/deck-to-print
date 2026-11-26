/* Live check of the whole import path: real export files captured from Archidekt's own Export dialog are
   pasted into the real page, looked up on the real Scryfall, and compared with what Archidekt's API says
   each card is (it records the exact Scryfall id of every printing).
   Run: NODE_PATH=/opt/npm-tools/node_modules node test/live/import-live.cjs */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const C = require('../../src/core.js');

const PAGE = 'file://' + path.resolve(__dirname, '../../docs/index.html');
const SAMPLES = path.resolve(__dirname, 'samples');
const deckFile = (id) => path.join(SAMPLES, 'archidekt-' + id + '.json');   // saved by capture-archidekt.cjs

function truthFor(deckId) {
  const d = JSON.parse(fs.readFileSync(deckFile(deckId), 'utf8'));
  const out = new Set(d.categories.filter((c) => !c.includedInDeck).map((c) => c.name));
  return d.cards.map((c) => ({
    name: c.card.oracleCard.name,
    uid: c.card.uid,
    set: c.card.edition.editioncode,
    cn: String(c.card.collectorNumber),
    qty: c.quantity,
    inDeck: !(c.categories && c.categories.length && out.has(c.categories[0]))
  }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const files = fs.readdirSync(SAMPLES).filter((f) => /^archidekt-\d+-.*\.txt$/.test(f)).sort();
  let bad = 0;
  const pages = {};
  for (const f of files) {
    const m = /^archidekt-(\d+)-(.*)\.txt$/.exec(f);
    const deckId = m[1], format = m[2];
    const truth = truthFor(deckId);
    const byName = new Map(truth.map((t) => [C.normName(t.name), t]));
    if (!pages[deckId]) { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); pages[deckId] = await ctx.newPage(); await pages[deckId].goto(PAGE); }
    const page = pages[deckId];
    await page.fill('#deckA', fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
    await page.fill('#deckB', '');
    const t0 = Date.now();
    await page.click('#find');
    await page.waitForFunction(() => !document.getElementById('find').disabled, null, { timeout: 180000 });
    const ms = Date.now() - t0;
    const res = await page.evaluate(() => {
      const s = window.__dtp.state;
      return {
        status: document.getElementById('status').textContent,
        headings: s.decks[0].headings || [],
        slots: s.plan ? s.plan.slots.length : 0,
        entries: s.decks[0].map((e) => ({ name: e.name, qty: e.qty, set: e.set, cn: e.cn, section: e.section, status: e.status, card: e.card ? { id: e.card.id, name: e.card.name, set: e.card.set, cn: e.card.collector_number, faces: e.card.faces.length, layout: e.card.layout } : null }))
      };
    });
    const included = res.entries.filter((e) => e.section !== 'maybe');
    const qty = included.reduce((n, e) => n + e.qty, 0);
    const notFound = included.filter((e) => e.status !== 'ok');
    let exact = 0, sameCard = 0, wrongCard = [], unknown = [];
    included.forEach((e) => {
      if (!e.card) return;
      /* a deck can hold several printings of one card (four different Plains), so match on the printing first */
      const t = truth.find((x) => C.normName(x.name) === C.normName(e.name) && e.set === x.set && String(e.cn) === x.cn) ||
        byName.get(C.normName(e.name)) || truth.find((x) => C.normName(x.name.split(' // ')[0]) === C.normName(e.name));
      if (!t) { unknown.push(e.name); return; }
      if (e.card.id === t.uid) exact++;
      if (C.normName(e.card.name) === C.normName(t.name)) sameCard++; else wrongCard.push(e.name + ' -> ' + e.card.name);
    });
    const hasPrintings = /default|header-category|header-type|header-generic$|front-only|no-maybe/.test(format) && !/plain/.test(format);
    /* A plain list with no headings cannot say which cards are maybeboard, so those come through.
       Archidekt's Arena export leaves the maybeboard out by itself. */
    const expectQty = truth.filter((t) => t.inDeck || /text-plain$/.test(format)).reduce((n, t) => n + t.qty, 0);
    const maybeSeen = res.entries.filter((e) => e.section === 'maybe').length;
    const dfcSlots = included.filter((e) => e.card && e.card.faces === 2).length;
    const problems = [];
    if (notFound.length) problems.push('not found: ' + notFound.map((e) => e.name).join('; '));
    if (wrongCard.length) problems.push('wrong card: ' + wrongCard.join('; '));
    if (unknown.length) problems.push('lines that are not cards in the deck: ' + unknown.join('; '));
    if (sameCard !== included.length - notFound.length) problems.push('card mismatch count');
    if (hasPrintings && exact !== included.length) problems.push('exact printing matched for ' + exact + ' of ' + included.length);
    if (qty !== expectQty) problems.push('quantity ' + qty + ' but expected ' + expectQty);
    if (problems.length) bad++;
    console.log((problems.length ? 'FAIL ' : '  ok ') + (deckId + ' ' + format).padEnd(40) + ' lines ' + String(res.entries.length).padStart(3) + ' | in deck ' + String(qty).padStart(3) + ' | maybeboard lines ' + maybeSeen + ' | exact printing ' + String(exact).padStart(3) + '/' + included.length + ' | double-faced ' + dfcSlots + ' | headings ' + res.headings.length + ' | ' + ms + ' ms' + (problems.length ? '\n       ' + problems.join('\n       ') : ''));
  }
  await browser.close();
  console.log(bad ? '\n' + bad + ' sample(s) with problems' : '\nall samples imported correctly');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
