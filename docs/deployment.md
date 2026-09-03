# Deployment Guide

## Overview

This app is designed to deploy on **Vercel Hobby (Free) plan** with **Neon Postgres** for data storage. It's a personal research tool, not a commercial service.

## Prerequisites

- GitHub account with `Jeonyomi/robin` repository
- Vercel account (Hobby plan)
- Neon account (free tier)

## Step 1: Neon Database Setup

1. Go to [neon.tech](https://neon.tech) and create a free account
2. Create a new project
3. Copy the connection string from the dashboard
4. It will look like: `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require`

## Step 2: Vercel Project Setup

1. Go to [vercel.com](https://vercel.com)
2. Import `Jeonyomi/robin` repository
3. Framework: **Next.js** (auto-detected)
4. Build command: `pnpm build`
5. Install command: `pnpm install`

## Step 3: Environment Variables

Set these in Vercel Project Settings → Environment Variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | `postgresql://...` | From Neon dashboard |
| `CRON_SECRET` | Random string | For daily maintenance cron |
| `ADMIN_SYNC_SECRET` | Random string | For manual admin sync |

**Generate secrets:**
```bash
openssl rand -hex 32
```

### Optional Variables

| Variable | Description |
|----------|-------------|
| `BLOCKSCOUT_API_KEY` | If using Blockscout PRO API |
| `UPSTASH_REDIS_REST_URL` | For distributed caching (P1) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash auth token |

## Step 4: Database Migration

After first deploy, run the migration:

```bash
# Local
DATABASE_URL="your-neon-url" npx drizzle-kit push

# Or via Vercel CLI
npx vercel env pull .env.local
DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) npx drizzle-kit push
```

## Step 5: Initial Data Sync

Trigger the first canonical asset sync:

```bash
# Get your admin sync secret from Vercel env
ADMIN_SYNC_SECRET="your-secret"

# Trigger sync
curl -X POST "https://your-app.vercel.app/api/admin/sync/canonical-assets" \
  -H "Authorization: Bearer $ADMIN_SYNC_SECRET"
```

## Step 6: Verify

1. Visit your Vercel URL
2. Check `/settings/data-sources` for source health
3. Navigate to `/stock-tokens` — should show canonical tokens after sync

---

## Daily Cron

The app includes a daily maintenance cron job:

```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/daily-maintenance",
    "schedule": "17 3 * * *"
  }]
}
```

This runs at **03:17 UTC daily** (one of 2 allowed slots on Hobby plan).

**Protected by**: `CRON_SECRET` environment variable.

The cron job:
1. Syncs canonical asset registry
2. Checks source health
3. Stale metadata refresh
4. Bounded metric recalculation

---

## On-Demand Refresh

Users can trigger scoped refresh from the dashboard:

```
POST /api/v1/refresh/stock-token/{address}
POST /api/v1/refresh/opportunities
```

**Features:**
- Global cooldown (5 min per scope)
- DB-level deduplication
- Bounded execution (no full-chain scans)

---

## Preview Deployments

Every push to a non-main branch creates a Preview Deployment:

1. Push feature branch
2. Vercel auto-deploys preview URL
3. Use admin sync for testing with real data
4. Merge to main for production

---

## Hobby Plan Limitations

| Limit | Value | Mitigation |
|-------|-------|------------|
| Cron jobs | 1 per day | Use on-demand refresh for near-real-time |
| Function duration | 60s (Hobby) | Bounded batch processing |
| Function memory | 1024 MB | Sufficient for P0 |
| Bandwidth | 100 GB/mo | API responses are small |
| Serverless executions | 100/day | DB-first reads reduce calls |

---

## Rollback

If a deployment fails:

1. Go to Vercel Dashboard → Deployments
2. Find the last working deployment
3. Click "..." → "Promote to Production"

Or revert via Git:
```bash
git revert HEAD
git push
```

---

## Local Development

```bash
# Clone
git clone https://github.com/Jeonyomi/robin.git
cd robin

# Install
pnpm install

# Setup env
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL

# Run dev server
pnpm dev

# Run migrations
npx drizzle-kit push

# Sync canonical assets
curl -X POST http://localhost:3000/api/admin/sync/canonical-assets \
  -H "Authorization: Bearer your-admin-secret"
```

---

## Troubleshooting

### Build fails with "Missing env vars"
- Environment variables default to empty strings at build time
- They are validated at runtime when API routes are called
- Set all required variables in Vercel before deploying

### "No database connection string"
- Ensure `DATABASE_URL` is set in Vercel environment variables
- Neon connection string must include `?sslmode=require`

### Cron not running
- Hobby plan allows only 1 cron job
- Verify `CRON_SECRET` is set
- Check Vercel Dashboard → Settings → Cron Jobs
