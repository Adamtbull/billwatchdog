import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleGo } from '../src/redirect.mjs';
import { blockNetwork } from './helpers.mjs';

blockNetwork();

const now = new Date('2026-10-10T12:00:00Z');
const deal = {
  id: 'netflix-standard', provider: 'Netflix', plan: 'Standard', category: 'streaming',
  price_usd_monthly: 19.99, billing: 'monthly', status: 'active', verified: true, affiliate: false,
  checked_at: '2026-10-01', check_cadence_days: 14, last_check_status: 'ok', promo_ends: null,
  url: 'https://www.netflix.com/?affiliate=not-kept#tracking', source_url: 'https://www.netflix.com/ads-plan',
};
// env.ASSETS stand-ins: the plan list comes from static assets, never from the network.
const assets = (respond) => ({ fetch: async () => respond() });
const source = (changes = {}) => assets(() => Response.json({ meta: { currency: 'USD' }, deals: [{ ...deal, ...changes }] }));
const request = (path = '/go/netflix-standard', method = 'GET') => new Request(`https://getbillwatchdog.com${path}`, { method });
function database() {
  const calls = [];
  return { calls, binding: { prepare(sql) {
    return { bind(...values) { return { async run() { calls.push({ sql, values }); return { success: true }; } }; } };
  } } };
}

test('known active GET records only plan/day before a plain provider redirect', async () => {
  const db = database();
  const req = new Request('https://getbillwatchdog.com/go/netflix-standard?url=https://evil.test&affiliate=x', {
    headers: { Cookie: 'private=secret', Referer: 'https://private.test', 'CF-Connecting-IP': '192.0.2.1' },
  });
  const response = await handleGo(req, { BILLWATCH_CLICKS: db.binding, ASSETS: source() }, { now });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://www.netflix.com/');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].values, ['netflix-standard', '2026-10-10']);
  assert.match(db.calls[0].sql, /ON CONFLICT \(plan_id, day\)/);
  assert.doesNotMatch(JSON.stringify(db.calls), /secret|private|192\.0\.2/);
});

test('redirect waits for durable database success', async () => {
  let release;
  let settled = false;
  const binding = { prepare: () => ({ bind: () => ({ run: () => new Promise((resolve) => { release = resolve; }) }) }) };
  const pending = handleGo(request(), { BILLWATCH_CLICKS: binding, ASSETS: source() }, { now }).then((response) => { settled = true; return response; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release({ success: true });
  assert.equal((await pending).status, 302);
});

test('HEAD returns the same target without recording a click', async () => {
  const db = database();
  const response = await handleGo(request('/go/netflix-standard', 'HEAD'), { BILLWATCH_CLICKS: db.binding, ASSETS: source() }, { now });
  assert.equal(response.status, 302);
  assert.equal(await response.text(), '');
  assert.equal(db.calls.length, 0);
});

test('unknown and inactive plans are 404 without a database write', async () => {
  const db = database();
  assert.equal((await handleGo(request('/go/unknown'), { BILLWATCH_CLICKS: db.binding, ASSETS: source() }, { now })).status, 404);
  assert.equal((await handleGo(request(), { BILLWATCH_CLICKS: db.binding, ASSETS: source({ status: 'discontinued' }) }, { now })).status, 404);
  assert.equal(db.calls.length, 0);
});

test('malformed IDs fail before a source fetch; other methods are 405', async () => {
  const untouched = assets(() => { throw new Error('Malformed request must not read the plan list'); });
  for (const path of ['/go/', '/go/bad_id', '/go/%2Fother', '/go/netflix-standard/extra', '/go/' + 'a'.repeat(161)]) {
    assert.equal((await handleGo(request(path), { ASSETS: untouched }, { now })).status, 400, path);
  }
  const response = await handleGo(request('/go/netflix-standard', 'POST'), { ASSETS: untouched }, { now });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, HEAD');
});

test('missing, failing, or unconfirmed durable backend fails honestly with no redirect', async () => {
  for (const binding of [undefined, {}, { prepare() { throw new Error('database offline'); } },
    { prepare: () => ({ bind: () => ({ run: async () => ({ success: false }) }) }) },
    { prepare: () => ({ bind: () => ({ run: async () => undefined }) }) },
  ]) {
    const response = await handleGo(request(), { BILLWATCH_CLICKS: binding, ASSETS: source() }, { now });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Location'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('affiliate, unrelated URL, failed or missing asset reads and invalid schemas fail closed', async () => {
  const db = database();
  for (const plans of [source({ affiliate: true }), source({ url: 'https://evil.test/' }),
    assets(() => new Response('', { status: 500 })), assets(() => Response.json({ deals: [] })),
    assets(() => { throw new Error('Asset read failed'); }), undefined, {},
  ]) {
    const response = await handleGo(request(), { BILLWATCH_CLICKS: db.binding, ASSETS: plans }, { now });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Location'), null);
  }
  assert.equal(db.calls.length, 0);
});

test('real SQLite migration and upsert persist aggregate totals across repeated GETs', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_clicks.sql', import.meta.url), 'utf8'));
  const binding = { prepare(sql) { return { bind(...values) { return { async run() {
    sqlite.prepare(sql).run(...values);
    return { success: true };
  } }; } }; } };
  try {
    for (let index = 0; index < 3; index++) assert.equal((await handleGo(request(), { BILLWATCH_CLICKS: binding, ASSETS: source() }, { now })).status, 302);
    const rows = sqlite.prepare('SELECT * FROM click_counts').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].plan_id, 'netflix-standard');
    assert.equal(rows[0].day, '2026-10-10');
    assert.equal(rows[0].click_count, 3);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['click_count', 'day', 'plan_id']);
  } finally {
    sqlite.close();
  }
});
