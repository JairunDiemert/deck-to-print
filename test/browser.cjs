/* End-to-end tests in a real browser, with Scryfall replaced by test/mock.cjs.
   Run: NODE_PATH=/opt/npm-tools/node_modules node test/browser.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const sharp = require('sharp');
const mock = require('./mock.cjs');
const C = require('../src/core.js');

const PAGE = 'file://' + path.resolve(__dirname, '../docs/index.html');
const OUT = path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log('  ok  ' + name + '  (' + (Date.now() - t0) + ' ms)'); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n      ')); }
}

async function rawPixels(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, at: (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; } };
}
const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

function unzip(zipPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-out-'));
  execFileSync('unzip', ['-q', zipPath, '-d', dir]);
  const files = [];
  const walk = (d, rel) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + '/'); else files.push(rel + e.name);
  });
  walk(dir, '');
  return { dir, files: files.sort() };
}

async function freshPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|CORS policy/.test(m.text())) errors.push(m.text()); });
  await mock.install(page);
  await page.goto(PAGE);
  return { ctx, page, errors };
}

async function find(page) {
  await page.click('#find');
  await page.waitForFunction(() => !document.getElementById('find').disabled, null, { timeout: 120000 });
}

async function download(page, saveAs) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('#download')]);
  await dl.saveAs(saveAs);
  await page.waitForFunction(() => !document.getElementById('download').disabled, null, { timeout: 60000 });
  return dl.suggestedFilename();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });

  console.log('first look');
  await test('page loads clean and shows the empty state', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    assert.equal(await page.title(), 'Deck to Print');
    assert.equal(await page.isVisible('#checkEmpty'), true);
    assert.equal(await page.isVisible('#printEmpty'), true);
    assert.equal(await page.isVisible('#download'), false);
    assert.ok(await page.evaluate(() => document.fonts.check('700 16px Archivo')), 'embedded font is available');
    await page.screenshot({ path: path.join(OUT, '01-empty-desktop.png'), fullPage: true });
    await page.click('#find');
    assert.match(await page.textContent('#status'), /paste a deck list/);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  console.log('example: two small decks');
  let exampleZip = path.join(OUT, 'example.zip');
  await test('example fills both lists, finds cards and pairs them', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    mock.stats.collection.length = 0; mock.stats.named.length = 0;
    await page.click('#example');
    await page.waitForFunction(() => !document.getElementById('find').disabled && document.querySelectorAll('#proof .slot').length > 0, null, { timeout: 60000 });
    const plan = await page.evaluate(() => { const p = window.__dtp.state.plan; return { n: p.slots.length, counts: p.counts, doubles: p.doubles, blanks: p.blanks, sameBack: p.sameBack, pairs: p.slots.map((s) => [s.front.name, s.back.name, s.front.deck, s.back.deck == null ? null : s.back.deck]) }; });
    assert.equal(plan.n, 8);
    assert.deepEqual(plan.counts, [8, 7]);
    assert.deepEqual(plan.doubles, [1, 0]);
    assert.equal(plan.blanks, 0);
    assert.deepEqual(plan.pairs[0], ['Delver of Secrets', 'Insectile Aberration', 0, 0]);
    assert.deepEqual(plan.pairs[1], ['Sol Ring', 'Llanowar Elves', 0, 1]);
    assert.deepEqual(plan.pairs[7], ['Island', 'Forest', 0, 1]);
    assert.match(await page.textContent('#tally'), /^8 cards to print$/);
    assert.match(await page.textContent('#orderSize'), /Up to 18.*10 spare slots/);
    assert.match(await page.textContent('#tallyNotes'), /1 double-faced card needs both sides/);
    assert.equal(await page.isVisible('#problems'), false);
    assert.equal(await page.locator('#proof .slot').count(), 8);
    assert.equal(await page.locator('#proof .face').count(), 16);
    assert.match(await page.textContent('#proofLead'), /Each numbered pair is one printed card\. Front on the left, back on the right\./);
    assert.equal(await page.isVisible('#example'), false, 'the example cannot overwrite lists that are filled in');
    assert.equal(await page.locator('#order li').count(), 8);
    // one batched lookup covers both decks, including the double-faced card listed by its front name
    assert.equal(mock.stats.collection.length, 1);
    assert.equal(mock.stats.collection[0].n, 13);
    assert.equal(mock.stats.collection[0].origin, 'null', 'a page opened from a file announces itself as null');
    assert.match(mock.stats.collection[0].contentType, /application\/json/);
    assert.match(mock.stats.collection[0].accept, /application\/json/);
    assert.deepEqual(mock.stats.named.map((x) => x.q), []);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#proof img')).slice(0, 12).every((i) => i.complete && i.naturalWidth > 0));
    await page.screenshot({ path: path.join(OUT, '02-example-desktop.png'), fullPage: true });
    await page.locator('#step-check').screenshot({ path: path.join(OUT, '02b-example-check.png') });

    const name = await download(page, exampleZip);
    assert.equal(name, 'deck-print-files.zip');
    assert.match(await page.textContent('#dlStatus'), /Saved deck-print-files\.zip.*8 cards/);
    assert.equal(await page.isVisible('#again'), true);
    await page.locator('#step-print').screenshot({ path: path.join(OUT, '03-example-print.png') });
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await test('the download has the right files in the right order', async () => {
    execFileSync('python3', ['-I', '-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); bad = z.testzip(); assert bad is None, bad', exampleZip]);
    const { dir, files } = unzip(exampleZip);
    assert.deepEqual(files, [
      'HOW TO ORDER.txt', 'cards.xml', 'Start order - Windows.bat', 'Start order - Mac or Linux.command',
      'backs/B001 Insectile Aberration.jpg', 'backs/B002 Llanowar Elves.jpg', 'backs/B003 Cultivate.jpg', 'backs/B004 Rampant Growth.jpg',
      'backs/B005 Swords to Plowshares.jpg', 'backs/B006 Birds of Paradise.jpg', 'backs/B007 Forest.jpg', 'backs/B008 Forest.jpg',
      'fronts/F001 Delver of Secrets.jpg', 'fronts/F002 Sol Ring.jpg', 'fronts/F003 Arcane Signet.jpg', 'fronts/F004 Command Tower.jpg',
      'fronts/F005 Lightning Bolt.jpg', 'fronts/F006 Counterspell.jpg', 'fronts/F007 Island.jpg', 'fronts/F008 Island.jpg'
    ].sort());
    const txt = fs.readFileSync(path.join(dir, 'HOW TO ORDER.txt'), 'utf8');
    assert.match(txt, /Cards in this download: 8/);
    assert.match(txt, /Up to 18/);
    assert.ok(!/\u2014/.test(txt));
    for (const f of files.filter((x) => x.endsWith('.jpg'))) {
      const meta = await sharp(path.join(dir, f)).metadata();
      assert.equal(meta.format, 'jpeg', f);
      assert.equal(meta.width, 822, f);
      assert.equal(meta.height, 1122, f);
      assert.equal(meta.density, 300, f + ' is stamped 300 dpi');
    }
    fs.copyFileSync(path.join(dir, 'fronts/F002 Sol Ring.jpg'), path.join(OUT, 'sample-front-bordered.jpg'));
  });

  await test('a bordered card: scan placed 1:1, margin continues the border, corners filled, proxy mark present', async () => {
    const { dir } = unzip(exampleZip);
    const out = await rawPixels(fs.readFileSync(path.join(dir, 'fronts/F002 Sol Ring.jpg')));
    const src = await rawPixels(await mock.image(mock.register('Sol Ring', 'black'), 'png'));
    const border = [21, 17, 15];
    for (const [x, y] of [[2, 2], [819, 2], [2, 1119], [819, 1119], [411, 3], [411, 1118], [3, 561], [818, 561], [20, 300], [800, 900]]) {
      assert.ok(near(out.at(x, y), border, 7), 'margin pixel ' + x + ',' + y + ' = ' + out.at(x, y));
    }
    // the scan's see-through rounded corners must not print as white or black holes
    assert.equal(src.at(1, 1)[3], 0);
    for (const [x, y] of [[38 + 1, 41 + 1], [38 + 743, 41 + 1], [38 + 1, 41 + 1038], [38 + 743, 41 + 1038]]) {
      assert.ok(near(out.at(x, y), border, 7), 'corner pixel ' + x + ',' + y + ' = ' + out.at(x, y));
    }
    // same picture at offset 38,41 with no resampling: it matches there far better than one pixel off in any
    // direction, and what difference remains is JPEG rounding (brightness within a few percent)
    const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const score = (dx, dy) => {
      let sum = 0, n = 0, worstLum = 0;
      for (let y = 50; y < 990; y += 3) for (let x = 50; x < 695; x += 3) {
        const a = out.at(38 + x + dx, 41 + y + dy), b = src.at(x, y);
        sum += Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])); n++;
        worstLum = Math.max(worstLum, Math.abs(lum(a) - lum(b)));
      }
      return { mean: sum / n, worstLum };
    };
    const here = score(0, 0);
    assert.ok(here.mean < 3, 'mean difference ' + here.mean.toFixed(2));
    assert.ok(here.worstLum < 32, 'worst brightness difference ' + here.worstLum.toFixed(1));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(score(dx, dy).mean > here.mean * 1.5, 'shifted by ' + dx + ',' + dy + ' should match worse');
    // proxy mark: light pixels inside the dark right-hand border, around the middle
    let lit = 0;
    for (let y = 41 + 400; y < 41 + 640; y++) for (let x = 38 + 745 - 24; x < 38 + 745 - 6; x++) { const p = out.at(x, y); if (p[0] > 150 && p[1] > 150 && p[2] > 150) lit++; }
    assert.ok(lit > 150, 'mark pixels found: ' + lit);
    // and none of it reaches the copyright line area or the trim margin
    for (let y = 41 + 990; y < 41 + 1030; y++) for (let x = 38 + 745 - 24; x < 38 + 745 - 2; x++) assert.ok(near(out.at(x, y), border, 12), 'bottom right border is untouched');
  });

  console.log('awkward lists');
  await test('typos, missing cards, cards without pictures, wrong set numbers', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    mock.teach('c21', '263', 'Sol Ring');
    mock.teach('znr', '381', 'Island');
    mock.stats.collection.length = 0; mock.stats.named.length = 0;
    const listA = [
      'Commander', "1 Atraxa, Praetors' Voice", '', 'Deck',
      '1 Sol Rng', '1 Cultivte', '1 Missing Card Of Doom', '1 No Picture Card', '1 Sol Rg',
      '1 Sol Ring (C21) 263', '1 Command Tower (C21) 999', '1 Arcane Signet (XYZ) 12', '2 Island (ZNR) 381 *F*',
      '1 Borderless Dream', '1 Fire // Ice', '', 'Maybeboard', '1 Mana Crypt'
    ].join('\n');
    await page.fill('#deckA', listA);
    await find(page);
    const info = await page.evaluate(() => {
      const s = window.__dtp.state;
      return { entries: s.decks[0].map((e) => [e.name, e.section, e.status, e.card ? e.card.name + '|' + e.card.set + '|' + e.card.collector_number : null]), slots: s.plan.slots.map((x) => x.front.name), sameBack: s.plan.sameBack };
    });
    const by = Object.fromEntries(info.entries.map((e) => [e[0], e]));
    assert.equal(by['Sol Rng'][3], 'Sol Ring|tst|1');
    assert.equal(by['Cultivte'][3], 'Cultivate|tst|1');
    assert.equal(by['Missing Card Of Doom'][2], 'notfound');
    assert.equal(by['No Picture Card'][2], 'noimage');
    assert.equal(by['Sol Rg'][2], 'notfound', 'a wild guess from the forgiving search is not accepted');
    assert.equal(by['Sol Ring'][3], 'Sol Ring|c21|263');
    assert.equal(by['Command Tower'][3], 'Command Tower|c21|1', 'a number pointing at another card falls back to the name in that set');
    assert.equal(by['Arcane Signet'][3], 'Arcane Signet|tst|1', 'an unknown set falls back to the name');
    assert.equal(by['Island'][3], 'Island|znr|381');
    assert.equal(by['Mana Crypt'][2], 'pending', 'maybeboard is never looked up');
    assert.deepEqual(info.slots, ["Atraxa, Praetors' Voice", 'Sol Ring', 'Cultivate', 'Sol Ring', 'Command Tower', 'Arcane Signet', 'Island', 'Island', 'Borderless Dream', 'Fire // Ice']);
    assert.equal(info.sameBack, true);
    const problems = await page.textContent('#problems');
    assert.match(problems, /3 lines need a look/);
    assert.match(problems, /Deck 1, line 7: 1 Missing Card Of Doom was not found/);
    assert.match(problems, /Deck 1, line 8: 1 No Picture Card has no picture/);
    assert.match(problems, /line 9/);
    assert.match(await page.textContent('#tallyNotes'), /Every card gets a plain back/);
    assert.match(await page.textContent('#proofLead'), /Each numbered picture is one printed card\. They all get the same plain back\./);
    assert.equal(await page.locator('#proof .slot').count(), 10);
    assert.equal(await page.locator('#proof .face').count(), 10, 'one deck shows fronts only');
    // lookups: every request within the 75 card limit and spaced at least half a second apart
    const times = mock.stats.collection.map((x) => x.at).concat(mock.stats.named.map((x) => x.at)).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 500, 'gap between lookups was ' + (times[i] - times[i - 1]) + ' ms');
    mock.stats.collection.forEach((c) => assert.ok(c.n <= 75));
    await page.locator('#step-check').screenshot({ path: path.join(OUT, '04-problems.png') });

    // fixing the list and running again asks only for what is new
    const before = mock.stats.collection.length + mock.stats.named.length;
    await page.fill('#deckA', listA.replace('1 Missing Card Of Doom', '1 Counterspell').replace('1 Sol Rg\n', ''));
    await find(page);
    assert.match(await page.textContent('#problems'), /1 line needs a look/);
    assert.equal(mock.stats.collection.length + mock.stats.named.length - before, 1, 'one new lookup for the one new card');

    const zip = path.join(OUT, 'awkward.zip');
    await download(page, zip);
    const { dir, files } = unzip(zip);
    assert.equal(files.filter((f) => f.startsWith('fronts/')).length, 11);
    assert.deepEqual(files.filter((f) => f.startsWith('backs/')), ['backs/B000 card back (same for every card).jpg']);
    assert.match(fs.readFileSync(path.join(dir, 'HOW TO ORDER.txt'), 'utf8'), /Same image/);
    // one deck: the helper's order file uses the single shared back for every card
    const shared = JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'orderfile_check.py'), dir]).toString());
    assert.deepEqual(shared.problems, []);
    assert.equal(shared.cardback, 'backs/B000 card back (same for every card).jpg');
    assert.ok(shared.backs.every((b) => b === shared.cardback));
    fs.copyFileSync(path.join(dir, 'fronts/F010 Borderless Dream.jpg'), path.join(OUT, 'sample-front-borderless.jpg'));

    // art that runs to the edge: the margin mirrors the picture instead of going flat
    const out = await rawPixels(fs.readFileSync(path.join(dir, 'fronts/F010 Borderless Dream.jpg')));
    const src = await rawPixels(await mock.image(mock.register('Borderless Dream', 'borderless'), 'png'));
    let close = 0, total = 0;
    for (let y = 150; y < 900; y += 37) for (const d of [6, 14, 22, 30]) {
      total += 2;
      if (near(out.at(38 - 1 - d, 41 + y), src.at(d, y), 40)) close++;
      if (near(out.at(38 + 745 + d, 41 + y), src.at(744 - d, y), 40)) close++;
    }
    assert.ok(close / total > 0.9, 'mirrored side margin matches in ' + close + ' of ' + total + ' samples');
    close = 0; total = 0;
    for (let x = 120; x < 640; x += 29) for (const d of [6, 16, 26, 36]) {
      total += 2;
      if (near(out.at(38 + x, 41 - 1 - d), src.at(x, d), 40)) close++;
      if (near(out.at(38 + x, 41 + 1040 + d), src.at(x, 1039 - d), 40)) close++;
    }
    assert.ok(close / total > 0.9, 'mirrored top and bottom margin matches in ' + close + ' of ' + total + ' samples');
    const corner = out.at(3, 3);
    assert.ok(!(corner[0] > 245 && corner[1] > 245 && corner[2] > 245) && !(corner[0] < 6 && corner[1] < 6 && corner[2] < 6), 'canvas corner is filled with picture colour, got ' + corner);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await test('the plain back is its own design and says what it is', async () => {
    const { dir } = unzip(path.join(OUT, 'awkward.zip'));
    const out = await rawPixels(fs.readFileSync(path.join(dir, 'backs/B000 card back (same for every card).jpg')));
    fs.copyFileSync(path.join(dir, 'backs/B000 card back (same for every card).jpg'), path.join(OUT, 'sample-plain-back.jpg'));
    assert.equal(out.w, 822); assert.equal(out.h, 1122);
    assert.ok(near(out.at(5, 5), [35, 31, 32], 6));
    let lit = 0;
    for (let y = 520; y < 680; y += 2) for (let x = 200; x < 620; x += 2) { if (out.at(x, y)[0] > 180) lit++; }
    assert.ok(lit > 800, 'lettering pixels: ' + lit);
  });

  await test('turning the proxy mark off leaves the scan untouched', async () => {
    const { ctx, page } = await freshPage(browser);
    await page.fill('#deckA', '1 Sol Ring');
    await page.click('.options summary');
    await page.uncheck('#optMark');
    await find(page);
    const zip = path.join(OUT, 'nomark.zip');
    await download(page, zip);
    const { dir } = unzip(zip);
    const out = await rawPixels(fs.readFileSync(path.join(dir, 'fronts/F001 Sol Ring.jpg')));
    let lit = 0;
    for (let y = 41 + 400; y < 41 + 640; y++) for (let x = 38 + 745 - 24; x < 38 + 745 - 6; x++) { const p = out.at(x, y); if (p[0] > 150) lit++; }
    assert.equal(lit, 0);
    await ctx.close();
  });

  console.log('artwork picker');
  await test('choose another version, keep it across a new search', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    await page.fill('#deckA', '1 Sol Ring\n1 Counterspell');
    await page.fill('#deckB', '1 Cultivate');
    await find(page);
    await page.click('#proof .slot:nth-child(1) button.face[data-side="front"]');
    await page.waitForSelector('#picker[open]');
    await page.waitForFunction(() => document.querySelectorAll('#prints .print').length === 2);
    assert.match(await page.textContent('#pickerTitle'), /Choose artwork for Sol Ring/);
    assert.equal(await page.locator('#prints .print.is-current').count(), 1);
    assert.equal(await page.isVisible('#pickerMore'), true);
    await page.click('#pickerMore');
    // six versions exist; the digital-only one and the one without a picture are not offered
    await page.waitForFunction(() => document.querySelectorAll('#prints .print').length === 4 && document.getElementById('pickerMore').hidden);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#prints img')).every((i) => i.complete && i.naturalWidth > 0));
    await page.screenshot({ path: path.join(OUT, '05-picker.png') });
    await page.click('#prints li:nth-child(3) .print');   // the white-bordered one
    await page.waitForFunction(() => !document.getElementById('picker').open);
    let card = await page.evaluate(() => { const c = window.__dtp.state.plan.slots[0].front.card; return c.set + '|' + c.collector_number; });
    assert.equal(card, 'wht|250');
    assert.match(await page.getAttribute('#proof .slot:nth-child(1) button.face[data-side="front"] img', 'src'), /sol-ring-white/);
    await find(page);
    card = await page.evaluate(() => { const c = window.__dtp.state.plan.slots[0].front.card; return c.set + '|' + c.collector_number; });
    assert.equal(card, 'wht|250', 'the pick survives a new search');
    // a white border gets a white margin and dark lettering
    const zip = path.join(OUT, 'picked.zip');
    await download(page, zip);
    const { dir } = unzip(zip);
    const out = await rawPixels(fs.readFileSync(path.join(dir, 'fronts/F001 Sol Ring.jpg')));
    assert.ok(near(out.at(3, 3), [241, 240, 234], 7), 'white margin, got ' + out.at(3, 3));
    let dark = 0;
    for (let y = 41 + 400; y < 41 + 640; y++) for (let x = 38 + 745 - 24; x < 38 + 745 - 6; x++) { if (out.at(x, y)[0] < 90) dark++; }
    assert.ok(dark > 150, 'dark mark pixels on the white border: ' + dark);
    fs.copyFileSync(path.join(dir, 'fronts/F001 Sol Ring.jpg'), path.join(OUT, 'sample-front-white.jpg'));
    // Escape closes the picker without changing anything
    await page.click('#proof .slot:nth-child(2) button.face[data-side="front"]');
    await page.waitForSelector('#picker[open]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('picker').open);
    assert.equal(await page.evaluate(() => window.__dtp.state.plan.slots[1].front.card.set), 'tst');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  console.log('two full decks');
  await test('two 100 card decks with double-faced cards, basics, a sideboard and a maybeboard', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    const a = ['1 Day Side // Night Side', '1 Sun Face // Moon Face', '1 Left Door // Right Door'];
    for (let i = 1; i <= 67; i++) a.push('1 Alpha Card ' + i);
    a.push('30 Island');
    a.push('', 'Sideboard', '2 Alpha Side One', '', 'Maybeboard', '5 Alpha Maybe');
    const b = ['1 Delver of Secrets // Insectile Aberration (ISD) 51'];
    mock.teach('isd', '51', 'Delver of Secrets // Insectile Aberration');
    for (let i = 1; i <= 64; i++) b.push('1 Beta Card ' + i);
    b.push('35 Forest');
    await page.fill('#deckA', a.join('\n'));
    await page.fill('#deckB', b.join('\n'));
    mock.stats.collection.length = 0;
    const t0 = Date.now();
    await find(page);
    const lookupMs = Date.now() - t0;
    const plan = await page.evaluate(() => { const p = window.__dtp.state.plan; return { n: p.slots.length, counts: p.counts, doubles: p.doubles, singles: p.singles, blanks: p.blanks }; });
    // deck 1: 3 double + 67 + 30 basics + 2 sideboard = 102; deck 2: 1 double + 64 + 35 = 100
    assert.deepEqual(plan.counts, [102, 100]);
    assert.deepEqual(plan.doubles, [3, 1]);
    assert.deepEqual(plan.singles, [99, 99]);
    assert.equal(plan.n, 103);
    assert.equal(plan.blanks, 0);
    assert.match(await page.textContent('#orderSize'), /Up to 108.*5 spare slots/);
    assert.deepEqual(mock.stats.collection.map((c) => c.n), [75, 63]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '06-two-decks.png'), fullPage: true });

    const zip = path.join(OUT, 'two-decks.zip');
    const t1 = Date.now();
    await download(page, zip);
    const buildMs = Date.now() - t1;
    const { files } = unzip(zip);
    assert.equal(files.filter((f) => f.startsWith('fronts/')).length, 103);
    assert.equal(files.filter((f) => f.startsWith('backs/')).length, 103);
    assert.ok(files.includes('fronts/F001 Day Side.jpg') && files.includes('backs/B001 Night Side.jpg'));
    assert.ok(files.includes('fronts/F004 Delver of Secrets.jpg') && files.includes('backs/B004 Insectile Aberration.jpg'));
    assert.ok(files.includes('fronts/F005 Alpha Card 1.jpg') && files.includes('backs/B005 Beta Card 1.jpg'));
    assert.ok(files.includes('fronts/F103 Alpha Side One.jpg') && files.includes('backs/B103 Forest.jpg'));
    const size = fs.statSync(zip).size;
    console.log('        lookups ' + lookupMs + ' ms, pictures and zip ' + buildMs + ' ms, zip ' + (size / 1048576).toFixed(1) + ' MB, ' + (await page.textContent('#dlStatus')));

    // options that change the plan
    await page.click('.options summary');
    await page.check('#optBasics');
    assert.equal(await page.evaluate(() => window.__dtp.state.plan.slots.length), 4 + 69);
    await page.uncheck('#optBasics');
    await page.uncheck('#optSideboard');
    await page.waitForFunction(() => !document.getElementById('find').disabled && window.__dtp.state.plan.slots.length === 103);
    assert.deepEqual(await page.evaluate(() => window.__dtp.state.plan.counts), [100, 100]);
    assert.match(await page.textContent('#tallyNotes'), /2 cards have no partner from the other deck, so their other side is plain/);
    const tail = await page.evaluate(() => window.__dtp.state.plan.slots.slice(-2).map((s) => [s.front.type, s.back.name, s.back.deck]));
    assert.deepEqual(tail, [['blank', 'Forest', 1], ['blank', 'Forest', 1]], 'deck 2 cards without a partner stay on the back');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  console.log('when things go wrong');
  await test('no connection: a clear message, nothing half-done', async () => {
    const { ctx, page } = await freshPage(browser);
    mock.flags.blockAll = true;
    await page.fill('#deckA', '1 Brand New Card');
    await find(page);
    mock.flags.blockAll = false;
    assert.match(await page.textContent('#status'), /Could not reach the card database/);
    assert.equal(await page.evaluate(() => document.getElementById('status').className), 'status is-bad');
    assert.equal(await page.isVisible('#download'), false);
    await page.locator('#step-lists').screenshot({ path: path.join(OUT, '07-offline.png') });
    await find(page);
    assert.match(await page.textContent('#tally'), /1 card to print/);
    await ctx.close();
  });

  await test('a picture that will not download: says which card, then recovers', async () => {
    const { ctx, page } = await freshPage(browser);
    await page.fill('#deckA', '1 Sol Ring\n1 Stubborn Picture');
    await find(page);
    mock.flags.failImage = 'stubborn-picture';
    await page.click('#download');
    await page.waitForFunction(() => /Could not download the picture/.test(document.getElementById('dlStatus').textContent), null, { timeout: 60000 });
    assert.match(await page.textContent('#dlStatus'), /picture for Stubborn Picture/);
    mock.flags.failImage = null;
    const zip = path.join(OUT, 'recovered.zip');
    await download(page, zip);
    assert.equal(unzip(zip).files.filter((f) => f.startsWith('fronts/')).length, 2);
    await ctx.close();
  });

  await test('told to slow down: waits, then carries on', async () => {
    const { ctx, page } = await freshPage(browser);
    await page.addInitScript(() => {});
    mock.flags.rateLimitOnce = true;
    await page.fill('#deckA', '1 Patient Card');
    const t0 = Date.now();
    await page.click('#find');
    await page.waitForFunction(() => /slow down/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
    await page.waitForFunction(() => !document.getElementById('find').disabled, null, { timeout: 60000 });
    assert.ok(Date.now() - t0 >= 30000, 'waited ' + (Date.now() - t0) + ' ms');
    assert.match(await page.textContent('#tally'), /1 card to print/);
    await ctx.close();
  });

  console.log('real-world list quirks');
  await test('category headings, empty set brackets and odd set codes from real exports', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    mock.teach('cmr', '259', 'Heliod, Sun-Crowned');
    mock.teach('mh2', '2', 'Esper Sentinel');
    mock.stats.collection.length = 0; mock.stats.named.length = 0;
    const list = ['Commander', '1x Heliod, Sun-Crowned (cmr) 259 *F* [Commander{top}]', '', 'Draw', '1x Esper Sentinel (mh2) 2 *F* [Draw]', '',
      'The Gun', '1x Walking Ballista [The Gun]', '1 Giver of Runes () 3', '1 Mother of Runes (UL) 14', '1x Fire // Ice (mh2) 290 [Removal]', '',
      'Maybeboard', '1x Leonin Arbiter (2x2) 16 *F* [Maybeboard{noDeck}{noPrice}]'].join('\n');
    await page.fill('#deckA', list);
    await find(page);
    const got = await page.evaluate(() => window.__dtp.state.decks[0].map((e) => [e.name, e.section, e.status, e.card ? e.card.name + '|' + e.card.set : null]));
    assert.deepEqual(got, [
      ['Heliod, Sun-Crowned', 'commander', 'ok', 'Heliod, Sun-Crowned|cmr'],
      ['Esper Sentinel', 'main', 'ok', 'Esper Sentinel|mh2'],
      ['Walking Ballista', 'main', 'ok', 'Walking Ballista|tst'],
      ['Giver of Runes', 'main', 'ok', 'Giver of Runes|tst'],
      ['Mother of Runes', 'main', 'ok', 'Mother of Runes|tst'],
      ['Fire // Ice', 'main', 'ok', 'Fire // Ice|mh2'],
      ['Leonin Arbiter', 'maybe', 'pending', null]
    ]);
    assert.equal(mock.stats.collection.filter((c) => c.refused).length, 0, 'nothing the card database would refuse was sent');
    assert.equal(mock.stats.named.length, 0, 'no one-at-a-time lookups were needed');
    assert.match(await page.textContent('#tallyNotes'), /Deck 1: these lines were read as headings, not cards: Draw, The Gun\./);
    assert.equal(await page.isVisible('#problems'), false);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await test('one line the card database refuses does not take the rest of the deck with it', async () => {
    const { ctx, page } = await freshPage(browser);
    mock.flags.rejectName = 'cursed';
    mock.stats.collection.length = 0;
    const names = [];
    for (let i = 1; i <= 9; i++) names.push('1 Fine Card ' + i);
    names.splice(4, 0, '1 Cursed Card');
    await page.fill('#deckA', names.join('\n'));
    await find(page);
    mock.flags.rejectName = null;
    const got = await page.evaluate(() => window.__dtp.state.decks[0].map((e) => e.status));
    assert.deepEqual(got, ['ok', 'ok', 'ok', 'ok', 'notfound', 'ok', 'ok', 'ok', 'ok', 'ok']);
    assert.match(await page.textContent('#problems'), /1 line needs a look.*Cursed Card/);
    assert.match(await page.textContent('#tally'), /^9 cards to print$/);
    assert.ok(mock.stats.collection.length <= 12, 'narrowed down in ' + mock.stats.collection.length + ' requests');
    await ctx.close();
  });

  await test('a scan one pixel narrower is still placed without resizing', async () => {
    const { ctx, page } = await freshPage(browser);
    await page.fill('#deckA', '1 Narrow Scan Card');
    await find(page);
    const zip = path.join(OUT, 'narrow.zip');
    await download(page, zip);
    const info = await page.evaluate(() => Array.from(window.__dtp.faceCache.values()).map((v) => v.info).filter(Boolean).pop());
    assert.deepEqual([info.scanWidth, info.scanHeight], [744, 1040]);
    assert.deepEqual(info.placedAt, [39, 41, 744, 1040]);
    const { dir } = unzip(zip);
    const out = await rawPixels(fs.readFileSync(path.join(dir, 'fronts/F001 Narrow Scan Card.jpg')));
    assert.equal(out.w, 822);
    for (const [x, y] of [[2, 561], [38, 561], [819, 561], [783, 561]]) assert.ok(near(out.at(x, y), [21, 17, 15], 7), 'margin at ' + x + ' is ' + out.at(x, y));
    await ctx.close();
  });

  console.log('MPC Autofill switch');
  await test('switching to MPC Autofill gives a paired list to paste instead of files', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.fill('#deckA', '1 Delver of Secrets\n1 Sol Ring\n1 Fire // Ice\n3 Island\n1 Goblin Token');
    await page.fill('#deckB', "1 Llanowar Elves\n1 Atraxa, Praetors' Voice\n2 Forest");
    await find(page);
    assert.equal(await page.isVisible('#printScryfall'), true);
    assert.equal(await page.isVisible('#printMpc'), false);
    await page.check('#srcMpc');
    assert.equal(await page.isVisible('#printScryfall'), false);
    assert.equal(await page.isVisible('#printMpc'), true);
    assert.equal(await page.textContent('#printTitle'), 'Copy the list and order');
    const list = (await page.inputValue('#mpcList')).split('\n');
    assert.deepEqual(list, [
      '1x Delver of Secrets // Insectile Aberration',
      '1x Sol Ring // Llanowar Elves',
      "1x Fire Ice // Atraxa, Praetors' Voice",
      '2x Island // Forest',
      '1x Island',
      '1x t:Goblin Token'
    ]);
    assert.match(await page.textContent('#proofHint'), /You choose the artwork on MPC Autofill/);
    assert.match(await page.textContent('#mpcOrder'), /Add Cards.*Text.*desktop tool/s);
    await page.click('#copyList');
    await page.waitForFunction(() => /Copied/.test(document.getElementById('copyStatus').textContent), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), list.join('\n'));
    // artwork is chosen on the other site, so the picker stays closed here
    await page.click('#proof .slot:nth-child(2) button.face[data-side="front"]');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.getElementById('picker').open), false);
    await page.locator('#step-print').screenshot({ path: path.join(OUT, '12-mpc-mode.png') });
    // the choice is remembered, and switching back restores the download
    await page.waitForTimeout(100);
    await page.reload();
    assert.equal(await page.isChecked('#srcMpc'), true);
    await find(page);
    assert.equal(await page.isVisible('#printMpc'), true);
    await page.check('#srcScryfall');
    assert.equal(await page.isVisible('#printScryfall'), true);
    assert.equal(await page.textContent('#printTitle'), 'Download and order');
    await page.locator('#step-lists').screenshot({ path: path.join(OUT, '13-source-switch.png') });
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  console.log('small screens and saved drafts');
  await test('phone width: nothing overflows, lists stack', async () => {
    const { ctx, page, errors } = await freshPage(browser, { width: 390, height: 844 });
    await page.screenshot({ path: path.join(OUT, '08-empty-phone.png'), fullPage: true });
    await page.click('#example');
    await page.waitForFunction(() => !document.getElementById('find').disabled && document.querySelectorAll('#proof .slot').length > 0, null, { timeout: 60000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#proof img')).every((i) => i.complete && i.naturalWidth > 0) || true);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'horizontal overflow of ' + overflow + ' px');
    const boxes = await page.evaluate(() => [document.getElementById('deckA').getBoundingClientRect().top, document.getElementById('deckB').getBoundingClientRect().top]);
    assert.ok(boxes[1] > boxes[0] + 100, 'second list sits under the first');
    await page.screenshot({ path: path.join(OUT, '09-example-phone.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await test('lists and options are remembered in this browser, and Clear forgets them', async () => {
    const { ctx, page } = await freshPage(browser);
    await page.fill('#deckA', '1 Sol Ring');
    await page.fill('#deckB', '1 Cultivate');
    await page.click('.options summary');
    await page.check('#optBasics');
    await page.waitForTimeout(600);
    await page.reload();
    assert.equal(await page.inputValue('#deckA'), '1 Sol Ring');
    assert.equal(await page.inputValue('#deckB'), '1 Cultivate');
    assert.equal(await page.isChecked('#optBasics'), true);
    assert.equal(await page.isVisible('#example'), false);
    await page.click('#clear');
    assert.equal(await page.inputValue('#deckA'), '');
    assert.equal(await page.textContent('#clear'), 'Put my lists back');
    assert.equal(await page.isVisible('#example'), true);
    await page.click('#clear');
    assert.equal(await page.inputValue('#deckA'), '1 Sol Ring');
    assert.equal(await page.inputValue('#deckB'), '1 Cultivate');
    assert.equal(await page.textContent('#clear'), 'Clear both lists');
    await page.click('#clear');
    await page.reload();
    assert.equal(await page.inputValue('#deckA'), '');
    assert.equal(await page.isVisible('#clear'), false);
    assert.equal(await page.isVisible('#example'), true);
    await ctx.close();
  });

  console.log('the chain: commander in, order out');
  const chainZip = path.join(OUT, 'chain.zip');
  const idle = (page) => page.waitForFunction(() => !document.getElementById('find').disabled && !/Getting the deck list/.test(document.getElementById('foundA').textContent + document.getElementById('foundB').textContent), null, { timeout: 60000 });

  await test('a commander name leads to a ready-made deck, and the deck fills the list', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    mock.stats.decks.length = 0;
    await page.fill('#cmdA', 'atrax');
    await page.waitForSelector('#suggestA button.pick');
    assert.deepEqual(await page.locator('#suggestA button.pick b').allTextContents(), ["Atraxa, Praetors' Voice", 'Atraxa, Grand Unifier']);
    assert.match(await page.locator('#suggestA button.pick small').first().textContent(), /^Legendary Creature: Test Angel$/);
    assert.match(decodeURIComponent(mock.stats.search[mock.stats.search.length - 1].q), /q=is:commander game:paper name:atrax&order=edhrec/);
    await page.click('#suggestA button.pick');
    assert.equal(await page.inputValue('#cmdA'), "Atraxa, Praetors' Voice");
    assert.equal(await page.isVisible('#suggestA'), false);
    const decks = await page.locator('#foundA .found-decks li b').allTextContents();
    assert.deepEqual(decks, ['Breed Lethality', 'Starter deck'], 'the official deck is offered first, then the starter deck');
    assert.match(await page.locator('#foundA .found-decks small').first().textContent(), /^Official deck from 20\d\d, 100 cards$/);
    const links = await page.locator('#foundA .found-links a').evaluateAll((as) => as.map((a) => [a.textContent, a.href, a.target, a.rel]));
    assert.deepEqual(links.map((l) => l[0]), ['Most viewed decks on Archidekt', 'The average deck on EDHREC', 'Browse decks on Moxfield']);
    assert.equal(links[1][1], 'https://edhrec.com/average-decks/atraxa-praetors-voice');
    assert.ok(links.every((l) => l[2] === '_blank' && /noopener/.test(l[3])));
    await page.locator('#step-lists').screenshot({ path: path.join(OUT, '10-commander-found.png') });

    await page.click('#foundA .found-decks button');
    await idle(page);
    assert.equal(mock.stats.decks.length, 1);
    assert.match(mock.stats.decks[0].file, /^BreedLethality_/);
    const box = await page.inputValue('#deckA');
    assert.deepEqual(box.split('\n').slice(0, 5), ['Commander', "1 Atraxa, Praetors' Voice (C16) 28", '', 'Deck', '1 Arcane Signet (PLST) ELD-331']);
    assert.ok(box.includes('\n1 Twin Face\n') || box.endsWith('\n1 Twin Face'), 'a same-face card is asked for by name');
    assert.ok(!/Germ/.test(box), 'tokens are not part of the deck');
    assert.match(await page.textContent('#foundA .status'), /Stand-in Deck|Breed Lethality is in the box below\. 9 cards found\..*second deck/);
    const st = await page.evaluate(() => { const s = window.__dtp.state; return { n: s.plan.slots.length, counts: s.plan.counts, bad: s.decks[0].filter((e) => e.status !== 'ok').map((e) => e.name), sections: s.decks[0].map((e) => e.section) }; });
    assert.equal(st.n, 9);
    assert.deepEqual(st.bad, []);
    assert.equal(st.sections[0], 'commander');
    assert.equal(await page.isVisible('#download'), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await test('no ready-made deck: links out, then Paste brings a copied list in, and it can be undone', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.fill('#deckB', '1 Cultivate');
    await page.fill('#cmdB', 'nodeck');
    await page.waitForSelector('#suggestB button.pick');
    await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#cmdB'), 'Zzz Nodeck, the Unlisted');
    assert.match(await page.textContent('#foundB'), /No official ready-made deck is led by this commander\./);
    assert.equal(await page.locator('#foundB .found-links a').count(), 3);
    await page.evaluate(() => navigator.clipboard.writeText('this is not a list'));
    await page.click('#foundB .found-actions .btn-small');
    await page.waitForFunction(() => /does not look like a deck list/.test(document.querySelector('#foundB .status').textContent));
    assert.equal(await page.inputValue('#deckB'), '1 Cultivate');
    await page.evaluate(() => navigator.clipboard.writeText('https://archidekt.com/decks/123/some_deck'));
    await page.click('#foundB .found-actions .btn-small');
    await page.waitForFunction(() => /web address, not the list/.test(document.querySelector('#foundB .status').textContent));
    assert.equal(await page.inputValue('#deckB'), '1 Cultivate');
    await page.evaluate(() => navigator.clipboard.writeText('1 Zzz Nodeck, the Unlisted (CMR) 1 *F*\n1 Sol Ring (C21) 263\n2 Forest\n\nSIDEBOARD:\n1 Counterspell'));
    await page.click('#foundB .found-actions .btn-small');
    await page.waitForFunction(() => /Pasted\./.test(document.querySelector('#foundB .status').textContent), null, { timeout: 60000 });
    assert.match(await page.textContent('#foundB .status'), /Pasted\. 5 cards found\./);
    assert.match(await page.inputValue('#deckB'), /^1 Zzz Nodeck, the Unlisted \(CMR\) 1 \*F\*\n1 Sol Ring/);
    assert.equal(await page.evaluate(() => window.__dtp.state.plan.slots.length), 5);
    assert.equal(await page.isVisible('#foundB .found-actions .btn-quiet'), true);
    await page.click('#foundB .found-actions .btn-quiet');
    await page.waitForFunction(() => /Your old list is back/.test(document.querySelector('#foundB .status').textContent), null, { timeout: 60000 });
    assert.equal(await page.inputValue('#deckB'), '1 Cultivate');
    assert.equal(await page.evaluate(() => window.__dtp.state.plan.slots.length), 1);
    // typing a different name clears the choice; nothing found says so
    await page.fill('#cmdB', 'qqqq');
    await page.waitForFunction(() => /No commander found/.test(document.getElementById('suggestB').textContent));
    assert.equal(await page.isVisible('#foundB'), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#suggestB'), false);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await test('a deck list that cannot be fetched leaves the box alone and says so', async () => {
    const { ctx, page } = await freshPage(browser);
    await page.fill('#deckA', '1 Sol Ring');
    await page.fill('#cmdA', 'atraxa praetors');
    await page.waitForSelector('#suggestA button.pick');
    await page.click('#suggestA button.pick');
    mock.flags.failDeck = true;
    try {
      await page.click('#foundA .found-decks button');
      await page.waitForFunction(() => /Could not get that deck list/.test(document.querySelector('#foundA .status').textContent));
    } finally { mock.flags.failDeck = false; }
    assert.equal(await page.inputValue('#deckA'), '1 Sol Ring');
    await ctx.close();
  });

  await test('deck view: cards by type, remove one, put it back, and edits flag what follows', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    await page.fill('#cmdA', 'atraxa praetors');
    await page.waitForSelector('#suggestA button.pick');
    await page.click('#suggestA button.pick');
    await page.click('#foundA .found-decks button');
    await idle(page);
    await page.fill('#deckB', '1 Cultivate\n2 Forest');
    assert.equal(await page.isVisible('#stale'), true, 'editing a list flags the steps after it');
    assert.equal(await page.isDisabled('#download'), true);
    assert.match(await page.textContent('#dlStatus'), /lists changed/);
    await page.click('#staleFind');
    await idle(page);
    assert.equal(await page.isVisible('#stale'), false);
    assert.equal(await page.isDisabled('#download'), false);

    assert.equal(await page.getAttribute('#viewPrinted', 'aria-pressed'), 'true');
    assert.equal(await page.isVisible('#proof'), true);
    await page.click('#viewDecks');
    assert.equal(await page.isVisible('#proof'), false);
    assert.equal(await page.getAttribute('#viewDecks', 'aria-pressed'), 'true');
    assert.deepEqual(await page.locator('#deckView .deck-sheet h3').allTextContents(), ['Deck 1: 9 cards', 'Deck 2: 3 cards']);
    const heads = await page.locator('#deckView .deck-a h4').allTextContents();
    assert.equal(heads[0], 'Commander (1)');
    assert.ok(heads.includes('Lands (3)'), heads.join(' | '));
    assert.equal(await page.locator('#deckView .deck-a .tile .qty').textContent(), '\u00d73');
    await page.locator('#step-check').screenshot({ path: path.join(OUT, '11-deck-view.png') });

    await page.click('#deckView .deck-a button.tile-remove[aria-label="Remove Sol Ring from deck 1"]');
    await idle(page);
    assert.ok(!/Sol Ring/.test(await page.inputValue('#deckA')), 'the list in step 1 was edited');
    assert.match(await page.textContent('#viewStatus'), /Removed Sol Ring from deck 1\./);
    assert.equal(await page.locator('#deckView .deck-sheet h3').first().textContent(), 'Deck 1: 8 cards');
    assert.equal(await page.evaluate(() => window.__dtp.state.plan.counts[0]), 8);
    await page.click('#viewUndo');
    await idle(page);
    assert.match(await page.inputValue('#deckA'), /1 Sol Ring \(C16\) 272/);
    assert.equal(await page.locator('#deckView .deck-sheet h3').first().textContent(), 'Deck 1: 9 cards');
    assert.equal(await page.isVisible('#viewUndo'), false);

    // artwork from the deck view, narrowed by typing an artist
    await page.click('#deckView .deck-a button.tile[aria-label^="Sol Ring"]');
    await page.waitForSelector('#picker[open]');
    await page.waitForFunction(() => document.querySelectorAll('#prints .print').length === 2);
    assert.match(await page.locator('#prints li:not([hidden]) .print small').first().textContent(), /^Art by Ann Example$/);
    await page.fill('#pickerFilter', 'sample');
    assert.equal(await page.locator('#prints li:not([hidden])').count(), 1);
    assert.match(await page.textContent('#pickerStatus'), /1 version matches\..*Show more versions/);
    await page.fill('#pickerFilter', 'oldham');
    assert.equal(await page.locator('#prints li:not([hidden])').count(), 0);
    assert.match(await page.textContent('#pickerStatus'), /No version here matches that\. Press Show more versions/);
    await page.click('#pickerMore');
    await page.waitForFunction(() => document.querySelectorAll('#prints li:not([hidden])').length === 1 && document.getElementById('pickerMore').hidden);
    assert.match(await page.locator('#prints li:not([hidden]) .print small').textContent(), /^Art by Cy Oldham, old frame, white border$/);
    await page.fill('#pickerFilter', 'old frame 1995');
    assert.equal(await page.locator('#prints li:not([hidden])').count(), 1);
    await page.locator('#picker').screenshot({ path: path.join(OUT, '12-picker-filter.png') });
    await page.click('#prints li:not([hidden]) .print');
    await page.waitForFunction(() => !document.getElementById('picker').open);
    const chosen = await page.evaluate(() => { const e = window.__dtp.state.decks[0].find((x) => x.name === 'Sol Ring'); return e.card.set + '|' + e.card.artist; });
    assert.equal(chosen, 'wht|Cy Oldham');
    assert.match(await page.locator('#deckView .deck-a button.tile[aria-label^="Sol Ring"] img').getAttribute('src'), /white/);

    await page.click('#viewPrinted');
    assert.equal(await page.isVisible('#proof'), true);
    assert.equal(await page.isVisible('#deckView'), false);
    await download(page, chainZip);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await test('the download carries an order file that pairs every front with its back', async () => {
    const { dir, files } = unzip(chainZip);
    assert.ok(files.includes('cards.xml'));
    const xml = fs.readFileSync(path.join(dir, 'cards.xml'), 'utf8');
    const part = (tag) => (new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(xml) || [])[1] || '';
    const cards = (text) => (text.match(/<card>.*?<\/card>/g) || []).map((c) => ({ id: /<id>(.*?)<\/id>/.exec(c)[1].replace(/&amp;/g, '&'), slot: Number(/<slots>(\d+)<\/slots>/.exec(c)[1]), source: /<sourceType>(.*?)<\/sourceType>/.exec(c)[1] }));
    const fronts = cards(part('fronts')), backs = cards(part('backs'));
    assert.equal(part('quantity'), '9');
    assert.equal(fronts.length, 9);
    assert.equal(backs.length, 9);
    assert.deepEqual(fronts.map((c) => c.slot), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(backs.map((c) => c.slot), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    fronts.concat(backs).forEach((c) => { assert.equal(c.source, 'Local File'); assert.ok(files.includes(c.id), 'file is in the download: ' + c.id); });
    assert.equal(files.filter((f) => /\.jpg$/.test(f)).length, 18, 'every picture in the download is used exactly once');
    assert.match(fronts[0].id, /^fronts\/F001 Delver of Secrets\.jpg$/);
    assert.match(backs[0].id, /^backs\/B001 Insectile Aberration\.jpg$/);
    // the same file, read by the rules the helper program applies
    const check = JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'orderfile_check.py'), dir]).toString());
    assert.deepEqual(check.problems, []);
    assert.equal(check.quantity, 9);
    assert.equal(check.stock, '(S30) Standard Smooth');
    assert.equal(check.foil, false);
    assert.deepEqual(check.fronts, fronts.map((c) => c.id));
    assert.deepEqual(check.backs, backs.map((c) => c.id));
    const txt = fs.readFileSync(path.join(dir, 'HOW TO ORDER.txt'), 'utf8');
    assert.match(txt, /HANDS-FREE, WITH A HELPER PROGRAM/);
    assert.match(txt, /cards\.xml/);
  });

  console.log('more automation');
  await test('any commander can get a starter deck built, then go straight to the download', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    mock.stats.starter.length = 0;
    await page.fill('#cmdA', 'kaalia');
    await page.waitForSelector('#suggestA button.pick');
    await page.click('#suggestA button.pick');
    assert.match(await page.textContent('#foundA'), /Starter deck/);
    assert.equal(await page.isVisible('#foundA .found-go'), false);
    await page.click('#foundA .starter-build');
    await page.waitForFunction(() => /starter deck is in the box below|Could not/.test(document.querySelector('#foundA .status').textContent), null, { timeout: 60000 });
    assert.match(await page.textContent('#foundA .status'), /A starter deck is in the box below\. 100 cards found\./);
    assert.equal(mock.stats.starter.length, 8, 'one search per job');
    assert.ok(mock.stats.starter.every((q) => q.startsWith('id<=wu legal:commander game:paper ')), mock.stats.starter[0]);
    const box = (await page.inputValue('#deckA')).split('\n');
    assert.deepEqual(box.slice(0, 5), ['Commander', '1 Kaalia of the Vast (CMR) 1', '', 'Deck', '// Lands']);
    assert.ok(box.includes('// Angel creatures') && box.includes('19 Plains') || box.includes('// Angel creatures'), box.filter((l) => l.startsWith('//')).join(' '));
    assert.equal(box.filter((l) => l === '1 Ramp Pick 1 (CMR) 101').length, 1, 'a card that fits two jobs is listed once');
    assert.ok(!box.some((l) => /^1 Island/.test(l)), 'basic lands come from the count, not the land search');
    const st = await page.evaluate(() => { const s = window.__dtp.state; return { n: s.plan.slots.length, bad: s.decks[0].filter((e) => e.status !== 'ok').length, cmd: s.decks[0].filter((e) => e.section === 'commander').length, heads: s.decks[0].headings.length }; });
    assert.deepEqual(st, { n: 100, bad: 0, cmd: 1, heads: 0 });

    // the short way: download from the commander box
    assert.equal(await page.isVisible('#foundA .found-go'), true);
    const zip = path.join(OUT, 'starter.zip');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('#foundA .found-go')]);
    await dl.saveAs(zip);
    const modes = JSON.parse(execFileSync('python3', ['-I', '-c', 'import json, sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({i.filename: oct((i.external_attr >> 16) & 0o777) for i in z.infolist() if "/" not in i.filename}))', zip]).toString());
    assert.deepEqual(modes, { 'HOW TO ORDER.txt': '0o644', 'cards.xml': '0o644', 'Start order - Windows.bat': '0o644', 'Start order - Mac or Linux.command': '0o755' });
    const { dir } = unzip(zip);
    assert.equal(fs.readFileSync(path.join(dir, 'Start order - Windows.bat'), 'utf8'), C.startFileWindows());
    assert.equal(fs.readFileSync(path.join(dir, 'Start order - Mac or Linux.command'), 'utf8'), C.startFileUnix());
    assert.match(fs.readFileSync(path.join(dir, 'HOW TO ORDER.txt'), 'utf8'), /double-click "Start order - Windows\.bat"/);
    assert.deepEqual(JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'orderfile_check.py'), dir]).toString()).problems, []);

    // a creature type with hardly any cards is not used as a theme
    mock.flags.kinPool = 3;
    try {
      await page.waitForFunction(() => !document.getElementById('find').disabled && !document.getElementById('download').disabled);
      await page.click('#foundA .starter-build');
      await page.waitForFunction(() => /starter deck is in the box below\. 100 cards found/.test(document.querySelector('#foundA .status').textContent) && !/Angel creatures/.test(document.getElementById('deckA').value), null, { timeout: 60000 });
    } finally { mock.flags.kinPool = null; }
    assert.equal(await page.isVisible('#foundA .found-actions .btn-quiet'), true, 'the earlier list can be put back');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  console.log('pairing by hand');
  const pairsOf = (page) => page.evaluate(() => window.__dtp.state.plan.slots.map((x) => x.front.name + '/' + x.back.name));

  await test('double-faced commander: the other commander stands alone, and its plain side can be filled', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    await page.fill('#deckA', 'Commander\n1 Delver of Secrets // Insectile Aberration\n\nDeck\n1 Sol Ring\n1 Island');
    await page.fill('#deckB', 'Commander\n1 Krenko Test\n\nDeck\n1 Cultivate\n1 Forest');
    await find(page);
    assert.deepEqual(await pairsOf(page), ['Delver of Secrets/Insectile Aberration', 'Sol Ring/Cultivate', 'Island/Forest', 'plain side/Krenko Test']);
    assert.match(await page.textContent('#proofHint'), /Select a plain side to fill it/);
    const blank = page.locator('#proof .slot:nth-child(4) button.face.blank');
    assert.equal(await blank.getAttribute('aria-label'), 'Plain front of card 004. Fill it with a card.');
    await blank.click();
    await page.waitForSelector('#picker[open]');
    assert.equal(await page.textContent('#pickerTitle'), 'Fill the plain front of card 004');
    assert.equal(await page.textContent('#pickerFilterLabel'), 'Card name');
    await page.fill('#pickerFilter', 'nothing here');
    await page.waitForFunction(() => /No card found with that name/.test(document.getElementById('pickerStatus').textContent));
    await page.fill('#pickerFilter', 'spare');
    await page.waitForFunction(() => document.querySelectorAll('#prints .print').length === 2);
    assert.deepEqual(await page.locator('#prints .print b').allTextContents(), ['Spare', 'Spare Two'], 'the double-faced match is left out');
    assert.equal(mock.stats.fill[mock.stats.fill.length - 1].extras, 'true', 'tokens are searched too');
    await page.locator('#picker').screenshot({ path: path.join(OUT, '16-fill-side.png') });
    await page.click('#prints li:nth-child(2) .print');
    await page.waitForFunction(() => /now fills that side/.test(document.getElementById('viewStatus').textContent), null, { timeout: 60000 });
    assert.ok((await page.inputValue('#deckA')).endsWith('1 Island\n\nExtras\n1 Spare Two (CMR) 8'));
    assert.deepEqual(await pairsOf(page), ['Delver of Secrets/Insectile Aberration', 'Sol Ring/Cultivate', 'Island/Forest', 'Spare Two/Krenko Test']);
    assert.equal(await page.locator('#proof button.face.blank').count(), 0);
    assert.equal(await page.textContent('#viewUndo'), 'Take it out again');
    await page.click('#viewUndo');
    await page.waitForFunction(() => /Taken out again/.test(document.getElementById('viewStatus').textContent), null, { timeout: 60000 });
    assert.ok(!/Extras/.test(await page.inputValue('#deckA')));
    assert.deepEqual((await pairsOf(page))[3], 'plain side/Krenko Test');
    // the artwork picker still works after the dialog was used for a search
    await page.click('#proof .slot:nth-child(2) button.face[data-side="front"]');
    await page.waitForFunction(() => document.querySelectorAll('#prints .print').length === 2);
    assert.equal(await page.textContent('#pickerFilterLabel'), 'Show only');
    assert.match(await page.textContent('#pickerTitle'), /Choose artwork for Sol Ring/);
    await page.click('#pickerClose');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await test('drag a card onto another, or use Move a card, and the move sticks', async () => {
    const { ctx, page, errors } = await freshPage(browser);
    await page.fill('#deckA', '1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Island');
    await page.fill('#deckB', '1 Cultivate\n1 Llanowar Elves\n1 Forest');
    await find(page);
    assert.deepEqual(await pairsOf(page), ['Sol Ring/Cultivate', 'Arcane Signet/Llanowar Elves', 'Command Tower/Forest', 'Island/plain side']);
    assert.equal(await page.isVisible('#moveMode'), true);
    await page.waitForTimeout(700);   // the page scrolls smoothly to step 2 after a search; let it settle before dragging
    // drag the back of card 1 onto card 3
    await page.dragAndDrop('#proof .slot:nth-child(1) button.face[data-side="back"]', '#proof .slot:nth-child(3) .pair');
    await page.waitForFunction(() => /Swapped the backs of cards 001 and 003/.test(document.getElementById('viewStatus').textContent));
    assert.deepEqual(await pairsOf(page), ['Sol Ring/Forest', 'Arcane Signet/Llanowar Elves', 'Command Tower/Cultivate', 'Island/plain side']);
    // a back dragged onto the card with a plain back swaps with the plain side
    await page.dragAndDrop('#proof .slot:nth-child(2) button.face[data-side="back"]', '#proof .slot:nth-child(4) .pair');
    await page.waitForFunction(() => /cards 002 and 004/.test(document.getElementById('viewStatus').textContent));
    assert.deepEqual(await pairsOf(page), ['Sol Ring/Forest', 'Arcane Signet/plain side', 'Command Tower/Cultivate', 'Island/Llanowar Elves']);
    await page.locator('#step-check').screenshot({ path: path.join(OUT, '17-moved.png') });
    // without dragging: Move a card, select a front, select where it goes
    await page.click('#moveMode');
    assert.equal(await page.getAttribute('#moveMode', 'aria-pressed'), 'true');
    await page.click('#proof .slot:nth-child(1) button.face[data-side="front"]');
    assert.equal(await page.isVisible('#picker'), false, 'in move mode a click selects, it does not open the artwork picker');
    assert.match(await page.textContent('#viewStatus'), /Now select the card it should go to/);
    await page.click('#proof .slot:nth-child(3) button.face[data-side="back"]');
    assert.equal(await page.getAttribute('#moveMode', 'aria-pressed'), 'false');
    const moved = ['Command Tower/Forest', 'Arcane Signet/plain side', 'Sol Ring/Cultivate', 'Island/Llanowar Elves'];
    assert.deepEqual(await pairsOf(page), moved);
    // the moves survive new artwork and a new search
    await page.click('#proof .slot:nth-child(1) button.face[data-side="front"]');
    await page.waitForFunction(() => document.querySelectorAll('#prints .print').length === 2);
    await page.click('#prints li:nth-child(2) .print');
    await page.waitForFunction(() => !document.getElementById('picker').open);
    assert.deepEqual(await pairsOf(page), moved);
    await find(page);
    assert.deepEqual(await pairsOf(page), moved);
    assert.equal(await page.evaluate(() => window.__dtp.state.swaps.length), 3);
    // undo takes back the last move only
    await page.click('#moveMode');
    await page.click('#proof .slot:nth-child(4) button.face[data-side="back"]');
    await page.click('#proof .slot:nth-child(1) .pair');
    assert.equal(await page.textContent('#viewUndo'), 'Undo the move');
    await page.click('#viewUndo');
    assert.deepEqual(await pairsOf(page), moved);
    // the files follow the moves
    const zip = path.join(OUT, 'moved.zip');
    await download(page, zip);
    const { dir, files } = unzip(zip);
    assert.ok(files.includes('fronts/F001 Command Tower.jpg') && files.includes('backs/B001 Forest.jpg') && files.includes('backs/B002 plain side.jpg') && files.includes('backs/B004 Llanowar Elves.jpg'), files.join(', '));
    assert.deepEqual(JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'orderfile_check.py'), dir]).toString()).problems, []);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
