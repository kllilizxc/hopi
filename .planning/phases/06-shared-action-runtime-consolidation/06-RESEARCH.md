# Phase 6: Shared Action Runtime Consolidation - Research

**Researched:** 2026-03-09
**Domain:** Brownfield runtime consolidation across Merge, Preview, and Init after Phase 4/5 parity work
**Confidence:** HIGH for repo-grounded duplication points, plan slicing, and validation layers; MEDIUM for the exact shared helper boundaries inside hub route/service code

<research_summary>
## Summary

HOPI now has the right product behavior in three places, but not one shared runtime implementation. Merge, Preview, and Init all follow the intended story — direct repo-owned attempt first, transcript-visible CLI-style result, repair only after failure, durable task-backed status, and queue/retry/blocker handling — yet the code still implements that story through parallel action-specific contracts.

The duplication is now visible across all three layers:

1. **Shared/schema** — three near-parallel runtime types in `shared/src/schemas.ts`
2. **Hub/orchestration** — Merge/Preview logic concentrated in `hub/src/web/routes/tasks.ts`, Init logic concentrated in `hub/src/sync/taskSessionService.ts`
3. **Web/presentation** — partly unified status-card chrome, but separate summary builders, mutation cache updaters, and control semantics

That means Phase 6 should **consolidate the shared runtime envelope and product grammar without making the product feel generic to users**. Best brownfield sequence:

1. unify the runtime contract and persistence helpers,
2. normalize shared transcript/queueing/control semantics behind action-specific adapters,
3. clean the extension seams and docs so future repo-defined actions can plug into the same envelope later.

The key constraint from context remains: **generic mostly internal, action-specific user-facing**.
</research_summary>

<repo_findings>
## Repo Findings

### Shared contracts are obviously parallel now
- `shared/src/schemas.ts` defines `TaskMergeRuntimeSchema`, `TaskPreviewRuntimeSchema`, and `TaskInitRuntimeSchema` with the same envelope fields: `sessionId`, timestamps, `retryCount`, `failureFingerprint`, `latestNote`, `blockedReason`.
- The main divergence is status vocabulary: Merge has `queued|waiting|approval_pending|running|retrying|blocked|succeeded|canceled`; Preview adds `ready|stopped`; Init currently only has `running|waiting|retrying|blocked|succeeded`.
- This is a strong signal to introduce a shared base/runtime vocabulary plus action-specific terminal states instead of preserving three nearly identical schemas forever.

### Store and relink logic already hint at a reusable runtime base
- `hub/src/store/tasks.ts` already normalizes all three runtimes separately via `normalizeTaskMergeRuntime()`, `normalizeTaskPreviewRuntime()`, and `normalizeTaskInitRuntime()`.
- `hub/src/sync/sessionTaskLink.ts` already has the exact same relink pattern for all three via `syncTaskMergeRuntimeSession()`, `syncTaskPreviewRuntimeSession()`, and `syncTaskInitRuntimeSession()`.
- This means Phase 6 does not need to invent new persistence behavior; it needs to factor duplicated behavior into shared helpers while preserving brownfield task storage semantics.

### Hub orchestration is the biggest consolidation gap
- Merge and Preview runtime builders, updater helpers, queue/block logic, and route orchestration are still concentrated in `hub/src/web/routes/tasks.ts`.
- Init runtime builders and retry/blocker helpers live in `hub/src/sync/taskSessionService.ts`.
- Script command/report builders are parallel: Merge/Preview build command-report lines and transcript/result messages in `tasks.ts`; Init has matching builders in `taskSessionService.ts`.
- Runnable gating is parallel too: Preview and Merge wait for idle/approval resolution in route-local flows; Init uses `waitForSessionToBecomeInitRunnable()` in the service layer.
- The repo now needs one shared action-runtime helper layer inside hub so route vs service placement stops deciding behavior.

### Web UI is already half-way to the desired end state
- `web/src/components/AssistantChat/HappyThread.tsx` already uses one `StatusCard` chrome for init, merge, and preview summaries.
- `web/src/components/SessionChat.tsx` still computes Merge and Preview summaries locally while Init summary lives in `web/src/lib/task-init-runtime.ts`.
- Mutation hooks still duplicate the same cache-update pattern: `useMergeTaskWorktree.ts`, `useTaskPreview.ts`, and `useStartTaskSession.ts` each patch task/task-list/session caches in parallel ways.
- This means Phase 6 can consolidate user-facing product grammar without a risky redesign: reuse the existing shared chrome and unify builders/control adapters underneath.

### Queueing and busy-session semantics are close, but not normalized
- Merge already exposes queue, approval-pending, running, retry, blocked, cancel, and success semantics.
- Preview mirrors most of that and adds `ready` / `stopped` behavior.
- Init now has waiting/retrying/blocked/succeeded semantics in the started session, but not the same queue/cancel-oriented vocabulary or shared helper path.
- Requirement `ACTION-06` points directly at this gap: the first direct run should defer visibly and auto-run later, consistently, regardless of action.

### Transcript grammar is similar enough to standardize now
- Merge, Preview, and Init all now append compact CLI-style result summaries with command/output context before repair prompts.
- The differences are mostly helper location and exact wording, not product intent.
- This is the right moment to create one shared transcript builder grammar instead of letting small message differences calcify into three separate action dialects.
</repo_findings>

<architecture_recommendation>
## Architecture Recommendation

### Recommended consolidation model
Use a **shared base runtime envelope with action-specific adapters**, not a fully generic user-facing action system.

Concretely:
- One shared internal runtime model for core lifecycle fields and core statuses
- One per-action mapping layer for extra terminal states and UI wording
- One shared hub helper layer for:
  - direct-attempt/result message formatting
  - queue/runnable gating
  - blocker note + failure fingerprint handling
  - durable runtime update helpers
- One shared web helper layer for:
  - status summary shape
  - task cache patching patterns
  - task/thread control-surface plumbing

### Best internal shape
The repo is ready for a shared **base + action-specific status extension** model, not necessarily a single flat enum forced on all actions.

Recommended approach:
- Shared base statuses for the common lifecycle: `queued`, `approval_pending`, `running`, `waiting`, `retrying`, `blocked`, `succeeded`, `canceled`
- Action-specific terminal/derived states layered on top where needed:
  - Preview can keep `ready` and `stopped`
  - Init can omit cancel if it remains semantically meaningless
  - Merge can keep repo-truth-specific success semantics under the same envelope

This matches the context decision: same core story, action-specific end states allowed.

### Best hub factoring path
Do **not** attempt one huge route/service rewrite in a single step.

Safer factoring path:
1. extract shared runtime types/builders/update helpers,
2. extract shared transcript/result/blocker/queue helpers,
3. move Merge/Preview/Init callers onto those helpers while preserving action-specific adapters.

That sequencing reduces risk because behavior stays stable while duplication is removed incrementally.

### Best web factoring path
Use the current `StatusCard` as the stable UI anchor and unify around it.

Safer web path:
- shared status-summary helper model
- action-specific summary adapters where needed
- shared task-cache update primitives for action mutations
- control-surface normalization in `SessionChat` / task workbench without introducing generic “Action” labeling

### What not to do
- Do not introduce a full repo-defined action manifest/product surface now.
- Do not force the same visible state labels everywhere if they reduce clarity.
- Do not make the shared model so abstract that action-specific behavior becomes harder to reason about than today's code.
</architecture_recommendation>

<plan_recommendation>
## Recommended 3-Plan Split

### Plan 06-01 — Consolidate shared action runtime contracts and persisted state across hub/web/shared
Focus: shared base runtime contract, status vocabulary alignment, persistence/relink/update helpers, and typed API surface normalization.

Why first:
- Everything else depends on one stable shared envelope.
- The repo already has enough duplication in schema/store/runtime updater code to justify this as the first seam.

Primary targets:
- `shared/src/schemas.ts`
- `shared/src/types.ts`
- `hub/src/store/tasks.ts`
- `hub/src/store/types.ts`
- `hub/src/sync/sessionTaskLink.ts`
- `hub/src/web/routes/tasks.ts`
- `hub/src/sync/taskSessionService.ts`
- `web/src/types/api.ts`

### Plan 06-02 — Normalize task/thread control surfaces for cancel, retry, and blocker summaries
Focus: shared transcript/result grammar, shared runnable/queueing helpers, consistent blocker/manual-step handling, and shared web status/control logic.

Why second:
- Once the shared runtime envelope exists, the next risk is behavioral drift in the actual product story.
- `ACTION-05` and `ACTION-06` are mostly about shared grammar and queue/control behavior, not just types.

Primary targets:
- `hub/src/web/routes/tasks.ts`
- `hub/src/sync/taskSessionService.ts`
- `hub/src/sync/projectScripts.ts`
- `hub/src/sync/autoRunScheduler.ts`
- `web/src/components/SessionChat.tsx`
- `web/src/components/AssistantChat/HappyThread.tsx`
- `web/src/hooks/mutations/useMergeTaskWorktree.ts`
- `web/src/hooks/mutations/useTaskPreview.ts`
- `web/src/hooks/mutations/useStartTaskSession.ts`

### Plan 06-03 — Clean extension seams and docs for future repo-defined actions without shipping the generic framework yet
Focus: extension-facing helper seams, docs, naming cleanup, dead-duplication removal, and validation/docs to make future custom actions feasible.

Why third:
- Extension seams should sit on top of the final consolidated runtime, not precede it.
- This plan can reduce technical debt and leave a clear runway for future `ACTION-07` without expanding milestone scope.

Primary targets:
- shared/hub/web runtime helper modules introduced in 06-01/06-02
- `.planning` docs / summaries
- inline runtime documentation/comments only where needed for maintainability
- maybe `hub/src/sync/projectScripts.ts` and adjacent helper seams for future action reuse
</plan_recommendation>

<validation_architecture>
## Validation Architecture

### Test Infrastructure
- Existing framework already covers the phase well: Bun/Vitest across hub/web, strict TypeScript across shared/hub/web.
- Fast validation commands already exist:
  - `bun run test:hub`
  - `bun run typecheck:hub`
  - `bun run typecheck:web`
  - `bun run test:web`
- No Wave 0 test-framework setup required.

### What needs verification
- Shared runtime contract changes do not regress Merge, Preview, or Init semantics.
- Runtime session relink/persistence still works for all three actions after consolidation.
- Transcript-visible direct result messages remain action-first and consistent across actions.
- Busy-session deferral and auto-run semantics remain consistent across Merge, Preview, and Init.
- Web summaries and mutation cache updates remain durable across refresh/re-entry without exposing a generic action UI.

### Best validation layers
- **Schema/store tests** for shared runtime contract, per-action status allowances, and relink normalization.
- **Hub route/service tests** for Merge/Preview/Init behavior parity after helper extraction.
- **Focused web hook/component tests** for shared cache-update helpers and shared summary/control grammar.
- **Manual companion checks** for product feel: action labels stay specific, queueing remains visible, and transcript wording stays compact.

### Suggested phase gate
Use the full milestone gate for every plan wave touching shared helpers:
- `bun run test:hub && bun run typecheck:hub && bun run typecheck:web`
- Add `bun run test:web` whenever a plan changes web summaries, mutation hooks, or task/chat controls.

### Recommended validation split by plan
- **06-01:** emphasize typecheck + store/hub tests on runtime contract/persistence changes.
- **06-02:** emphasize hub tests plus web tests on transcript grammar, queueing, blocker notes, and shared controls.
- **06-03:** full suite plus a short manual regression checklist for action-specific labeling and future-extension seams.

### Avoid in this phase
- Heavy browser E2E coverage before helper extraction stabilizes.
- Expanding validation to hypothetical future custom actions not shipped in this phase.
</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: Over-generalizing the runtime too early
If Phase 6 exposes a generic user-facing action model now, it will conflict with the context decision to keep actions human and specific.

### Pitfall 2: Unifying types without unifying behavior
A shared schema alone will not satisfy `ACTION-05`/`ACTION-06` if transcript wording and queueing behavior still drift per action.

### Pitfall 3: Forcing identical visible states
Preview `ready`/`stopped` and action-specific success wording are useful; removing them for theoretical purity would hurt UX.

### Pitfall 4: Large-bang refactor across route and service layers
Merge/Preview and Init currently live in different hub seams. Replacing both at once would be high-risk unless helper extraction is incremental.

### Pitfall 5: Leaving web duplication untouched
If hub gets consolidated but web summaries/cache helpers remain parallel, the next action added later will still re-copy the same product logic.

### Pitfall 6: Extension seams that leak product scope
Future custom action support should emerge as internal seams and docs, not as a half-shipped generic framework in this milestone.
</risks>

<sources>
## Sources

### Primary
- `shared/src/schemas.ts`
- `shared/src/types.ts`
- `hub/src/store/tasks.ts`
- `hub/src/store/types.ts`
- `hub/src/sync/sessionTaskLink.ts`
- `hub/src/web/routes/tasks.ts`
- `hub/src/sync/taskSessionService.ts`
- `hub/src/sync/projectScripts.ts`
- `hub/src/sync/autoRunScheduler.ts`
- `web/src/components/SessionChat.tsx`
- `web/src/components/AssistantChat/HappyThread.tsx`
- `web/src/hooks/mutations/useMergeTaskWorktree.ts`
- `web/src/hooks/mutations/useTaskPreview.ts`
- `web/src/hooks/mutations/useStartTaskSession.ts`
- `.planning/phases/05-init-action-parity/05-01-SUMMARY.md`
- `.planning/phases/05-init-action-parity/05-02-SUMMARY.md`
- `.planning/phases/05-init-action-parity/05-03-SUMMARY.md`
- `.planning/phases/06-shared-action-runtime-consolidation/06-CONTEXT.md`

### Notes
- Existing repo context is sufficient; no extra discuss-phase is needed before planning.
- The best brownfield plan is helper extraction + alignment, not a new framework.
</sources>

## Post-Execution Notes

Phase 6 execution landed the recommended helper split without shipping a generic user-facing action framework:

- `hub/src/utils/taskActionRuntime.ts` owns the shared durable runtime envelope adapters.
- `hub/src/utils/taskActionFlow.ts` owns shared runnable-gate polling, repeated-blocker phrasing, and command-report formatting.
- `web/src/lib/task-action-runtime.ts` owns shared status-summary grammar and runtime equality checks.
- `web/src/hooks/mutations/taskActionCache.ts` owns shared task/session cache patch + invalidation behavior.

User-facing action labels stay specific (`Merge`, `Preview`, `Init`) while the shared runtime/copy/cache seams are now internal and reusable.
