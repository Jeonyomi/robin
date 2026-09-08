# P0 source reliability

P0 hardens existing sources; it does **not** migrate transfer indexing to RPC, provision paid APIs, change database schema, or change scheduled task frequency.

## Independent activity pulse

`scripts/sync-hourly.cmd` invokes the version-controlled `scripts/activity-pulse.ts`. Transfers, stats and snapshot publication are attempted separately with fixed child commands, no shell interpolation, and a bounded stage timeout. A nonzero/aborted stage leaves the aggregate exit nonzero even when publication succeeds. Original source timestamps are preserved; publishing an old observation is not a new observation.

The existing `RobinSync` task definition stays unchanged. Manual CLI jobs and pulse children enable `ROBINWATCH_COLLECTOR=1` so source quotas/cooldowns survive independent child processes.

## HTTP source policy

`src/lib/sources/source-request.ts` is the shared policy for Blockscout, Robinhood, DEX Screener and GeckoTerminal HTTP adapters. It bounds request starts, request count, network/body time, body bytes and transient retries. Its constants are local safety ceilings, not statements of provider entitlement or guaranteed capacity.

- 403/challenge: scope cooldown and no retry loop. A transfer-specific failure does not automatically mark a different stats endpoint as blocked.
- 429: provider-wide cooldown; Retry-After seconds and HTTP-date forms are handled.
- Ordinary 4xx and malformed/invalid data: no blind retries.
- Transient network/5xx: bounded backoff. Retries consume quota too.
- Error records exclude credential-bearing URLs, request headers and response bodies.
- Durable local state: `data/source-request-state.json`, atomic replacement with an exclusive lock. Corrupt/inaccessible state fails closed.
- A lock left after a crash is not stolen automatically. Verify that no collector owns it before operator recovery; do not delete state just to reset a quota or bypass a cooldown.
- Web/serverless instances use memory state. Neither their caches nor their quotas coordinate all Vercel instances; provider-wide cross-host orchestration remains P1.

Current local ceilings (all attempts, including retries):
- Blockscout: 1-second start spacing, 120 starts per trailing minute, 9,000 per UTC day.
- Robinhood: 500ms spacing, 30 starts per trailing minute, 1,500 per UTC day.
- DEX Screener: 500ms spacing, 30 starts per trailing minute, 1,000 per UTC day.
- GeckoTerminal: 2.1-second spacing, 30 starts per trailing minute, 500 per UTC day.

The trailing-minute counters are instance-local. Collector daily counters and start spacing use the shared local state file. Exhaustion fails closed; lowering freshness is preferable to silently exceeding the local budget. Public RPC admission separately caps one active operation, six starts and 192 estimated methods per minute, and 10,000 estimated methods per UTC day **per process**, with individual fetcher bounds retained.

## Truthful data acceptance

A valid empty event page is different from unavailable/invalid data. No usable metadata, no accepted registry, or no storable/matched price must not advance the last usable-success time. Partial runs carry degraded status and safe failure details. Transfer recovery work remains pending rather than silently counting failures as a completed scan.

Reference quote identity is matched by chain and canonical deployment address, not ticker alone. Missing source times are not replaced with the fetch clock. Where existing non-null storage columns cannot represent unknown time, unverified quotes are withheld instead of changing the schema or inventing timestamps. Original observations remain available subject to their existing freshness rules. Historical rows are not rewritten or retroactively certified by this rollout.

Validated transfer pages are persisted before later pagination. A later page failure or shared source block retains already accepted observations and truthful partial counts, while the incomplete token stays pending and the CLI result stays nonzero. A usable partial observation is not a completed scan or verified window exposure.

## Coverage and Activity Lens

Stored-transfer token counts use the same canonical population and selected observation window. They are **observed-token counts**, not proof of exhaustive scanning. An inactive token can have complete exposure after a verified empty range scan, but the current page-bounded collector cannot prove that for a full window.

P0 therefore withholds comparative Activity Lens rankings when observation exposure is unknown or source health is unsuitable. Older snapshots lacking explicit exposure evidence also fail closed. Raw activity counts remain lower-bound observations, and an old completed rotation is not a current complete-data claim.

## Public LP compatibility route

`/api/v1/lp-position` is retained. It now coalesces identical requests, briefly caches successful fresh observations, and participates in the same **process-local** admission module as Meme/Stock inspection. No stale observation is substituted after a failed refresh. Invalid input is rejected before upstream work and busy responses use 429/Retry-After.

The gate limits concurrency, operation starts and conservative estimated method cost; each fetcher retains its own RPC method/time bounds. This is not a distributed guarantee across Vercel functions or the separate LP collector. Cross-host shared RPC orchestration and v4 history optimization remain P1.

## Rollout and recovery

1. Run focused fault-injection/unit regressions, lint/type/build and independent review.
2. Push the reviewed commit to GitHub main and verify the matching Git-connected Vercel deployment and canonical alias.
3. During an idle collector interval, back up the exact changed runtime files and copy only reviewed source/launcher dependencies. Verify byte hashes and unchanged task XML.
4. Read the next normal pulse's stage results, source state and public API. A blocked source may remain degraded: P0 contains failures; it does not solve upstream permission or availability.
5. Roll back only the backed-up files if a local regression is found. Preserve provider cooldown/budget state and actual collected observations. No database schema rollback is needed.

## Acceptance evidence

Tests cover source HTTP errors and budgets, durable state, success/timestamp/identity rejection, partial transfer recovery, ranking fail-closed behavior, independent pulse results, and public LP cache/admission behavior. Synthetic fixtures are test-only and never uploaded as observations. Runtime/deployment checks are recorded separately from unit fixtures and provider SLA claims.
