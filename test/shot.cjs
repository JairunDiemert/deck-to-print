/* Makes the preview picture: the example lists, found and paired. Card pictures are test placeholders. */
const path = require('node:path');
const { chromium } = require('playwright');
const mock = require('./mock.cjs');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 860, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await mock.install(page);
  await page.goto('file://' + path.resolve(__dirname, '../docs/index.html'));
  await page.click('#example');
  await page.waitForFunction(() => !document.getElementById('find').disabled && document.querySelectorAll('#proof .slot').length > 0);
  await page.evaluate(() => document.querySelectorAll('#proof img').forEach((i) => { i.loading = 'eager'; }));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#proof img')).every((i) => i.complete && i.naturalWidth > 0));
  await page.evaluate(() => window.scrollTo(0, 0));
  const bottom = await page.evaluate(() => { const r = document.getElementById('step-print').getBoundingClientRect(); return Math.round(r.top + window.scrollY + 150); });
  await page.screenshot({ path: path.resolve(__dirname, 'out/deck-to-print-preview.png'), fullPage: true, clip: { x: 0, y: 0, width: 860, height: bottom } });
  await page.click('.options summary');
  await page.locator('.options').screenshot({ path: path.resolve(__dirname, 'out/11-options.png') });
  await browser.close();
  console.log('shot ok, height', bottom);
})().catch((e) => { console.error(e); process.exit(1); });
