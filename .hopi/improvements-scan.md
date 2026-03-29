# HOPI improvements-scan best-practice checklist

Goal: when a task finishes, propose only the most valuable follow-up work. Do not bias toward product polish only; explicitly look for code-quality, reliability, and architecture debt.

## What "good" architecture/code-quality follow-ups look like

- Call out **concrete hotspots**, not generic cleanup. Mention the module, flow, or boundary that should change.
- Prefer **root-cause fixes** over symptom cleanup.
- Favor work that improves **maintainability, correctness, testability, reliability, or performance**.
- If no strong architecture item exists, return fewer tasks rather than filler.

## HOPI-specific review pass

### 1. Boundaries + ownership

- Keep route handlers thin; reusable task/session/project logic should live in sync/store/service helpers.
- Avoid spreading one workflow across web route handlers, sync automation, and UI-specific helpers without a clear owner.
- Prefer one canonical implementation for task/session state transitions.

### 2. Shared contracts

- Shared message/task/session shapes belong in `shared/` when used across cli/hub/web.
- Prefer Zod-backed parsing/validation over ad-hoc shape checks.
- Flag duplicated normalization/parsing logic across agent integrations when a shared helper would reduce drift.

### 3. Automation reliability

- Look for stale-version races, timeout handling, inactive-session edges, retry loops, and idempotency gaps.
- Improvements around SSE / Socket.IO / DB consistency are high-value.
- Silent fallbacks or swallowed errors should usually become explicit states or actionable diagnostics.

### 4. Complexity + duplication

- Giant files, repeated prompt-building patterns, repeated extractor logic, or repeated "best effort" branches are good architecture targets.
- Prefer simplification when the current abstraction hides straightforward control flow.

### 5. Tests + guardrails

- Missing regression coverage for parse failures, automation triggers, approval limits, race conditions, or workflow transitions counts as architecture debt.
- Especially valuable: tests around cross-package contracts and real-time state synchronization.

### 6. Performance

- Repeated full scans, expensive hot-path queries, or avoidable rerenders are worth suggesting when concrete and user-visible.

## Suggestion bias

- Roughly half of suggested tasks should be user-facing / feature follow-ups.
- Roughly half should be architecture / code-quality / reliability follow-ups.
- Architecture tasks can include refactors, dedupe, boundary cleanup, validation hardening, regression tests, observability, or performance work.
