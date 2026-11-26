/* Live check of the print files: real lists, real Scryfall lookups, real card scans.
   Checks the files by measurement, and saves only thin edge strips for a look at the proxy line. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const sharp = require('sharp');

const OUT = path.resolve(__dirname, '../out');
const A = ['1 Delver of Secrets (ISD) 51', '1 Sol Ring (C21) 263', '1 Fire // Ice (MH2) 290', "1 Atraxa, Praetors' Voice (2X2) 190", '1 Counterspell (7ED) 67', '1 Island (UST) 213', '1 Bonecrusher Giant', '2 Plains'].join('\n');
const B = ['1 Llanowar Elves', '1 Lightning Bolt (2XM) 117', '1 Swords to Plowshares', '1 Forest (UST) 216', '1 Command Tower', "1 Agadeem's Awakening // Agadeem, the Undercrypt", '1 Nicol Bolas, the Ravager'].join('\n');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '../../docs/index.html'));
  await page.fill('#deckA', A);
  await page.fill('#deckB', B);
  await page.click('#find');
  await page.waitForFunction(() => !document.getElementById('find').disabled, null, { timeout: 120000 });
  const plan = await page.evaluate(() => { const p = window.__dtp.state.plan; return { tally: document.getElementById('tally').textContent, size: document.getElementById('orderSize').textContent, notes: document.getElementById('tallyNotes').textContent, problems: document.getElementById('problems').textContent, slots: p.slots.map((s) => [s.front.name, s.back.name, s.double]) }; });
  console.log(plan.tally, '|', plan.size.slice(0, 60));
  console.log('notes:', plan.notes);
  if (plan.problems) console.log('problems:', plan.problems);
  plan.slots.forEach((s, i) => console.log('  ' + String(i + 1).padStart(2) + '  ' + s[0] + '  |  ' + s[1] + (s[2] ? '  (double-faced)' : '')));
  const thumbs = await page.evaluate(() => Array.from(document.querySelectorAll('#proof img')).length);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#proof img')).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 });
  console.log('thumbnails loaded:', thumbs);

  const zip = path.join(OUT, 'live-export.zip');
  const t0 = Date.now();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.click('#download')]);
  await dl.saveAs(zip);
  console.log('download took', Date.now() - t0, 'ms |', await page.textContent('#dlStatus'));
  const infos = await page.evaluate(() => Array.from(window.__dtp.faceCache.entries()).map(([k, v]) => [k.replace(/^https:\/\/cards\.scryfall\.io\/png\//, '').slice(0, 60), v.info, v.size]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-live-'));
  execFileSync('unzip', ['-q', zip, '-d', dir]);
  execFileSync('python3', ['-I', '-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("zip ok,", len(z.namelist()), "files")', zip], { stdio: 'inherit' });
  const scans = {};
  infos.forEach(([k, info]) => { if (info) scans[info.scanWidth + 'x' + info.scanHeight] = (scans[info.scanWidth + 'x' + info.scanHeight] || 0) + 1; });
  console.log('scan sizes from Scryfall:', JSON.stringify(scans));
  console.log('margin treatment per picture:');
  infos.forEach(([k, info, size]) => console.log('   ' + (info ? (info.plainBorder ? 'plain border ' + info.fill : 'art to the edge (mirrored)') + ' at ' + JSON.stringify(info.placedAt) : 'plain side') + '  ' + Math.round(size / 1024) + ' KB  ' + k));

  const files = [];
  for (const side of ['fronts', 'backs']) for (const f of fs.readdirSync(path.join(dir, side)).sort()) files.push(side + '/' + f);
  let bad = 0;
  for (const f of files) {
    const img = sharp(path.join(dir, f));
    const meta = await img.metadata();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    const corners = [px(2, 2), px(819, 2), px(2, 1119), px(819, 1119)];
    const sides = [px(10, 561), px(811, 561), px(411, 10), px(411, 1111)];
    const inner = [px(46, 561), px(775, 561), px(411, 49), px(411, 1073)];
    const d = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    const seam = Math.max(d(sides[0], inner[0]), d(sides[1], inner[1]), d(sides[2], inner[2]), d(sides[3], inner[3]));
    const ok = meta.width === 822 && meta.height === 1122 && meta.density === 300 && meta.format === 'jpeg';
    if (!ok) bad++;
    console.log((ok ? '  ok ' : 'FAIL ') + f.padEnd(46) + meta.width + 'x' + meta.height + ' ' + meta.density + 'dpi  margin vs card edge difference ' + String(seam).padStart(3) + '  corner ' + corners[0].join(','));
  }
  // thin strips from the right edge, to look at where the proxy line sits on real frames (no artwork in view)
  const strips = files.filter((f) => /Sol Ring|Atraxa|Counterspell|Island|Delver|Fire/.test(f)).slice(0, 6);
  const parts = [];
  for (const f of strips) parts.push(await sharp(path.join(dir, f)).extract({ left: 822 - 39 - 44, top: 331, width: 83, height: 460 }).png().toBuffer());
  await sharp({ create: { width: parts.length * 93 + 10, height: 480, channels: 3, background: '#808080' } })
    .composite(parts.map((b, i) => ({ input: b, left: 10 + i * 93, top: 10 }))).png().toFile(path.join(OUT, 'live-edge-strips.png'));
  console.log('edge strips:', strips.join(' | '));
  console.log('page errors:', JSON.stringify(errors));
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
