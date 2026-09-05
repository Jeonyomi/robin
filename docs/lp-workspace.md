# LP Workspace: methodology and readiness

## Purpose and operating boundary

`/liquidity` combines an on-demand public v3 state inspector and a browser-local research workspace for **user-entered concentrated-liquidity scenarios**. It is not a connected portfolio, wallet ownership assertion or execution surface. No token, position, fee or return is prefilled. Existing Robin chain statistics and transfer collection are unchanged.

The first implementation deliberately separates a useful range model from data that has not yet been verified. Canonical security-token registry entries and ERC-20 transfer counts are not substitutes for meme-token DEX pools, swaps, LP fee growth or personal position accounting.

## Price orientation and model

All prices are **quote units per one base token**. Symbols are user labels, not verified contract identifiers. A quote token is not assumed to be USD or worth one dollar.

Let `a = sqrt(lowerPrice)`, `b = sqrt(upperPrice)`, and `s = sqrt(price)` clamped into `[a, b]` for inventory calculations:

- Base inventory per unit of liquidity: `(b - s) / (s * b)`.
- Quote inventory per unit of liquidity: `s - a`.
- Liquidity is calibrated at entry so entry base inventory × entry price + entry quote inventory equals the entered capital.
- LP value at the observed/scenario price is current base inventory × **unclamped price** + current quote inventory.
- Hold value is the same **entry token quantities**, valued at the observed/scenario price.
- No-fee divergence is LP value minus Hold value, with percentage denominator Hold value.
- Net versus Hold is divergence + entered fees − entered costs.
- Net PnL versus entry is LP value + entered fees − entered costs − entry capital.
- Historical simple fee APR is `fees / entryCapital × 365 / elapsedDays × 100`. It is unavailable below one elapsed day, is not compounded and is never a forecast.

Model reference: [Uniswap v3 whitepaper](https://uniswap.org/whitepaper-v3.pdf), concentrated liquidity and virtual reserves. This implementation uses continuous prices, not exact tick-rounded contract accounting.

Range state follows `[lower, upper)`. Below the lower bound the modeled position holds only base tokens; at/above the upper bound it holds only quote tokens. A move below range does not stop losses if the base asset continues falling.

## Missing inputs and unsupported behavior

Fees and costs default to **unknown**, not zero. Both must be explicitly entered before net metrics appear. APR needs explicit fees and an elapsed period of at least one day. Values from different quote units are not aggregated.

Supported scenario: one deposit with entry strictly inside a fixed range, unchanged liquidity, no reinvestment. Unsupported: liquidity additions/removals, range changes, claimed/owed fee reconstruction, fee growth, exact tick alignment, rebasing or transfer-tax tokens, v4 hooks, taxes, ownership attribution and quote-token FX changes. Fees entered in quote units require the user to choose consistent valuation and avoid double counting.

The lower/entry/upper rows are **hypothetical price scenarios**, not market observations. The narrow-range flag (upper/lower minus one ≤10%) and edge review flag (distance to nearest edge ≤5% of the entered price) are fixed review heuristics, not asset-volatility calibration or a recommended allocation.

## Input freshness and alerts

The observation timestamp is explicitly supplied by the user. A labeled button can set it to the current local time only when the user confirms observing that price now. Editing does not silently refresh it.

Inputs older than two hours are marked stale. Clock-skewed/future imports are rejected. The visible range statement always says it applies to the **entered price**, not the current market. A timer reevaluates input age only; it does not fetch prices.

Telegram is off, no recurring job is created and no notification credential is requested. Live alerts require validated source freshness, authorized recipient, threshold hysteresis, deduplication, recovery alerts and explicit stale/error behavior before activation.

## Persistence, privacy and recovery

- Browser-origin local storage key: `robin:lp-workspace:v1`.
- Workspace version 1; up to 50 scenarios; JSON imports limited to 256 KB by byte size.
- Inputs are validated again on read, import and save, including representable numerical outputs.
- Duplicate IDs, invalid/future observation timestamps and unknown schema versions are rejected. Unknown fields, including forged verification claims, are stripped.
- User strings render as React text, never HTML or arbitrary URLs.
- Corrupted storage is preserved; save is blocked until explicit reset. Raw backup export remains available.
- Storage quota/permission failures do not report successful persistence.
- Cross-tab updates trigger refresh. Writes and resets use exclusive Web Locks around revision-check plus mutation; unsupported browsers fail closed. Conflicting saves and stale edits fail rather than overwrite silently.
- Replacement import, individual removal and unreadable-storage reset require confirmation.
- Manual scenario inputs are not sent to application APIs. The separate inspector sends the public NFT position ID to `/api/v1/lp-position` and the official RPC for that read; standard request logs may retain it. No wallet address, signature or private key is required.
- Local storage and exported files are not encrypted. A shared browser profile, other same-origin code or browser extensions can access local records. Clearing site data removes them.

## Connected portfolio release gates

The implemented on-demand v3 inspector covers only public position state. It uses official mainnet chain `4663`, NPM `0x73991a25c818bf1f1128deaab1492d45638de0d3`, factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` and fixed `https://rpc.mainnet.chain.robinhood.com`. No configurable user URL, contract or wallet is accepted. Read failures return unavailable rather than old success. Fee amounts and performance are always withheld.

Official sources checked on 5 September 2026: [Robinhood network connection](https://docs.robinhood.com/chain/connecting), [Uniswap v3 Robinhood deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments.md), [unified deployment feed](https://developers.uniswap.org/deployments.json). The official public RPC is rate-limited and is not a production capacity/SLA guarantee. Uniswap v4 deployment exists but is deliberately out of the implemented adapter scope.

A fully connected **performance** portfolio still requires:

1. Confirm the exact chain/network with official documentation and live `eth_chainId` evidence. Do not silently relabel or switch the existing collector.
2. Verify protocol deployment provenance, factory and position-manager addresses, bytecode and token order. A ticker match or ABI-compatible contract is insufficient.
3. Read position owner/ID, ticks, liquidity, pool state, block timestamp and fee-growth state at a consistent block.
4. Reconstruct deposits, withdrawals, fee collections and gas/other costs with complete event coverage before making real PnL claims.
5. Compute active liquidity share in matching units and time intervals; token-transfer counts and TVL ratios are not swap volume or active-range share.
6. Provide stale/error/unsupported-network gates and explicitly identify any unverified oracle, protocol or valuation input.
7. Obtain user authorization for personal wallet association and notification destination. No transactions are included in read-only authorization.

At this stage, **public v3 state reads and manual scenario research are enabled; connected LP performance accounting and automated alerts are unavailable**.

## Verification commands

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
# Against the final local production build; no external writes or live financial data fixtures:
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3105 pnpm exec playwright test tests/e2e/lp-workspace.spec.ts
```

The E2E fixtures are explicitly labeled synthetic **test inputs**, never production seeds or substituted API responses.
