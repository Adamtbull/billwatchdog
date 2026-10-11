import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDeployments, ROUTES, USER_AGENT } from '../scripts/compare-existing-routes.mjs';

const FEED = JSON.stringify({ meta: { currency: 'USD' }, deals: [{ id: 'example-plan' }] });
const SITE = {
  '/': ['<p>home</p>', 'text/html; charset=utf-8'],
  '/llms.txt': ['# BillWatch', 'text/plain; charset=utf-8'],
  '/v1/deals.json': [FEED, 'application/json'],
  '/v1/price-history/example-plan.json': ['{"plan_id":"example-plan","history":[]}', 'application/json'],
};
/** Fake fetch for two hosts. `changes` alters the candidate host's responses. */
function hosts(changes = {}) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    seen.push({ host: target.host, method: init.method ?? 'GET', path: target.pathname, agent: init.headers?.['User-Agent'] });
    const site = target.host === 'candidate.test' ? { ...SITE, ...changes } : SITE;
    if (target.pathname === '/privacy.html') return new Response(null, { status: 308, headers: { Location: `${target.origin}/privacy` } });
    const entry = site[target.pathname];
    if (!entry) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    const [body, type, extra = {}] = entry;
    return new Response(init.method === 'HEAD' ? null : body, { headers: { 'Content-Type': type, Date: String(Math.random()), ...extra } });
  };
  return { seen, fetchImpl };
}

test('identical deployments report no differences, ignoring platform headers and host names', async () => {
  const { fetchImpl } = hosts();
  const result = await compareDeployments('https://baseline.test', 'https://candidate.test', { fetchImpl });
  assert.equal(result.differences, 0, result.lines.join('\n'));
  assert.equal(result.lines.at(-1), 'No differences');
});

test('a changed body, status or application header is reported and fails the run', async () => {
  const { fetchImpl } = hosts({
    '/llms.txt': ['# BillWatch changed', 'text/plain; charset=utf-8'],
    '/': ['<p>home</p>', 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' }],
    '/v1/deals/vpn.json': ['{}', 'application/json'],
  });
  const result = await compareDeployments('https://baseline.test', 'https://candidate.test', { fetchImpl });
  assert.equal(result.differences, 4, result.lines.join('\n'));
  const report = result.lines.join('\n');
  assert.match(report, /DIFF {2}GET {5}\/llms\.txt\n {6}body differs/);
  assert.match(report, /cache-control: \(none\) vs no-store/);
  assert.match(report, /status 404 vs 200/);
});

test('it only reads: GET, HEAD and OPTIONS, never /go/ or a POST, and labels itself', async () => {
  const { seen, fetchImpl } = hosts();
  await compareDeployments('https://baseline.test', 'https://candidate.test', { fetchImpl, skipHome: true });
  // One read of the baseline feed, then every route on both hosts: all of ROUTES except the
  // two skipped "/" checks, plus one price-history file picked from the feed.
  assert.equal(seen.length, 1 + (ROUTES.length - 2 + 1) * 2);
  for (const call of seen) {
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(call.method), call.method);
    assert.ok(!call.path.startsWith('/go/'), call.path);
    assert.equal(call.agent, USER_AGENT);
  }
  assert.ok(!seen.some((call) => call.path === '/'), '--skip-home leaves "/" out');
  assert.ok(seen.some((call) => call.path === '/v1/price-history/example-plan.json'));
});
