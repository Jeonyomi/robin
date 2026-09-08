# Chain statistics collection repair

## Observed incident — 8 September 2026

At 22:25 KST the production Overview API served chain stats last accepted at 13:30:24 KST, while transfers had indexed at 22:20:42 KST. Neon was readable. The active Windows `RobinSync` runtime was separate from the Git working tree.

Two independent rejection paths appeared in the active collector log:

1. `Invalid Blockscout stats response: Invalid input: expected number, received object`.
2. `Ignored regressing Blockscout stats response: 57665570 < 57679740`.

The scheduler returned exit 0 because its activity pulse intentionally publishes with the last stored stats after a stats failure. Task success does not establish success of every source.

## Root causes and repair

### Gas response variants

Public `/api/v2/stats` reads reproduced both numeric gas tiers and object tiers within consecutive requests. An object tier includes `price`, `wei`, `base_fee`, `priority_fee`, `fiat_price` and `time`. `price` is the suggested gas price in Gwei; the other fields are not substitutes.

The adapter normalizes numeric tiers and object `price` values to the existing Gwei model. Null/zero remain distinct. Invalid values fail validation rather than becoming invented prices; errors identify the field path without dumping source payloads.

### Counter versus height

Blockscout's `total_blocks` is a cached/estimated consensus-block count, not a chain-head block number. Comparing it to the maximum observed transfer `blockNumber` is semantically invalid and can reject an otherwise usable response indefinitely.

The collector compares the incoming count only with the last accepted count from the same stats source. Lower counts remain rejected; rejected stats retain their previous accepted cursor and observation time. Gas observations retain their independent update path.

The Overview label is **Indexed block count**, separate from **Latest tracked block**. **Chain observed** denotes the last accepted stats fetch, not the chain-head timestamp or proof of complete provider indexing. A successful fetch can still contain lagging provider counters.

## Scope and verification boundary

- Regression tests cover the source adapter, same-source guard and displayed counter/freshness meaning.
- No database migration, synthetic data, paid service or additional recurring request stream is required.
- Runtime rollout replaces only the reviewed stats adapter and stats job after backing up the prior files. The existing scheduler interval, wrapper, LP collector and credentials remain unchanged.
- Recovery must be verified from a real stats collection result and the production Overview/source-health readback, not merely a successful build or scheduler exit code.
- To undo the runtime repair, restore only the backed-up source files between scheduled runs. Previously accepted observations are not destructively rewritten; the normal collection path governs later data.

## Source references

- [Blockscout stats endpoint](https://docs.blockscout.com/api-reference/get-stats-counters)
- [Stats controller: total_blocks uses BlocksCount.get()](https://github.com/blockscout/blockscout/blob/master/apps/block_scout_web/lib/block_scout_web/controllers/api/v2/stats_controller.ex)
- [Cached/estimated consensus-block count implementation](https://github.com/blockscout/blockscout/blob/master/apps/explorer/lib/explorer/chain/cache/counters/blocks_count.ex)
