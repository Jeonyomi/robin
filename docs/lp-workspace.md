# LP Leaders: NFT discovery, fee accounting and limitations

## Purpose

`/liquidity` automatically discovers a bounded sample of public Uniswap v3 LP NFTs and orders supported WETH pairs by **lifetime fee entitlement recorded in the WETH token itself**. Other token fees are separate; no pool-price conversion is used in fee rank. No personal NFT ID, wallet connection or manual scenario input is needed. Expand a row to inspect range structure, inventory, fee records and source contracts.

This is **not** a whole-chain top-earner list, a fair recent-period return comparison, an owner's personal profit report or an investment recommendation. Lifetime totals favor older/larger NFTs. Fees can coexist with losses on deposited assets.

## Source and sample

- Fixed mainnet chain `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`.
- Official v3 NFT manager `0x73991a25c818bf1f1128deaab1492d45638de0d3` and factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`.
- WETH identity comes from the official manager's `WETH9()` getter and validated 18-decimal contract, not a ticker guess. Only pools containing that exact wrapped-native asset are ranked.
- `totalSupply()` and `tokenByIndex()` discover up to 12 deterministic, stratified enumerable indices. Indices are not token IDs and their order is not chronological. Burned NFTs are absent from current enumeration.
- UI reports total enumerable NFTs, actual sample size, eligible, validation-excluded and unsupported-pair counts. Unsampled NFTs can outperform every displayed row.
- Every state read is pinned to the same block number; network, contract code, manager/factory/pool linkage, token order, fee tier, tick spacing and price/tick consistency are checked. The source block hash and timestamp are checked again at completion.
- Provider-returned IncreaseLiquidity, DecreaseLiquidity and Collect logs are requested from genesis through the anchored block for each sampled ID. The first increase's successful transaction receipt must contain the corresponding zero-address mint Transfer and matching block/transaction identity. Full ownership-transfer history is not claimed; current owner is read directly and is not asserted to be the viewer.

Public RPC historical state calls were unavailable in investigation. Sparse topic1 NFT event history worked; large OR-ID filters and broad or mint-specific Transfer-history filters were unreliable. Mint verification therefore uses receipts. HTTP JSON-RPC batches also exhausted the endpoint's rate limit; they are disabled. Shared request pacing, response/log/request limits and a total deadline bound each scan. Explorer links are for verification; the page does not depend on Blockscout's API, which returned 403 during investigation.

Only official manager/pool view calls are grouped through Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11`, after checking its runtime bytecode hash at the source block: `0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891`. This runtime was independently matched to Ethereum's canonical deployment. Untrusted token metadata calls execute separately so a malicious metadata function cannot change the simulated state used by other calls in the same aggregate. No transactions are signed or broadcast.

## Fee identity: principal is not revenue

For each token, raw integer accounting is:

```text
lifetime recorded fees =
  sum(NPM Collect accounting amounts)
  + current tokensOwed
  + newly accrued fee-growth entitlement
  - sum(DecreaseLiquidity principal amounts)

newly accrued entitlement = floor(
  liquidity * ((feeGrowthInsideNow - lastCheckpoint) mod 2^256) / 2^128
)
```

`tokensOwed` contains both checkpointed fees and uncollected withdrawn principal. It is never simply labeled fees. Fee growth follows Uniswap's half-open tick interval and uint256 modular subtraction. The ledger requires a first liquidity increase on the mint block, ordered unique coordinates, no pre-mint logs, no negative intermediate liquidity, and final liquidity matching the live position. Negative inferred fees or failed reconciliation exclude the record rather than becoming zero.

The RPC is still a trusted data provider: reconciliation does not cryptographically prove that no canceling events or collections were silently omitted. There is no documented history-retention or completeness SLA.

**Accounting amounts are not exact received cash.** Canonical NPM `Collect` emits the requested accounting debit; the pool may transfer a few raw units less due to rounding. This discrepancy was observed on a real closed NFT in source investigation. Displayed totals are recorded entitlement, not ERC20 receipt-confirmed income. They span the NFT lifetime and all owners. No claimed/unclaimed fee split is invented when principal and fees are mixed.

## Valuation and range structure

- Retain per-token raw fee totals and decimals in every row.
- Rank only the raw WETH fee leg, with a fixed 18-decimal denomination. Non-WETH token fees are not converted into the rank. This intentionally avoids elevating dust pools through manipulated or illiquid token prices.
- A separate, illustrative all-token fee estimate converts the other token using `sqrtPriceX96`, correctly oriented as **WETH per base token**. That estimate is not used for ranking, is not an executable conversion or historical proceeds, and may be severely distorted by manipulation or illiquidity. No USD peg, token safety or liquidity-depth certification is implied.
- Current LP inventory is approximated from liquidity and square-root bounds, separately from outstanding claims. Bounds and floating-point inventory are approximate, not exact execution quotes.
- Full-range uses the fee-tier's extreme usable ticks. Concentrated means upper/lower minus one is at most 20%; other non-full ranges are wide. These describe shape, not intent, trader skill, safety or a recommended strategy.
- Range state respects pool tick boundaries, including inverted WETH/base orientation. Closed and out-of-range positions can have past fees but do not presently earn active swap fees.
- No APR/APY, net PnL, time-weighted return, 24-hour yield, gas allocation, USD profit or HODL/IL performance is inferred. Those require separately verified historical states, cash-flow valuation, ownership scope and costs.

## API, freshness and privacy

- `GET /api/v1/lp-leaders` takes no user parameters. Additional wallet/token/provider parameters return 400.
- Success is `{data: LpLeaderboard, error: null, meta: {mode, revalidateSeconds, maxSourceAgeSeconds}}`. Rate-limited reads return 429; other unavailable reads return 503, both with `data: null` and `Retry-After`. Browser/edge HTTP response caching remains disabled.
- This is a **shared verified research snapshot, not a live feed**. Next Data Cache persists successful observations across server workers and revalidates on demand after 90 seconds. The source block and `observedAt` are never renewed by a cache hit. Every API response and the browser independently withhold snapshots older than **5 minutes**, even if background revalidation failed. No expired snapshot is substituted as a current one.
- A worker shares one in-flight collection. On 429 it cancels queued reads and holds new collection attempts for at least 60 seconds (longer if the provider specifies `Retry-After`); other failures receive a 15-second cooldown. The browser displays a countdown and disables repeated Refresh attempts. Cooldown is worker-local, not a distributed rate-limit guarantee; successful shared caching removes most repeated scans.
- A cold collection can take up to 90 seconds. Reads are paced 650 ms apart; each dispatched request has a separate 10-second network/body timeout. Queue wait does not consume that timeout. The API runtime budget is 120 seconds. No provider switching, JSON-RPC batch workaround or weakened code/provenance checks were introduced.
- Browser automatically loads once, supports explicit Refresh, schema-validates the response and removes the ranking when its source observation expires. No background RPC polling, database write, collector/scheduler change, wallet signing, trading or Telegram notification is performed.
- The previous local scenario key `robin:lp-workspace:v1` is left untouched. Old local data is not uploaded, deleted or relabeled as live evidence. Old model/storage utilities remain available in source history and tests; they are no longer the main page.
- Public hosting/RPC providers may log standard request metadata. Token symbols are unverified onchain text; missing/invalid symbols are represented by their contract address, never guessed tickers. No external NFT images, arbitrary HTML or user-supplied RPC targets are loaded.

## Verification

Use existing local dependency binaries on the Windows-mounted repository; avoid implicit dependency reconciliation:

```sh
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/vitest run
./node_modules/.bin/next build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3105 ./node_modules/.bin/playwright test
```

Unit/E2E fault fixtures are explicitly test-only. At least one actual RPC-backed NFT leaderboard and browser flow must succeed; an empty or fabricated response is not a substitute for live verification.

## Primary references

- https://docs.robinhood.com/chain/connecting
- https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments.md
- https://developers.uniswap.org/deployments.json
- https://github.com/Uniswap/v3-periphery/blob/main/contracts/NonfungiblePositionManager.sol
- https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/Tick.sol
- https://uniswap.org/whitepaper-v3.pdf
