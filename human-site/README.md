# BillWatch human pages

Dependency-free, server-rendered human-facing routes for the existing BillWatch Cloudflare Pages site. The browser receives HTML and a 1.8 KB optional table-sorting script, with no third-party fonts, scripts, or framework. All running pages fetch prices from the existing live `/v1/deals.json` API. There is no baked-in production price list or stale fallback.

## Important: integration, not a replacement deployment

The inspected repository at `2e49befa1b530cfdf96abd97830b9cf8a0fda865` contains only README, manifests, and mirrored data. It does **not** contain the current website, existing Pages Functions, `/mcp` handler, or history handler. This entire change is additive under `human-site/`; all existing files and endpoints remain untouched.

Before any deployment, a maintainer must integrate this package with the actual site's source. Deploying `human-site/public/` by itself would omit the existing API and pages. Do not do that. This draft does not create a deployment, change Cloudflare settings, or merge code.

The homepage is the one intentional existing-page rewrite in the request. No existing legal/disclosure page is replaced: the new page is `/affiliate-disclosure/`.

## Implemented routes

- `/`: human-value homepage with the lowest verified paid VPN and streaming monthly equivalents among eligible listings; free VPNs remain in the VPN table. Small agent section links to `/api`.
- `/vpn/`, `/streaming/`: sortable price, provider, plan, and billing tables; work without JavaScript via query parameters. Verified and needs-recheck sections are separate.
- `/plans/{id}/`: current/last-listed price, exact billing terms, source-check date, one-line factual verdict, source link, accessible history SVG and exact-value table. Missing, failed, or one-point histories are explicitly explained.
- `/compare/nordvpn-vs-surfshark/`, `/compare/netflix-vs-hulu/`: live price-and-terms comparisons, without unsupported quality/feature rankings.
- `/go/{plan-id}`: validated ordinary provider URL, atomic server-side aggregate count, then a non-cached 302.
- `/affiliate-disclosure/`: current unpaid-link policy, source/price limitations, aggregate click measurement explanation, and future paid-link disclosure requirements.

Plan and category pages include Product/Offer JSON-LD. A prepaid monthly equivalent is represented as a unit price specification, not falsely used as the full checkout price. Actual monthly billing may also have an Offer price. Stale/unverified prices do not receive a current Offer.

## Local review

Requires Node 22.13+ (tested with Node 24.19). There are no dependencies to install.

```sh
cd human-site
npm test
npm run build
npm start
```

Open `http://127.0.0.1:8788`. The server fetches live prices. The local click database is `.local/clicks.sqlite`; local `/go/` requests write only there. Unowned routes deliberately return a local explanatory 404 instead of pretending to implement the existing live APIs or docs. The production adapter passes them through.

Optional offline UI review can use an explicitly supplied captured real API response:

```sh
BILLWATCH_PREVIEW_SNAPSHOT=/absolute/path/to/real-live-deals.json npm start
```

This shows a visible preview banner, disables outbound redirects, and uses an unavailable-history state unless you exercise a history response through tests. It is a review mode only. No snapshot is bundled into the production runtime.

`npm run check:live` is read-only. It fetches the live deals and one live history response; it never requests a production `/go/` URL.

## Integrate with the existing Cloudflare Pages project

Only after review and Adam's separate deployment approval:

1. Find the actual existing site source and build configuration. Preserve the current build output, Functions, route configuration, and all agent files.
2. Add `src/` to an appropriate new folder in that source. Copy `public/billwatch-human.css` and `public/billwatch-human.js` into the existing build output's `assets/` directory.
3. Merge the small `functions/[[path]].js` adapter into the existing Functions routing without overwriting any current handler. If there is already a catch-all or advanced `_worker.js`, call `handleHumanRequest(request, env)` first for the owned human routes and pass `null` results to the existing handler. `integration/pages-adapter.mjs` shows the same pattern.
4. If the existing project uses `_routes.json`, add only these human routes and `/go/*` to its include list. Preserve existing include/exclude entries. Do not introduce a root wildcard that changes existing agent route handling.
5. Ensure the deployed assets are `/assets/billwatch-human.css` and `/assets/billwatch-human.js`. The `npm run build` output contains additive assets and portable modules only; it is not a complete replacement website.
6. Create a D1 database and apply `migrations/0001_clicks.sql` using the project's approved migration process. Bind it to the existing Pages project as `BILLWATCH_CLICKS`. Database creation, binding, migrations, preview deployments, and production deployment have **not** been performed by this change. These require maintainer action/approval.
7. In a separately authorized preview environment, verify the homepage and all new routes, then byte-compare unchanged existing `/v1/*`, `/mcp`, `/llms.txt`, `/agent.json`, `/.well-known/agent.json`, `/api`, privacy, and existing disclosure behavior. Do not exercise production `/go/` counters as a test.
8. Run `npm run check:live` in the integration environment. An independent review verified the actual NordVPN history envelope and exercised the homepage, categories, NordVPN detail (including SVG/history), and both comparisons against live endpoints with HTTP 200 responses. Repeat after integration to detect routing or environment differences.

No `wrangler.toml`, account IDs, database IDs, secrets, automated deployment workflow, or build-setting override is supplied. Adding one without seeing the current site's configuration could replace existing behavior.

## Price integrity

- The live source is fixed to `https://getbillwatchdog.com`; request parameters cannot select arbitrary upstream URLs.
- The source's USD monthly price is formatted without rounding or recalculating it. Full source billing text is shown nearby, including any stated upfront and renewal amounts.
- Verification requires the source's flag, active status, successful official-page check, a valid non-future check date, a confirmation no older than twice its cadence, and an unexpired dated promotion.
- A check can be due while still inside the source-defined freshness window. The UI shows both the last source-check and next-due dates; it never calls an old check “checked today.”
- Missing details are unknown, not calculated. Provider promotional savings claims are not amplified into unsubstantiated percentages or crossed-out prices.
- Provider links must match an explicit trusted provider/domain map, use HTTPS without credentials or custom ports, and be flagged `affiliate: false`. Query parameters and fragments are removed. New providers must be reviewed before enabling redirects. Unsafe and paid-link targets fail closed.
- Missing/unavailable/malformed live data returns 503 and no invented or cached price. Unknown plan IDs return 404.

## Measurable clicks

The D1 table stores only `(plan_id, day, click_count)`, with an atomic upsert. It stores no IP, referrer, cookies, user agent, or personal identifiers. Infrastructure logs are governed separately by the existing hosting configuration.

A GET waits for the database's confirmed durable write before redirecting. Missing binding or failed write returns 503 instead of pretending a click was recorded. HEAD does not increment. Repeated GETs, bots, and prefetches may count again; these are **redirect requests**, not unique visitors, purchases, conversions, or proof of human clicks. There is no public analytics endpoint.

Example owner-only read query after setup:

```sql
SELECT day, plan_id, click_count
FROM click_counts
ORDER BY day DESC, click_count DESC;
```

The query should run only through an authenticated operator database tool. No new dashboard permission or endpoint is created here.

## Disclosure

Current CTAs use ordinary unpaid provider links. The disclosure link appears in every page footer and beside deal groups. A future paid link is deliberately unavailable in this implementation until both the redirect policy and visible near-link commission disclosure are explicitly updated. The included wording follows FTC guidance, but is not a legal certification.

References reviewed for wording:
- https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking
- https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business
- https://www.ftc.gov/legal-library/browse/statement-policy-regarding-comparative-advertising

## Verification

`npm test` covers rendering, routing/passthrough, SSR sorting, exact prices, schema output, source failure, XSS, unsafe URLs/open-redirect attempts, stale/discontinued/expired offers, unsupported IDs/methods, history empty/error/single-point cases, counting only after durable writes, missing storage, HEAD behavior, and real local SQLite migration/upsert persistence.

`npm run build` prepares only new assets/modules. Browser and live integration outcomes are recorded in `review/` when available; unit tests alone do not establish browser or deployed-site compatibility.

No production counters were changed. No deployment was performed. This is a draft for review and integration, not a claim that the absent production source has already been modified.

## Rollback after a separately authorized integration

Keep the previous production source and deployment before integrating. To roll back the human layer, remove its owned-route adapter (or restore the previous dispatch), restore the previous homepage, and remove only `/assets/billwatch-human.css` and `/assets/billwatch-human.js` if no longer referenced. Restore previous route includes exactly. Leave the existing API, MCP, manifests, privacy, and disclosure files unchanged. Retain the aggregate click database unless its deletion is separately approved; rollback does not require dropping it. Verify preserved endpoints against the saved pre-integration responses. A rollback deployment is itself a deployment and requires the user's authorization.
