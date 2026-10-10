import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeals, isVerified, priceText, sortDeals, loadDeals, normalizeHistory, loadHistory } from '../src/data.mjs';
import { blockNetwork } from './helpers.mjs';

blockNetwork();
const BASE = 'https://getbillwatchdog.com/vpn/';
/** Minimal env.ASSETS stand-in: hands each Request to `respond` and records it. */
const assetsWith = (respond, seen = []) => ({ seen, async fetch(request) { seen.push(request); return respond(request); } });

const NOW = new Date('2026-10-10T12:00:00Z');
const record = (changes = {}) => ({
  id: 'nordvpn-basic-2-year-term', provider: 'NordVPN', category: 'vpn', plan: 'Basic 2-year term',
  price_usd_monthly: 3.49, billing: '$94.23 billed upfront for 27 months (24 + 3 extra); renews at $139.08/yr',
  promo: 'Save 70% + 3 extra months', promo_ends: null, promo_last_seen: '2026-09-29',
  url: 'https://nordvpn.com/?utm_source=example#pricing', source_url: 'https://nordvpn.com/pricing/',
  affiliate: false, status: 'active', checked_at: '2026-10-01', check_cadence_days: 7,
  next_check: '2026-10-08', last_check_status: 'ok', checks_blocked_since: null, verified: true,
  ...changes,
});
const payload = (...deals) => ({ meta: { currency: 'USD', updated: '2026-10-01', count: deals.length }, deals });

test('normalization uses the live envelope and preserves price and exact billing text', () => {
  const raw = record();
  const normalized = normalizeDeals(payload(raw), NOW).deals[0];
  assert.equal(normalized.price, 3.49);
  assert.equal(normalized.priceFormatted, '$3.49');
  assert.equal(normalized.billing, raw.billing);
  assert.equal(normalized.promo, raw.promo);
  assert.equal(normalized.name, raw.plan);
  assert.equal(normalized.verified, true);
  assert.equal(normalized.plainProviderUrl, 'https://nordvpn.com/');
  assert.equal(normalized.safeSourceUrl, 'https://nordvpn.com/pricing/');
  assert.notEqual(normalized, raw);
  assert.equal(raw.url, 'https://nordvpn.com/?utm_source=example#pricing');
});

test('prices retain all supplied numeric digits and zero is a valid free price', () => {
  assert.equal(priceText(0), '$0.00');
  assert.equal(priceText(5), '$5.00');
  assert.equal(priceText(3.49999), '$3.49999');
  assert.equal(priceText(1e-7), '$0.0000001');
  assert.equal(priceText(1e21), '$1000000000000000000000.00');
  for (const value of [-1, NaN, Infinity, '3.49', null, undefined]) assert.throws(() => priceText(value));
});

test('verification requires each source gate, real date, freshness and active promo', () => {
  assert.equal(isVerified(record(), NOW), true);
  for (const change of [
    { verified: false }, { verified: 'true' }, { status: 'discontinued' },
    { last_check_status: 'blocked' }, { last_check_status: 'failed' },
    { checked_at: null }, { checked_at: '2026-02-30' }, { checked_at: 'Oct 1, 2026' },
    { checked_at: '2026-10-11' }, { checked_at: '2026-09-01' },
    { check_cadence_days: 0 }, { check_cadence_days: -1 }, { check_cadence_days: '14' }, { check_cadence_days: 0.5 },
    { check_cadence_days: Number.MAX_VALUE },
    { check_cadence_days: Infinity }, { promo_ends: '2026-10-09' }, { promo_ends: 'bad-date' },
    { promo_ends: '2026-10-10T11:59:59Z' },
  ]) assert.equal(isVerified(record(change), NOW), false, JSON.stringify(change));
  assert.equal(isVerified(record({ promo_ends: '2026-10-10' }), NOW), true);
  assert.equal(isVerified(record(), new Date('2026-10-15T00:00:00Z')), true);
  assert.equal(isVerified(record(), new Date('2026-10-15T00:00:00.001Z')), false);
});

test('URL validation strips tracking and fails closed on unrelated, insecure or affiliate targets', () => {
  for (const change of [
    { affiliate: true }, { url: 'https://evil.test/' },
    { url: 'https://nordvpn.com.evil.test/' }, { url: 'http://nordvpn.com/' },
    { url: 'https://user:pass@nordvpn.com/' }, { url: 'https://nordvpn.com:8443/' },
    { url: 'javascript:alert(1)' }, { url: '//nordvpn.com/' },
    { source_url: 'https://evil.test/' }, { provider: 'Unknown Provider' },
  ]) assert.equal(normalizeDeals(payload(record(change)), NOW).deals[0].plainProviderUrl, null, JSON.stringify(change));
  assert.equal(normalizeDeals(payload(record({ url: 'https://www.nordvpn.com/pricing/?aff=123#tracked' })), NOW).deals[0].plainProviderUrl, 'https://www.nordvpn.com/pricing/');
  assert.equal(normalizeDeals(payload(record({ source_url: 'javascript:alert(1)' })), NOW).deals[0].safeSourceUrl, null);
});

test('malformed schemas, duplicate IDs and string prices are rejected rather than coerced', () => {
  for (const invalid of [[], { deals: [] }, { meta: { currency: 'EUR' }, deals: [] },
    payload(record({ price_usd_monthly: '3.49' })), payload(record({ verified: 1 })),
    payload(record({ billing: '' })), payload(record({ id: '../evil' })), payload(record(), record())]) {
    assert.throws(() => normalizeDeals(invalid, NOW));
  }
});

test('sorting is numeric, deterministic, reversible and does not mutate source', () => {
  const deals = normalizeDeals(payload(record({ id: 'big', price_usd_monthly: 10 }), record({ id: 'small', price_usd_monthly: 2.49 })), NOW).deals;
  assert.deepEqual(sortDeals(deals).map((d) => d.id), ['small', 'big']);
  assert.deepEqual(sortDeals(deals, 'price', 'desc').map((d) => d.id), ['big', 'small']);
  assert.deepEqual(deals.map((d) => d.id), ['big', 'small']);
  assert.deepEqual(sortDeals([{ ...deals[0], billing: 'z-last' }, { ...deals[1], billing: 'a-first' }], 'billing').map((d) => d.id), ['small', 'big']);
});

test('loadDeals reads the published /v1/deals.json from static assets, never the network', async () => {
  const assets = assetsWith(() => Response.json(payload(record())));
  const result = await loadDeals(assets, BASE, NOW);
  assert.equal(assets.seen.length, 1);
  const [request] = assets.seen;
  assert.ok(request instanceof Request);
  assert.equal(request.method, 'GET');
  assert.equal(request.url, 'https://getbillwatchdog.com/v1/deals.json');
  assert.equal(request.headers.get('Accept'), 'application/json');
  assert.equal(request.redirect, 'manual');
  assert.equal(result.deals[0].id, record().id);
  await assert.rejects(loadDeals(assetsWith(() => new Response('', { status: 503 })), BASE, NOW), /503/);
});

test('loadDeals treats redirects, HTML fallbacks and a missing binding as failures', async () => {
  await assert.rejects(loadDeals(assetsWith(() => new Response(null, { status: 308, headers: { Location: '/v1/deals' } })), BASE, NOW), /308/);
  await assert.rejects(loadDeals(assetsWith(() => new Response('<!doctype html><p>index</p>', { headers: { 'Content-Type': 'text/html' } })), BASE, NOW));
  for (const missing of [undefined, null, {}, { fetch: 'not a function' }]) {
    await assert.rejects(loadDeals(missing, BASE, NOW), /env\.ASSETS/);
  }
});

test('history shows original observations in date order without interpolation or rounding', () => {
  const result = normalizeHistory({ plan_id: 'example', history: [
    { date: '2026-10-01', price_usd_monthly: 3.4999 },
    { date: '2026-09-01', price_usd_monthly: 2.49 },
  ] });
  assert.deepEqual(result.history.map((entry) => entry.date), ['2026-09-01', '2026-10-01']);
  assert.equal(result.history[1].priceFormatted, '$3.4999');
  assert.equal(result.points, result.history);
  assert.throws(() => normalizeHistory({ history: [{ date: '2026-02-30', price_usd_monthly: 1 }] }));
});

test('loadHistory validates the plan ID before reading a fixed asset path', async () => {
  const assets = assetsWith(() => Response.json({ plan_id: 'netflix-standard', history: [] }));
  await loadHistory('netflix-standard', assets, BASE);
  assert.equal(assets.seen[0].url, 'https://getbillwatchdog.com/v1/price-history/netflix-standard.json');
  const untouched = assetsWith(() => { throw new Error('Must not read'); });
  await assert.rejects(loadHistory('../deals', untouched, BASE), /Invalid plan ID/);
  assert.equal(untouched.seen.length, 0);
});

test('history verifies the actual published plan_id and rejects another plan’s observations', async () => {
 assert.throws(() => normalizeHistory({ id: 'example', history: [] }), /live history envelope/);
 await assert.rejects(loadHistory('netflix-standard', assetsWith(() => Response.json({ plan_id: 'other-plan', history: [] })), BASE), /does not match/);
});
