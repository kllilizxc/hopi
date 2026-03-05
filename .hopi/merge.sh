#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOPI_TASK_ROOT:-$(pwd)}"
TARGET_BRANCH="${HOPI_TARGET_BRANCH:-dev}"
TASK_BRANCH="${HOPI_TASK_BRANCH:-$(git -C "$ROOT" branch --show-current)}"

cd "$ROOT"

echo "[hopi-merge] merging $TASK_BRANCH into $TARGET_BRANCH..." >&2

# Ensure we're on the task branch
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$TASK_BRANCH" ]]; then
  echo "[hopi-merge] error: not on task branch (current: $CURRENT_BRANCH, expected: $TASK_BRANCH)" >&2
  exit 1
fi

# Fetch latest from target
echo "[hopi-merge] fetching latest $TARGET_BRANCH..." >&2
git fetch origin "$TARGET_BRANCH:$TARGET_BRANCH" || true

# Switch to target branch
echo "[hopi-merge] switching to $TARGET_BRANCH..." >&2
git checkout "$TARGET_BRANCH"

# Merge task branch
echo "[hopi-merge] merging $TASK_BRANCH..." >&2
git merge --no-ff "$TASK_BRANCH" -m "Merge task branch $TASK_BRANCH into $TARGET_BRANCH"

# Push to remote
echo "[hopi-merge] pushing to origin/$TARGET_BRANCH..." >&2
git push origin "$TARGET_BRANCH"

echo "[hopi-merge] merge complete" >&2
