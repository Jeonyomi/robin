# 🦉 Robin — Robinhood Chain Opportunity Intelligence

Onchain investment intelligence terminal for Robinhood Chain (Chain ID `4663`).

> **"Where is money flowing on Robinhood Chain, and is that movement a real investment opportunity — risk-adjusted?"**

This is a **research/data intelligence tool**, not an investment advisory service. All UI language uses `Signal`, `Evidence`, `Risk`, and `Invalidation` framing.

## 🎯 What This Does

Robinhood Chain launched July 1, 2026 as an Ethereum L2 (Arbitrum Orbit) featuring:
- **202 Stock Tokens** (NVDA, GME, AAPL, etc.) trading 24/7
- **$1.595B daily DEX volume** (Uniswap 96%)
- **$738M DeFi TVL** (Morpho, Ethena, Maple)
- **$85.1M daily Stock Token volume**
- **ERC-4337 Account Abstraction** support

This dashboard answers:

1. **Where is capital flowing?** — Bridge inflow, stablecoin movement, DEX volume
2. **Is it real demand?** — Distinguish bots/airdrops from genuine adoption
3. **Is there executable liquidity?** — Actual depth, not just displayed market cap
4. **Are smart wallets accumulating?** — Whale/smart-money cohort tracking
5. **Is this the canonical Stock Token?** — Verify against Robinhood's official registry
6. **Is there a tradeable price divergence?** — DEX vs reference price with depth check
7. **What are the risks?** — Contract, liquidity, concentration, identity scoring

## 🏗️ Architecture

```
Frontend (Next.js 16) → API Routes → Domain Logic → Neon Postgres
                                                ↓
                              Source Adapters → External APIs
                              (Robinhood, Blockscout)
```

- **Frontend**: Next.js App Router, React 19, Tailwind CSS, ECharts
- **API**: Next.js Route Handlers (BFF pattern)
- **Domain**: Canonical identity resolver, risk engine, opportunity scorer, signal generator
- **Storage**: Neon Postgres with Drizzle ORM (10 tables)
- **Sources**: Robinhood Assets API, Robinhood Price API, Blockscout REST API
- **Deploy**: Vercel Hobby + Neon Free tier

## 📊 Core Features

| Feature | Description |
|---------|-------------|
| **Chain Pulse** | Overview metrics: capital flow, active wallets, DEX volume, signals |
| **Opportunity Radar** | Risk-adjusted leaderboard with filters (category, risk, liquidity, canonical) |
| **Stock Token Radar** | Canonical identity verification + flow + relative value |
| **Token Scanner** | New token discovery + contract risk + holder quality |
| **Token Detail** | Full analysis with tabs: Overview, Flows, Signals, Risk, Transactions |
| **Capital Flow** | Bridge inflow/outflow, USDG/WETH movement, destination tracking |
| **Smart Money** | Wallet scoring, labels, PnL, win rate, accumulation tracking |
| **Alerts** | Signal feed with type, confidence, evidence, and risk flags |

## 🚀 Quick Start

### Local Development

```bash
# Clone
git clone https://github.com/Jeonyomi/robin.git
cd robin

# Install
pnpm install

# Setup environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL (Neon)

# Run dev server
pnpm dev
```

### Environment Variables

```bash
# Required
DATABASE_URL="postgresql://..."     # Neon Postgres connection
CRON_SECRET="random-hex"           # Daily maintenance cron auth
ADMIN_SYNC_SECRET="random-hex"     # Admin sync endpoint auth

# Pre-configured (defaults work)
NEXT_PUBLIC_CHAIN_ID="4663"
NEXT_PUBLIC_EXPLORER_URL="https://robinhoodchain.blockscout.com"
ROBINHOOD_RPC_URL="https://rpc.mainnet.chain.robinhood.com"
ROBINHOOD_ASSETS_API_URL="https://api.robinhood.com/rhj/assets"
BLOCKSCOUT_API_BASE_URL="https://api.blockscout.com/4663/api/v2"
```

### Generate Secrets

```bash
openssl rand -hex 32
```

## 📁 Project Structure

```
robin/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── page.tsx            # Chain Pulse overview
│   │   ├── opportunities/      # Opportunity Radar
│   │   ├── stock-tokens/       # Stock Token Radar
│   │   ├── tokens/             # Token Scanner + Detail
│   │   ├── capital-flow/       # Bridge & DEX flow
│   │   ├── smart-money/        # Wallet tracking
│   │   ├── alerts/             # Signal feed
│   │   ├── api/v1/             # REST API endpoints
│   │   ├── api/admin/sync/     # Admin sync jobs
│   │   └── api/cron/           # Scheduled maintenance
│   ├── db/schema/              # Drizzle ORM schema (10 tables)
│   ├── lib/
│   │   ├── config/             # Env validation, constants
│   │   ├── db/                 # Lazy DB connection
│   │   ├── domain/             # Business logic engines
│   │   ├── jobs/               # Sync job runners
│   │   └── sources/            # External API adapters
│   └── components/ui/          # Reusable UI components
├── docs/                       # Documentation
│   ├── architecture.md
│   ├── metrics.md
│   ├── signals.md
│   └── deployment.md
├── vercel.json                 # Vercel config (daily cron)
├── drizzle.config.ts           # Drizzle Kit config
└── .env.example                # Environment template
```

## 🔄 Data Sync Strategy

### Daily Maintenance (Cron)
Runs at 03:17 UTC via Vercel Cron:
1. Sync Robinhood canonical asset registry
2. Check source health (Robinhood API, Blockscout)
3. Stale metadata refresh
4. Bounded metric recalculation

### On-Demand Refresh (User-triggered)
Scoped refresh with cooldown:
- **5 min** cooldown per scope (token, opportunity)
- **Bounded** batch processing (no full-chain scans)
- **DB-level deduplication** prevents concurrent duplicates

### Admin Sync (Manual)
Protected by `ADMIN_SYNC_SECRET`:
```bash
curl -X POST "https://your-app.vercel.app/api/admin/sync/canonical-assets" \
  -H "Authorization: Bearer $ADMIN_SYNC_SECRET"
```

## 🧪 Key Signals

| Signal | Description |
|--------|-------------|
| `SMART_ACCUMULATION` | Smart money + growing holders + stable liquidity |
| `CAPITAL_ROTATION` | Bridge inflow → specific token/protocol |
| `NEW_TOKEN_BREAKOUT` | New token with genuine adoption (not bot) |
| `STOCK_TOKEN_DIVERGENCE` | DEX price diverges from reference with depth |
| `FAKE_MOMENTUM_WARNING` | Artificial momentum (sybil, wash, bot) |
| `TICKER_COLLISION` | Non-canonical token using stock-like ticker |

## ⚠️ Known Limitations

- **Hobby plan**: 1 cron job/day, 60s function timeout
- **No realtime**: Data is snapshot-based, not streaming
- **No auth**: Watchlist is localStorage-based (P0)
- **Partial protocol decoding**: Only SWAP, BRIDGE, MINT/BURN in P0
- **No backtest**: Signal validation framework planned for P1

## 📚 Documentation

- [Architecture](docs/architecture.md) — System design and data flow
- [Metrics](docs/metrics.md) — All metric definitions and formulas
- [Signals](docs/signals.md) — Signal types, conditions, and scoring
- [Deployment](docs/deployment.md) — Vercel + Neon setup guide

## 📈 Roadmap

### P0 (Current) ✅
- [x] Canonical identity resolver
- [x] Stock Token Radar with canonical badges
- [x] Risk engine (6 components, 5 hard gates)
- [x] Opportunity scoring (6 weighted factors)
- [x] Signal engine (6 signal types)
- [x] 8 dashboard pages
- [x] 12 API endpoints
- [x] Vercel deployment config

### P1 (Next)
- [ ] Uniswap pool analytics
- [ ] LP opportunity scoring
- [ ] Wallet PnL model
- [ ] Corporate action timeline
- [ ] Telegram/Discord alerts
- [ ] Signal backtest UI

### P2 (Future)
- [ ] Perps activity tracking
- [ ] Cross-chain wallet identity
- [ ] Agent/AA cohort intelligence
- [ ] Custom quant formula builder
- [ ] API product + team workspaces

## 📄 License

Personal research use. Not financial advice.

---

Built for the Robinhood Chain ecosystem. Data is sourced from public on-chain records and official Robinhood APIs.
