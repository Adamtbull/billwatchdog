/** Live BillWatch API adapter. The published /v1 payloads are never modified. */
export const API_ORIGIN = 'https://getbillwatchdog.com';
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

export function isVerified(deal, now = Date) {
  return object(deal) && verificationReason(deal, instant(now)) === null;
}

/** Format all digits in the API number. Never recompute or round an equivalent price. */
export function priceText(number) {
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

export function normalizeDeals(payload, now = Date) {
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

export function sortDeals(deals, key = 'price', direction = 'asc') {
  const descending = direction === 'desc' ? -1 : 1;
  const field = { price: 'price_usd_monthly', provider: 'provider', plan: 'plan', name: 'plan', billing: 'billing', checked: 'checked_at', checked_at: 'checked_at' }[key] || 'price_usd_monthly';
  return [...deals].sort((a, b) => {
    const comparison = field === 'price_usd_monthly' ? a[field] - b[field] : String(a[field] ?? '').localeCompare(String(b[field] ?? ''), 'en');
    return descending * comparison || a.id.localeCompare(b.id, 'en');
  });
}

async function loadJson(path, fetcher, origin) {
  const response = await fetcher(new URL(path, origin).href, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`BillWatch source returned HTTP ${response.status}.`);
  return response.json();
}

export async function loadDeals(fetcher = fetch, origin = API_ORIGIN, now = Date) {
  return normalizeDeals(await loadJson('/v1/deals.json', fetcher, origin), now);
}

export function normalizeHistory(payload) {
  // Preserve observed prices; never interpolate missing dates or recompute prices.
  if (!object(payload) || typeof payload.plan_id !== 'string' || !ID_PATTERN.test(payload.plan_id) || !Array.isArray(payload.history)) throw new TypeError('Expected the live history envelope {plan_id, history}.');
  const history = payload.history.map((entry) => {
    if (!object(entry) || !Number.isFinite(dateInstant(entry.date))) throw new TypeError('Invalid history observation date.');
    const price = entry.price_usd_monthly;
    return { ...entry, date: entry.date, price, priceFormatted: priceText(price) };
  }).sort((a, b) => dateInstant(a.date) - dateInstant(b.date));
  return { ...payload, history, points: history };
}

export async function loadHistory(id, fetcher = fetch, origin = API_ORIGIN) {
  if (typeof id !== 'string' || id.length > 160 || !ID_PATTERN.test(id)) throw new TypeError('Invalid plan ID.');
  const result = normalizeHistory(await loadJson(`/v1/price-history/${id}.json`, fetcher, origin));
  if (result.plan_id !== id) throw new TypeError('History plan ID does not match the requested plan.');
  return result;
}
