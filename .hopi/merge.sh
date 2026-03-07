#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOPI_PROJECT_ROOT:-${HOPI_TASK_ROOT:-$(pwd)}}"
TARGET_BRANCH="${HOPI_MERGE_TARGET_BRANCH:-${HOPI_TARGET_BRANCH:-dev}}"
TASK_BRANCH="${HOPI_MERGE_SOURCE_BRANCH:-${HOPI_TASK_BRANCH:-$(git -C "$ROOT" branch --show-current)}}"

cd "$ROOT"

echo "[hopi-merge] merging $TASK_BRANCH into $TARGET_BRANCH..." >&2

log() {
  echo "[hopi-merge] $*" >&2
}

die() {
  log "error: $*"
  exit 1
}

find_worktree_for_branch() {
  local branch_name="$1"
  local target_ref="refs/heads/${branch_name}"
  local current_worktree=""

  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        current_worktree="${line#worktree }"
        ;;
      branch\ *)
        local branch_ref="${line#branch }"
        if [[ "$branch_ref" == "$target_ref" ]]; then
          echo "$current_worktree"
          return 0
        fi
        ;;
    esac
  done < <(git worktree list --porcelain)

  return 1
}

ensure_clean_worktree() {
  local path="$1"
  local label="$2"

  if [[ -n "$(git -C "$path" status --porcelain)" ]]; then
    die "${label} worktree has uncommitted changes: $path"
  fi
}

# Ensure we're on either the task branch or the target branch (common in worktree setups).
CURRENT_BRANCH="$(git branch --show-current || true)"
if [[ "$CURRENT_BRANCH" != "$TASK_BRANCH" && "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]]; then
  die "unexpected current branch: $CURRENT_BRANCH (expected: $TASK_BRANCH or $TARGET_BRANCH)"
fi

MERGE_ROOT="$ROOT"

# If target branch is checked out in another worktree, merge there.
# This avoids "branch is already checked out" errors and keeps that worktree consistent.
TARGET_WORKTREE_PATH="$(find_worktree_for_branch "$TARGET_BRANCH" || true)"
if [[ -n "${TARGET_WORKTREE_PATH:-}" && "$TARGET_WORKTREE_PATH" != "$ROOT" ]]; then
  log "target branch '$TARGET_BRANCH' checked out at: $TARGET_WORKTREE_PATH"
  MERGE_ROOT="$TARGET_WORKTREE_PATH"
fi

if [[ ! -d "$MERGE_ROOT" ]]; then
  die "merge worktree does not exist: $MERGE_ROOT"
fi

ensure_clean_worktree "$MERGE_ROOT" "target"

MERGE_BRANCH="$(git -C "$MERGE_ROOT" branch --show-current || true)"
if [[ "$MERGE_BRANCH" != "$TARGET_BRANCH" ]]; then
  log "switching to $TARGET_BRANCH in $MERGE_ROOT..."
  git -C "$MERGE_ROOT" checkout "$TARGET_BRANCH"
fi

# Fetch latest from target (best-effort). Use remote-tracking refs; do not fetch into a checked-out local branch.
log "fetching latest origin/$TARGET_BRANCH..."
git -C "$MERGE_ROOT" fetch origin "$TARGET_BRANCH" || true

# Fast-forward local target branch to origin if possible (best-effort).
if git -C "$MERGE_ROOT" rev-parse --verify --quiet "origin/$TARGET_BRANCH" >/dev/null; then
  log "fast-forwarding $TARGET_BRANCH to origin/$TARGET_BRANCH (if possible)..."
  git -C "$MERGE_ROOT" merge --ff-only "origin/$TARGET_BRANCH" || true
fi

log "merging $TASK_BRANCH..."
git -C "$MERGE_ROOT" merge --no-ff "$TASK_BRANCH" -m "Merge task branch $TASK_BRANCH into $TARGET_BRANCH"

if [[ "${HOPI_MERGE_PUSH:-0}" == "1" ]]; then
  log "pushing to origin/$TARGET_BRANCH..."
  git -C "$MERGE_ROOT" push origin "$TARGET_BRANCH"
else
  log "skipping push (set HOPI_MERGE_PUSH=1 to enable)"
fi

log "merge complete"
