---
phase: 04-preview-action-parity
plan: 03
subsystem: web
tags: [preview-runtime, task-chat-ui, reconnect-safe]
requires:
  - .planning/phases/04-preview-action-parity/04-02-SUMMARY.md
provides:
  - Durable Preview banner and controls in task-aware chat using `task.previewRuntime` plus live `/preview` data
  - Shared preview query and mutation hooks with cache updates and SSE invalidation aligned to the hub runtime contract
  - Focused web tests for preview mutation caching and preview-state rehydration fallback
affects: [preview-ui, task-chat, query-cache, preview-tests]
tech-stack:
  added: []
  patterns: [durable task-backed runtime ui, reconnect-safe preview rehydration, cache-first action hooks]
key-files:
  created:
    - .planning/phases/04-preview-action-parity/04-03-SUMMARY.md
    - web/src/hooks/mutations/useTaskPreview.test.tsx
    - web/src/hooks/queries/useTaskPreviewState.test.tsx
  modified:
    - web/src/components/SessionChat.tsx
    - web/src/components/AssistantChat/HappyThread.tsx
    - web/src/hooks/mutations/useTaskPreview.ts
    - web/src/hooks/queries/useTaskPreviewState.ts
    - web/src/hooks/useSSE.ts
    - web/src/lib/query-keys.ts
    - web/src/types/api.ts
key-decisions:
  - "Treat durable `task.previewRuntime` as the primary UI truth and layer live preview details on top instead of rebuilding status from local event chips."
  - "Keep Preview action mutations cache-aware so start, stop, cancel, and retry surfaces update immediately before SSE settles the final state."
  - "Add focused preview hook tests now so refresh/reconnect-safe behavior is enforced without waiting for heavier end-to-end browser coverage."
patterns-established:
  - "Preview task/chat UX now matches the Merge runtime story: compact durable banner, exact blocker text, and action controls backed by real task routes."
  - "Web preview state survives refresh or reconnect by combining task-backed runtime fallback with live preview polling only while the runtime is active."
requirements-completed: [PREVIEW-03, PREVIEW-04]
completed: 2026-03-08
---

# Phase 4 Plan 03 Summary

**Preview web parity: durable banner, durable controls, reconnect-safe state**

## Accomplishments
- Replaced SessionChat's local Preview event truth with durable task-backed runtime state, then fed a compact status banner into HappyThread with ready URL, retry count, blocker summary, and stop or retry semantics.
- Added reusable `useTaskPreview` and `useTaskPreviewState` hooks so Preview task actions update task caches, preview query caches, and SSE invalidation consistently with the hub contract.
- Kept live preview logs secondary: command plus log tail only render when useful, while durable runtime text remains the primary explanation after refresh or reconnect.
- Added focused web tests for preview mutation cache updates and preview-state rehydration fallback so the new runtime contract is covered in automation.

## Files Created/Modified
- `web/src/components/SessionChat.tsx` - wires durable Preview action labels, retry or cancel behavior, banner summary, and log-panel inputs from task/runtime state.
- `web/src/components/AssistantChat/HappyThread.tsx` - renders durable merge and preview banners plus optional Preview URL and log output.
- `web/src/hooks/mutations/useTaskPreview.ts` - adds cache-aware Preview start/stop mutations.
- `web/src/hooks/queries/useTaskPreviewState.ts` - adds task-backed live Preview query with active-state polling and durable runtime fallback.
- `web/src/hooks/useSSE.ts` - invalidates Preview query cache on task events.
- `web/src/hooks/mutations/useTaskPreview.test.tsx` - covers preview mutation cache updates.
- `web/src/hooks/queries/useTaskPreviewState.test.tsx` - covers inactive-session fallback and active-session live rehydration.
- `.planning/phases/04-preview-action-parity/04-03-SUMMARY.md` - records Plan 04-03 outcomes and validation.

## Decisions Made
- Keep Preview start available even when the linked session is busy, because the hub now queues the direct attempt durably instead of forcing extra chat overhead.
- Show durable runtime summary first and keep raw log tail secondary so blocked or ready state remains understandable after reload.
- Validate rehydration at the hook layer now; keep a real browser smoke pass as a final product-feel companion, not the only safeguard.

## Validation
- `bun run typecheck:web` ✓
- `bun run test:web` ✓

## Next Phase Readiness
- Phase 4 is complete. Phase 5 can now reuse the same action-runtime product story for Init: direct tool call first, transcript-visible failures, durable runtime state, and cache/SSE-backed web controls.

---
*Phase: 04-preview-action-parity*
*Completed: 2026-03-08*
