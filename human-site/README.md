# BillWatch human pages

Dependency-free, server-rendered human-facing routes for the existing BillWatch Cloudflare Pages site. The browser receives HTML and a 1.8 KB optional table-sorting script, with no third-party fonts, scripts, or framework. Every page reads prices at request time from the deployment's own published `/v1/deals.json`, the same file agents get, through the Pages static asset binding (`env.ASSETS`). There is no baked-in production price list, no stale fallback, and no network request.

## Important: integration, not a replacement deployment

This repository contains only the README, manifests, and mirrored data. It does **not** contain the live website's source: its `_worker.js`, `_routes.json`, `/mcp` handler or static pages. Everything here is additive under `human-site/`; all existing files and endpoints remain untouched.

**[RUNBOOK.md](RUNBOOK.md) is the integration procedure**: D1 setup, the files to copy, the exact `_worker.js` patch, the `_routes.json` entries, the homepage switch, preview verification, and rollback. Deploying `human-site/public/` by itself would omit the existing API and pages. Do not do that. Nothing in this package creates a deployment, changes Cloudflare settings, or merges code.

The homepage rewrite is behind a one-line switch in the live `_worker.js` (`HUMAN_HOMEPAGE`, shipped as `false`), so the current agent homepage stays at `/` until Adam chooses otherwise. No existing legal/disclosure page is replaced: the new page is `/affiliate-disclosure/`.

## How it plugs into the live worker

- `dist/billwatch-human.mjs` is the whole human layer as one self-contained module (generated from `src/` by `npm run build`; a test fails if it is stale). It defines one name, `BillWatchHuman`, and has no imports, so it works with a bundled `_worker.js`, a `_worker.js/` directory, or pasted into an unbundled `_worker.js`.
- The live `fetch` handler calls `BillWatchHuman.handleHumanRequest(request, env, ctx, { homepage: HUMAN_HOMEPAGE })` first. For any path it does not own it returns `null` immediately, without touching a binding or reading the request body, and the existing dispatch runs exactly as before.
- Owned paths: `/` (only with the switch on), `/vpn/`, `/streaming/`, `/plans/{id}/`, `/compare/{slug}/`, `/affiliate-disclosure/` (each also without the trailing slash, answered with a 308) and `/go/{id}`. The matching `_routes.json` entries are in `integration/routes-include.json`.
- Data comes from `env.ASSETS` (`/v1/deals.json` and `/v1/price-history/{id}.json`), so the human pages never make a self-subrequest and their reads are never counted as agent API traffic. If `env.ASSETS` is missing, pages answer 503; there is no fallback to a public fetch.
- Static files live in `public/assets/` and are deployed at `/assets/billwatch-human.css` and `/assets/billwatch-human.js`.

## Implemented routes

- `/` (only when the homepage switch is on): human-value homepage with the lowest verified paid VPN and streaming monthly equivalents among eligible listings; free VPNs remain in the VPN table. Small agent section links to `/api`.
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

Open `http://127.0.0.1:8788`. Locally there is no `env.ASSETS`, so the preview server supplies a stand-in that reads the live site's public `/v1` files with read-only GETs (the worker itself never does this). The local preview shows the human homepage at `/`; set `BILLWATCH_HUMAN_HOMEPAGE=0` to leave `/` unowned, as in production with the switch off. The local click database is `.local/clicks.sqlite`; local `/go/` requests write only there. Unowned routes deliberately return a local explanatory 404 instead of pretending to implement the existing live APIs or docs. In production they pass through to the existing worker.

Optional offline UI review can use an explicitly supplied captured real API response:

```sh
BILLWATCH_PREVIEW_SNAPSHOT=/absolute/path/to/real-live-deals.json npm start
```

This shows a visible preview banner, disables outbound redirects, and uses an unavailable-history state unless you exercise a history response through tests. It is a review mode only. No snapshot is bundled into the production runtime.

`npm run check:live` is read-only. It reads the live deals and one live history response; it never requests a production `/go/` URL.

`npm run compare:existing -- <baseline origin> <candidate origin>` compares the existing routes of two deployments byte for byte (GET, HEAD and OPTIONS only). RUNBOOK.md uses it to check a preview against production.

## Integrate with the existing Cloudflare Pages project

Follow [RUNBOOK.md](RUNBOOK.md), only after review and Adam's separate deployment approval. In short: create and bind the `BILLWATCH_CLICKS` D1 database, copy `dist/billwatch-human.mjs` and the two `public/assets/` files, add two lines and the homepage switch to `_worker.js`, append the nine `integration/routes-include.json` entries to `_routes.json`, verify on a preview, then deploy.

No `wrangler.toml`, account IDs, database IDs, secrets, automated deployment workflow, or build-setting override is supplied. For a Pages project, a Wrangler file becomes the source of truth for bindings and settings, so adding one without seeing the current configuration could remove existing behavior.

## Price integrity

- The data source is fixed: the deployment's own `/v1/deals.json` and `/v1/price-history/{id}.json` (with a validated plan ID), read through `env.ASSETS`. Request parameters cannot select other files or any URL.
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

`test/integration.test.mjs` applies the RUNBOOK.md `_worker.js` patch to a stand-in of the live dispatch (`test/fixtures/live-worker.mjs`) and checks every existing route byte for byte against the unpatched stand-in, for the imported, pasted and source builds, with the homepage switch off and on. It also checks the `_routes.json` entries, the `env.ASSETS` data path, the `/go/` binding behavior, and that `dist/billwatch-human.mjs` matches `src/`. Fixture data is this repository's published mirror (`v1/deals.json`), so a feed change the pages cannot handle fails here.

`npm run build` regenerates `dist/billwatch-human.mjs` and rejects worker code that uses a global `fetch`, Node-only APIs, tracking parameters or literal dollar prices. `test/browser.mjs` is the optional Playwright check (desktop and mobile, axe-core, keyboard, sorting with and without JavaScript); unit tests alone do not establish deployed-site compatibility.

No production counters were changed. No deployment was performed. This is a draft for review and integration, not a claim that the absent production source has already been modified.

## Rollback after a separately authorized integration

See the Rollback section of [RUNBOOK.md](RUNBOOK.md). In short: roll back to the previous Pages deployment, or restore the saved `_worker.js` and `_routes.json` and remove the module and the two asset files. Setting the homepage switch back to `false` restores the current homepage on its own. Leave the existing API, MCP, manifests, privacy, and disclosure files unchanged. Retain the aggregate click database unless its deletion is separately approved. A rollback deployment is itself a deployment and requires the user's authorization.
