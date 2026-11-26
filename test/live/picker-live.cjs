/* Live check of the artwork picker, typo handling and a two-sided token, against the real Scryfall. */
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '../../docs/index.html'));
  await page.fill('#deckA', ['1 Sol Rng', '1 Lightning Bolt (XYZ) 999', '1 Counterspell (7ED) 9999', '1 Treasure', '1 Totally Made Up Card Name', '1 Forest'].join('\n'));
  await page.click('#find');
  await page.waitForFunction(() => !document.getElementById('find').disabled, null, { timeout: 120000 });
  const got = await page.evaluate(() => window.__dtp.state.decks[0].map((e) => [e.name, e.status, e.card ? e.card.name + ' | ' + e.card.set + ' ' + e.card.collector_number + ' | sides ' + e.card.faces.length + ' | ' + e.card.layout : null]));
  got.forEach((g) => console.log('  ' + g.join('  ->  ')));
  console.log('problems:', (await page.textContent('#problems')).slice(0, 200));

  // artwork picker on the last card (Forest has hundreds of printings, so paging is exercised)
  const n = await page.locator('#proof .slot').count();
  await page.click('#proof .slot:nth-child(' + n + ') button.face');
  await page.waitForSelector('#picker[open]');
  await page.waitForFunction(() => document.querySelectorAll('#prints .print').length > 0 || /No other|Could not/.test(document.getElementById('pickerStatus').textContent), null, { timeout: 60000 });
  const first = await page.locator('#prints .print').count();
  const more = await page.isVisible('#pickerMore');
  console.log('picker:', await page.textContent('#pickerTitle'), '| versions on first page:', first, '| more to load:', more);
  if (more) {
    await page.click('#pickerMore');
    await page.waitForFunction((k) => document.querySelectorAll('#prints .print').length > k, first, { timeout: 60000 });
    console.log('after "Show more versions":', await page.locator('#prints .print').count());
  }
  const before = await page.evaluate((k) => { const c = window.__dtp.state.plan.slots[k - 1].front.card; return c.set + ' ' + c.collector_number; }, n);
  const label = (await page.locator('#prints li:nth-child(7) .print span').innerText()).replace(/\s+/g, ' ');
  await page.click('#prints li:nth-child(7) .print');
  await page.waitForFunction(() => !document.getElementById('picker').open);
  const after = await page.evaluate((k) => { const c = window.__dtp.state.plan.slots[k - 1].front.card; return c.set + ' ' + c.collector_number; }, n);
  console.log('picked the 7th version (' + label + '): ' + before + '  ->  ' + after);
  console.log('page errors:', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
