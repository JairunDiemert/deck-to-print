/* Run one sample through the real page against live Scryfall and print what happened. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const file = process.argv[2];
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => console.log('request failed:', r.method(), r.url().slice(0, 90), r.failure() && r.failure().errorText));
  page.on('response', (r) => { if (r.url().includes('api.scryfall.com')) console.log('api', r.request().method(), r.status(), r.url().slice(24, 90)); });
  await page.goto('file://' + path.resolve(__dirname, '../../docs/index.html'));
  await page.fill('#deckA', fs.readFileSync(file, 'utf8'));
  await page.click('#find');
  await page.waitForFunction(() => !document.getElementById('find').disabled, null, { timeout: 180000 });
  const res = await page.evaluate(() => {
    const s = window.__dtp.state;
    return { status: document.getElementById('status').textContent, n: s.decks[0].length, slots: s.plan ? s.plan.slots.length : 0,
      odd: s.decks[0].filter((e) => e.status !== 'ok' || (e.set && e.card && (e.card.set !== e.set || String(e.card.collector_number) !== String(e.cn)))).map((e) => [e.name, e.set, e.cn, e.status, e.card && (e.card.set + ' ' + e.card.collector_number)]) };
  });
  console.log(JSON.stringify(res, null, 1).slice(0, 3000));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
