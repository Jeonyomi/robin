# Robin · Robinhood Chain Onchain Observatory

Robin collects free, publicly available Robinhood Chain data, stores the raw observations, and turns them into source-labeled descriptive analysis.

> Independent public-source research project. Not affiliated with or endorsed by Robinhood Markets, Inc. The product does not provide investment advice, trade execution, or predictive signals.

## Product question

**What is changing on Robinhood Chain, where is observable activity concentrated, and what raw evidence supports that view?**

Robin answers this in three layers:

1. **Chain state**: public Blockscout network statistics.
2. **Tracked assets**: Robinhood's canonical asset registry matched by contract address.
3. **Observed activity**: page-bounded token transfer events, unique addresses, and mint/burn events.

The dashboard keeps chain-wide statistics separate from the rotating tracked-token sample. Missing data remains unavailable rather than being replaced with synthetic values.

## Current free sources

| Source | Data used | Scope |
|---|---|---|
| Robinhood Assets API | Canonical asset IDs, symbols, contracts, multipliers, status | Public registry |
| Robinhood Price API | Reference bid/ask observations | Canonical assets where available |
| Robinhood Chain Blockscout direct API | Chain stats, token metadata/counters, token transfers | Free public endpoint |
| Robinhood Chain RPC | Configured for future log-level validation | Not yet the primary indexer |

Default Blockscout base URL:

```text
https://robinhoodchain.blockscout.com/api/v2
```

The multi-chain `api.blockscout.com` endpoint is not the default because anonymous requests can require an API key or payment.

## What the dashboard shows

### Overview

- Chain-wide total transactions, addresses, block height, and block time
- Blockscout slow, standard, and fast suggested gas prices in Gwei per gas unit, with independent freshness, no additional API request, and an explicit total-fee caveat
- Stored transfer events in the selected window
- Unique addresses, including contracts, and active tracked tokens
- Current transfer-index rotation coverage and freshness
- Hourly transfer and address participation trend
- Explicit withholding of cross-token rankings until observation exposure is comparable
- Latest raw transfer observations

### Asset Registry

- Exact contract match against Robinhood's canonical registry
- Blockscout holder observations and holder change when available
- Metadata freshness and data completeness
- Direct contract links

### Transfer Activity

- Transfer, mint, and burn event counts
- Recent transaction evidence
- Explicit lower-bound and coverage caveats

### Activity Lens

Activity Lens publishes a limited descriptive ranking after an operational gate confirms a completed registry rotation, an index updated within two hours, at least 95% stored-transfer coverage, and observations in the selected window. The index combines 60% relative observed transfer events with 40% relative observed unique addresses; window-over-window change is shown separately.

The ranking remains explicitly page-bounded and may be a lower bound for busy tokens. It is not exhaustive, is not comparable across different windows, and is never presented as a price forecast, trade signal, or investment recommendation.

## LP Leaders

`/liquidity` now opens an **automatic LP NFT discovery page**, not a personal token-ID form or manual scenario editor. It displays a bounded sample of existing Uniswap v3 NFTs on Robinhood Chain and ranks supported pairs by **lifetime recorded WETH fees**.

- Up to 12 stratified enumerable NFT indices, with total/sample/eligible/excluded/unsupported counts
- WETH fee ranking, current spot-valued LP inventory, range-state filters and expandable NFT details
- Native fee amounts, price bounds, range structure, mint date, liquidity-change and collection counts, source contract links
- Full returned fee-event history reconciled against live liquidity; withdrawn principal excluded from fee amounts
- Mint receipt verification, same-block pool/fee-growth reads, contract provenance and freshness gates
- No wallet, signature, token-ID entry, trade, database write, collector change or Telegram alert

**Ranking boundary:** WETH fees are the WETH token leg only; other token fees remain separate. Illiquid pool-price conversion cannot inflate the fee rank. The illustrative all-token fee estimate and current inventory use pool spot prices and are not executable or USD values. NPM recorded fee entitlement can differ slightly from received cash due to raw-unit rounding; lifetime fees include previous owners and favor older/larger NFTs. This is not net PnL, APR/APY, a 24-hour return or a whole-chain top list. Burned and unsampled NFTs are absent.

The public RPC is rate-limited and not recommended by its operator for production-scale use. Reads are paced, bounded, deduplicated and fail closed; only bytecode-verified Multicall view calls are grouped. Stale/failed data is not replaced with invented rows. Legacy browser-local scenarios remain untouched and are never uploaded or treated as chain data.

See [LP Leaders methodology and source limits](docs/lp-workspace.md). The older read-only `/api/v1/lp-position` endpoint remains available for compatibility but is no longer the page's user flow.

## Collection design

The 10-minute sync uses a bounded rotating collector:

- 24 canonical tokens per run by default
- Up to 6 recently active tokens added for more frequent observation
- Up to 2 Blockscout pages per token
- 50 transfers per page
- 48-hour lookback cutoff
- Concurrency limited to 4 workers
- Deduplication by transaction hash + log index + token address

At default settings, the 194-token registry receives an initial full rotation over approximately nine successful runs, about 90 minutes when every run completes within its interval. Page limits mean transfer totals can be lower bounds for very active tokens. The UI states this explicitly.

The public observation windows are `1h`, `6h`, and `24h`. Longer comparative windows remain disabled until sufficient equivalent history is available.

Configurable limits:

```bash
TRANSFER_SYNC_BATCH_SIZE=24
TRANSFER_SYNC_HOT_TOKENS=6
TRANSFER_SYNC_MAX_PAGES=2
TRANSFER_SYNC_LOOKBACK_HOURS=48
METADATA_SYNC_BATCH_SIZE=50
```

The 10-minute Windows scheduler runs an activity-first pulse: bounded token transfers, chain/gas stats, then a v3 snapshot publish. A stats refresh failure does not discard a successful transfer refresh; the snapshot retains the last stored stats. Full canonical, metadata, price, and metrics maintenance remains available through `pnpm sync` and should be scheduled separately from the latency-sensitive activity pulse.

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
- Windows Task Scheduler for 10-minute collection with overlapping runs blocked

## Local setup

```bash
pnpm install
vercel env pull .env
pnpm db:migrate
pnpm sync
pnpm dev
```

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
- Partial source failures are recorded as degraded state.
- Snapshot publication is blocked when a required sync job fails.
- Activity is not labeled as demand, volume, profit, or investment opportunity.

## Known limitations

- The transfer index is a rotating, page-bounded sample, not a full archival chain index.
- Current transfer rows do not decode DEX swaps, bridge routes, or protocol intent.
- Token amounts do not imply USD value.
- Holder observations are point-in-time API snapshots.
- Wallet ownership, PnL, and "smart money" labels are not asserted.
- The dashboard is batch-updated rather than realtime.
- The free Blockscout instance can rate-limit or temporarily fail.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:check
```

UI E2E is intentionally kept to a single final core smoke run after static checks.

## Documentation

- [Architecture](docs/architecture.md)
- [Metrics](docs/metrics.md)
- [Signals](docs/signals.md)
- [Deployment](docs/deployment.md)
