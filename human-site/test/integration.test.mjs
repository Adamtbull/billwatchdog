/**
 * Integration checks for the live-worker wiring described in RUNBOOK.md.
 *
 * The real _worker.js is not in this repository, so test/fixtures/live-worker.mjs stands in
 * for it, using the dispatch shape from the integration brief. These tests apply the two
 * RUNBOOK.md code blocks to that stand-in's text (import, paste and src variants, homepage
 * switch off and on), then compare every existing route against the unpatched stand-in:
 * status, headers, body bytes, which existing handlers ran, and every env.ASSETS read.
 *
 * Data comes from this repository's published mirror (v1/deals.json, llms.txt, agent.json),
 * so a schema change in the real feed that the human pages cannot handle fails here first.
 */
import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { blockNetwork, createAssets, createClicks, readRepo, json } from './helpers.mjs';
import { bundle, OUTPUT } from '../scripts/build.mjs';
import { ownsHumanRoute } from '../src/routes.mjs';
import { normalizeDeals } from '../src/data.mjs';

blockNetwork();
const ROOT = new URL('../', import.meta.url);
const DAY = 86_400_000;

// ---- Fixture data from the published mirror -------------------------------------------
const DEALS = readRepo('v1/deals.json');
const FEED = JSON.parse(DEALS);
// One day after the latest source check, so every fresh record in the mirror counts as verified.
const NOW = Math.max(...FEED.deals.map((d) => Date.parse(`${d.checked_at}T00:00:00Z`))) + DAY;
const NORMALIZED = normalizeDeals(FEED, new Date(NOW));
const PLAN = NORMALIZED.deals.find((d) => d.verified && d.plainProviderUrl && d.category === 'vpn');
const html = (title) => ({ body: `<!doctype html><title>${title}</title><p>${title}</p>`, type: 'text/html; charset=utf-8' });
const FILES = {
  '/': html('Agent homepage'),
  '/demo': html('Demo'),
  '/api': html('API docs'),
  '/privacy': html('Privacy'),
  '/privacy.html': { redirect: '/privacy' },
  '/disclosure': html('Disclosure'),
  '/llms.txt': { body: readRepo('llms.txt'), type: 'text/plain; charset=utf-8' },
  '/agent.json': { body: readRepo('agent.json'), type: 'application/json' },
  '/.well-known/agent.json': { body: readRepo('agent.json'), type: 'application/json' },
  '/v1/deals.json': { body: DEALS, type: 'application/json' },
  '/v1/deals/vpn.json': { body: readRepo('v1/deals/vpn.json'), type: 'application/json' },
  '/v1/deals/streaming.json': { body: readRepo('v1/deals/streaming.json'), type: 'application/json' },
  [`/v1/price-history/${PLAN.id}.json`]: json({ plan_id: PLAN.id, history: [{ date: PLAN.checked_at, price_usd_monthly: PLAN.price_usd_monthly }] }),
  '/assets/site.css': { body: 'body{margin:0}', type: 'text/css' },
};

const EXISTING = [
  ['GET', '/'], ['HEAD', '/'], ['GET', '/?from=agent'],
  ['GET', '/demo'], ['GET', '/api'], ['GET', '/privacy'], ['GET', '/privacy.html'], ['GET', '/disclosure'],
  ['GET', '/llms.txt'], ['HEAD', '/llms.txt'], ['GET', '/agent.json'], ['GET', '/.well-known/agent.json'],
  ['GET', '/v1/deals.json'], ['GET', '/v1/deals.json?client=test-agent'], ['HEAD', '/v1/deals.json'],
  ['GET', '/v1/deals/vpn.json'], ['GET', '/v1/deals/streaming.json'], ['GET', `/v1/price-history/${PLAN.id}.json`],
  ['GET', '/mcp'], ['OPTIONS', '/mcp'], ['POST', '/mcp', JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })],
  ['POST', '/api/events', '{"event":"view"}'], ['GET', '/api/agent-report'], ['GET', '/mcp-log.html'],
  ['GET', '/no-such-page'], ['GET', '/assets/site.css'], ['GET', '/go'], ['GET', '/plans'], ['GET', '/compare'],
  ['GET', '/VPN/'], ['GET', '/vpn.html'], ['GET', '/plans/Upper-Case/'], ['GET', '/compare/a/b'],
];
const HUMAN = ['/vpn/', '/streaming/', `/plans/${PLAN.id}/`, '/compare/nordvpn-vs-surfshark/', '/compare/netflix-vs-hulu/', '/affiliate-disclosure/'];

// ---- Build worker variants from the RUNBOOK.md blocks -----------------------------------
const runbook = await readFile(new URL('RUNBOOK.md', ROOT), 'utf8');
function block(marker) {
  const match = new RegExp(`<!-- ${marker} -->\\s*\`\`\`js\\n([\\s\\S]*?)\`\`\``).exec(runbook);
  assert.ok(match, `RUNBOOK.md is missing the ${marker} block`);
  return match[1];
}
const TOP = block('worker-patch:top');
const FETCH = block('worker-patch:fetch');
const SWITCH_OFF = 'const HUMAN_HOMEPAGE = false;';
const IMPORT_LINE = 'import { BillWatchHuman } from "./billwatch-human.mjs";';
const EXPORT_LINE = 'export { BillWatchHuman };';
const FETCH_LINE = '  async fetch(request, env, ctx) {\n';

function patch(source, { homepage, paste }) {
  assert.equal(source.split(FETCH_LINE).length, 2, 'the stand-in must have exactly one fetch handler line');
  assert.equal(TOP.split(SWITCH_OFF).length, 2, 'the homepage switch must be exactly one line');
  assert.equal(TOP.split(IMPORT_LINE).length, 2, 'the top block must import the bundle exactly once');
  let top = homepage ? TOP.replace(SWITCH_OFF, 'const HUMAN_HOMEPAGE = true;') : TOP;
  if (paste) top = top.replace(IMPORT_LINE, paste);
  return `${top}\n${source.replace(FETCH_LINE, FETCH_LINE + FETCH)}`;
}

let workspace;
const variants = {};
before(async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  workspace = await mkdtemp(join(tmpdir(), 'billwatch-worker-'));
  const original = await readFile(new URL('fixtures/live-worker.mjs', import.meta.url), 'utf8');
  const built = await readFile(OUTPUT, 'utf8');
  const pasted = built.slice(0, built.lastIndexOf(EXPORT_LINE)).trimEnd();
  const srcShim = `import { handleHumanRequest } from ${JSON.stringify(new URL('src/app.mjs', ROOT).href)};\n` +
    `import { ownsHumanRoute } from ${JSON.stringify(new URL('src/routes.mjs', ROOT).href)};\n` +
    'export const BillWatchHuman = Object.freeze({ handleHumanRequest, ownsHumanRoute });\n';
  const specs = {
    original: { worker: original },
    importOff: { worker: patch(original, { homepage: false }), module: built },
    importOn: { worker: patch(original, { homepage: true }), module: built },
    pasteOff: { worker: patch(original, { homepage: false, paste: pasted }) },
    pasteOn: { worker: patch(original, { homepage: true, paste: pasted }) },
    srcOff: { worker: patch(original, { homepage: false }), module: srcShim },
  };
  for (const [name, spec] of Object.entries(specs)) {
    const dir = join(workspace, name);
    await mkdir(dir);
    await writeFile(join(dir, 'worker.mjs'), spec.worker);
    if (spec.module) await writeFile(join(dir, 'billwatch-human.mjs'), spec.module);
    const loaded = await import(pathToFileURL(join(dir, 'worker.mjs')).href);
    variants[name] = { worker: loaded.default, calls: loaded.calls, source: spec.worker };
  }
});
after(async () => {
  mock.timers.reset();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

const CTX = { waitUntil() {}, passThroughOnException() {} };
/** Run one request and capture everything observable about it. */
async function run(variant, [method, path, body], env = {}) {
  const { worker, calls } = variants[variant];
  calls.length = 0;
  const assets = createAssets(FILES);
  const clicks = createClicks();
  const request = new Request(`https://getbillwatchdog.com${path}`, {
    method, body, headers: body ? { 'Content-Type': 'application/json' } : {},
  });
  const response = await worker.fetch(request, { ASSETS: assets, BILLWATCH_CLICKS: clicks, ...env }, CTX);
  return {
    status: response.status,
    headers: [...response.headers].sort(([a], [b]) => a.localeCompare(b)),
    body: Buffer.from(await response.arrayBuffer()).toString('base64'),
    handlers: [...calls],
    assetReads: [...assets.log],
    writes: clicks.writes.map((write) => write.values),
  };
}
const isHome = ([, path]) => new URL(path, 'https://x.test').pathname === '/';
const text = (result) => Buffer.from(result.body, 'base64').toString('utf8');
const header = (result, name) => result.headers.find(([key]) => key === name)?.[1] ?? null;

// ---- Existing routes: byte-identical --------------------------------------------------
for (const [variant, homepage] of [['importOff', false], ['srcOff', false], ['pasteOff', false], ['importOn', true], ['pasteOn', true]]) {
  test(`${variant}: every existing route is byte-identical to the unpatched worker`, async () => {
    const routes = homepage ? EXISTING.filter((route) => !isHome(route)) : EXISTING;
    assert.ok(routes.length >= 30);
    for (const route of routes) {
      const before = await run('original', route);
      const after = await run(variant, route);
      assert.deepEqual(after, before, `${route[0]} ${route[1]}`);
    }
  });
}

test('the stand-in really exercises the existing handlers (sanity check for the comparison)', async () => {
  assert.deepEqual((await run('original', ['GET', '/v1/deals.json'])).handlers, ['counted GET /v1/deals.json']);
  assert.deepEqual((await run('original', ['POST', '/mcp', '{"jsonrpc":"2.0","id":1,"method":"ping"}'])).handlers, ['mcp POST']);
  assert.deepEqual((await run('original', ['POST', '/api/events', 'abc'])).handlers, ['events POST abc']);
  assert.equal((await run('original', ['GET', '/vpn/'])).status, 404);
});

// ---- Human routes ---------------------------------------------------------------------
for (const variant of ['importOff', 'pasteOff', 'srcOff']) {
  test(`${variant}: human routes render from env.ASSETS without reaching the existing dispatch`, async () => {
    for (const path of HUMAN) {
      const result = await run(variant, ['GET', path]);
      assert.equal(result.status, 200, path);
      assert.equal(header(result, 'content-type'), 'text/html; charset=utf-8', path);
      assert.deepEqual(result.handlers, [], `${path} must not reach counted() or any existing handler`);
      for (const read of result.assetReads) assert.match(read, /^GET \/v1\/(deals\.json|price-history\/[a-z0-9-]+\.json)$/, path);
      assert.deepEqual(result.writes, []);
      assert.doesNotMatch(text(result), /[?&](?:ref|aff|affid|affiliate|utm_[a-z]+|coupon|irclickid|clickid)=/i, path);
    }
  });
}

test('homepage switch: off leaves "/" to the existing worker, on serves the human homepage', async () => {
  for (const variant of ['importOff', 'pasteOff']) {
    const result = await run(variant, ['GET', '/']);
    assert.equal(text(result), '<!doctype html><title>Agent homepage</title><p>Agent homepage</p>');
    assert.deepEqual(result.handlers, ['counted GET /']);
  }
  for (const variant of ['importOn', 'pasteOn']) {
    for (const method of ['GET', 'HEAD']) {
      const result = await run(variant, [method, '/']);
      assert.equal(result.status, 200);
      assert.deepEqual(result.handlers, [], 'the human homepage must not reach counted()');
      assert.deepEqual(result.assetReads, ['GET /v1/deals.json']);
      if (method === 'GET') assert.match(text(result), /Good plans\./);
      else assert.equal(result.body, '');
    }
  }
  // The switch is the single line the tests flip.
  assert.notEqual(variants.importOn.source, variants.importOff.source);
  assert.equal(variants.importOn.source.replace('const HUMAN_HOMEPAGE = true;', SWITCH_OFF), variants.importOff.source);
});

test('/go/ counts then redirects with a binding, and answers 503 honestly without one', async () => {
  const day = new Date(NOW).toISOString().slice(0, 10);
  const counted = await run('importOff', ['GET', `/go/${PLAN.id}`]);
  assert.equal(counted.status, 302);
  assert.equal(header(counted, 'location'), PLAN.plainProviderUrl);
  assert.equal(new URL(header(counted, 'location')).search, '');
  assert.deepEqual(counted.writes, [[PLAN.id, day]]);
  assert.deepEqual(counted.handlers, []);
  assert.deepEqual(counted.assetReads, ['GET /v1/deals.json']);

  const head = await run('importOff', ['HEAD', `/go/${PLAN.id}`]);
  assert.equal(head.status, 302);
  assert.deepEqual(head.writes, []);

  for (const variant of ['importOff', 'pasteOff']) {
    const unbound = await run(variant, ['GET', `/go/${PLAN.id}`], { BILLWATCH_CLICKS: undefined });
    assert.equal(unbound.status, 503);
    assert.equal(header(unbound, 'location'), null);
    assert.match(text(unbound), /durable click recording is not configured/);
    assert.deepEqual(unbound.handlers, []);
  }
});

test('missing env.ASSETS fails closed on human routes and never reaches the network', async () => {
  const result = await run('importOff', ['GET', '/vpn/'], { ASSETS: undefined });
  assert.equal(result.status, 503);
  assert.match(text(result), /Prices are temporarily unavailable/);
  assert.deepEqual(result.handlers, []);
});

// ---- The shipped module -----------------------------------------------------------------
test('dist/billwatch-human.mjs is up to date with src/ (run npm run build if this fails)', async () => {
  assert.equal(await readFile(OUTPUT, 'utf8'), await bundle());
});

test('the bundle is self-contained: no imports, one export, one public name', async () => {
  const built = await readFile(OUTPUT, 'utf8');
  const lines = built.split('\n');
  assert.equal(lines.filter((line) => /^\s*import\b/.test(line)).length, 0);
  assert.deepEqual(lines.filter((line) => /^\s*export\b/.test(line)), [EXPORT_LINE]);
  assert.equal(built.trimEnd().split('\n').at(-1), EXPORT_LINE);
  assert.doesNotMatch(built, /(?:^|[^.\w$])fetch\s*\(|\bglobalThis\.fetch\b/m);
  const { BillWatchHuman } = await import(pathToFileURL(fileURLToPath(OUTPUT)).href);
  assert.ok(Object.isFrozen(BillWatchHuman));
  assert.deepEqual(Object.keys(BillWatchHuman).sort(), ['handleHumanRequest', 'ownsHumanRoute']);
});

test('every asset the pages reference ships under public/ at the same path', async () => {
  const referenced = new Set();
  for (const path of HUMAN) {
    for (const match of text(await run('importOff', ['GET', path])).matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)) referenced.add(match[1]);
  }
  assert.deepEqual([...referenced].sort(), ['/assets/billwatch-human.css', '/assets/billwatch-human.js']);
  for (const asset of referenced) await readFile(new URL(`public${asset}`, ROOT));
});

// ---- _routes.json ---------------------------------------------------------------------
const ROUTES = JSON.parse(await readFile(new URL('integration/routes-include.json', ROOT), 'utf8'));
// Strict reading: exact match, or "/x/*" matches "/x/" plus anything.
const strict = (rule, path) => (rule.endsWith('/*') ? path.startsWith(rule.slice(0, -1)) : path === rule);
// Wrangler's local matcher (pages-dev-util.ts): optional trailing slash, "/x/*" also matches "/x".
function permissive(rule, path) {
  let pattern;
  if (rule === '/' || rule === '/*') pattern = rule;
  else if (rule.endsWith('/*')) pattern = `${rule.slice(0, -2)}(/*)?`;
  else if (rule.endsWith('/')) pattern = `${rule.slice(0, -1)}(/)?`;
  else if (rule.endsWith('*')) pattern = rule;
  else pattern = `${rule}(/)?`;
  return new RegExp(`^${pattern.replaceAll('.', '\\.').replaceAll('*', '.*')}$`).test(path);
}
const OWNED_SAMPLES = ['/vpn', '/vpn/', '/streaming', '/streaming/', `/plans/${PLAN.id}/`, `/plans/${PLAN.id}`, '/compare/nordvpn-vs-surfshark/', '/compare/unknown', '/affiliate-disclosure', '/affiliate-disclosure/', `/go/${PLAN.id}`, '/go/'];

test('_routes.json additions are valid and contain no root wildcard', () => {
  const rules = ROUTES.add_to_include;
  assert.equal(rules.length, 9);
  assert.equal(new Set(rules).size, rules.length);
  for (const rule of rules) {
    assert.ok(rule.startsWith('/') && rule.length <= 100, rule);
    assert.ok(!['/*', '*', '/'].includes(rule), rule);
    assert.ok(!rule.slice(0, -1).includes('*') && (!rule.includes('*') || rule.endsWith('/*')), `${rule}: only a trailing /* wildcard is allowed`);
  }
  assert.deepEqual(ROUTES.must_already_include, ['/']);
});

test('_routes.json additions cover every human-owned path, even under strict matching', () => {
  for (const path of OWNED_SAMPLES) {
    assert.ok(ownsHumanRoute(path), path);
    assert.ok(ROUTES.add_to_include.some((rule) => strict(rule, path)), `${path} would never reach the worker`);
  }
  assert.ok(ownsHumanRoute('/', { homepage: true }) && !ownsHumanRoute('/'));
  for (const rule of ROUTES.add_to_include) assert.ok(OWNED_SAMPLES.some((path) => strict(rule, path)), `${rule} matches no human route`);
});

test('_routes.json additions capture no existing route, even under the permissive matcher', () => {
  const existing = [...new Set([...EXISTING.map(([, path]) => new URL(path, 'https://x.test').pathname),
    '/api.html', '/privacy.html', '/disclosure.html', '/index.html', '/404.html', '/favicon.ico', '/robots.txt', '/sitemap.xml',
    '/v1/price-history/', '/.well-known/mcp.json'])];
  for (const path of existing) {
    for (const rule of ROUTES.add_to_include) assert.ok(!permissive(rule, path) || ownsHumanRoute(path) || /^\/(?:plans|compare|go)\b/.test(path), `${rule} captures ${path}`);
  }
  // The only existing-looking paths the new prefixes capture are ones nothing serves today.
  assert.deepEqual(existing.filter((path) => ROUTES.add_to_include.some((rule) => permissive(rule, path))).sort(),
    ['/compare', '/compare/a/b', '/go', '/plans', '/plans/Upper-Case/']);
});
