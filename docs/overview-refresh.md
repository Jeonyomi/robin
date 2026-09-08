# Overview refresh and research entry points

## Refresh contract

- Overview offers a manual Refresh control without resetting the selected 1h, 6h or 24h window.
- Only Overview opts into return-event refresh: a visible `focus` or `visibilitychange` event can re-fetch after 60 seconds since the previous request settled. There is no polling interval. In-flight requests are coalesced; failed requests receive the same automatic-return cooldown. Manual retry is available after settlement.
- Same-window refresh keeps previous observations visible. Failure shows an explicit warning and preserves the last successful screen receipt and all source timestamps. First-load failure offers retry without fabricating a receipt timestamp.
- Changing observation window clears old-window data immediately. Cancellation and request ownership protect against stale completions, including A → B → A and unmount.
- Screen received is a successful API response receipt time, **not** a newly collected source observation. Normal upstream, snapshot and CDN caching still apply. Refresh does not run a collector, force an upstream crawl or guarantee fresher data.
- The shared hook remains opt-in: other existing consumers do not acquire automatic-return requests.

## Research content

Overview has three editorial capability summaries rather than an extra live market feed:

- Meme / Stock Pairs → `/liquidity#stock-pairs`: discovery, verified v3/v4 pool evidence, related LP analysis. Related-position discovery is bounded to up to 8 sampled NFTs; absence from the sample is not proof of no LPs.
- LP Leaders → `/liquidity#lp-leaders`: supported LP positions ranked by recorded WETH fee entitlement. A bounded observation set, not whole-chain ranking or realized profit.
- Meme Leaders → `/meme-leaders`: provider trending candidates from the first page of up to 20 pools, deduplicated by base-token contract. Category labels are not safety or authenticity verification.

The suggested research sequence is pair discovery → pool evidence → LP position review. New links disable prefetch. Cards remain available when the Overview observation endpoint fails. They do not mount detail workspaces or call LP/Meme APIs, and are not relabeled by the Overview time-window selector.

## Scope

No changes to detail-page behavior, collector/runtime files, schedules, database, provider quotas, dependencies, billing or Analytics. Delivery follows the existing GitHub main → Git-connected Vercel path when authorized.

Focused regression files: `observation-refresh.test.ts`, `overview-refresh-ui.test.ts`, `overview-research.test.ts`, and existing `observation-request.test.ts` / `observation-status.test.ts`.
