// BillWatch human pages: worker module. GENERATED FILE, do not edit by hand.
// Built by human-site/scripts/build.mjs from human-site/src/ (run `npm run build` in human-site/).
// Source digest (sha256): 66de18d5464e4eb42a3e683e91fc3e78cc6150c6b733fd5cdff473c1e40823e7
// Defines one name, BillWatchHuman. No imports, no network requests, no secrets, no prices.
// Wiring, homepage switch and paste-mode instructions: human-site/RUNBOOK.md.

const BillWatchHuman = (() => {
// ---- src/data.mjs
const __data = (() => {
/**
 * Live BillWatch data adapter. Reads the deployment's own published /v1 files through the
 * Pages static asset binding (env.ASSETS). It never makes a network request, so there is no
 * self-subrequest back through the worker. The published /v1 payloads are never modified.
 */
const DAY = 86_400_000;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROVIDER_DOMAINS = Object.freeze({
  Netflix: ['netflix.com'],
  'Disney+': ['disneyplus.com'],
  Hulu: ['hulu.com'],
  'HBO Max': ['hbomax.com', 'max.com'],
  'Apple TV+': ['apple.com'],
  'Paramount+': ['paramountplus.com'],
  Peacock: ['peacocktv.com'],
  NordVPN: ['nordvpn.com'],
  ExpressVPN: ['expressvpn.com'],
  Surfshark: ['surfshark.com'],
  'Proton VPN': ['protonvpn.com'],
  Mullvad: ['mullvad.net'],
});

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function instant(now = Date) {
  const value = now === Date ? Date.now() : typeof now === 'function' ? now() : now;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError('A valid current date is required.');
  return timestamp;
}

/** Reject impossible dates instead of accepting JavaScript's rollover dates. */
function dateInstant(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return NaN;
  const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return Date.parse(value);
}

function verificationReason(deal, now) {
  if (deal.status !== 'active') return 'Plan is no longer active';
  if (deal.verified !== true) return 'Not marked verified by the source';
  if (deal.last_check_status !== 'ok') return 'Last official-page check did not succeed';
  const checked = dateInstant(deal.checked_at);
  if (!Number.isFinite(checked)) return 'Missing or invalid official-page check date';
  if (checked > now) return 'Official-page check date is in the future';
  const cadence = deal.check_cadence_days;
  if (!Number.isSafeInteger(cadence) || cadence <= 0) return 'Missing or invalid check cadence';
  if (now - checked > cadence * 2 * DAY) return 'Official-page confirmation is outside the freshness window';
  if (deal.promo_ends != null) {
    const expiration = dateInstant(deal.promo_ends);
    if (!Number.isFinite(expiration)) return 'Invalid promotion expiry date';
    // A date-only promotion remains valid through the named UTC calendar day.
    const expiresAt = expiration + (deal.promo_ends.length === 10 ? DAY : 0);
    if (now >= expiresAt) return 'Dated promotion has ended';
  }
  return null;
}

function isVerified(deal, now = Date) {
  return object(deal) && verificationReason(deal, instant(now)) === null;
}

/** Format all digits in the API number. Never recompute or round an equivalent price. */
function priceText(number) {
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
    throw new TypeError('Price must be a finite, nonnegative number.');
  }
  let decimal = String(number);
  if (/e/i.test(decimal)) {
    const [coefficient, exponentText] = decimal.toLowerCase().split('e');
    const [integer, fraction = ''] = coefficient.split('.');
    const digits = integer + fraction;
    const point = integer.length + Number(exponentText);
    decimal = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length ? digits + '0'.repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  const [integer, fraction = ''] = decimal.split('.');
  return `$${integer}.${fraction.padEnd(2, '0')}`;
}

/** Targets are authorized by an explicit provider/domain map, never a URL parameter. */
function officialUrl(value, deal) {
  const allowed = PROVIDER_DOMAINS[deal.provider];
  if (!allowed) return null;
  try {
    const target = new URL(value);
    if (target.protocol !== 'https:' || target.username || target.password || target.port ||
      !allowed.some((domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`))) return null;
    target.search = '';
    target.hash = '';
    return target.href;
  } catch {
    return null;
  }
}

function providerUrl(deal) {
  if (deal.affiliate !== false || !officialUrl(deal.source_url, deal)) return null;
  return officialUrl(deal.url, deal);
}

function normalizeDeals(payload, now = Date) {
  if (!object(payload) || !object(payload.meta) || !Array.isArray(payload.deals)) {
    throw new TypeError('Expected the live API envelope {meta, deals}.');
  }
  if (payload.meta.currency !== 'USD') throw new TypeError('Expected USD source prices.');
  const timestamp = instant(now);
  const seen = new Set();
  const deals = payload.deals.map((deal, index) => {
    if (!object(deal)) throw new TypeError(`Invalid deal at index ${index}.`);
    for (const key of ['id', 'provider', 'category', 'plan', 'billing', 'status', 'url', 'source_url']) {
      if (typeof deal[key] !== 'string' || deal[key].trim().length === 0) throw new TypeError(`Invalid ${key} at index ${index}.`);
    }
    if (deal.id.length > 160 || !ID_PATTERN.test(deal.id) || seen.has(deal.id)) throw new TypeError(`Invalid or duplicate plan ID at index ${index}.`);
    if (typeof deal.verified !== 'boolean' || typeof deal.affiliate !== 'boolean') throw new TypeError(`Invalid verification or affiliate flag at index ${index}.`);
    seen.add(deal.id);
    const formatted = priceText(deal.price_usd_monthly);
    const reason = verificationReason(deal, timestamp);
    return {
      ...deal,
      price: deal.price_usd_monthly,
      priceFormatted: formatted,
      name: deal.plan,
      reportedVerified: deal.verified,
      verified: reason === null,
      verificationReason: reason,
      plainProviderUrl: providerUrl(deal),
      safeSourceUrl: officialUrl(deal.source_url, deal),
    };
  });
  return { ...payload, meta: { ...payload.meta }, deals };
}

function sortDeals(deals, key = 'price', direction = 'asc') {
  const descending = direction === 'desc' ? -1 : 1;
  const field = { price: 'price_usd_monthly', provider: 'provider', plan: 'plan', name: 'plan', billing: 'billing', checked: 'checked_at', checked_at: 'checked_at' }[key] || 'price_usd_monthly';
  return [...deals].sort((a, b) => {
    const comparison = field === 'price_usd_monthly' ? a[field] - b[field] : String(a[field] ?? '').localeCompare(String(b[field] ?? ''), 'en');
    return descending * comparison || a.id.localeCompare(b.id, 'en');
  });
}

/**
 * Read one published /v1 JSON file from static assets. `assets` is env.ASSETS; `base` is the
 * incoming request URL (only the pathname is used to match the asset). `cache` and `signal`
 * are deliberately not set: `cache` throws on Workers compatibility dates before 2024-11-11,
 * and an asset read needs neither. Redirects are never followed (`redirect: 'manual'`): a
 * redirect, like any non-2xx status, is treated as a failure.
 */
async function loadJson(path, assets, base) {
  if (!assets || typeof assets.fetch !== 'function') {
    throw new Error('The static asset binding (env.ASSETS) is not available.');
  }
  const response = await assets.fetch(new Request(new URL(path, base), {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'application/json' },
  }));
  if (!response.ok) throw new Error(`BillWatch data returned HTTP ${response.status}.`);
  return response.json();
}

async function loadDeals(assets, base, now = Date) {
  return normalizeDeals(await loadJson('/v1/deals.json', assets, base), now);
}

function normalizeHistory(payload) {
  // Preserve observed prices; never interpolate missing dates or recompute prices.
  if (!object(payload) || typeof payload.plan_id !== 'string' || !ID_PATTERN.test(payload.plan_id) || !Array.isArray(payload.history)) throw new TypeError('Expected the live history envelope {plan_id, history}.');
  const history = payload.history.map((entry) => {
    if (!object(entry) || !Number.isFinite(dateInstant(entry.date))) throw new TypeError('Invalid history observation date.');
    const price = entry.price_usd_monthly;
    return { ...entry, date: entry.date, price, priceFormatted: priceText(price) };
  }).sort((a, b) => dateInstant(a.date) - dateInstant(b.date));
  return { ...payload, history, points: history };
}

async function loadHistory(id, assets, base) {
  if (typeof id !== 'string' || id.length > 160 || !ID_PATTERN.test(id)) throw new TypeError('Invalid plan ID.');
  const result = normalizeHistory(await loadJson(`/v1/price-history/${id}.json`, assets, base));
  if (result.plan_id !== id) throw new TypeError('History plan ID does not match the requested plan.');
  return result;
}
return Object.freeze({ isVerified, priceText, normalizeDeals, sortDeals, loadDeals, normalizeHistory, loadHistory });
})();

// ---- src/redirect.mjs
const __redirect = (() => {
const { loadDeals } = __data;

const UPSERT = `INSERT INTO click_counts (plan_id, day, click_count)
VALUES (?, ?, 1)
ON CONFLICT (plan_id, day) DO UPDATE SET click_count = click_count + 1`;

/**
 * Count GET requests for provider redirects, not unique people or conversions.
 * Every GET counts once. Refreshes, retrying clients, and bots can count again.
 * There is deliberately no fingerprinting, cookie, IP address, or referrer storage.
 * A failed/uncertain database write returns 503 and is never retried here.
 * The plan list is read from this deployment's static assets (env.ASSETS), never fetched.
 */
async function handleGo(request, env = {}, { now = Date } = {}) {
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
    deal = (await loadDeals(env?.ASSETS, request.url, current)).deals.find((entry) => entry.id === id);
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
return Object.freeze({ handleGo });
})();

// ---- src/render.mjs
const __render = (() => {
const { isVerified, priceText, sortDeals } = __data;

const ORIGIN = 'https://getbillwatchdog.com';
const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escape;
const idPath = d => `/plans/${encodeURIComponent(d.id)}/`;
const formatDate = date => /^\d{4}-\d{2}-\d{2}/.test(date || '') ? String(date).slice(0, 10) : 'Not supplied';
const money = d => priceText(d.price_usd_monthly);
const usable = (d, now) => isVerified(d, now);
const priceNote = 'USD monthly equivalent. Taxes and extra fees may apply. Read the full billing terms before subscribing.';

function disclosure() {
  return '<p class="disclosure">Ordinary provider links. BillWatch currently earns no commission from these links. <a href="/affiliate-disclosure/">Affiliate disclosure</a>.</p>';
}
function dealLink(d) {
  if (d.status !== 'active' || d.affiliate !== false || !d.plainProviderUrl) return '<span class="muted">Provider link unavailable</span>';
  return `<a class="button button-small" href="/go/${encodeURIComponent(d.id)}" rel="nofollow">Get deal<span class="sr-only">: ${e(d.provider)} ${e(d.plan)}</span></a>`;
}
function status(d, now) {
  return usable(d, now)
    ? '<span class="badge">Source verified</span>'
    : `<span class="badge badge-warning">${d.status === 'discontinued' ? 'Discontinued' : 'Not currently verified'}</span>`;
}
function promoMarkup(d) {
  if (typeof d.promo !== 'string' || !d.promo.trim()) return '';
  return `<div class="promo-terms"><strong>Provider promotion / eligibility text</strong><p>${e(d.promo)}</p><span class="check">Last seen: ${e(formatDate(d.promo_last_seen))}.${d.promo_ends ? ` Listed end date: ${e(formatDate(d.promo_ends))}.` : ' End date not supplied.'} Provider wording; confirm eligibility and current terms. The price above remains the feed’s listed monthly equivalent.</span></div>`;
}
function checked(d, now) {
  const next = d.next_check ? ` Next check due: ${e(formatDate(d.next_check))}.` : '';
  return `<span class="check">Source checked: ${e(formatDate(d.checked_at))}.${next}${usable(d, now) ? '' : ' Confirm the price with the provider.'}</span>`;
}
function productSchema(d, now) {
  const product = { '@type': 'Product', name: `${d.provider} ${d.plan}`, category: d.category, sku: d.id, url: ORIGIN + idPath(d), brand: { '@type': 'Brand', name: d.provider }, description: d.billing + (d.promo ? ` Provider promotion / eligibility text: ${d.promo}` : '') };
  if (usable(d, now) && d.plainProviderUrl) {
    // The feed supplies a monthly equivalent, not necessarily the checkout bill.
    // Never mark a prepaid monthly equivalent as the total purchase price.
    product.offers = {
      '@type': 'Offer', url: `${ORIGIN}/go/${encodeURIComponent(d.id)}`,
      seller: { '@type': 'Organization', name: d.provider },
      description: `USD monthly equivalent: ${money(d)}. Billing terms: ${d.billing}`,
      priceSpecification: { '@type': 'UnitPriceSpecification', price: String(d.price_usd_monthly), priceCurrency: 'USD', unitText: 'monthly equivalent', description: d.billing }
    };
    if (/^monthly(?:$|[,;])/i.test(d.billing)) Object.assign(product.offers, { price: String(d.price_usd_monthly), priceCurrency: 'USD' });
  }
  return product;
}
function jsonLd(value) { return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}</script>`; }
function layout({ title, description, path, body, schema, now = new Date() }) {
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} | BillWatch</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${ORIGIN}${e(path)}"><link rel="stylesheet" href="/assets/billwatch-human.css"><script src="/assets/billwatch-human.js" defer></script>${schema ? jsonLd({'@context':'https://schema.org', ...schema}) : ''}</head><body><a class="skip" href="#main">Skip to content</a><header class="header"><div class="wrap nav"><a class="brand" href="/" aria-label="BillWatch home"><span class="brand-mark" aria-hidden="true">b.</span>BillWatch<span class="brand-dot" aria-hidden="true"></span></a><nav aria-label="Main navigation"><a href="/vpn/"${path === '/vpn/' ? ' aria-current="page"' : ''}>VPN</a><a href="/streaming/"${path === '/streaming/' ? ' aria-current="page"' : ''}>Streaming</a><a href="/compare/nordvpn-vs-surfshark/">Compare</a></nav></div></header><main id="main" class="wrap">${body}</main><footer class="footer"><div class="wrap footer-grid"><div><a class="brand" href="/">BillWatch</a><p>Clear prices. Fewer surprises.</p></div><nav aria-label="Footer"><a href="/affiliate-disclosure/">Affiliate disclosure</a><a href="/privacy">Privacy</a><a href="/api">For agents &amp; developers</a><a href="mailto:hello@getbillwatchdog.com">Contact</a></nav><p class="fineprint">Selected U.S. offers, in USD. Prices and availability can change. Always confirm the provider’s checkout total and renewal terms.</p></div></footer></body></html>`;
}
function table(deals, now, { caption = 'Compare plans', sort = 'price', direction = 'asc' } = {}) {
  const headings = [['provider','Provider'],['plan','Plan'],['price','Monthly equivalent'],['billing','Billing terms']];
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${e(caption)}"><table data-sort-table><caption>${e(caption)}. Select a column heading to sort.</caption><thead><tr>${headings.map(([key,label]) => `<th scope="col"${sort === key ? ` aria-sort="${direction === 'asc' ? 'ascending' : 'descending'}"` : ''}><a class="sort-button" href="?sort=${key}&amp;direction=${sort === key && direction === 'asc' ? 'desc' : 'asc'}" data-sort="${key}">${label}<span aria-hidden="true"> ↕</span></a></th>`).join('')}<th scope="col">Source check</th><th scope="col"><span class="sr-only">Links</span></th></tr></thead><tbody>${sortDeals(deals, sort, direction).map(d => `<tr data-price="${e(d.price_usd_monthly)}" data-provider="${e(d.provider)}" data-plan="${e(d.plan)}" data-billing="${e(d.billing)}"><th scope="row"><a href="${idPath(d)}">${e(d.provider)}</a></th><td>${e(d.plan)}</td><td><span class="table-price">${money(d)}</span><span class="check">${usable(d, now) ? 'USD / month equivalent' : 'Last listed USD / month equivalent'}</span></td><td class="terms">${e(d.billing || 'Billing terms not supplied. Check with the provider.')}${promoMarkup(d)}</td><td>${status(d, now)}${checked(d, now)}</td><td class="table-links">${dealLink(d)}<a class="detail-link" href="${idPath(d)}">Details &amp; history</a></td></tr>`).join('')}</tbody></table></div><p class="sr-only" data-sort-status aria-live="polite"></p>`;
}
function card(d, label, now) {
  if (!d) return `<article class="deal-card"><p class="eyebrow">${e(label)}</p><h3>No verified offer available</h3><p>We’ll show a price here when the live source has a current verified offer.</p></article>`;
  return `<article class="deal-card"><div class="card-top"><p class="eyebrow">${e(label)}</p>${status(d, now)}</div><h3>${e(d.provider)}</h3><p class="plan-label">${e(d.plan)}</p><p class="hero-price">${money(d)}<span>/ mo equivalent</span></p><p class="terms">${e(d.billing)}</p>${promoMarkup(d)}${checked(d, now)}<div class="card-actions">${dealLink(d)}<a href="${idPath(d)}">Details &amp; history</a></div></article>`;
}
function available(deals, now) { return deals.filter(d => usable(d, now)); }
function homePage(data, now) {
  const current = available(data.deals, now);
  const vpn = sortDeals(current.filter(d => d.category === 'vpn' && d.price_usd_monthly > 0))[0];
  const streaming = sortDeals(current.filter(d => d.category === 'streaming'))[0];
  const free = current.filter(d => d.category === 'vpn' && d.price_usd_monthly === 0);
  return layout({title:'Compare VPN and streaming prices', description:'Find the lowest verified monthly-equivalent VPN and streaming prices among the plans BillWatch tracks. See full billing terms and price history.', path:'/', now,
    body:`<section class="hero"><p class="eyebrow">A clearer view of your subscriptions</p><h1>Good plans.<br><span>Less guesswork.</span></h1><p class="hero-copy">Today’s lowest verified VPN and streaming prices in our listings, with the billing terms up front.</p><div class="hero-actions"><a class="button" href="/vpn/">Compare VPN prices</a><a class="button button-outline" href="/streaming/">Compare streaming prices</a></div><p class="fineprint">“Lowest” compares the verified offers shown here, not every offer on the market. Source-checked dates are shown on each plan.</p></section><section class="section"><div class="section-heading"><div><p class="eyebrow">Start with the numbers</p><h2>Lowest listed monthly equivalents</h2></div><p>Live feed read for this page.<br>Feed updated: ${e(formatDate(data.meta?.updated))}</p></div><div class="deal-grid">${card(vpn,'Lowest paid VPN in our verified listings',now)}${card(streaming,'Lowest streaming in our verified listings',now)}</div><p class="fineprint">${priceNote}${free.length ? ' Free VPN plans are also included in the full VPN table.' : ''}</p>${disclosure()}</section><section class="section"><div class="section-heading"><div><p class="eyebrow">Before you commit</p><h2>Compare the whole deal</h2></div></div><div class="comparison-links"><a href="/compare/nordvpn-vs-surfshark/"><span class="eyebrow">VPN</span><h3>NordVPN vs. Surfshark</h3><p>Monthly cost, upfront billing, and renewal terms.</p><span class="text-link">Compare plans →</span></a><a href="/compare/netflix-vs-hulu/"><span class="eyebrow">Streaming</span><h3>Netflix vs. Hulu</h3><p>See plans with and without ads, and what each costs.</p><span class="text-link">Compare plans →</span></a></div></section><section class="section how"><p class="eyebrow">Know what you’re looking at</p><h2>A price is only part of the story.</h2><div class="three-columns"><div><span class="step">01</span><h3>Source-checked prices</h3><p>Verified means the feed records a check against the provider’s official page within its freshness window. It does not mean a hands-on product test.</p></div><div><span class="step">02</span><h3>The bill, not just the headline</h3><p>Monthly equivalents can require an upfront payment. We show the source’s billing and renewal terms beside the price.</p></div><div><span class="step">03</span><h3>Your choice stays yours</h3><p>We compare selected advertised offers. Confirm availability, eligibility, cancellation terms, and the final total with the provider.</p></div></div></section><aside class="agent-note"><div><h2>Building with an agent?</h2><p>The same price data is available through our read-only JSON API and MCP server.</p></div><a href="/api">Explore the API →</a></aside>` });
}
function categoryPage(data, category, now, options = {}) {
  const name = category === 'vpn' ? 'VPN' : 'Streaming';
  const active = data.deals.filter(d => d.category === category && d.status === 'active');
  const verified = available(active, now);
  const rest = active.filter(d => !usable(d, now));
  return layout({title:`${name} prices and billing terms`,description:`Compare selected U.S. ${name} plans using live listed prices, billing terms, and source-check dates.`,path:`/${category}/`,now,schema:{'@type':'CollectionPage',name:`${name} price comparison`,mainEntity:{'@type':'ItemList',itemListElement:sortDeals(verified,options.sort,options.direction).map((d,i)=>({'@type':'ListItem',position:i+1,item:productSchema(d,now)}))}},body:`<section class="page-heading"><p class="eyebrow">Make the bill make sense</p><h1>${name} prices,<br><span>with the terms attached.</span></h1><p>Compare selected U.S. plans. Sort by price, provider, plan, or billing terms.</p></section><div class="notice"><strong>Read the full bill.</strong> ${priceNote} The lowest monthly equivalent may require a longer commitment. All prices come from the live feed; no estimates are added.</div>${disclosure()}<section class="section"><div class="section-heading"><h2>Verified offers <span class="count">${verified.length}</span></h2><p>Feed updated: ${e(formatDate(data.meta?.updated))}</p></div><p class="fineprint">Source verified means checked against the official provider page within the feed’s freshness window. It does not mean checked today. Check dates are shown below.</p>${verified.length ? table(verified,now,{caption:`Verified ${name} offers`, ...options}) : '<div class="empty"><h3>No current verified offers</h3><p>The live feed has no eligible verified plans in this category right now.</p></div>'}</section>${rest.length ? `<section class="section"><h2>Needs a fresh source check</h2><p>These are last-listed prices, excluded from lowest-price comparisons and current offer markup.</p>${table(rest,now,{caption:`Unverified ${name} listings`,...options})}</section>` : ''}<aside class="agent-note"><p>Want to compare two providers?</p><a href="/compare/${category==='vpn'?'nordvpn-vs-surfshark':'netflix-vs-hulu'}/">${category==='vpn'?'NordVPN vs. Surfshark':'Netflix vs. Hulu'} →</a></aside>`});
}
function verdict(d, now) {
  if (!usable(d, now)) return 'This price needs a current source check; confirm it with the provider before deciding.';
  if (d.price_usd_monthly === 0) return 'A listed free option; check the provider’s limits and eligibility before choosing.';
  if (/upfront|\b(?:12|24|27|28)-?month|\byear\b/i.test(d.billing) && !/^monthly/i.test(d.billing)) return 'Compare the upfront bill and renewal terms before committing to this monthly equivalent.';
  return 'Compare this listed monthly price with the plan’s ads, features, and cancellation terms before choosing.';
}
function historyMarkup(history, problem) {
  if (problem) return '<div class="empty"><h3>Price history is temporarily unavailable</h3><p>The history source could not be loaded. No trend or missing points have been estimated.</p></div>';
  const points = history?.points || [];
  if (!points.length) return '<div class="empty"><h3>No recorded price history yet</h3><p>No historical points are available for this plan. We don’t fill gaps with estimates.</p></div>';
  const prices=points.map(p=>p.price_usd_monthly), min=Math.min(...prices), max=Math.max(...prices);
  const times=points.map(p=>Date.parse(p.date)), first=Math.min(...times), last=Math.max(...times);
  const coords=points.map((p,i)=>[64+(last===first ? 264 : (times[i]-first)/(last-first)*528), 170-(max===min?65:(p.price_usd_monthly-min)/(max-min)*130)]);
  return `<figure class="chart"><svg viewBox="0 0 640 230" role="img" aria-labelledby="history-title history-desc"><title id="history-title">Recorded monthly-equivalent prices</title><desc id="history-desc">${points.length} recorded price ${points.length===1?'point':'points'}. Exact values and dates are in the table below. Lines connect recorded points only, and do not establish prices between them.</desc><path d="M64 20V180H610" fill="none" stroke="currentColor" opacity=".2"/><text x="4" y="40">${e(priceText(max))}</text><text x="4" y="172">${e(priceText(min))}</text>${points.length>1?`<polyline points="${coords.map(c=>c.join(',')).join(' ')}" fill="none" stroke="#d45140" stroke-width="3"/>`:''}${coords.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="5" fill="#d45140"><title>${e(points[i].date)}: ${e(priceText(points[i].price_usd_monthly))}</title></circle>`).join('')}<text x="64" y="210">${e(points[0].date)}</text>${points.length>1?`<text text-anchor="end" x="595" y="210">${e(points.at(-1).date)}</text>`:''}</svg><figcaption>Recorded USD monthly equivalents. ${points.length===1?'One point is not a trend.':'Lines connect recorded observations; prices between checks are unknown.'} No estimates added.</figcaption></figure><details class="history-details"><summary>Exact recorded prices</summary><table><caption>Price history from the live source</caption><thead><tr><th scope="col">Recorded date</th><th scope="col">USD monthly equivalent</th></tr></thead><tbody>${points.map(p=>`<tr><th scope="row">${e(p.date)}</th><td>${e(priceText(p.price_usd_monthly))}</td></tr>`).join('')}</tbody></table></details>`;
}
function planPage(d, history, now, historyProblem=false) {
 return layout({title:`${d.provider} ${d.plan}: price and history`,description:`See the live listed price, full billing terms, and recorded price history for ${d.provider} ${d.plan}.`,path:idPath(d),now,schema:productSchema(d,now),body:`<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/${e(d.category)}/">${d.category==='vpn'?'VPN':'Streaming'} prices</a><span aria-hidden="true">/</span><span>${e(d.provider)}</span></nav><section class="plan-header"><div><p class="eyebrow">${e(d.provider)}</p><h1>${e(d.plan)}</h1>${status(d,now)}<p class="verdict">${e(verdict(d,now))}</p></div><div class="plan-price"><p class="eyebrow">${usable(d,now)?'Current listed monthly equivalent':'Last listed monthly equivalent'}</p><p class="hero-price">${money(d)}<span>USD / month</span></p>${dealLink(d)}</div></section><div class="notice"><strong>Billing terms</strong><p>${e(d.billing||'Not supplied by the source. Confirm with the provider.')}</p><p>Taxes and extra fees may apply. ${/renew/i.test(d.billing)?'Renewal terms above are quoted from the live feed.':'Renewal price is not supplied separately; confirm with the provider.'} ${/upfront|billed for/i.test(d.billing)?'':'Any upfront total not stated above is unknown; no total has been calculated.'}</p></div>${promoMarkup(d)}${disclosure()}<section class="source-panel"><h2>Know the source</h2>${checked(d,now)}<p>${usable(d,now)?'Checked against the provider’s official source within the feed’s freshness window.':'This listing is not currently verified and is excluded from lowest-price claims.'} Confirm current availability and terms before subscribing.</p>${d.safeSourceUrl?`<a href="${e(d.safeSourceUrl)}" rel="noopener noreferrer nofollow">View the official price source</a>`:''}${d.promo_ends?`<p>Listed promotion end date: ${e(formatDate(d.promo_ends))}.</p>`:''}</section><section class="section"><div class="section-heading"><h2>Price history</h2><a href="/v1/price-history/${encodeURIComponent(d.id)}.json">View source data</a></div>${historyMarkup(history,historyProblem)}</section><aside class="agent-note"><p>Keep comparing before you commit.</p><a href="/${e(d.category)}/">All ${d.category==='vpn'?'VPN':'streaming'} plans →</a></aside>`});
}
const COMPARISONS = {
 'nordvpn-vs-surfshark': { title:'NordVPN vs. Surfshark', providers:['NordVPN','Surfshark'], category:'vpn', intro:'Compare advertised prices and billing commitments. A lower monthly equivalent can mean paying more months up front.', note:'This is a price-and-terms comparison. It does not rank privacy, security, speed, or product quality. Check the provider’s current feature list and policies before choosing.' },
 'netflix-vs-hulu': { title:'Netflix vs. Hulu', providers:['Netflix','Hulu'], category:'streaming', intro:'Compare the listed plans and their billing terms. Plan names identify ads where the source supplies that information.', note:'A lower price does not establish better value for you. Catalogs, live TV, ads, household rules, and availability differ. The feed does not provide a complete feature comparison.' }
};
function comparisonPage(data,slug,now,options={}) {
 const c=COMPARISONS[slug], deals=data.deals.filter(d=>c.providers.includes(d.provider)&&d.status==='active');
 const cards=c.providers.map(provider=>card(sortDeals(available(deals.filter(d=>d.provider===provider),now))[0],`Lowest verified ${provider} monthly equivalent`,now)).join('');
 return layout({title:c.title,description:`Compare ${c.title} using live listed prices, full billing terms, and source-check dates.`,path:`/compare/${slug}/`,now,body:`<section class="page-heading"><p class="eyebrow">The numbers, side by side</p><h1>${e(c.title)}</h1><p>${e(c.intro)}</p></section><div class="deal-grid">${cards}</div><p class="fineprint">Lowest among each provider’s verified plans shown here. Plans may have different tiers and commitments. ${priceNote}</p>${disclosure()}<div class="notice">${e(c.note)}</div><section class="section"><h2>All listed active plans</h2>${deals.length?table(deals,now,{caption:c.title,...options}):'<p>No active plans are available from the live feed.</p>'}</section><aside class="agent-note"><p>See the wider selection.</p><a href="/${c.category}/">All ${c.category==='vpn'?'VPN':'streaming'} plans →</a></aside>`});
}
function disclosurePage(now) {
 return layout({title:'Affiliate disclosure',description:'How BillWatch handles provider links, price comparisons, and click measurement.',path:'/affiliate-disclosure/',now,body:`<article class="prose"><p class="eyebrow">Straightforward by design</p><h1>Affiliate disclosure</h1><h2>How our links work today</h2><p>BillWatch currently uses ordinary provider links and does not earn commissions from them. If we add paid links, we’ll label them beside the link and explain how we’re paid.</p><p>Get deal links go through a BillWatch redirect before opening the provider’s ordinary website. They contain no affiliate codes. The redirect records aggregate counts by plan and UTC date, without recording your IP address, browsing history, or personal identifiers in the click-count database.</p><h2>What “verified” means</h2><p>A source-verified price was checked against the provider’s official page on the date shown, within the feed’s freshness window. It does not mean a hands-on product test or that the price was checked today. Prices, eligibility, and availability may change. Confirm the final price and terms at checkout.</p><h2>What we compare</h2><p>We cover selected U.S. providers and plans. Lowest-price statements apply only to the eligible verified listings identified beside the comparison. A monthly equivalent is a comparison figure from the source and can require an upfront payment. It is not necessarily a monthly bill. Taxes and extra fees may apply.</p><p>Tables default to listed monthly-equivalent price, and you can change their order. Payment does not influence these comparisons. Unverified or discontinued plans are excluded from current lowest-price claims.</p><h2>If paid links are introduced</h2><p>Any paid link will have a clear statement beside it: “Paid link. BillWatch may earn a commission if you buy through this link.” This disclosure page does not replace that nearby statement.</p><h2>Questions or corrections</h2><p>Contact <a href="mailto:hello@getbillwatchdog.com">hello@getbillwatchdog.com</a>.</p><p class="fineprint">Operated by Adam Bull, a sole trader in New South Wales, Australia. <a href="/privacy">Read the privacy policy</a>.</p></article>`});
}
function errorPage(statusCode, title, message, path='/') {
 return layout({title,description:message,path,body:`<section class="page-heading"><p class="eyebrow">${statusCode}</p><h1>${e(title)}</h1><p>${e(message)}</p><a class="button" href="${e(path)}">Try again</a><a class="text-link" href="/">Return home</a></section>`});
}
return Object.freeze({ ORIGIN, escape, productSchema, layout, homePage, categoryPage, verdict, planPage, COMPARISONS, comparisonPage, disclosurePage, errorPage });
})();

// ---- src/routes.mjs
const __routes = (() => {
/**
 * The only paths the human layer answers. Every other path belongs to the existing
 * worker: handleHumanRequest returns null for it before doing any I/O.
 * Keep integration/routes-include.json in step with these patterns (a test checks).
 */
const PLAN = /^\/plans\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;
const COMPARE = /^\/compare\/([A-Za-z0-9_-]+)\/?$/;
const CATEGORY = /^\/(vpn|streaming)\/?$/;
const DISCLOSURE = /^\/affiliate-disclosure\/?$/;

/**
 * Classify a pathname. "/" is human-owned only when the homepage switch is on, so with
 * the switch off the existing agent homepage keeps serving "/" untouched.
 */
function matchHumanRoute(pathname, { homepage = false } = {}) {
  if (typeof pathname !== 'string') return null;
  if (pathname === '/') return homepage === true ? { kind: 'home' } : null;
  if (pathname.startsWith('/go/')) return { kind: 'go' };
  let match;
  if ((match = CATEGORY.exec(pathname))) return { kind: 'category', param: match[1] };
  if ((match = PLAN.exec(pathname))) return { kind: 'plan', param: match[1] };
  if ((match = COMPARE.exec(pathname))) return { kind: 'compare', param: match[1] };
  if (DISCLOSURE.test(pathname)) return { kind: 'disclosure' };
  return null;
}

function ownsHumanRoute(pathname, options = {}) {
  return matchHumanRoute(pathname, options) !== null;
}
return Object.freeze({ matchHumanRoute, ownsHumanRoute });
})();

// ---- src/app.mjs
const __app = (() => {
const { loadDeals, loadHistory } = __data;
const { handleGo } = __redirect;
const { homePage, categoryPage, planPage, comparisonPage, disclosurePage, errorPage, COMPARISONS } = __render;
const { matchHumanRoute } = __routes;

const SECURITY_HEADERS = {
 'Content-Type':'text/html; charset=utf-8',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
function html(body, status=200) { return new Response(body,{status,headers:SECURITY_HEADERS}); }

/**
 * Worker entry point for the human pages. The live _worker.js calls it first:
 *   const humanResponse = await BillWatchHuman.handleHumanRequest(request, env, ctx, { homepage: HUMAN_HOMEPAGE });
 *   if (humanResponse) return humanResponse;
 * For any path it does not own it returns null straight away: no I/O, no bindings touched,
 * request body unread. The existing dispatch then handles that request exactly as before.
 * Options: homepage (true serves the human homepage at "/"; anything else leaves "/" alone),
 * now (a fixed clock for tests).
 */
async function handleHumanRequest(request, env = {}, ctx = undefined, options = {}) {
 const url = new URL(request.url);
 const route = matchHumanRoute(url.pathname, { homepage: options?.homepage === true });
 if (!route) return null;
 try {
   return await respond(request, url, route, env, options?.now ?? new Date());
 } catch {
   // A bug on a human route must not fall through to another handler or leak details.
   return new Response('BillWatch could not show this page. Please try again later.',{status:500,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
}

async function respond(request, url, route, env, now) {
 const path = url.pathname;
 if (route.kind==='go') return handleGo(request, env, {now});
 if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
 if (route.kind==='compare' && !Object.hasOwn(COMPARISONS, route.param)) return html(errorPage(404,'Comparison not found','Choose one of our published provider comparisons.'),404);
 if (path!=='/' && !path.endsWith('/')) return new Response(null,{status:308,headers:{Location:path+'/'+url.search,'Cache-Control':'no-store'}});
 if (request.method==='HEAD') {
   const result = await respond(new Request(request.url,{method:'GET'}),url,route,env,now);
   return new Response(null,{status:result.status,headers:result.headers});
 }
 if (route.kind==='disclosure') return html(disclosurePage(now));
 try {
   const data=await loadDeals(env?.ASSETS, request.url, now);
   const sort=['price','provider','plan','billing'].includes(url.searchParams.get('sort'))?url.searchParams.get('sort'):'price';
   const direction=url.searchParams.get('direction')==='desc'?'desc':'asc';
   const options={sort,direction};
   if (route.kind==='home') return html(homePage(data,now));
   if (route.kind==='category') return html(categoryPage(data,route.param,now,options));
   if (route.kind==='compare') return html(comparisonPage(data,route.param,now,options));
   if (route.kind==='plan') {
     const deal=data.deals.find(d=>d.id===route.param);
     if (!deal) return html(errorPage(404,'Plan not found','This plan ID is not in the current source feed.'),404);
     let history=null, historyProblem=false;
     try { history=await loadHistory(deal.id, env?.ASSETS, request.url); } catch { historyProblem=true; }
     return html(planPage(deal,history,now,historyProblem));
   }
 } catch {
   return html(errorPage(503,'Prices are temporarily unavailable','The live price source could not be loaded or validated. We haven’t substituted old or estimated prices.',path),503);
 }
 // An owned route must never fall through to the existing dispatch.
 throw new Error(`Unhandled human route: ${route.kind}`);
}
return Object.freeze({ SECURITY_HEADERS, handleHumanRequest });
})();

return Object.freeze({ handleHumanRequest: __app.handleHumanRequest, ownsHumanRoute: __routes.ownsHumanRoute });
})();

export { BillWatchHuman };
