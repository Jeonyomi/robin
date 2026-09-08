# Performance follow-up: request identity, latest metrics, freshness

## Delivery scope

The user approved publishing the reviewed performance work first, then continuing the next priorities on the same repository and production environment.

- Phase 1: `b98697f4ec9c21a4370e5a3b6d7615a0782c3581` was pushed to GitHub main and deployed through the Git integration. Vercel production deployment `dpl_C8ENyBEHULUesyMtTwhgnnsKHRLf` reached Ready and the canonical alias was verified. Meme Leaders page, Overview API and Capital Flow API returned HTTP 200; both APIs read Neon successfully.
- Phase 2 scope: condition-safe observation requests; latest-only Stock Token metrics; per-source observation freshness and current rotation progress; exact snapshot-window fallback.
- No database/schema/index migrations, collector/scheduler changes, new infrastructure or paid-provider changes.

## Snapshot window behavior

`pickWindow` now returns only the requested window. A published snapshot missing the requested window must not be silently presented as 1h/6h data using the 24h entry.

If the snapshot exists but the requested entry is absent, Overview, Capital Flow, Stock Tokens and Opportunities return HTTP 503 with `data:null`, the requested `meta.window`, and `degraded:true`. A present empty list is still a valid empty result. Existing handling for no usable snapshot remains separate.

Offline tests reproduced the original wrong-window return and the misleading generic no-snapshot response before the changes. Both tests pass after the changes. No production provider response was fabricated.

## Latest-only Stock Token metrics

The metric query selects one latest row per token with PostgreSQL `DISTINCT ON`, projects only the token address and ten displayed metric fields, and pushes the canonical-token predicate into the metric query when requested. The token list still includes tokens without metrics. The most recent row is authoritative even when its fields are null; older populated metrics are not substituted. Equal-time rows use the highest id as a defensive tie-break, although the current unique index normally prevents such ties.

Offline tests exercise actual Drizzle compilation/decoding with a fake Neon transport. They cover window predicates, both canonical modes, output equivalence for unique timestamps, missing/empty/all-null metrics, ordering, and numeric zero/negative values. No database index changes or actual DB query-plan measurements were performed.

## Request ownership and displayed observation age

A shared request hook aborts prior/unmounted requests, checks the ownership of every completion, and resets displayed data for changed conditions. The guard distinguishes request instances even when a user selects A, then B, then A again. The four pages use stable payload selectors, so a render or unchanged selection does not introduce a request. Current request failures are explicit; obsolete failures cannot clear current loading/data state.

Overview and Transfer Activity display chain observation, gas update, transfer observation and transfer indexing ages independently. The 3h display-age threshold is stated in the UI and is not a change to source-health or ranking gates. A timer updates age labels without additional network fetches. Unknown/invalid/future timestamps are distinct from fresh observations. The current rotation uses `cycleProgressPct`; prior completed rotations no longer force the current bar to 100%. Asset Registry metadata timestamps remain distinct from holder observations.

## Verification boundaries

Timing and work-count observations in the prior review are not production latency improvement guarantees. Reducing transferred metric history does not prove a particular PostgreSQL execution plan or response-time percentage. Existing source degradation is not repaired by these UI/query changes.

See `performance-review-20260908.md` for the original dated baseline.

Final offline verification: 445 tests across 25 test files passed with the thread pool. Changed-source lint passed. Independent backend/frontend specification review and final security/logic review passed. Reviewers did not execute tests themselves; execution evidence is separate.

Clock regressions additionally cover stale duplicate gas notes, static timestamp surfaces, and valid observations arriving after component mount. Dynamic source ages use the current render-time clock and an idle-render interval; non-ticking surfaces show immutable ISO timestamps. Truly future timestamps remain explicit warnings. These checks do not claim real browser QA, production load-test coverage or repaired upstream collectors.
