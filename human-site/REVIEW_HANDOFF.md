# Review handoff

## Requested outcome

Build human-facing BillWatch pages using live source prices: homepage, VPN/streaming sortable tables, individual plans and history charts, NordVPN vs Surfshark and a streaming comparison, measurable `/go/{plan-id}` provider redirects without affiliate codes, affiliate disclosure, and Product/Offer JSON-LD. Use U.S. plain English, no emoji, no heavy framework, mobile-friendly layouts. Keep existing `/v1/*`, `/mcp`, `/llms.txt`, and `/agent.json` untouched. Deliver a draft pull request; do not deploy or merge.

## What changed

Everything is new under `human-site/`. Main runtime: `src/app.mjs` routes, `src/render.mjs` server-rendered HTML, `src/data.mjs` strict live-source adapters, `src/redirect.mjs` counted redirects, `public/` CSS and progressive sorting, `migrations/` aggregate storage schema. Node preview and build scripts have no package dependencies.

## Review first

1. Read README's architecture mismatch and integration warning. This repository is a data mirror, not the existing website's source. Do not deploy it as a replacement.
2. Run `npm test` and `npm run build` in `human-site/`.
3. Inspect human-readable terms beside every monthly-equivalent price. No total bill has been inferred from an equivalent.
4. Check verification freshness and empty/error cases; make sure “lowest” means eligible listings, not the entire market.
5. Confirm no unsafe or affiliate URL can pass through `/go/`, and no redirect claims measurement without storage.
6. Repeat live checks in the integration environment. Independent review confirmed the live NordVPN history envelope and HTTP 200 rendering of all price-page types; actual deployed route integration remains untested.
7. Review mobile screenshots and browser checks if supplied in the PR's review summary.

## Remaining owner-controlled actions

Locate/integrate actual Pages source; authorize and configure D1; inspect existing Pages routes and deployment settings; approve any preview/production deployment separately. Do not deploy, merge, create paid relationships, change access, or contact external agents without Adam's approval.

The integration procedure for those steps (worker wiring, `env.ASSETS` data path, `_routes.json` entries, D1 setup, homepage switch, verification and rollback) is in `RUNBOOK.md`.
