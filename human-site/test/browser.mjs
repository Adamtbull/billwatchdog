/**
 * Repeatable local browser QA. No production mutations, no /go requests.
 * Requires Playwright and Chromium already installed, plus a real API snapshot:
 * BILLWATCH_PREVIEW_SNAPSHOT=/absolute/path/to/deals.json node test/browser.mjs
 * Optional PLAYWRIGHT_MODULE and CHROMIUM_PATH overrides for local/CI installs.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { handleHumanRequest } from '../src/app.mjs';
import { normalizeDeals, priceText } from '../src/data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = root + 'review/';
const report = { generatedAt: new Date().toISOString(), source: null, safety: 'Local preview only; external requests and /go requests blocked.', checks: [], browserErrors: [], screenshots: [], limitations: [] };
const check = (name, details = {}) => report.checks.push({ name, status: 'passed', ...details });
const require = createRequire(import.meta.url);
let server, browser;
await mkdir(output + 'screenshots', { recursive: true });
try {
  const snapshotPath = process.env.BILLWATCH_PREVIEW_SNAPSHOT;
  assert.ok(snapshotPath, 'Set BILLWATCH_PREVIEW_SNAPSHOT to an actual captured live /v1/deals.json response.');
  const raw = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const now = new Date();
  const data = normalizeDeals(raw, now);
  report.source = { path: snapshotPath, feedUpdated: raw.meta.updated, count: raw.deals.length, evaluationTime: now.toISOString() };
  // Stand-in for env.ASSETS: the captured feed, and no history files.
  const ASSETS = { fetch: async request => new URL(request.url).pathname === '/v1/deals.json' ? Response.json(raw) : new Response('No captured history is supplied', { status: 503 }) };
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/go/')) { res.writeHead(409); res.end('Local QA never exercises redirects or click counters.'); return; }
      if (url.pathname === '/assets/billwatch-human.css' || url.pathname === '/assets/billwatch-human.js') {
        const ext = url.pathname.endsWith('.css') ? 'css' : 'js';
        res.writeHead(200, { 'Content-Type': ext === 'css' ? 'text/css' : 'text/javascript' });
        res.end(await readFile(root + `public/assets/billwatch-human.${ext}`)); return;
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const response = await handleHumanRequest(new Request(url), { ASSETS }, undefined, { now, homepage: true });
      if (!response) { res.writeHead(404); res.end('Existing route is outside this local package.'); return; }
      let html = await response.text();
      if (response.headers.get('Content-Type')?.includes('text/html')) html = html.replace('<body>', '<body><div class="preview-banner">Local preview using a real captured API response. Source-check dates shown below. Outbound redirects disabled.</div>');
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(html);
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let playwright;
  try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
  catch { playwright = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
  browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const routes = [ ['home','/'], ['vpn','/vpn/'], ['streaming','/streaming/'], ['plan','/plans/nordvpn-basic-2-year-term/'], ['compare-vpn','/compare/nordvpn-vs-surfshark/'], ['compare-streaming','/compare/netflix-vs-hulu/'], ['disclosure','/affiliate-disclosure/'] ];
  let axe;
  try { axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { report.limitations.push('axe-core is not installed; no dependency was installed for this check.'); }
  const captureErrors = page => {
    page.on('pageerror', e => report.browserErrors.push({ type: 'pageerror', message: e.message, url: page.url() }));
    page.on('console', m => { if (m.type() === 'error') report.browserErrors.push({ type: 'console', message: m.text(), url: page.url() }); });
  };
  const guard = context => context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/go/')) return route.abort();
    return route.continue();
  });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1100 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    await guard(context);
    const page = await context.newPage(); captureErrors(page);
    for (const [name, path] of routes) {
      const response = await page.goto(origin + path, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, path);
      assert.equal(await page.locator('h1').count(), 1, `One primary heading: ${path}`);
      assert.equal(await page.locator('main').count(), 1, `One main landmark: ${path}`);
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert.ok(metrics.document <= viewport.width && metrics.body <= viewport.width, `Page overflow on ${path}: ${JSON.stringify(metrics)}`);
      const ctas = await page.getByRole('link', { name: /^Get deal/ }).evaluateAll(links => links.map(link => link.getAttribute('href')));
      assert.ok(ctas.every(href => /^\/go\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(href)), `CTA targets: ${path}`);
      const rows = await page.locator('table[data-sort-table] tbody tr').evaluateAll(rows => rows.map(row => ({ id: row.querySelector('th a').getAttribute('href').split('/')[2], price: row.dataset.price, billing: [...row.querySelector('.terms').childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(''), promotion: row.querySelector('.promo-terms p')?.textContent || null, displayed: row.querySelector('.table-price').textContent })));
      for (const row of rows) {
        const source = raw.deals.find(d => d.id === row.id); assert.ok(source, row.id);
        assert.equal(Number(row.price), source.price_usd_monthly, row.id);
        assert.equal(row.displayed, priceText(source.price_usd_monthly), row.id);
        assert.equal(row.billing, source.billing, row.id);
        assert.equal(row.promotion, source.promo || null, row.id);
      }
      const text = await page.locator('body').innerText();
      assert.ok(text.includes('Affiliate disclosure'), path);
      if (name === 'plan') {
        const plan = raw.deals.find(d => d.id === 'nordvpn-basic-2-year-term');
        assert.ok(text.includes(plan.billing)); assert.ok(text.includes(plan.checked_at));
        assert.ok(text.includes('Price history is temporarily unavailable')); assert.equal(await page.locator('.chart').count(), 0);
      }
      if (axe) {
        await page.evaluate(axe);
        const result = await page.evaluate(async () => await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } }));
        assert.deepEqual(result.violations, [], `Accessibility failures: ${path}`);
      }
      const screenshot = output + `screenshots/${name}-${viewport.name}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      report.screenshots.push(screenshot);
      check(`${name} ${viewport.name}`, { path, exactSourceRows: rows.length, dealLinks: ctas.length, metrics });
      await writeFile(output + 'ui-checks.json', JSON.stringify(report, null, 2));
      console.log(`CAPTURED ${screenshot}`);
    }
    await page.goto(origin + '/'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to content');
    await page.keyboard.press('Enter'); assert.equal(new URL(page.url()).hash, '#main');
    check(`Keyboard skip link ${viewport.name}`);
    await page.goto(origin + '/vpn/');
    const priceSort = page.locator('table[data-sort-table]').first().locator('[data-sort="price"]');
    await priceSort.focus(); await page.keyboard.press('Enter');
    const prices = await page.locator('table[data-sort-table]').first().locator('tbody tr').evaluateAll(rows => rows.map(r => Number(r.dataset.price)));
    assert.deepEqual(prices, [...prices].sort((a,b) => b-a));
    assert.equal(await priceSort.locator('..').getAttribute('aria-sort'), 'descending');
    assert.ok((await page.locator('[data-sort-status]').first().innerText()).includes('descending'));
    check(`Keyboard JavaScript numeric sort ${viewport.name}`);
    await context.close();
  }
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } }); await guard(noJs);
  const page = await noJs.newPage(); await page.goto(origin + '/vpn/');
  await page.locator('table[data-sort-table]').first().locator('[data-sort="price"]').click();
  assert.equal(new URL(page.url()).search, '?sort=price&direction=desc');
  const noJsPrices = await page.locator('table[data-sort-table]').first().locator('tbody tr').evaluateAll(rows => rows.map(r => Number(r.dataset.price)));
  assert.deepEqual(noJsPrices, [...noJsPrices].sort((a,b) => b-a)); check('No-JavaScript numeric sort');
  await noJs.close();
  assert.deepEqual(report.browserErrors, []); check('No JavaScript or browser-console errors');
  report.status = 'passed';
} catch (error) {
  report.status = 'blocked-or-failed'; report.error = { name: error.name, message: error.message.split('\n')[0] };
  await writeFile(output + 'browser-run.log', error.stack || error.message);
  console.error(error.message); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await writeFile(output + 'ui-checks.json', JSON.stringify(report, null, 2));
}
