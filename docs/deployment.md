# Deployment Guide — LOCAL-FIRST

## Architecture Overview

This project uses a **local-first data architecture**:

```
┌─────────────────────────── LOCAL MACHINE ───────────────────────────┐
│  pnpm dev                ← Next.js app + API routes                 │
│  pnpm sync               ← data sync jobs (Robinhood + Blockscout)  │
│  data/robin.db           ← SQLite database (all on-chain data)      │
└─────────────────────────────────────────────────────────────────────┘
            │
            │ (UI only)
            ▼
┌─────────────────────────── VERCEL (UI-only) ────────────────────────┐
│  Static/dynamic pages render with empty states                      │
│  API routes return uiOnly responses (no data)                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Key principle**: All data accumulation and usage happens on your machine.
Vercel deployment serves the UI only — pages render, but data is synced and
served locally.

---

## Local Setup (data + full dashboard)

### 1. Install & configure

```bash
git clone https://github.com/Jeonyomi/robin.git
cd robin
pnpm install

# Environment — the defaults work out of the box
cp .env.example .env
# DATABASE_URL=data/robin.db  (SQLite local file)
```

### 2. Create the database

```bash
pnpm db:push          # drizzle-kit push → creates tables in data/robin.db
```

### 3. Sync data (Robinhood + Blockscout)

```bash
pnpm sync             # all jobs
pnpm sync canonical   # Robinhood /rhj/assets registry (~194 stock tokens)
pnpm sync metadata    # Blockscout token metadata (holders, volume, supply)
pnpm sync prices      # Robinhood reference prices (batch endpoint)
pnpm sync metrics     # holder deltas between snapshots
pnpm sync watch       # run all jobs every 5 minutes (leave running)
```

Each sync is **idempotent** (upserts, no duplicates) and bounded
(50 tokens per metadata batch — safe for rate limits).

### 4. Run the dashboard

```bash
pnpm dev
# → http://localhost:3000
```

---

## Vercel Deployment (UI only)

### 1. Connect repository

1. [vercel.com](https://vercel.com) → New Project
2. Import `Jeonyomi/robin`
3. Framework: **Next.js** (auto-detected)
4. Build command: `pnpm build`

### 2. Environment variables

No secrets are required for UI-only deployment. The only variables used
at runtime on Vercel are the public ones (defaults work):

| Variable | Default | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_CHAIN_ID` | `4663` | |
| `NEXT_PUBLIC_EXPLORER_URL` | Blockscout | |

`DATABASE_URL`, `CRON_SECRET`, `ADMIN_SYNC_SECRET` are NOT needed —
API routes detect the missing local DB and return `uiOnly` empty responses.

### 3. What works on Vercel

- All 9 pages render (empty states with setup guidance)
- Navigation, layout, watchlist (localStorage), styling
- API routes return `{ data: [], meta: { uiOnly: true, message: "..." } }`

### 4. What requires the local machine

- Real on-chain data (tokens, prices, holders, signals)
- Data sync jobs (`pnpm sync`)
- On-demand refresh (local API)

---

## Migrations

```bash
pnpm db:generate   # generate SQL migration from schema changes
pnpm db:push       # apply to local SQLite
```

Migration files live in `src/db/migrations/` and are committed.

---

## Local sync jobs (reference)

| Job | Source | What it stores | Frequency |
|-----|--------|----------------|-----------|
| `canonical` | Robinhood `/rhj/assets` | 194 canonical stock tokens | daily |
| `metadata` | Blockscout `/tokens/{addr}` | holders, volume, supply, verification | daily |
| `prices` | Robinhood `/rhj/prices` (batch) | bid/ask/mid × multiplier snapshots | hourly |
| `metrics` | internal | holder deltas between snapshots | after metadata |
| `watch` | all above | runs every 5 min | while running |

---

## Troubleshooting

### "UI-only deployment" message on pages
Expected on Vercel — data lives on your local machine. Run `pnpm dev` locally.

### API returns empty even locally
- Check `data/robin.db` exists: `pnpm db:push`
- Run `pnpm sync` once to populate
- Restart `pnpm dev` (it caches the DB connection)

### 429 rate limits on Robinhood API
The price adapter uses the **batch endpoint** (1 request for all assets).
Metadata sync is bounded to 50 tokens per run — wait 5+ min between runs.

### better-sqlite3 native build on Windows
pnpm handles prebuilt binaries. If build scripts are blocked, run
`pnpm approve-builds` and allow `better-sqlite3`.
