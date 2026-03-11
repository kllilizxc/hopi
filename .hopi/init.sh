#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOPI_PROJECT_ROOT:-${HOPI_TASK_ROOT:-$(pwd)}}"
cd "$ROOT"

echo "[hopi-init] checking dependencies..." >&2

# Sandbox-safe tempdir (macOS /var -> /private/var symlink can break allowlists)
mkdir -p ".tmp"
export TMPDIR="$(pwd)/.tmp"

# Check for bun
if ! command -v bun >/dev/null 2>&1; then
  echo "[hopi-init] error: bun not found" >&2
  exit 1
fi

# Install dependencies if needed
if [[ ! -d "node_modules" ]]; then
  echo "[hopi-init] installing dependencies..." >&2
  if bun install --cache-dir ".tmp/bun-cache"; then
    echo "[hopi-init] dependencies installed" >&2
  else
    echo "[hopi-init] warning: bun install failed; continuing without deps (offline sandbox?)" >&2
    echo "[hopi-init] warning: run \`bun install\` manually when network is available" >&2
  fi
else
  echo "[hopi-init] dependencies already installed" >&2
fi

echo "[hopi-init] initialization complete" >&2
