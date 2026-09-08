# Vercel Web Analytics

Robinwatch uses `@vercel/analytics/next` (pinned SDK 2.0.1) once in the root layout through a client wrapper. Vercel Web Analytics was already enabled for the existing `robinwatch` project; no plan, billing setting, collector or scheduler change is required.

## Collection boundary

- Production builds only, with debug logs disabled.
- Only HTTPS page views for `robinwatch24.vercel.app` and explicitly supported public routes are sent. Preview domains, API/admin/private/unknown paths and custom events are dropped.
- Query strings and fragments are removed. Valid `/tokens/0x…` paths become `/tokens/[address]`; malformed token paths are dropped.
- Do Not Track, Global Privacy Control and the documented local `va-disable` opt-out are respected. Opt-out storage errors fail closed. Existing local-storage records are not modified.
- Standard Vercel SDK aggregate device/referrer statistics and hosting logs are separate from the application's sanitized page-view URL. No wallet identity or custom event payload is supplied.
- When adding a public page, update `PUBLIC_PATHS` in `src/components/site-analytics.tsx` and its tests deliberately. Do not automatically include arbitrary user-controlled paths.

## Cost boundary

The team was verified as active Hobby on 8 September 2026. Vercel documents 50,000 included Web Analytics events per month, shared across the team. Hobby cannot purchase overage events; collection pauses at the limit rather than charging extra. No Web Analytics Plus, Speed Insights upgrade or paid custom events were enabled.

## Verification

`tests/unit/site-analytics.test.ts` uses an offline SDK mock to verify root mounting, development exclusion and the actual beforeSend privacy boundary. It does not prove dashboard ingestion. Production verification separately checks the deployed Git SHA, analytics script loading and real browser page-view requests. Allow provider processing time before interpreting dashboard totals; verification visits are not organic audience growth.

## Official references

- https://vercel.com/docs/analytics/quickstart
- https://vercel.com/docs/analytics/package
- https://vercel.com/docs/analytics/redacting-sensitive-data
- https://vercel.com/docs/analytics/privacy-policy
- https://vercel.com/docs/analytics/limits-and-pricing
