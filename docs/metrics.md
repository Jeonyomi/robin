# Metrics Reference

This document defines the metrics used in Robin's operating dashboard. All metrics are descriptive observations unless explicitly stated otherwise.

## Scope labels

### Chain-wide

A point-in-time value returned by Blockscout `/api/v2/stats`. These values describe the indexed network as reported by Blockscout.

### Tracked-token sample

A value calculated from transfers stored by Robin's bounded rotating collector. These values do not represent a full archival scan and can be lower bounds.

## Chain-wide metrics

### Total transactions

- **Definition:** cumulative transaction count reported by Blockscout
- **Source:** `/api/v2/stats.total_transactions`
- **Freshness:** latest successful `chain-stats` sync
- **Caveat:** Blockscout indexing latency can differ from chain head

### Total addresses

- **Definition:** cumulative address count reported by Blockscout
- **Source:** `/api/v2/stats.total_addresses`
- **Caveat:** addresses are not people or verified users

### Total blocks

- **Definition:** latest indexed block total reported by Blockscout
- **Source:** `/api/v2/stats.total_blocks`

### Average block time

- **Definition:** Blockscout's current average block interval
- **Source:** `/api/v2/stats.average_block_time`
- **Unit:** milliseconds as returned by the source

### Gas price

- **Definition:** slow, average, and fast gas observations
- **Source:** `/api/v2/stats.gas_prices`
- **Unit:** Gwei

## Tracked-token metrics

### Transfer events

- **Formula:** `COUNT(*)` over stored `token_transfers` in the selected window
- **Deduplication:** transaction hash + log index + token address
- **Caveat:** page-bounded collection can make this a lower bound

### Active addresses

- **Formula:** distinct union of `from_address` and `to_address` in the selected window
- **Caveat:** an address is not a unique person; routers and automated accounts are not yet labeled

### Active tokens

- **Formula:** `COUNT(DISTINCT token_address)` in the selected window
- **Scope:** canonical assets stored in Robin's registry

### Mint events

- **Formula:** transfers where `from_address` is `0x0000000000000000000000000000000000000000`
- **Meaning:** token issuance event at the ERC-20 transfer layer
- **Caveat:** business purpose is not inferred

### Burn events

- **Formula:** transfers where `to_address` is the zero address
- **Meaning:** token destruction event at the ERC-20 transfer layer
- **Caveat:** business purpose is not inferred

### Hourly transfer trend

- **Formula:** transfer count grouped by UTC hour
- **Companion metric:** distinct participating addresses in each hour
- **Use:** identify when stored activity changed, not why it changed

### Transfer momentum

```text
(current_window_transfers - previous_window_transfers)
------------------------------------------------------ × 100
             previous_window_transfers
```

If the previous window contains zero transfers and the current window is non-zero, the result is labeled `newly observed` rather than assigned an infinite percentage.

### Holder count

- **Definition:** token holder count reported by Blockscout counters
- **Source:** `/tokens/{address}/counters`
- **Caveat:** point-in-time observation; holders can include contracts, routers, or dust recipients

### Holder change

- **Formula:** latest holder-count observation minus the prior observation
- **Caveat:** snapshot intervals can differ and should not be treated as an exact 24-hour change unless the timestamps support that interval

## Activity Index

The Activity Index ranks tokens within the selected response set.

```text
transfer_component = token transfers / maximum token transfers in result
address_component  = token active addresses / maximum token active addresses in result

Activity Index = round(100 × (0.60 × transfer_component + 0.40 × address_component))
```

Properties:

- Relative, not absolute
- Recalculated for every time window
- Not comparable across different result sets
- Does not include price, liquidity, PnL, wallet identity, or prediction
- Intended to prioritize investigation only

## Coverage metrics

### Rotation progress

- **Definition:** canonical tokens scanned in the current initial rotation divided by tracked canonical tokens
- **Full-cycle state:** at least one complete registry rotation has finished

### Tokens with stored transfers

- **Definition:** distinct token addresses present in `token_transfers`
- **Caveat:** zero stored transfers can mean no observed event or not-yet-scanned; use rotation state alongside this value

### Last indexed time

- **Definition:** `source_sync_state.last_success_at` for the `token-transfers` job

## Metrics deliberately not asserted

Until decoded and independently validated, Robin does not label raw transfers as:

- DEX buy or sell volume
- Bridge inflow or outflow
- Net capital flow
- Smart-money accumulation
- Wallet profitability
- Tradeable liquidity
- Investment opportunity

Legacy research code for these concepts is outside the default operating path.
