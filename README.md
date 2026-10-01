# BillWatch

BillWatch publishes US advertised base prices for streaming and VPN plans in machine-readable form, so AI agents can compare a person's current plans against listed alternatives and watch for price changes. The person's agent holds the person's bills; BillWatch never receives bills, transactions or account details.

- Website: https://getbillwatchdog.com
- Interactive demo: https://getbillwatchdog.com/demo
- API docs: https://getbillwatchdog.com/api
- Privacy: https://getbillwatchdog.com/privacy
- Disclosure: https://getbillwatchdog.com/disclosure

## Use the data

### MCP server (remote)

Endpoint: `https://getbillwatchdog.com/mcp` (streamable HTTP, stateless, no sign-up or key)

Tools:

- `search_deals` — download current deals and filter by category, provider or plan. Unverified or discontinued plans are excluded unless `include_unverified` is set.
- `get_price_history` — pricing changes over time for one plan.

### JSON API

- `GET https://getbillwatchdog.com/v1/deals.json` — all plans
- `GET https://getbillwatchdog.com/v1/deals/streaming.json` and `/v1/deals/vpn.json` — one category
- `GET https://getbillwatchdog.com/v1/price-history/{plan-id}.json` — pricing changes over time for a plan
- Manifest: `https://getbillwatchdog.com/.well-known/agent.json`
- Machine-readable index: `https://getbillwatchdog.com/llms.txt`

The `v1/` folder in this repository mirrors the current data snapshot. The live site is the source of truth.

## Reading the data

Each record carries a stable `id`, provider, plan, listed monthly-equivalent USD price, billing terms, promo (the provider's own wording), `url` (the provider's sign-up page), `source_url` (the page the price was confirmed on), an `affiliate` flag, the `checked_at` date and a `verified` flag.

`verified: true` means the price was confirmed on the provider's official page within its freshness window; `false` means it is stale, discontinued or not yet confirmed there. Prices are listed prices, before taxes and extra fees; what a person pays can differ. Plans are listed by listed price. BillWatch makes no recommendations, and payment never affects which plans appear or their order.

## Pilot notice

Free to use. These are direct provider links. BillWatch receives no affiliate commission from them. Every record has `affiliate: false`.

## Ground rules for agents

- Never present a switch without the human's explicit approval. Present the option, the difference in listed price, and the workings.
- BillWatch never pays bills, moves money, cancels subscriptions, or contacts providers.
- Nothing here is financial advice. Surface facts; let the human decide.

Operated by Adam Bull, a sole trader in New South Wales, Australia. Contact: hello@getbillwatchdog.com
