#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOPI_TASK_ROOT:-$(pwd)}"
cd "$ROOT"

echo "[hopi-init] checking dependencies..." >&2

# Check for bun
if ! command -v bun >/dev/null 2>&1; then
  echo "[hopi-init] error: bun not found" >&2
  exit 1
fi

# Install dependencies if needed
if [[ ! -d "node_modules" ]]; then
  echo "[hopi-init] installing dependencies..." >&2
  bun install
else
  echo "[hopi-init] dependencies already installed" >&2
fi

echo "[hopi-init] initialization complete" >&2
