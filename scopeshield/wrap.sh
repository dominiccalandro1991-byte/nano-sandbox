#!/bin/sh
# Intercept a build command. Does not run if the check fails (exit 1).
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
CONTRACT=${SCOPESHIELD_CONTRACT:-"$ROOT/scopeshield/contracts/ci.yaml"}
BIN="$ROOT/scopeshield/bin/scopeshield"
if [ ! -x "$BIN" ]; then
  echo '{"ok":false,"reason":"scopeshield_binary_missing"}'
  exit 1
fi
"$BIN" check --contract "$CONTRACT" --skip-liveness --json -- "$@"
