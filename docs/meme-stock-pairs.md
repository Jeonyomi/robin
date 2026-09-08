# Meme / Stock Pairs

## Product flow

`/liquidity` keeps the existing WETH-fee LP Leaders separate from Meme / Stock Pairs:

1. Discover candidate stock/non-stock pools.
2. Inspect provider-reported activity and then request a read-only onchain pool observation.
3. Request a bounded related-position sample or inspect a public NFT ID against that exact pool.

This is research, not a recommendation or whole-chain ranking. Stock address identity does not verify legal rights, backing, project authenticity or contract safety. A non-stock token is not automatically a verified meme project.

## Discovery

- Fixed sources: Robinhood `https://api.robinhood.com/rhj/assets` and public DEX Screener API.
- Stock basket: NVDA, HIMS, MU, MSTR, TSLA. Match Robinhood Chain (4663) deployment **addresses**, not tickers.
- Additional narrative searches: AI NVDA, BONER HIMS, MOO MU, SAYLORMOON MSTR. These are search hints only; every result must independently match a canonical stock address.
- Exactly one stock side is required. Known native ETH, WETH and USDG addresses are excluded from the other side. All remaining tokens retain `candidate` classification.
- At most 60 deduplicated provider-limited pools. Provider-reported liquidity ordering is not popularity, safety or yield ranking.
- Missing numeric fields remain null, never zero. Reported liquidity is not executable depth. Reported volume is not reconstructed from transfer counts.
- Retrieved-at timestamps do not establish the provider's observation freshness. No block number is fabricated for offchain provider metrics.
- Three concurrent provider requests maximum, fixed bounded basket, 22-second total deadline, no retries, three-minute per-instance cache, cooldown on failure. No new paid API or recurring collector.

## Onchain inspection

- Only pools in the current discovery list may be inspected. Protocol identifiers distinguish a v3 pool address from a v4 bytes32 pool ID.
- Official Uniswap v3/v4 deployment mappings, token pair linkage, chain and source-block identity are checked independently of the discovery provider.
- Unsupported protocols remain discoverable but return an explicit unsupported state for the inspector.
- Pool observations and position records retain block-derived timestamps; stale records are not represented as fresh.
- Position records are not proof of the user's ownership. Pool mismatch must not produce a related-position result.
- Native liquidity units are not TVL. Current principal estimates and range state are not profit. Fees, APR/APY, IL and net PnL remain withheld without verified accounting history.
- Bounded related-position discovery does not enumerate every LP. Empty samples do not establish that a pool has no LP positions.

## API

- `GET /api/v1/meme-stock-pairs`: bounded discovery.
- `GET /api/v1/meme-stock-pairs?pool=<id>`: verified pool observation.
- `GET /api/v1/meme-stock-pairs?pool=<id>&positions=1`: bounded related-position discovery.
- `GET /api/v1/meme-stock-pairs?pool=<id>&tokenId=<decimal-id>`: exact-pool NFT inspection.
- `positions` and `tokenId` are mutually exclusive. Unknown or duplicate parameters, malformed IDs, leading-zero token IDs, and out-of-range uint256 are rejected before RPC work.
- No user-provided RPC URL, transaction submission, wallet signing, approvals, or token transfers.
- RPC admission is bounded per server instance, with one active request, cooldown, a recent-start limit, and short bounded result cache. This is not a distributed global rate limiter; traffic growth requires an independently approved shared limiter or persisted collector.

## Delivery and recovery

User requested code update and production deployment through `Jeonyomi/robin` main, explicitly excluding QA. No test suite, lint, browser QA or exploratory QA is included. The Git-connected production build is still required to compile the deployment. Verify remote commit, Ready state and canonical alias before reporting deployment complete.

No existing LP collector, WSL process/scheduler, database schema, Buffer queue or billing plan is changed by this feature. Recover by reverting only this feature commit through normal Git workflow after approval; avoid reverting prior image-hosting or social-link commits. No destructive migration or data rewrite is required.
