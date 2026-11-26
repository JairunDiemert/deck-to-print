/* Cross-site behaviour through the browser's real network stack.
   A local HTTPS server plays Scryfall; Chrome is told to resolve the two Scryfall host names to it.
   Nothing here leaves this machine. Run: NODE_PATH=/opt/npm-tools/node_modules node test/realnet.cjs

   What this can show: how the page behaves for each way a server might answer a page opened from a file
   (which announces itself with "Origin: null") or from a web address.
   What it cannot show: which of those ways the real Scryfall servers answer. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const mock = require('./mock.cjs');

const DIST = path.resolve(__dirname, '../docs/index.html');
const FILE_PAGE = 'file://' + DIST;
const WEB_PAGE = 'http://localhost:8080/deck-to-print.html';
const OUT = path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log('  ok  ' + name + '  (' + (Date.now() - t0) + ' ms)'); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n      ')); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-tls-'));
  const key = path.join(tmp, 'key.pem'), cert = path.join(tmp, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2',
    '-subj', '/CN=api.scryfall.com', '-addext', 'subjectAltName=DNS:api.scryfall.com,DNS:cards.scryfall.io'], { stdio: 'ignore' });
  const api = await mock.serve(https, { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, 8443);
  const site = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(DIST)); });
  await new Promise((r) => site.listen(8080, '127.0.0.1', r));

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--no-proxy-server', '--ignore-certificate-errors',
      '--host-resolver-rules=MAP api.scryfall.com 127.0.0.1:8443, MAP cards.scryfall.io 127.0.0.1:8443']
  });

  async function open(url) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(url);
    return { ctx, page };
  }
  async function runExample(page) {
    await page.click('#example');
    await page.waitForFunction(() => !document.getElementById('find').disabled, null, { timeout: 60000 });
    return page.evaluate(() => ({ status: document.getElementById('status').textContent, slots: window.__dtp.state.plan ? window.__dtp.state.plan.slots.length : 0 }));
  }
  async function tryDownload(page, name) {
    const got = page.waitForEvent('download', { timeout: 20000 }).then((d) => d.saveAs(path.join(OUT, name)).then(() => 'saved'), () => 'no download');
    await page.click('#download');
    const result = await got;
    await page.waitForFunction(() => !document.getElementById('download').disabled, null, { timeout: 60000 });
    return { result, text: await page.textContent('#dlStatus') };
  }
  const reset = (cors, corsImages) => { mock.flags.cors = cors; mock.flags.corsImages = corsImages || null; mock.stats.collection.length = 0; mock.stats.preflight = 0; };

  console.log('page opened from a file (double-clicked)');
  await test('server allows everyone (Access-Control-Allow-Origin: *): lookups, pictures and download all work', async () => {
    reset('star');
    const { ctx, page } = await open(FILE_PAGE);
    const r = await runExample(page);
    assert.equal(r.slots, 8, r.status);
    assert.equal(mock.stats.collection[0].origin, 'null');
    assert.ok(mock.stats.preflight >= 1, 'the browser asked permission first (preflight)');
    const d = await tryDownload(page, 'realnet-file-star.zip');
    assert.equal(d.result, 'saved', d.text);
    assert.match(d.text, /Saved deck-print-files\.zip/);
    await ctx.close();
  });

  await test('server repeats the caller back (Access-Control-Allow-Origin: null): also works', async () => {
    reset('echo');
    const { ctx, page } = await open(FILE_PAGE);
    const r = await runExample(page);
    assert.equal(r.slots, 8, r.status);
    const d = await tryDownload(page, 'realnet-file-echo.zip');
    assert.equal(d.result, 'saved', d.text);
    await ctx.close();
  });

  await test('server only answers web addresses: the page says so plainly', async () => {
    reset('web-only');
    const { ctx, page } = await open(FILE_PAGE);
    const r = await runExample(page);
    assert.equal(r.slots, 0);
    assert.match(r.status, /Could not reach the card database/);
    assert.match(r.status, /open this page from a web address instead/);
    await page.locator('#step-lists').screenshot({ path: path.join(OUT, '10-file-refused.png') });
    await ctx.close();
  });

  await test('lookups allowed but the picture server only answers web addresses: cards show, download explains', async () => {
    reset('star', 'web-only');
    const { ctx, page } = await open(FILE_PAGE);
    const r = await runExample(page);
    assert.equal(r.slots, 8, r.status);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#proof img')).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 });
    const d = await tryDownload(page, 'realnet-should-not-exist.zip');
    assert.equal(d.result, 'no download');
    assert.match(d.text, /Could not download the picture for/);
    await ctx.close();
  });

  console.log('page opened from a web address (hosted)');
  await test('server only answers web addresses: everything works', async () => {
    reset('web-only');
    const { ctx, page } = await open(WEB_PAGE);
    const r = await runExample(page);
    assert.equal(r.slots, 8, r.status);
    assert.equal(mock.stats.collection[0].origin, 'http://localhost:8080');
    const d = await tryDownload(page, 'realnet-web.zip');
    assert.equal(d.result, 'saved', d.text);
    await ctx.close();
  });

  await test('server allows no other sites at all: clear message, no file-specific hint', async () => {
    reset('none');
    const { ctx, page } = await open(WEB_PAGE);
    const r = await runExample(page);
    assert.equal(r.slots, 0);
    assert.match(r.status, /Could not reach the card database/);
    assert.doesNotMatch(r.status, /web address instead/);
    await ctx.close();
  });

  await browser.close();
  api.close(); site.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
