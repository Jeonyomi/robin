# Metrics Reference

This document defines all core metrics used in the Robinhood Chain Opportunity Intelligence Dashboard.

## Chain-Level Metrics

### Active Wallets
- **Definition**: Unique wallet addresses that sent at least one transaction in the given time window
- **Formula**: `COUNT(DISTINCT from_address) WHERE timestamp >= window_start`
- **Window**: 1h, 6h, 24h, 7d
- **Source**: Blockscout API → token_transfers / transactions
- **Exclusions**: Router, pool, bridge, bundler, paymaster, protocol treasury addresses
- **Caveats**: ERC-4337 bundler wallets inflate counts if not excluded; smart accounts may appear as one address

### Net Capital Inflow
- **Definition**: Sum of bridge inflows minus bridge outflows in the given window
- **Formula**: `SUM(bridge_in_usd) - SUM(bridge_out_usd)`
- **Window**: 24h (default)
- **Source**: Bridge contract events (Relay, Across, LayerZero, Arbitrum canonical)
- **Exclusions**: Internal bridge hops (e.g., router → pool → router)
- **Caveats**: Multi-hop bridges may double-count; source chain identification depends on event parsing

### DEX Economic Volume
- **Definition**: Realized swap volume across all tracked DEX pools (Uniswap V3/V4, Arcus)
- **Formula**: `SUM(swap_usd_value) WHERE action_type = 'SWAP'`
- **Window**: 24h
- **Source**: Uniswap PoolManager events, SwapRouter events
- **Exclusions**: Router internal transfers, multi-hop routing counted once per economic action
- **Caveats**: Price impact not factored into volume; MEV bot activity included

### USDG Net Flow
- **Definition**: Net change in USDG stablecoin holdings across all tracked addresses
- **Formula**: `SUM(usdg_in) - SUM(usdg_out)`
- **Window**: 24h
- **Source**: USDG token transfers
- **Exclusions**: Protocol treasury, mint/burn operations
- **Caveats**: Mint/burn can look like flow; differentiate with transaction context

## Token-Level Metrics

### Holder Count
- **Definition**: Total unique addresses holding non-zero balance of a token
- **Source**: Blockscout `/tokens/{address}/counters`
- **Caveats**: Includes airdrop recipients, bots, routers, and protocol contracts

### Holder Delta (Δ holders)
- **Definition**: Change in holder count over the measurement window
- **Formula**: `holders_end - holders_start`
- **Window**: 24h, 7d
- **Caveats**: May include sybil/airdrop wallets; use with active_holder_delta for quality

### Active Holder Delta
- **Definition**: Change in holders who also initiated at least one transfer (not just received)
- **Formula**: `COUNT(DISTINCT from_address WHERE action = 'transfer' OR action = 'swap')`
- **Window**: 24h, 7d
- **Caveats**: More reliable than raw holder delta but requires transfer event ingestion

### Unique Buyers / Sellers
- **Definition**: Distinct addresses that received (bought) or sent (sold) the token via DEX swap
- **Formula**: `COUNT(DISTINCT counterparty_address) WHERE action_type = 'SWAP'`
- **Window**: 1h, 6h, 24h
- **Source**: Economic actions table
- **Exclusions**: Router/pool addresses excluded as counterparties

### Net Flow USD
- **Definition**: Net USD value of all buys minus all sells in the window
- **Formula**: `SUM(buy_usd) - SUM(sell_usd)`
- **Window**: 1h, 6h, 24h
- **Source**: Economic actions with USD pricing

### Liquidity USD
- **Definition**: Total value locked in DEX pools for this token (sum of both sides)
- **Source**: Uniswap pool reserves × token price
- **Caveats**: TVL ≠ executable depth; liquidity can be concentrated in narrow ranges

### Depth ±1% USD
- **Definition**: Total USD value within ±1% of mid price that can be executed without >1% price impact
- **Source**: Uniswap V3/V4 pool tick data analysis
- **Caveats**: Calculated from pool reserves, not live order book; real execution may differ

### Volume / Liquidity Ratio
- **Definition**: Economic volume divided by liquidity — higher ratio indicates efficient capital use
- **Formula**: `volume_usd / liquidity_usd`
- **Caveats**: Very high ratios may indicate wash trading or bot activity

### Top 10 Share
- **Definition**: Percentage of total supply held by the 10 largest non-LP, non-router wallets
- **Formula**: `SUM(balance_top_10) / total_supply`
- **Exclusions**: LP positions, burn addresses, router/pool contracts, protocol treasuries
- **Caveats**: High concentration alone isn't negative; check against smart_money labels

### Sybil Ratio
- **Definition**: Estimated proportion of holders that are sybil/bot wallets
- **Formula**: Based on transfer pattern analysis, address age, and clustering
- **Range**: 0.0 (clean) to 1.0 (fully sybil)
- **Caveats**: Heuristic-based; lower confidence for new tokens

## Stock Token-Specific Metrics

### Adjusted Reference Price
- **Definition**: Underlier mid price divided by current multiplier
- **Formula**: `raw_mid_price / current_multiplier`
- **Source**: Robinhood `/rhj/prices/{symbol}` + `/rhj/assets` multiplier
- **Caveats**: Multiplier can change during corporate actions; always check multiplier freshness

### Premium / Discount
- **Definition**: DEX mid price relative to adjusted reference price
- **Formula**: `(dex_mid / adjusted_reference_price) - 1`
- **Caveats**: Requires fresh reference price; liquidity depth must support the trade for signal validity

## Opportunity Score

### Raw Opportunity Score
- **Formula**: Weighted sum of normalized factors
  - 23% Capital Flow
  - 18% Adoption Momentum
  - 18% Liquidity Quality
  - 15% Smart Money
  - 11% Relative Value
  - 15% Catalyst / Structural Growth
- **Normalization**: Each factor normalized to 0–100 using percentile or winsorized z-score

### Adjusted Opportunity Score
- **Formula**: `raw_score × (1 - risk_score / 125)`
- **Caveats**: Hard gate triggers set status to RESTRICTED regardless of score

### Data Completeness
- **Definition**: Proportion of required factors that have valid data
- **Range**: 0.0 to 1.0
- **Threshold**: Below 0.6, confidence is LOW and score is not used for ranking

## Confidence Levels

| Level | Criteria |
|-------|----------|
| HIGH | data_completeness ≥ 0.9, ≥ 5 factors available, canonical/verified source |
| MEDIUM | data_completeness ≥ 0.6, ≥ 3 factors available |
| LOW | data_completeness < 0.6 or < 3 factors available |
