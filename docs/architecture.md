# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                         │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────┐  │
│  │ Dashboard   │ │ Opportunity  │ │ Stock Token │ │   Token    │  │
│  │ Overview    │ │ Radar        │ │ Radar       │ │ Scanner    │  │
│  └─────────────┘ └──────────────┘ └─────────────┘ └────────────┘  │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────┐  │
│  │ Capital     │ │ Smart Money  │ │   Alerts    │ │   Settings │  │
│  │ Flow        │ │              │ │             │ │            │  │
│  └─────────────┘ └──────────────┘ └─────────────┘ └────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                        API Layer (Route Handlers)                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │ /api/v1/*    │ │ /api/admin/* │ │ /api/cron/*  │               │
│  │ REST API     │ │ Sync Jobs    │ │ Maintenance  │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
├─────────────────────────────────────────────────────────────────────┤
│                      Domain Logic Layer                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │ Identity     │ │ Risk Engine  │ │ Opportunity  │               │
│  │ Resolver     │ │              │ │ Scorer       │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │ Signal       │ │ Smart Money  │ │ Economic     │               │
│  │ Engine       │ │ Engine       │ │ Actions      │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
├─────────────────────────────────────────────────────────────────────┤
│                     Source Adapter Layer                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │ Robinhood    │ │ Blockscout   │ │ RPC          │               │
│  │ Assets API   │ │ REST API     │ │ WebSocket    │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
├─────────────────────────────────────────────────────────────────────┤
│                      Storage Layer                                  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Neon Postgres via Vercel Marketplace (Drizzle ORM + HTTP)      │  │
│  │ • canonical_assets    • token_transfers                       │  │
│  │ • tokens              • economic_actions                      │  │
│  │ • token_metric_snapshots • stock_token_price_snapshots        │  │
│  │ • wallet_features     • signals                               │  │
│  │ • source_sync_state   • protocol_registry                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Ingestion Flow

```
External APIs → Source Adapters → Normalized Models → DB Upserts
```

- **Robinhood Assets API** → Canonical asset registry
- **Robinhood Price API** → Reference prices with multiplier normalization
- **Blockscout API** → Token metadata, transfers, counters, contract info
- **Chain RPC** → Block ingestion, log decoding (P1)

### 2. Calculation Flow

```
DB Snapshots → Feature Engine → Opportunity/Risk Scores → Signals → API
```

1. Raw data collected via ingestion
2. Feature engine computes token metrics per time window
3. Risk engine evaluates contract, liquidity, concentration, manipulation, identity
4. Opportunity engine scores across 6 weighted factors
5. Signal engine detects specific patterns (accumulation, rotation, divergence)
6. Results stored in DB, served via API

### 3. User Interaction Flow

```
User → Dashboard Page → API Route → Neon Query → Response → UI Render
```

- Pages are client components that fetch from API routes
- API routes query shared Neon Postgres (not external APIs) for consistent data
- Local/automated sync jobs write to the same Neon database
- Vercel Blob is a read-only fallback, not the primary database
- Stale data shows "Last Updated" timestamp
- Refresh button triggers scoped server-side re-fetch

## Design Decisions

### P-01: Canonical Identity First

Stock Tokens are identified by **exact contract address match** against Robinhood's official registry, never by symbol or name. This prevents ticker collision attacks.

### P-02: Cloud DB-First Reads

All dashboard pages read from Neon, never directly from external APIs. This ensures:
- One source of truth across local sync jobs and Vercel
- Consistent data across users
- Graceful read degradation through the last published Blob snapshot

### P-03: Bounded Refresh

User-triggered refresh is scoped and rate-limited:
- 5-minute cooldown per scope (token, opportunity, etc.)
- Maximum batch size per invocation
- DB-level deduplication prevents concurrent duplicate fetches

### P-04: Economic Actions > Raw Transfers

A single swap transaction may generate 4+ token transfers (Wallet→Router, Router→Pool, Pool→Router, Router→Wallet). These are normalized into a single SWAP economic action to prevent volume inflation.

### P-05: Risk Before Opportunity

Risk gates are evaluated before opportunity scoring. Tokens that fail hard gates (ticker collision, no liquidity, extreme concentration) are marked RESTRICTED regardless of opportunity score.

## File Structure

```
src/
├── app/
│   ├── (dashboard)/          # Client pages
│   ├── api/v1/               # REST API routes
│   ├── api/admin/sync/       # Admin sync endpoints
│   └── api/cron/             # Scheduled jobs
├── components/ui/            # Reusable UI primitives
├── db/
│   └── schema/               # Drizzle ORM schema
├── lib/
│   ├── config/               # Env validation, constants
│   ├── db/                   # DB connection (lazy)
│   ├── domain/               # Business logic
│   │   ├── identity/         # Canonical resolver
│   │   ├── risk/             # Risk scoring
│   │   ├── opportunity/      # Opportunity scoring
│   │   ├── signals/          # Signal generation
│   │   └── smart-money/      # Wallet scoring
│   ├── jobs/                 # Sync jobs
│   └── sources/              # External API adapters
│       ├── blockscout/
│       └── robinhood/
└── tests/                    # Unit + integration tests
```
