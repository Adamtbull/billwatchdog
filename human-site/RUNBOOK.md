# BillWatch human pages: integration runbook

How the human pages in `human-site/` go live on the existing Cloudflare Pages project behind getbillwatchdog.com. Nothing in this pull request has been deployed, no Cloudflare setting has been changed, and no secret is involved. Every step that touches Cloudflare needs Adam's go-ahead.

What gets added to the live site:

- one worker module, `dist/billwatch-human.mjs` (generated from `src/`, no imports, no network access, no prices)
- two static files, `/assets/billwatch-human.css` and `/assets/billwatch-human.js`
- two lines in the `_worker.js` fetch handler, plus a one-line homepage switch
- nine entries in the `_routes.json` include list
- one D1 database, bound to the Pages project as `BILLWATCH_CLICKS`

What does not change: `/v1/*`, `/mcp`, `/api/*`, `/api`, `/demo`, `/llms.txt`, `/agent.json`, `/.well-known/agent.json`, the privacy and disclosure pages, and, while the switch is off, `/`. For any path the human pages do not own, the new call returns `null` before it touches a binding or reads the request body, so the existing dispatch receives exactly the request it receives today.

## 0. Before you start

1. Work from the live site's source: the Pages build output folder that holds `_worker.js` and `_routes.json`. This repository is a data mirror and does not contain it.
2. Find out how `_worker.js` is shipped, because it decides step 3:
   - **A.** a single `_worker.js` file deployed with `wrangler pages deploy` (Wrangler bundles it by default, so imports work)
   - **B.** a `_worker.js/` folder with an `index.js`
   - **C.** a single file uploaded without bundling (for example with `--no-bundle`), so imports are not available

   If you are not sure, use C. It works in every case.
3. Check that the new paths are free. The output folder must not contain anything named `vpn`, `vpn.html`, `streaming`, `streaming.html`, `plans`, `compare`, `affiliate-disclosure`, `affiliate-disclosure.html` or `go`, and `_redirects` must not mention those paths. If something is there, stop: the new routes would shadow it.
4. Count the rules in `_routes.json` (include plus exclude). After adding nine it must still be 100 or fewer, and each rule 100 characters or fewer.
5. Save copies of the current `_worker.js` and `_routes.json` for rollback.

## 1. Create the click-count database (D1)

Do this first. Until the binding exists, every `/go/` link answers 503 instead of redirecting.

Dashboard route (no terminal needed):

1. Cloudflare dashboard, **Storage & databases > D1 SQL database > Create database** ([direct link](https://dash.cloudflare.com/?to=/:account/workers/d1)).
2. Name: `billwatch-clicks`. Location: **Eastern North America (ENAM)**. Select **Create**.
   Why set the location: without a hint, D1 places the database near whoever creates it, which for Adam means Oceania. The site lists US plans, so most clicks are likely to come from the US, and each click waits for the database write before it redirects. Western North America (WNAM) is also fine.
3. Open `billwatch-clicks` and select **Console**. Paste the full contents of `human-site/migrations/0001_clicks.sql` and select **Execute**.
4. In the same console, run:
   ```sql
   SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'click_counts';
   ```
   Expected: one row, `click_counts`.
5. **Workers & Pages >** the BillWatch Pages project **> Settings > Bindings > Add > D1 database bindings**. Variable name: `BILLWATCH_CLICKS`. D1 database: `billwatch-clicks`. Save it for the **Production** environment.
6. Preview environment, pick one:
   - bind a second database, `billwatch-clicks-preview`, created and migrated the same way, so test clicks never touch production counts (recommended), or
   - leave Preview unbound, in which case preview `/go/` links answer 503 by design.
7. A new binding takes effect on the next deployment.

Terminal route (same result, needs Node and a Cloudflare login):

```sh
npx wrangler@latest d1 create billwatch-clicks --location=enam
npx wrangler@latest d1 execute billwatch-clicks --remote --file=human-site/migrations/0001_clicks.sql
npx wrangler@latest d1 execute billwatch-clicks --remote --command="SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'click_counts';"
```

Then add the binding in the dashboard as in step 5. Do not add a `wrangler.toml` (or `wrangler.json`) to the Pages project to declare it: for Pages, that file becomes the source of truth for the project's bindings and settings, replacing what the dashboard holds.

The migration uses `CREATE TABLE IF NOT EXISTS`, so running it again, or later through `wrangler d1 migrations apply`, is harmless.

How it behaves once bound:

- `GET /go/{plan-id}` adds 1 to that plan's count for the current UTC day, then answers 302 to the provider's plain page (no query string, no affiliate code). `HEAD` answers the same 302 without counting.
- Without the binding, `/go/` answers 503 "Provider links are unavailable because durable click recording is not configured." If the write fails, it answers 503 too. It never redirects without a confirmed write.
- Counts are redirect requests, not visitors or sales. Read them in the console:
  ```sql
  SELECT day, plan_id, click_count FROM click_counts ORDER BY day DESC, click_count DESC;
  ```

## 2. Copy the files

| From this repository | To the live build output folder |
| --- | --- |
| `human-site/public/assets/billwatch-human.css` | `assets/billwatch-human.css` |
| `human-site/public/assets/billwatch-human.js` | `assets/billwatch-human.js` |
| `human-site/dist/billwatch-human.mjs` | A: next to `_worker.js`. B: inside `_worker.js/`. C: not copied, pasted in step 3. |

- The pages always link to `/assets/billwatch-human.css` and `/assets/billwatch-human.js`. Those paths are not in `_routes.json`, so Pages serves them as plain static files without running the worker.
- Copy `dist/billwatch-human.mjs` as it is. It is generated; to change it, edit `human-site/src/` and run `npm run build`.
- In case A, Pages also publishes the module itself at `/billwatch-human.mjs`, because everything in the output folder except `_worker.js` and the other special files is public. It contains only code that is already public in this repository. To avoid that, keep the module outside the output folder and point the import at it; Wrangler resolves the import while bundling. In case B nothing inside `_worker.js/` is published.

## 3. Patch `_worker.js`

Two additions. Nothing else in the file changes.

At the top of the file:

<!-- worker-patch:top -->
```js
import { BillWatchHuman } from "./billwatch-human.mjs";

// Homepage switch. false: "/" keeps today's agent homepage. true: "/" serves the new human homepage.
const HUMAN_HOMEPAGE = false;
```

As the first lines inside `fetch`, before the existing `const { pathname } = new URL(request.url);`:

<!-- worker-patch:fetch -->
```js
    const human = await BillWatchHuman.handleHumanRequest(request, env, ctx, { homepage: HUMAN_HOMEPAGE });
    if (human) return human;
```

The result:

```js
import { BillWatchHuman } from "./billwatch-human.mjs";

// Homepage switch. false: "/" keeps today's agent homepage. true: "/" serves the new human homepage.
const HUMAN_HOMEPAGE = false;

export default {
  async fetch(request, env, ctx) {
    const human = await BillWatchHuman.handleHumanRequest(request, env, ctx, { homepage: HUMAN_HOMEPAGE });
    if (human) return human;
    const { pathname } = new URL(request.url);
    if (pathname === "/api/events") { /* unchanged */ }
    if (pathname === "/api/agent-report" || pathname === "/mcp-log.html") { /* unchanged */ }
    if (pathname === "/mcp") { /* unchanged */ }
    return counted(request, env, ctx);
  },
};
```

- Case B: put the import in `_worker.js/index.js`. With the module in the same folder the path stays `./billwatch-human.mjs`.
- Case C (paste): replace the `import` line with the whole of `dist/billwatch-human.mjs` except its last line, `export { BillWatchHuman };`. Everything it adds sits inside one constant, `BillWatchHuman`, so it cannot collide with names already in `_worker.js` (check that `_worker.js` does not already define `BillWatchHuman`).

Why this keeps existing routes byte-identical:

- For a path it does not own, `handleHumanRequest` returns `null` after one pathname check. It does not touch `env.ASSETS`, `BILLWATCH_CLICKS` or any other binding, and it does not read the request body, so `/mcp` POSTs and `/api/events` reach their handlers intact. The test suite applies the two blocks above to a stand-in of this dispatch and compares status, headers, body bytes and side effects for every existing route, with the switch off and on.
- Human routes never reach `counted()`, so page views and the human pages' own data reads are not counted as agent API traffic.
- An error on a human route ends in a 500 or 503 from the human layer. It never falls through to the existing handlers.

## 4. Add the human routes to `_routes.json`

Append these nine entries to the end of `include`. Keep every existing `include` entry, leave `exclude` exactly as it is, and do not add `/*`.

```json
"/vpn", "/vpn/", "/streaming", "/streaming/", "/plans/*", "/compare/*", "/affiliate-disclosure", "/affiliate-disclosure/", "/go/*"
```

Shape of the result (illustrative, existing entries abbreviated):

```text
{
  "version": 1,
  "include": [ "/", "/demo", "/api", "/v1/*", "/mcp", <every other existing entry, unchanged>,
               "/vpn", "/vpn/", "/streaming", "/streaming/", "/plans/*", "/compare/*",
               "/affiliate-disclosure", "/affiliate-disclosure/", "/go/*" ],
  "exclude": [ <unchanged> ]
}
```

- `"/"` must already be in `include` (it is today). The homepage switch relies on it, and no change is needed.
- Both spellings, with and without the trailing slash, are listed so the rule holds whether or not the matcher treats the slash as optional. Wrangler's local matcher does; the extra entries cost nothing.
- Paths under the new prefixes that the human pages do not own, such as `/plans/Upper-Case/`, now run the worker, get `null`, and fall through to `counted()`, ending in the same 404 as before.
- `exclude` beats `include`. Check that no existing exclude rule covers these paths.
- `human-site/integration/routes-include.json` holds the same list in machine-readable form.

## 5. The homepage switch

The open product decision is kept to one line in `_worker.js`:

```js
const HUMAN_HOMEPAGE = false;
```

- `false` (what this pull request ships): `/` is untouched. The human pages live at `/vpn/`, `/streaming/`, `/plans/{id}/`, `/compare/nordvpn-vs-surfshark/`, `/compare/netflix-vs-hulu/` and `/affiliate-disclosure/`. Nothing on the current homepage links to them yet.
- `true`: `/` serves the human homepage (lowest verified VPN and streaming prices, links to the tables, and a small "Building with an agent?" link to `/api`). The current agent homepage is no longer reachable at `/`, and `/` stops passing through `counted()`, so whatever `counted()` records for homepage visits stops too.

Changing it is a one-line edit and a redeploy. Rolling it back is the same edit in reverse.

## 6. Preview, verify, then production

1. Deploy to a preview first, with the switch set to `false`, for example `npx wrangler pages deploy <output folder> --project-name <project> --branch human-pages-preview` (any branch other than the production branch makes a preview). Build the preview from the same source as the current production deployment plus these changes, so the data files match.
2. Compare existing routes, byte for byte, from any machine with Node 22.13 or later:
   ```sh
   node human-site/scripts/compare-existing-routes.mjs https://getbillwatchdog.com https://<preview>.pages.dev
   ```
   It sends only GET, HEAD and OPTIONS to existing read-only routes. It never requests `/go/`, never POSTs to `/mcp`, and identifies itself with the User-Agent `billwatch-integration-check` so `counted()` can tell its reads apart. Expected: `No differences`. If the only differences are headers that your zone adds to the custom domain, rerun it with the production `https://<project>.pages.dev` address as the first argument. With the switch on, add `--skip-home`.
3. Open the human pages on the preview: `/vpn/`, `/streaming/`, a plan page (any "Details & history" link), both comparisons and `/affiliate-disclosure/`. Each should show prices with source-check dates. A page saying prices are temporarily unavailable means the worker could not read `/v1/deals.json` through `env.ASSETS`.
4. Click flow on the preview: with a preview database bound, a "Get deal" button should land on the provider's site, and the console should show a count of 1 for that plan today. With Preview unbound, expect the 503 message instead.
5. To see the human homepage, set the switch to `true` in a preview deployment only.
6. Production only with Adam's approval. Afterwards, `curl -sI https://getbillwatchdog.com/go/<plan-id>` should show `302` and a `location` header. `HEAD` never counts. A 503 means the binding is missing. Without a terminal, open `https://getbillwatchdog.com/go/<plan-id>` in a browser instead: it should land on the provider's site, and it adds 1 to that plan's count for the day.

## Rollback

- Fastest: Pages dashboard, the project, **Deployments**, the previous production deployment, **Rollback**.
- Homepage only: set the switch back to `false` and redeploy.
- Full: restore the saved `_worker.js` and `_routes.json`, delete the module and the two asset files, redeploy, and rerun the comparison script.
- Leave the D1 database and its binding in place unless deleting them is separately approved. Without the code nothing uses them.

## Reference

Data path. The pages read `/v1/deals.json` and `/v1/price-history/{plan-id}.json`, the same files agents get, through `env.ASSETS`. There is no network request, so no self-subrequest back through the worker, and no dependency on the project's compatibility date. No price is written in the code; every figure comes from that feed at request time.

| Situation | What a visitor gets |
| --- | --- |
| `env.ASSETS` missing, or `/v1/deals.json` unreadable or invalid | 503 page: prices temporarily unavailable, nothing estimated |
| Price history file missing or invalid | Plan page renders, history marked unavailable |
| Unknown plan or comparison | 404 page |
| `/go/` without `BILLWATCH_CLICKS`, or a failed write | 503 text, no redirect |
| `/go/` for a plan without a plain, non-affiliate provider URL | 503 text, no redirect |
| Unexpected error on a human route | 500 text, no fall-through |

Load. Each human page view and each `/go/` click runs the worker once. On the Workers Free plan those requests share the daily allowance with `/mcp` and the counted routes. Rendering with the current 65-plan feed measured about 2 ms of CPU or less per page locally (Node 22, warm), well inside the Workers Free per-request CPU limit.

## Ready-to-paste prompt for the agent that edits the live site

```text
You are integrating the BillWatch human pages into the live Cloudflare Pages project for getbillwatchdog.com.
Instructions: human-site/RUNBOOK.md in github.com/Adamtbull/billwatchdog (branch claude/integrate-human-pages, or main once merged).

Do exactly this, in order, and nothing else:
0. Section 1 (the D1 database and its binding) is Adam's step. Skip it; preview /go/ links will answer 503 until it is done.
1. Run the checks in section 0 against the live build output folder. If any check fails, stop and report it.
2. Copy the three files listed in section 2, unchanged. Use case A, B or C from section 0.
3. Add the two code blocks from section 3 to _worker.js. Do not change any other line. Keep HUMAN_HOMEPAGE = false.
4. Append the nine entries from section 4 to the include list in _routes.json. Do not remove or reorder existing entries, do not touch exclude, do not add "/*".
5. Do not create or edit wrangler.toml or wrangler.json. Do not change any Cloudflare setting or binding.
6. Deploy to a preview only, never production. Then report: the preview URL, the output of
   node human-site/scripts/compare-existing-routes.mjs https://getbillwatchdog.com <preview URL>,
   and the HTTP status of /vpn/, /streaming/ and /affiliate-disclosure/ on the preview.
```
