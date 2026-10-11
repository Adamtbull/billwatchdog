/**
 * Read-only, byte-for-byte comparison of the EXISTING routes on two deployments, for example
 * production and a preview that has the human pages integrated with the homepage switch off.
 *
 *   node scripts/compare-existing-routes.mjs https://getbillwatchdog.com https://<preview>.pages.dev
 *
 * Exits 1 if any status, application header or body differs. It sends only GET, HEAD and
 * OPTIONS to existing read-only routes. It never requests /go/ and never POSTs to /mcp. It
 * identifies itself with the User-Agent below, so counted() can tell these reads apart.
 * Add --skip-home when comparing against a preview with the homepage switch on.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const USER_AGENT = 'billwatch-integration-check';
export const ROUTES = [
  ['GET', '/'], ['HEAD', '/'],
  ['GET', '/demo'], ['GET', '/api'], ['GET', '/api.html'],
  ['GET', '/privacy'], ['GET', '/privacy.html'], ['GET', '/disclosure'], ['GET', '/disclosure.html'],
  ['GET', '/llms.txt'], ['GET', '/agent.json'], ['GET', '/.well-known/agent.json'],
  ['GET', '/v1/deals.json'], ['HEAD', '/v1/deals.json'], ['GET', '/v1/deals/vpn.json'], ['GET', '/v1/deals/streaming.json'],
  ['OPTIONS', '/mcp'],
  ['GET', '/billwatch-integration-check-no-such-page'],
];
// Headers the site itself controls. Platform headers (date, cf-ray, server, nel, report-to,
// alt-svc, etag, age, x-robots-tag on preview URLs, strict-transport-security on the custom
// domain) legitimately differ between hosts and are listed for information only.
const COMPARED = ['content-type', 'cache-control', 'location', 'content-security-policy', 'referrer-policy', 'x-content-type-options',
  'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-expose-headers'];
const VOLATILE = new Set(['date', 'cf-ray', 'server', 'nel', 'report-to', 'alt-svc', 'etag', 'age', 'cf-cache-status', 'x-robots-tag',
  'strict-transport-security', 'server-timing', 'speculation-rules', 'content-length', 'transfer-encoding', 'connection']);

async function capture(origin, [method, path], fetchImpl) {
  const response = await fetchImpl(new URL(path, origin), {
    method, redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries([...response.headers].map(([key, value]) => {
    if (key !== 'location') return [key, value];
    const target = new URL(value, origin);
    return [key, target.origin === new URL(origin).origin ? target.pathname + target.search : target.href];
  }));
  return { status: response.status, headers, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

export async function compareDeployments(baseline, candidate, { fetchImpl = globalThis.fetch, skipHome = false } = {}) {
  const routes = ROUTES.filter(([, path]) => !(skipHome && path === '/'));
  // Add one real price-history file, picked from the baseline's own feed.
  try {
    const feed = await (await fetchImpl(new URL('/v1/deals.json', baseline), { headers: { 'User-Agent': USER_AGENT } })).json();
    if (typeof feed?.deals?.[0]?.id === 'string' && /^[a-z0-9-]+$/.test(feed.deals[0].id)) routes.push(['GET', `/v1/price-history/${feed.deals[0].id}.json`]);
  } catch { /* the deals route itself is compared below */ }
  const lines = [];
  let differences = 0;
  for (const route of routes) {
    const [a, b] = await Promise.all([capture(baseline, route, fetchImpl), capture(candidate, route, fetchImpl)]);
    const problems = [];
    if (a.status !== b.status) problems.push(`status ${a.status} vs ${b.status}`);
    if (a.sha256 !== b.sha256) problems.push(`body differs (${a.size} vs ${b.size} bytes)`);
    for (const name of COMPARED) if ((a.headers[name] ?? null) !== (b.headers[name] ?? null)) problems.push(`${name}: ${a.headers[name] ?? '(none)'} vs ${b.headers[name] ?? '(none)'}`);
    const other = [...new Set([...Object.keys(a.headers), ...Object.keys(b.headers)])]
      .filter((name) => !COMPARED.includes(name) && !VOLATILE.has(name) && a.headers[name] !== b.headers[name]);
    differences += problems.length ? 1 : 0;
    lines.push(`${problems.length ? 'DIFF' : 'same'}  ${route[0].padEnd(7)} ${route[1]}${problems.length ? `\n      ${problems.join('\n      ')}` : ''}${other.length ? `\n      (info) other headers differ: ${other.join(', ')}` : ''}`);
  }
  lines.push(differences ? `${differences} route(s) differ.` : 'No differences');
  return { differences, lines };
}

async function main() {
  const [baseline, candidate] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!baseline || !candidate) {
    console.error('Usage: node scripts/compare-existing-routes.mjs <baseline origin> <candidate origin> [--skip-home]');
    process.exitCode = 2;
    return;
  }
  const { differences, lines } = await compareDeployments(baseline, candidate, { skipHome: process.argv.includes('--skip-home') });
  console.log(lines.join('\n'));
  if (differences) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
