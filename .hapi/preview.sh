#!/usr/bin/env bash
set -euo pipefail

ROOT="${HAPI_PREVIEW_ROOT:-$(pwd)}"
MODE="${HAPI_PREVIEW_MODE:-local}"
TIMEOUT_SEC="${HAPI_PREVIEW_TIMEOUT_SEC:-180}"

HUB_PORT_BASE="${HAPI_PREVIEW_HUB_PORT_BASE:-${HAPI_LISTEN_PORT:-3006}}"
WEB_PORT_BASE="${HAPI_PREVIEW_WEB_PORT_BASE:-${HAPI_WEB_PORT:-5173}}"

cd "$ROOT"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

is_port_busy() {
  local port="$1"
  if command_exists lsof; then
    lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1
  else
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  fi
}

find_free_port() {
  local port="$1"
  port="${port:-0}"
  if ! [[ "$port" =~ ^[0-9]+$ ]]; then
    port=0
  fi
  if [[ "$port" -le 0 || "$port" -gt 65535 ]]; then
    port=0
  fi

  local candidate
  for candidate in $(seq "$port" $((port + 200))); do
    if [[ "$candidate" -gt 65535 ]]; then
      break
    fi
    if ! is_port_busy "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done

  echo "[hapi-preview] no free port found near base: $port" >&2
  return 1
}

http_ok() {
  local url="$1"
  if command_exists curl; then
    curl -fsS --max-time 1 -o /dev/null "$url" >/dev/null 2>&1
    return $?
  fi

  # Fallback: basic TCP connect if curl missing
  local host port
  host="127.0.0.1"
  port="$(echo "$url" | sed -nE 's#^[^:]+://[^:]+:([0-9]{2,5}).*$#\\1#p' | head -n 1 || true)"
  if [[ -n "$port" ]]; then
    nc -z "$host" "$port" >/dev/null 2>&1
    return $?
  fi

  return 1
}

install_deps() {
  if ! command_exists bun; then
    echo "[hapi-preview] bun not found" >&2
    return 1
  fi

  local lockfile=""
  if [[ -f "bun.lock" ]]; then
    lockfile="bun.lock"
  elif [[ -f "bun.lockb" ]]; then
    lockfile="bun.lockb"
  fi

  local next_hash="no-lockfile"
  if [[ -n "$lockfile" ]]; then
    next_hash="$(shasum -a 256 "$lockfile" | awk '{print $1}')"
  fi

  local hash_file=".hapi/.preview-install.hash"
  local prev_hash=""
  [[ -f "$hash_file" ]] && prev_hash="$(cat "$hash_file" || true)"

  if [[ ! -d "node_modules" || "$prev_hash" != "$next_hash" ]]; then
    echo "[hapi-preview] installing deps (mode=$MODE)" >&2
    bun install
    printf "%s" "$next_hash" > "$hash_file"
  fi
}

install_deps

HUB_PORT="$(find_free_port "$HUB_PORT_BASE")"
WEB_PORT="$(find_free_port "$WEB_PORT_BASE")"

export HAPI_LISTEN_PORT="$HUB_PORT"
export HAPI_WEB_PORT="$WEB_PORT"

echo "[hapi-preview] hub: http://127.0.0.1:$HUB_PORT" >&2
echo "[hapi-preview] web: http://127.0.0.1:$WEB_PORT" >&2

bun run dev &
APP_PID=$!

cleanup() {
  if kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

hub_url="http://127.0.0.1:$HUB_PORT/health"
web_url="http://127.0.0.1:$WEB_PORT"

hub_ready=0
web_ready=0

deadline=$((SECONDS + TIMEOUT_SEC))
while (( SECONDS < deadline )); do
  if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
    echo "[hapi-preview] dev process exited before ready" >&2
    exit 1
  fi

  if [[ "$hub_ready" -eq 0 ]] && http_ok "$hub_url"; then
    hub_ready=1
  fi
  if [[ "$web_ready" -eq 0 ]] && http_ok "$web_url"; then
    web_ready=1
  fi

  if [[ "$hub_ready" -eq 1 && "$web_ready" -eq 1 ]]; then
    break
  fi

  sleep 1
done

if [[ "$hub_ready" -ne 1 ]]; then
  echo "[hapi-preview] hub not ready: $hub_url" >&2
  exit 1
fi

if [[ "$web_ready" -ne 1 ]]; then
  echo "[hapi-preview] web not ready: $web_url" >&2
  exit 1
fi

echo "::hapi-preview-url::$web_url"
wait "$APP_PID"
