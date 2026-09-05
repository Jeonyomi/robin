#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.local/bin:/usr/bin:/bin"
state="$HOME/.local/state/robin-lp"
mkdir -p "$state"
chmod 700 "$state"
exec 9>"$state/collector.lock"
if ! flock -n 9; then
  printf '%s\n' '{"status":"skipped","reason":"collector-already-running"}'
  exit 0
fi
# One bounded source scan; runtime logs are separate from the clean checkout.
exec timeout --signal=TERM --kill-after=5s 115s "$HOME/.local/bin/node" --import tsx scripts/sync-lp-leaders.ts
