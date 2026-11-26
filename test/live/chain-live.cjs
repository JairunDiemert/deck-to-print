/* The whole chain against the real services: commander name -> official deck (Scryfall search, MTGJSON list)
   -> cards found -> artwork filter -> download -> order file checked the way the MPC Autofill tool reads it.
   Run: node test/live/chain-live.cjs   (needs internet; set HTTPS_PROXY if you are behind a proxy) */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const PAGE = process.env.DTP_URL || 'file://' + path.resolve(__dirname, '../../docs/index.html');
const OUT = path.resolve(__dirname, '../out');
fs.mkdirSync(OUT, { recursive: true });
const status = (page, sel, re) => page.waitForFunction(([s, src]) => new RegExp(src).test((document.querySelector(s) || {}).textContent || ''), [sel, re.source], { timeout: 180000 });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE);
  console.log('page:', PAGE);

  // 1. a commander name, as someone would type it
  await page.fill('#cmdA', 'atraxa');
  await page.waitForSelector('#suggestA button.pick', { timeout: 60000 });
  const offered = await page.locator('#suggestA button.pick b').allTextContents();
  console.log('typed "atraxa", offered:', offered);
  assert.equal(offered[0], "Atraxa, Praetors' Voice", 'the most played match comes first');
  await page.click('#suggestA button.pick');
  const decks = await page.locator('#foundA .found-decks li').allTextContents();
  console.log('ready-made decks:', decks);
  assert.ok(/Breed Lethality/.test(decks.join(' ')));

  // 2. the official deck becomes the list, and every card is found in its exact printing
  await page.click('#foundA .found-decks button');
  await status(page, '#foundA .status', /cards found|Could not|could not/);
  console.log('status:', await page.textContent('#foundA .status'));
  const one = await page.evaluate(() => {
    const s = window.__dtp.state;
    const d = s.decks[0];
    return {
      slots: s.plan.slots.length, cards: d.reduce((n, e) => n + e.qty, 0), lines: d.length,
      bad: d.filter((e) => e.status !== 'ok').map((e) => e.raw),
      exact: d.filter((e) => e.card && e.set && e.card.set === e.set && String(e.card.collector_number) === String(e.cn)).length,
      commander: d.filter((e) => e.section === 'commander').map((e) => e.card && e.card.name),
      artists: d.filter((e) => e.card && e.card.artist).length
    };
  });
  console.log('deck 1:', JSON.stringify(one));
  assert.equal(one.cards, 100);
  assert.deepEqual(one.bad, []);
  assert.equal(one.exact, one.lines, 'every line resolved to the printing named in the list');
  assert.deepEqual(one.commander, ["Atraxa, Praetors' Voice"]);
  assert.equal(one.artists, one.lines);

  // 3. a commander with no official deck still gets its links
  await page.fill('#cmdB', 'krenko mob');
  await page.waitForSelector('#suggestB button.pick', { timeout: 60000 });
  await page.click('#suggestB button.pick');
  console.log('deck 2 commander:', await page.inputValue('#cmdB'), '|', (await page.textContent('#foundB')).slice(0, 120));
  const links = await page.locator('#foundB .found-links a').evaluateAll((as) => as.map((a) => a.href));
  console.log('links:', links);
  assert.equal(links.length, 3);

  // 3b. a starter deck built from Scryfall's open search, for a commander with no official deck
  await page.click('#foundB .starter-build');
  await status(page, '#foundB .status', /starter deck is in the box below|Could not/);
  console.log('starter status:', await page.textContent('#foundB .status'));
  const starter = await page.evaluate(() => {
    const d = window.__dtp.state.decks[1];
    const lines = document.getElementById('deckB').value.split('\n');
    const sample = {};
    let job = '';
    lines.forEach((l) => { if (l.startsWith('// ')) job = l.slice(3); else if (job && /^\d/.test(l)) (sample[job] = sample[job] || []).push(l.replace(/ \([A-Z0-9]+\) \S+$/, '').replace(/^1 /, '')); });
    return { cards: d.reduce((n, e) => n + e.qty, 0), lines: d.length, bad: d.filter((e) => e.status !== 'ok').map((e) => e.raw), commander: d.filter((e) => e.section === 'commander').map((e) => e.card && e.card.name), jobs: Object.keys(sample).map((k) => k + ' ' + sample[k].length), sample };
  });
  console.log('starter deck:', JSON.stringify({ cards: starter.cards, lines: starter.lines, bad: starter.bad, commander: starter.commander, jobs: starter.jobs }));
  Object.keys(starter.sample).forEach((k) => console.log('   ' + k + ': ' + starter.sample[k].slice(0, 7).join(', ')));
  assert.equal(starter.cards, 100);
  assert.deepEqual(starter.bad, []);
  assert.deepEqual(starter.commander, ['Krenko, Mob Boss']);
  assert.ok(starter.jobs.some((j) => /^Goblin creatures 18$/.test(j)), starter.jobs.join(' | '));

  // 4. deck 2 from a short pasted list, so the order has both shared and plain backs
  await page.fill('#deckB', '1 Krenko, Mob Boss\n1 Goblin Chieftain\n1 Skirk Prospector\n2 Mountain');
  await page.click('#find');
  await status(page, '#status', /Found your cards|Could not|error/);
  const two = await page.evaluate(() => { const p = window.__dtp.state.plan; return { slots: p.slots.length, counts: p.counts, doubles: p.doubles, blanks: p.blanks }; });
  console.log('two decks:', JSON.stringify(two));
  assert.deepEqual(two.counts, [100, 5]);

  // 5. deck view, then the artwork filter on a card with many printings
  await page.click('#viewDecks');
  const heads = await page.locator('#deckView .deck-a h4').allTextContents();
  console.log('deck view groups:', heads.join(' | '));
  assert.equal(heads[0], 'Commander (1)');
  await page.click('#deckView .deck-a button.tile[aria-label^="Sol Ring"]');
  await page.waitForSelector('#picker[open]');
  await page.waitForFunction(() => document.querySelectorAll('#prints .print').length > 5 && !/Loading/.test(document.getElementById('pickerStatus').textContent), null, { timeout: 60000 });
  const all = await page.locator('#prints li').count();
  await page.fill('#pickerFilter', 'tedin');
  const shown = await page.locator('#prints li:not([hidden]) .print small').allTextContents();
  console.log('Sol Ring versions loaded:', all, '| matching "tedin":', shown.length, '| e.g.', shown[0], '|', await page.textContent('#pickerStatus'));
  assert.ok(shown.length >= 1 && shown.length < all);
  assert.ok(shown.every((t) => /Tedin/.test(t)));
  await page.click('#prints li:not([hidden]) .print');
  await page.waitForFunction(() => !document.getElementById('picker').open);
  const picked = await page.evaluate(() => { const e = window.__dtp.state.decks[0].find((x) => x.name === 'Sol Ring'); return e.card.artist + ' | ' + e.card.set + ' ' + e.card.collector_number; });
  console.log('picked Sol Ring:', picked);
  assert.match(picked, /Tedin/);

  // 6. download, and read the order file the way the helper program does
  const zip = path.join(OUT, 'chain-live.zip');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#download')]);
  await dl.saveAs(zip);
  console.log('download:', (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB |', await page.textContent('#dlStatus'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-live-'));
  execFileSync('unzip', ['-q', zip, '-d', dir]);
  const check = JSON.parse(execFileSync('python3', ['-I', path.resolve(__dirname, '../orderfile_check.py'), dir]).toString());
  console.log('order file: quantity', check.quantity, '| stock', check.stock, '| problems', check.problems.length, '| slot 1:', check.fronts[0], '+', check.backs[0], '| last slot:', check.fronts[check.quantity - 1], '+', check.backs[check.quantity - 1]);
  assert.equal(check.quantity, two.slots);
  assert.deepEqual(check.problems, []);
  assert.equal(new Set(check.fronts).size, two.slots);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('\nchain: all checks passed');
})().catch((e) => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
