# Meme Leaders

`06 Meme Leaders` is available at `/meme-leaders`; API: `/api/v1/meme-leaders`.

## Meaning of hot

Default order follows GeckoTerminal's Robinhood trending-pool order, deduplicated by base-token contract address. It is **not** an internally invented score, a whole-chain token ranking, guaranteed growth or a trading recommendation. Price-change, reported volume and liquidity sorts are alternate views of the same bounded sample.

The default view is All candidates. The Source-tagged filter restricts results to provider meme-related categories. Candidate badges remain explicit because non-stock/actively traded does not imply meme. Source tagging is not a security audit, official endorsement or project authenticity verification.

## Sources and coverage

- GeckoTerminal public API: first page of Robinhood trending pools, with base/quote token and DEX relationships.
- Robinhood canonical registry: exclude registered chain4663 stock base-token addresses.
- Known native ETH, WETH and USDG contract addresses are also excluded. This is not a comprehensive stablecoin/wrapper classification system.
- First page only, up to20 pools. Duplicate base-token contracts use their first source-ranked pool. Quote-only tokens, later pages and unobserved pools are not enumerated.
- Up to12 token-info lookups provide categories and holder observations. Category mapping uses explicit meme, Inu, dog/cat/frog-themed or PolitiFi source labels, never ticker/name matching.
- Unknown metadata remains unknown. Metadata failures must not fabricate tags, holders or zero amounts.

## Metric boundaries

Prices, changes, volume, buys/sells, liquidity and valuation are provider-reported. Pool activity and liquidity refer to one representative observed pool, not all markets for the token. Do not add the rows into chain-wide totals. Volume is not transfer count; liquidity is not executable depth.

Market cap and FDV are distinct; unavailable market cap stays unavailable. Null is not zero. Holder counts retain provider holder-update timestamps. Feed retrieval time does not establish the upstream observation time.

## Operation

No wallet connection, trade, signature, new paid API, database migration, cron or existing collector change. Fixed upstream hosts, validated addresses/pool IDs, bounded responses, 24-second deadline, no retries, category requests in batches of three, stop remaining metadata batches after429. Partial metadata still permits an explicitly labelled candidate feed.

Per-instance three-minute successful-feed cache and request coalescing reduce calls. Failed feed reads enter30-second cooldown. This is not a distributed global rate limiter. The UI expires the ranked feed after5minutes and offers manual refresh, without background polling.

Only validated HTTPS image hosts (assets.geckoterminal.com and coin-images.coingecko.com) may be rendered. Explorer links use known hosts, not arbitrary project URLs. Safety/ownership/honeypot status is not inferred from listing or category tags.

## Delivery

Implemented as a continuation of the user's fast feature delivery request. GitHub main -> Git-connected Vercel production deployment. No broad QA suite or browser QA. The source adapter was exercised against real public sources before deployment; partial metadata was observed and preserved rather than invented. Production build and canonical deployment completion are separately verified. Revert only the feature commit after approval to roll back; no data recovery or migration is needed.
