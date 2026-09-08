# Robinwatch · Robinhood Chain Onchain Observatory

Robinwatch collects free, publicly available Robinhood Chain data, stores the raw observations, and turns them into source-labeled descriptive analysis.

**Web app:** https://robinwatch24.vercel.app/

**Repository:** https://github.com/Jeonyomi/robin · **X:** https://x.com/robinwatch24

> Independent public-source research project. Not affiliated with or endorsed by Robinhood Markets, Inc. The product does not provide investment advice, trade execution, or predictive signals.

## Product question

**What is changing on Robinhood Chain, where is observable activity concentrated, and what raw evidence supports that view?**

Robinwatch answers this in three layers:

1. **Chain state**: public Blockscout network statistics.
2. **Tracked assets**: Robinhood's canonical asset registry matched by contract address.
3. **Observed activity**: page-bounded token transfer events, unique addresses, and mint/burn events.

Separate liquidity and token-discovery views add provider-reported market observations and bounded onchain LP evidence. They are not derived from transfer counts or merged into chain-wide totals.

The dashboard keeps chain-wide statistics separate from the rotating tracked-token sample. Missing data remains unavailable rather than being replaced with synthetic values.

## Current free sources

| Source | Data used | Scope |
|---|---|---|
| Robinhood Assets API | Canonical asset IDs, symbols, contracts, multipliers, status | Public registry |
| Robinhood Price API | Reference bid/ask observations | Canonical assets where available |
| Robinhood Chain Blockscout direct API | Chain stats, token metadata/counters, token transfers | Free public endpoint |
| Robinhood Chain RPC | Anchored Uniswap v3 NFT state, fee logs and mint receipts | Bounded, separately collected LP sample |
| Robinhood Chain RPC | Verified Uniswap v3/v4 pool state and related NFT inspection | Bounded, on-demand Meme / Stock Pairs reads |
| DEX Screener public API | Candidate stock/non-stock pools and reported market metrics | Fixed stock basket; provider-limited discovery |
| GeckoTerminal public API | Trending pools, token categories and holder observations | First-page sample; bounded metadata lookups |

Default Blockscout base URL:

```text
https://robinhoodchain.blockscout.com/api/v2
```

The multi-chain `api.blockscout.com` endpoint is not the default because anonymous requests can require an API key or payment.

## What the dashboard shows

### Overview

- Provider-reported total transactions, addresses, indexed block count, and average block time; block count is not chain-head height
- Blockscout slow, standard, and fast suggested gas prices in Gwei per gas unit, with independent freshness, no additional API request, and an explicit total-fee caveat
- Stored transfer events in the selected window
- Unique addresses, including contracts, and active tracked tokens
- Current transfer-index rotation coverage and freshness
- Independent chain, gas, transfer observation and index timestamps; explicit unknown, stale and future states
- Current rotation progress separated from prior completed rotations; age labels update without refetching
- Chain observed means the last accepted stats fetch; provider counters can still lag the chain
- Manual Refresh preserves the selected window; visible tab returns re-fetch after at least one minute since the last request settled, with no polling
- Screen receipt time is separate from source observation time; same-window refresh failures retain prior evidence with an explicit warning
- LP Leaders, Meme / Stock Pairs, and Meme Leaders capability summaries include coverage limits and direct workspace links; no extra LP/Meme API reads on Overview
- Hourly transfer and address participation trend
- Explicit withholding of cross-token rankings until observation exposure is comparable
- Latest raw transfer observations

### Asset Registry

- Exact contract match against Robinhood's canonical registry
- Blockscout holder observations and holder change when available
- Metadata freshness and data completeness
- Latest stored metrics per token for the selected window; missing metrics remain unavailable
- Direct contract links

### Transfer Activity

- Transfer, mint, and burn event counts
- Recent transaction evidence
- Explicit lower-bound and coverage caveats

### Activity Lens

Activity Lens withholds comparative rankings until equivalent observation exposure is explicitly verified. The page-bounded collector does not establish complete window coverage, and a completed rotation or historical transfer presence is not enough. P0 also checks source health and fails closed for older snapshots without exposure evidence. Raw activity remains available as bounded observations; the stored-token count uses the same canonical population and selected window, not a completeness percentage.

The ranking remains explicitly page-bounded and may be a lower bound for busy tokens. It is not exhaustive, is not comparable across different windows, and is never presented as a price forecast, trade signal, or investment recommendation.

## LP Leaders

The **LP Leaders** tab at `/liquidity#lp-leaders` displays a bounded sample of existing Uniswap v3 NFTs on Robinhood Chain and ranks supported pairs by **lifetime recorded WETH fees**. `/liquidity` opens **Meme / Stock Pairs** by default; only the selected tab mounts and starts its data reads.

- Up to 12 stratified enumerable NFT indices, with total/sample/eligible/excluded/unsupported counts
- WETH fee ranking, current spot-valued LP inventory, range-state filters and expandable NFT details
- Native fee amounts, price bounds, range structure, mint date, liquidity-change and collection counts, source contract links
- Full returned fee-event history reconciled against live liquidity; withdrawn principal excluded from fee amounts
- Mint receipt verification, same-block pool/fee-growth reads, contract provenance and freshness gates
- Public page requests need no wallet, signature or token-ID entry and trigger no trade, database write, RPC collection or Telegram alert

**Ranking boundary:** WETH fees are the WETH token leg only; other token fees remain separate. Illiquid pool-price conversion cannot inflate the fee rank. The illustrative all-token fee estimate and current inventory use pool spot prices and are not executable or USD values. NPM recorded fee entitlement can differ slightly from received cash due to raw-unit rounding; lifetime fees include previous owners and favor older/larger NFTs. This is not net PnL, APR/APY, a 24-hour return or a whole-chain top list. Burned and unsampled NFTs are absent.

The independent LP collector publishes verified observations to a dedicated Neon snapshot row about every two minutes. The public page and `GET /api/v1/lp-leaders` read only that stored snapshot; refreshing the page does not consume RPC quota. Source observations older than five minutes are withheld. The latest collection attempt is reported separately: a failed attempt does not refresh the last successful observation or prevent it being read while still inside the hard freshness limit.

The public RPC is rate-limited and not recommended by its operator for production-scale use. Collector reads are paced, bounded, deduplicated and fail closed; only bytecode-verified Multicall view calls are grouped. Rate-limit cooldowns persist between collection runs. Missing or expired observations are not replaced with invented rows. Freshness depends on the separate collector host remaining available, not on Vercel alone. Legacy browser-local scenarios remain untouched and are never uploaded or treated as chain data.

See [LP Leaders methodology and source limits](docs/lp-workspace.md). The older read-only `/api/v1/lp-position` endpoint remains available for compatibility but is no longer the page's user flow. It now has short fresh-result caching, identical-request coalescing and process-local admission/cooldown shared with Meme/Stock inspection; these are not cross-instance provider quotas.

## Meme / Stock Pairs

The default `/liquidity` tab follows **discover a pair → inspect its actual pool state → inspect related LP positions**.

- Address-matched Robinhood stock basket: NVDA, HIMS, MU, MSTR and TSLA; up to 60 deduplicated provider-limited pools
- Provider-reported liquidity, volume and price information kept separate from block-anchored onchain observations
- Verified Uniswap v3/v4 pool inspection; unsupported protocols remain explicitly unsupported
- Bounded related-position sampling or manual public NFT-ID inspection against the exact selected pool
- No wallet connection, signing, approvals, trades or token transfers

Unlike the storage-only LP Leaders tab, explicit pool/position inspection can perform bounded RPC reads. A non-stock token is a **candidate**, not a verified meme project. An empty LP sample does not prove that a pool has no positions. Fee returns, APR/APY, impermanent loss and net PnL are withheld without verified accounting history.

See [Meme / Stock Pairs methodology and API](docs/meme-stock-pairs.md).

## Meme Leaders

`06 Meme Leaders` at `/meme-leaders` opens **All candidates** by default. The optional **Source-tagged** filter shows provider meme-related categories, not internally inferred ticker/name classifications.

- GeckoTerminal's first trending-pool page, bounded to 20 pools and deduplicated by base-token address
- Canonical Robinhood stock base tokens and known ETH/WETH/USDG addresses excluded
- Provider order by default; price change, reported volume and liquidity offer alternate views of the same sample
- Up to 12 token-info lookups; missing categories, holders and numeric observations stay unknown
- Per-instance caching and request coalescing; no background polling, manual refresh, and ranked-feed expiry after five minutes

This is neither a whole-chain ranking nor a security or authenticity check. Metrics refer to a representative observed pool, not all markets for each token. Retrieval time is not the provider's observation timestamp.

See [Meme Leaders sources and limits](docs/meme-leaders.md).

## Collection design

The 10-minute sync uses a bounded rotating collector:

- 24 canonical tokens per run by default
- Up to 6 recently active tokens added for more frequent observation
- Up to 2 Blockscout pages per token
- 50 transfers per page
- 48-hour lookback cutoff
- Concurrency limited to 4 workers
- Deduplication by transaction hash + log index + token address

Rotation duration depends on the current registry size and successful collector runs; it is not a fixed completeness guarantee. Page limits mean transfer totals can be lower bounds for very active tokens. The UI reports current rotation progress separately from past completed rotations.

The public observation windows are `1h`, `6h`, and `24h`. Longer comparative windows remain disabled until sufficient equivalent history is available.

P0 adds shared source request deadlines, local request budgets, bounded transient retries, and persisted collector cooldowns. These contain errors; they do not remove upstream blocking or establish production RPC capacity. See [P0 source reliability and rollout](docs/source-reliability-p0.md).

Configurable limits:

```bash
TRANSFER_SYNC_BATCH_SIZE=24
TRANSFER_SYNC_HOT_TOKENS=6
TRANSFER_SYNC_MAX_PAGES=2
TRANSFER_SYNC_LOOKBACK_HOURS=48
METADATA_SYNC_BATCH_SIZE=50
```

The 10-minute Windows scheduler runs independent attempts for bounded token transfers, chain/gas stats, then v3 snapshot publication. Transfer failure no longer prevents stats or publication; source failures retain last-good observations and original timestamps. Any failed stage leaves the pulse exit nonzero, even after successful publication. Full canonical, metadata, price, and metrics maintenance remains available through `pnpm sync` and should be scheduled separately from the latency-sensitive activity pulse.

## Sync pipeline

```text
Robinhood canonical registry
  → Blockscout chain stats
  → rotating token metadata
  → Robinhood reference prices
  → real Blockscout token transfers
  → holder-delta metrics
  → Neon Postgres
  → optional Vercel Blob fallback snapshot
```

Heuristic signal generation is not part of the default pipeline. Synthetic economic actions remain fail-closed and require explicit `ALLOW_SYNTHETIC_ACTIONS=true` opt-in for development-only runs.

Legacy token-scoring routes are retired. The v3 Blob fallback excludes token details and scanner scores, is rejected after three hours, and uses a short cache lifetime.

## Architecture

```text
Next.js dashboard and API routes
                ↓
      shared query layer
                ↓
         Neon Postgres
                ↑
 bounded local/scheduled indexer
       ↙                  ↘
Robinhood APIs     Blockscout direct API
```

- Next.js 16 / React 19 / Tailwind CSS / ECharts
- Neon Postgres / Drizzle ORM
- Vercel deployment
- Optional Vercel Blob read fallback
- Bounded provider discovery and on-demand RPC inspection for Meme / Stock Pairs; GeckoTerminal-backed Meme Leaders
- Privacy-filtered Vercel Web Analytics for production page views
- Windows Task Scheduler for 10-minute collection with overlapping runs blocked
- Separate two-minute LP collector, dedicated Neon snapshot storage, and storage-only public LP reads

## Local setup

Use Node.js compatible with the installed Next.js version and the pinned `pnpm@11.25.0`. For a UI-only start:

```bash
pnpm install
pnpm dev
```

Data-backed development requires an approved development database and environment configuration. Missing sources are not replaced with demo data. Keep credentials outside Git; do not pull production credentials into an unapproved environment.

For an explicitly selected development database only, initialize and populate it separately:

```bash
pnpm db:migrate
pnpm sync
```

These commands write to the configured database and contact external sources. They are not required documentation checks and must not be run against production as a setup shortcut.

Targeted jobs:

```bash
pnpm sync:canonical
pnpm sync:stats
pnpm sync:metadata
pnpm sync:prices
pnpm sync:transfers
pnpm sync:metrics
```

Database URLs:

```bash
DATABASE_URL="postgresql://...-pooler.../robin?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://.../robin?sslmode=require"
```

## Data integrity rules

- Raw source identifiers are retained before aggregation.
- Missing observations stay `null`; they are not converted to zero.
- Synthetic activity is excluded from the operating path.
- Collection status, source, scope, and freshness are visible in the UI.
- Partial source failures are recorded as degraded state; `/api/v1/source-health` reports the same overall status in its data and metadata, including LP freshness and the latest collection attempt.
- Activity snapshot publication requires the transfer job to succeed; a stats failure can retain prior stats with their original timestamps. LP publication requires a verified, non-regressing observation; failures update attempt metadata, not the accepted observation.
- Activity is not labeled as demand, volume, profit, or investment opportunity.
- A snapshot must contain the exact requested `1h`, `6h` or `24h` window. When an available snapshot lacks that entry, the four observation APIs return HTTP 503 with `data: null` and degraded metadata, rather than relabeling 24h data.
- Window/filter changes cancel obsolete requests and reject stale completions, including A → B → A selection changes; old-condition data is hidden while new-condition data loads.

## Performance improvements

- Overview and Transfer Activity skip an unused ranking query while Activity Lens keeps its ranking behavior.
- Stock Token metrics use PostgreSQL `DISTINCT ON` with a narrow projection and deterministic ordering instead of transferring all metric history for JavaScript deduplication.
- Snapshot fallback coalesces concurrent requests per instance, checks source age, bounds upstream fetches to eight seconds and applies a 30-second failure cooldown.
- Meme Leaders reuses numeric formatters across renders; freshness clocks do not trigger extra network requests.

These changes reduce redundant work and protect displayed observation identity. They do **not** establish a production latency improvement percentage, a database query plan, or repaired upstream collection. See the [follow-up implementation and verification](docs/performance-followup-20260908.md); the [initial audit](docs/performance-review-20260908.md) records the earlier, pre-deployment state.

## Web Analytics and privacy

Vercel Web Analytics is integrated once in the root layout with pinned `@vercel/analytics@2.0.1`, production-only collection and debug logging disabled.

- Page views are limited to the canonical HTTPS site and an explicit public-route allowlist.
- Queries and fragments are removed from analytics page URLs; valid token-detail addresses become `/tokens/[address]`.
- Preview origins, unsupported/private/API paths and custom events are dropped.
- Do Not Track, Global Privacy Control and the `va-disable` local opt-out are respected; inaccessible opt-out storage fails closed.
- No wallet identity or custom event payload is supplied. Referrer/device statistics and hosting/RPC logs are separate from sanitized page URLs.

The existing Hobby setup was retained without a paid upgrade. SDK deployment/loading and privacy tests are separate from actual visitor-event acceptance and dashboard aggregation; the latter have not been confirmed. Automated visits can be excluded by Vercel and are not evidence of organic traffic.

See [Web Analytics configuration, cost boundary and verification](docs/web-analytics.md) and the site's [legal/privacy page](https://robinwatch24.vercel.app/legal).

## Known limitations

- The transfer index is a rotating, page-bounded sample, not a full archival chain index.
- Current transfer rows do not decode DEX swaps, bridge routes, or protocol intent.
- Token amounts do not imply USD value.
- Holder observations are point-in-time API snapshots.
- Wallet ownership, PnL, and "smart money" labels are not asserted.
- The dashboard is batch-updated rather than realtime.
- The free Blockscout instance can rate-limit or temporarily fail.
- DEX discovery and token metadata may be partial or rate-limited; provider categories do not establish safety or official endorsement.
- The LP collector can also encounter RPC rate limits. Web deployment does not repair external API availability or keep a stopped collector running.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

If Vitest's default worker pool times out before running assertions in the Windows/WSL environment, use `pnpm test --pool=threads`.

`pnpm db:check` is a separate database-connected check; run it only with the intended environment. Browser smoke tests are separate from unit/static checks and are not implied by a successful build. Documentation-only changes need link, command and diff checks, not a database job or full product QA run.

Latest implementation verification (8 September 2026): 475 unit tests across 26 files passed. The initial Analytics test-file lint error was corrected; the subsequent focused tests, scoped lint, type checking and production build passed. This is a dated verification record, not a claim that checks rerun automatically whenever this README changes.

## Delivery

Production code is delivered through GitHub `Jeonyomi/robin` on `main` and its Git-connected Vercel deployment. A local build or standalone CLI deployment is not evidence that GitHub is updated. Confirm the remote commit, Vercel Ready state and canonical domain before declaring a release complete. Web deployment does not start, repair or reconfigure the independent collectors.

## Documentation

- [Architecture](docs/architecture.md)
- [Metrics](docs/metrics.md)
- [Signals](docs/signals.md)
- [Deployment](docs/deployment.md)
- [LP Leaders methodology](docs/lp-workspace.md)
- [Meme / Stock Pairs](docs/meme-stock-pairs.md)
- [Meme Leaders](docs/meme-leaders.md)
- [Performance follow-up](docs/performance-followup-20260908.md)
- [Initial performance audit — historical baseline](docs/performance-review-20260908.md)
- [Web Analytics and privacy](docs/web-analytics.md)
- [Chain statistics collection repair](docs/chain-stats-recovery.md)
