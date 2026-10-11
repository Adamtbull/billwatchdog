# Verification record — 2026-10-10

## Passed

- Node 24.19: 36 automated tests, zero failures.
- Additive build completed. Client-side sorting JavaScript is 1,829 bytes; no runtime package dependencies.
- Read-only live API check: 65 plans, 62 eligible current verified records, 65 safe provider URLs. Feed updated 2026-10-01.
- Live NordVPN history: 2 actual points in the published `plan_id`/`history` envelope. History IDs must match the requested plan.
- Independent live handler checks: homepage, VPN, streaming, NordVPN detail, and both comparison pages returned HTTP 200. NordVPN detail included its history SVG/table.
- Independent file-backed SQLite check: a recorded count survived database close/reopen; forced write failure returned 503 without redirect and preserved the prior count.
- Existing route handling: `/v1/*`, `/mcp`, `/llms.txt`, `/agent.json`, `/.well-known/agent.json`, API docs, privacy, and old disclosure are not owned by the new handler and pass through without an upstream request.
- Price integrity/security: exact decimal display, source billing/promo/eligibility wording, freshness/expiry gates, safe provider URL checks, no affiliate parameters, XSS escaping, JSON-LD escaping, unknown/prototype comparison slugs, HEAD/no-count behavior, and storage failure handling covered by tests.
- Static rendered-page checks: 7 pages, 88 table rows with exact source prices/billing/check dates, and 36 rows with full source promotion text.
- Contrast arithmetic: #c34333 on the paper background passes 4.685:1 for small text. Narrow navigation wraps at 420px. This is a static check, not a substitute for browser accessibility testing.

## Not verified

- Browser screenshots, visual layout, keyboard interaction, real browser sorting, and automated accessibility execution. Installed Chromium could not start because the environment denied OS sockets, including a reviewed retry. No passing browser result is claimed.
- Integration into the absent production website source and Cloudflare Pages route configuration.
- Production D1 binding/migration or deployed persistent counts. Only local real SQLite and mock D1 interfaces were exercised.
- Deployment behavior/account settings. The Cloudflare dashboard was not accessible. Publication uses the documented `[CF-Pages-Skip]` commit prefix to avoid a Pages build.

## Review artifacts

A standalone homepage preview was generated from the actual renderer and an actual live API capture dated October 10, 2026, with explicit source date and disabled outbound links. It is a visual review artifact, not the live application or a current-price substitute. The original task requires a draft PR only; no deployment or merge was performed.

## Safety

No production `/go/` endpoint was requested. No production counters, provider accounts, payments, deployment configuration, existing files, or agent endpoints were changed.

# Integration verification — 2026-10-10

Scope: wiring the human pages into the live Pages `_worker.js` (see `RUNBOOK.md`). No deployment, Cloudflare change or production request was made.

## Passed

- Node 22.22: `npm test`, 62 tests, zero failures. The 36 tests above are kept, adapted to the `env.ASSETS` data path; 26 are new.
- Worker wiring: the two `RUNBOOK.md` code blocks were applied to a stand-in of the live dispatch (`test/fixtures/live-worker.mjs`, the shape given in the integration brief). 33 existing route and method cases, including `POST /mcp`, `POST /api/events`, `OPTIONS /mcp` and HEAD requests, were byte-identical to the unpatched stand-in in status, headers, body, existing handlers run, and `env.ASSETS` reads. Checked for the imported, pasted and source builds, with the homepage switch off and on (on: every case except `/`).
- Mutation checks: making the human layer read `env.ASSETS` for every request, read the request body, own `/` regardless of the switch, fall through on an owned route, drop `/go/*` from the routes, or add a public-fetch fallback each made the suite fail.
- Browser: Playwright 1.56 with Chromium 1194 and axe-core 4.10.3, using the repository's published feed mirror (updated 2026-10-01). All 7 pages at 1440 px and 390 px, zero WCAG 2.0/2.1 A and AA violations, keyboard skip link, numeric sorting with and without JavaScript, no browser console errors, and 88 table rows per viewport matching the feed's price, billing and promotion text exactly.
- Defect found and fixed: on phones the table pages scrolled sideways (document 804 to 809 px wide in a 390 px viewport) because the absolutely positioned `.sr-only` labels inside each table escaped the scroll container. `.table-scroll` now sets `position: relative`; all pages measure 390 px.
- CPU: about 0.05 to 2.1 ms per page render (warm, Node 22) with the 65-plan feed.

## Not verified

- The real `_worker.js`, `_routes.json` and deploy method, which are not in this repository. The stand-in follows the brief's dispatch description.
- Cloudflare runtime behavior of `env.ASSETS` and D1. Both were exercised through stand-ins only, and nothing was deployed to a preview.
- The live feed: this environment cannot reach getbillwatchdog.com from its shell, so checks used the repository mirror.

# Review follow-up — 2026-10-10

Muse reviewed the integration against the live `_worker.js`, `_routes.json` and deploy folder. Confirmed: the dispatch shape, a dashboard or API zip upload (so the module is pasted inline), 21 include rules with `"/"` among them, no name collisions, and no existing files at the new paths except `plans.html`.

Changes made in response:

- Rebuild safety. The live `_worker.js` is generated by `build/make_worker.py`, so a hand patch would be lost on the next rebuild. `integration/billwatch_human_patch.py` now applies the integration as the build's last step and holds the homepage switch. Tests run the full byte-identity matrix against workers patched by the script (switch off and on), and check that a second run changes nothing, that `--remove` restores the original bytes, that `--check` detects an unpatched or differently switched worker, that CRLF line endings are kept, and that it refuses, without writing, a worker with no or two fetch methods, no `export default`, a leftover hand patch or a half-removed block, and a bundle that is not the generated file. Four deliberate breakages of the script each made the suite fail.
- `/plans`. `_routes.json` has no "exact match wins" rule, and `"/plans/*"` can also match bare `/plans`, which would start sending the existing plans page through `counted()`. The runbook now adds `"/plans"` to `exclude` when it is not already in `include`. The stand-in serves `plans.html`, and `/plans`, `HEAD /plans`, `/plans/` and `/plans.html` are byte-identical through every patched variant.
- The dispatch variable is now `humanResponse` (was `human`), a name the script checks is unused.

`npm test`: 67 tests, zero failures, none skipped (Python 3.13 present).
