/* Capture real export files from a public Archidekt deck using the site's own Export dialog.
   The samples are someone's public deck list, so they stay out of the repository (see .gitignore). */
const { chromium } = require('playwright');
const path = require('node:path');
require('node:fs').mkdirSync(path.resolve(__dirname, 'samples'), { recursive: true });
const DECK = process.argv[2] || '7031486';
const configs = (process.argv[3] || 'text-default,text-plain,text-header-category,text-header-generic,text-plain-header-generic,arena,text-no-maybe').split(',').map((name) => ({
  'text-default': { name, steps: [] },
  'text-plain': { name, steps: [['Export options', 'Uncheck all']] },
  'text-header-category': { name, steps: [['Section header', 'Primary category']] },
  'text-header-type': { name, steps: [['Section header', 'Card type']] },
  'text-header-generic': { name, steps: [['Section header', 'Generic (eg: Commander, Mainboard, Sideboard)']] },
  'text-plain-header-generic': { name, steps: [['Export options', 'Uncheck all'], ['Section header', 'Generic (eg: Commander, Mainboard, Sideboard)']] },
  'text-front-only': { name, steps: [], frontOnly: true },
  'text-no-maybe': { name, steps: [], noMaybe: true },
  'arena': { name, steps: [['Export type', 'Arena']], copy: true }
}[name]));
(async () => {
  // what Archidekt itself says the deck holds: the exact Scryfall id of every printing
  const res = await fetch('https://archidekt.com/api/decks/' + DECK + '/', { headers: { Accept: 'application/json' } });
  if (res.ok) require('node:fs').writeFileSync(path.resolve(__dirname, 'samples', 'archidekt-' + DECK + '.json'), await res.text());
  else console.log('could not save the deck data: HTTP ' + res.status);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  for (const cfg of configs) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    try {
      await page.goto('https://archidekt.com/decks/' + DECK, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4500);
      await page.getByRole('button', { name: 'More', exact: true }).first().click();
      await page.waitForTimeout(700);
      await page.getByText(/^Export/i).first().click();
      const box = page.locator('[class^="export_content"]');
      await box.waitFor({ timeout: 15000 });
      for (const [label, option] of cfg.steps) {
        const container = box.locator('[class*="phatDropdown_container"]').filter({ has: page.locator('label', { hasText: new RegExp('^' + label + '$') }) }).first();
        await container.locator('[class*="phatDropdown_trigger__"]').first().click();
        await page.waitForTimeout(400);
        await container.locator('[class*="menu_menu"]').getByText(option, { exact: true }).first().click();
        await page.waitForTimeout(500);
        await box.locator('h3').first().click().catch(() => {});   // closes a menu that stays open
        await page.waitForTimeout(300);
      }
      if (cfg.frontOnly) { await box.getByText('Use front name only for MDFC cards').click(); await page.waitForTimeout(300); }
      if (cfg.noMaybe) { await box.getByText('Include out of deck cards').click(); await page.waitForTimeout(300); }
      const example = await box.locator('[class*="xample"]').last().innerText().catch(() => '');
      const out = path.resolve(__dirname, 'samples', 'archidekt-' + DECK + '-' + cfg.name + '.txt');
      if (cfg.copy) {
        await box.getByRole('button', { name: 'Copy' }).click();
        await page.waitForTimeout(600);
        const text = await page.evaluate(() => navigator.clipboard.readText());
        require('node:fs').writeFileSync(out, text);
        console.log('ok  ' + cfg.name + '  copied ' + text.length + ' chars  example=' + example.replace(/\s+/g, ' ').slice(0, 90));
      } else {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), box.getByRole('button', { name: 'Download' }).click()]);
        await dl.saveAs(out);
        console.log('ok  ' + cfg.name + '  file=' + dl.suggestedFilename() + '  example=' + example.replace(/\s+/g, ' ').slice(0, 90));
      }
    } catch (e) {
      console.log('ERR ' + cfg.name + ': ' + e.message.split('\n')[0]);
      await page.screenshot({ path: path.resolve(__dirname, '../out/live-archidekt-err-' + cfg.name + '.png') }).catch(() => {});
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error('ERR', e.message.split('\n')[0]); process.exit(1); });
