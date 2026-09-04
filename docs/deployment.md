# Deployment Guide — Vercel + Neon Postgres

## Target architecture

```text
RobinSync (Windows Task Scheduler or manual pnpm sync)
        │
        ▼
Neon Postgres  ◀──── Next.js API routes on Vercel
        │
        └──── optional JSON snapshot → Vercel Blob fallback
```

Neon Postgres is the shared source of truth. Local sync jobs and deployed API
routes use the same database. The Blob snapshot remains a read-only fallback
when `DATABASE_URL` is unavailable.

## 1. Connect Neon through Vercel Marketplace

1. Open the Vercel project for this repository.
2. Go to **Storage** or **Integrations / Marketplace** and add **Neon**.
3. Create a Neon project/database or attach an existing one.
4. Connect it to Production, Preview, and Development as appropriate.
5. Confirm that Vercel injected `DATABASE_URL` into the selected environments.
6. Add `DATABASE_URL_UNPOOLED` with Neon's direct connection string if the
   integration did not add it. Drizzle migrations should prefer this direct URL.

Use the pooled Neon URL (`-pooler` in the hostname) as `DATABASE_URL` for the
Next.js serverless app and recurring sync jobs. Never commit either URL.

Official references:

- Vercel Postgres integrations: <https://vercel.com/docs/postgres>
- Neon + Drizzle: <https://neon.com/docs/guides/drizzle>

## 2. Configure protected operations

Set these in Vercel Project Settings → Environment Variables:

- `CRON_SECRET`: authenticates `/api/cron/daily-maintenance`
- `ADMIN_SYNC_SECRET`: authenticates `/api/admin/sync/*`
- `BLOB_READ_WRITE_TOKEN`: optional; enables snapshot publishing
- `SNAPSHOT_URL_V3`: optional override for the built-in v3 Blob fallback URL

Generate each secret independently:

```bash
openssl rand -hex 32
```

## 3. Pull environment variables for local sync

The sync scripts use `dotenv/config`, so place the variables in an ignored
`.env` file. With Vercel CLI:

```bash
vercel link
vercel env pull .env
```

Alternatively, copy `.env.example` to `.env` and fill in the Neon URLs and
secrets manually.

## 4. Create the Postgres schema

Generate and apply versioned migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

The committed Postgres migrations live in `src/db/migrations-postgres/`.
`pnpm db:push` is retained for disposable development databases, but production
changes should use `db:generate` + `db:migrate`.

## 5. Import the existing SQLite data once

Pause the existing `RobinSync` scheduled task so the source stops changing,
keep the legacy SQLite file backed up, then run:

```bash
pnpm db:import-sqlite -- data/robin.db
```

The importer:

- copies all 10 application tables in bounded batches;
- reads all SQLite tables from one consistent transaction snapshot;
- preserves primary IDs and timestamps;
- skips existing primary/unique-key conflicts so interrupted runs can resume;
- resets Postgres serial sequences after importing explicit IDs;
- compares source and target row counts and exits non-zero on a short copy;
- never prints a database connection string.

Do not delete the SQLite backup until the target counts and deployed API have
been verified.

## 6. Verify the Cloud DB

```bash
pnpm db:check
```

Expected output includes `"ok": true`, `"provider": "neon-postgres"`, table
counts, and the latest sync state. Then exercise one write cycle:

```bash
pnpm sync:canonical
pnpm db:check
```

## 7. Update the scheduled sync

The existing `RobinSync` task can continue running `pnpm sync`; only its working
copy needs the new `.env` containing `DATABASE_URL`. It now writes directly to
Neon. Keep one scheduler active to avoid overlapping runs. Synthetic economic
actions are skipped by default; never set `ALLOW_SYNTHETIC_ACTIONS=true` in the
production scheduler.

The operating sequence is `canonical → stats → metadata → prices → transfers → metrics`.
Transfer collection is intentionally bounded. Tune `TRANSFER_SYNC_BATCH_SIZE`,
`TRANSFER_SYNC_HOT_TOKENS`, `TRANSFER_SYNC_MAX_PAGES`, and
`TRANSFER_SYNC_LOOKBACK_HOURS` only after checking the direct Blockscout
instance's stability. Heuristic signal generation is not in the default path.

## 8. Deploy and verify

After committing and pushing the migration:

1. Redeploy the Vercel project.
2. Confirm `/api/v1/source-health` reports `Neon Postgres` and
   `meta.servedFrom: "neon-postgres"`.
3. Confirm `/api/v1/overview?window=24h` returns current data.
4. Confirm transfer count, source cursor, rotation progress, and latest observed block advance.
5. Confirm `lastUpdatedAt` advances after a scheduled sync.
6. Run `PLAYWRIGHT_BASE_URL=<preview-or-production-url> pnpm e2e`. For a
   Vercel-protected Preview, also set the local-only
   `VERCEL_AUTOMATION_BYPASS_SECRET`; Playwright sends the official bypass
   headers when this variable is present.
7. Temporarily test a Preview deployment without `DATABASE_URL` and confirm it
   falls back to the Blob snapshot instead of returning a 500.

## Rollback

1. Keep the original SQLite DB and last good Blob snapshot unchanged.
2. Remove or disconnect `DATABASE_URL` from the affected Vercel environment.
3. Redeploy; read APIs fall back to the published Blob snapshot.
4. Restore the prior application revision if required.

This rollback is read-only: sync jobs must be stopped or pointed back to a safe
working copy before making any further writes.
