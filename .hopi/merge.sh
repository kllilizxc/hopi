#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOPI_PROJECT_ROOT:-${HOPI_TASK_ROOT:-$(pwd)}}"
TARGET_BRANCH="${HOPI_MERGE_TARGET_BRANCH:-${HOPI_TARGET_BRANCH:-dev}}"
TASK_BRANCH="${HOPI_MERGE_SOURCE_BRANCH:-${HOPI_TASK_BRANCH:-$(git -C "$ROOT" branch --show-current)}}"

cd "$ROOT"

echo "[hopi-merge] merging $TASK_BRANCH into $TARGET_BRANCH..." >&2

# Ensure we're on either the task branch or the target branch (common in worktree setups)
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$TASK_BRANCH" && "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]]; then
  echo "[hopi-merge] error: unexpected current branch: $CURRENT_BRANCH (expected: $TASK_BRANCH or $TARGET_BRANCH)" >&2
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
