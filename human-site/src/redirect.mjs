import { API_ORIGIN, normalizeDeals } from './data.mjs';

const UPSERT = `INSERT INTO click_counts (plan_id, day, click_count)
VALUES (?, ?, 1)
ON CONFLICT (plan_id, day) DO UPDATE SET click_count = click_count + 1`;

/**
 * Count GET requests for provider redirects, not unique people or conversions.
 * Every GET counts once. Refreshes, retrying clients, and bots can count again.
 * There is deliberately no fingerprinting, cookie, IP address, or referrer storage.
 * A failed/uncertain database write returns 503 and is never retried here.
 */
export async function handleGo(request, env = {}, { fetcher = fetch, now = Date } = {}) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  const reply = (status, message, extra = {}) => new Response(request.method === 'HEAD' ? null : message, {
    status, headers: { ...headers, ...extra },
  });
  if (!['GET', 'HEAD'].includes(request.method)) return reply(405, 'Use GET or HEAD for provider links.', { Allow: 'GET, HEAD' });
  let id;
  try {
    const path = new URL(request.url).pathname;
    const match = /^\/go\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
    if (!match || match[1].length > 160) return reply(400, 'Malformed plan link.');
    id = match[1];
  } catch {
    return reply(400, 'Malformed plan link.');
  }
  const current = now === Date ? new Date() : new Date(typeof now === 'function' ? now() : now);
  if (!Number.isFinite(current.getTime())) return reply(503, 'Provider links are temporarily unavailable.');
  let deal;
  try {
    const response = await fetcher(`${API_ORIGIN}/v1/deals.json`, {
      headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Upstream unavailable');
    deal = normalizeDeals(await response.json(), current).deals.find((entry) => entry.id === id);
  } catch {
    return reply(503, 'The live plan list could not be checked. Please try again later.');
  }
  if (!deal || deal.status !== 'active') return reply(404, 'This active plan could not be found.');
  if (!deal.plainProviderUrl) return reply(503, 'A safe, non-affiliate provider link is not available for this plan.');
  if (!env?.BILLWATCH_CLICKS || typeof env.BILLWATCH_CLICKS.prepare !== 'function') {
    return reply(503, 'Provider links are unavailable because durable click recording is not configured.');
  }
  if (request.method === 'HEAD') return reply(302, '', { Location: deal.plainProviderUrl });
  try {
    const result = await env.BILLWATCH_CLICKS.prepare(UPSERT).bind(id, current.toISOString().slice(0, 10)).run();
    if (result?.success !== true) throw new Error('Write not confirmed');
  } catch {
    return reply(503, 'The provider click could not be recorded. Please try again later.');
  }
  return reply(302, '', { Location: deal.plainProviderUrl });
}
