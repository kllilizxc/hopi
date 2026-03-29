# Codebase Concerns

**Analysis Date:** 2026-03-29

## Tech Debt

**Project/task automation stack spread across many packages:**
- Issue: The new projects workflow is implemented across `hub/src/sync/taskAutomation.ts`, `hub/src/sync/taskSessionService.ts`, `hub/src/sync/setupWorkflowRunner.ts`, `hub/src/sync/projectAutomationReadiness.ts`, `hub/src/sync/workflowStrategy.ts`, `cli/src/runner/actionContract.ts`, `cli/src/runner/previewManager.ts`, and `web/src/routes/projects/task-workbench.tsx`.
- Why: The feature landed incrementally, with the hub, runner, and web UI each carrying part of the contract and state machine.
- Impact: Contract drift is easy. Small shape changes in task status, workflow phase, or preview readiness can break one layer while the others still compile.
- Fix approach: Consolidate shared automation/runtime types in `shared/src/` and add cross-package tests for task start, preview readiness, and workflow transitions.

**SQLite schema and JSON runtime state remain concentrated in store code:**
- Issue: Task and project persistence is still centered in `hub/src/store/index.ts`, `hub/src/store/tasks.ts`, `hub/src/store/projectStore.ts`, and `hub/src/store/schemaMigration.test.ts`.
- Why: SQLite keeps the deployment simple and the codebase has favored in-place schema evolution over a separate migration system.
- Impact: The current task runtime fields (`merge_runtime`, `preview_runtime`, `init_runtime`) and project automation fields are easy to evolve inconsistently, especially while the worktree is already dirty with automation changes.
- Fix approach: Keep adding versioned migration coverage, but move schema-shape invariants and runtime payload normalization into shared helpers so new fields do not need ad hoc fixes in multiple store files.

## Security Considerations

**Manifest-driven shell execution has a wide trust boundary:**
- Risk: `hub/src/sync/setupWorkflowRunner.ts` and `cli/src/runner/previewManager.ts` execute commands declared in `.hopi/actions.yaml`, and `previewManager.ts` passes through `process.env` into child services.
- Current mitigation: Both sides validate the contract first through `hub/src/sync/actionContract.ts` and `cli/src/runner/actionContract.ts`, and execution is limited to local project paths / the selected machine.
- Recommendations: Treat project manifests as trusted code, document that boundary explicitly, and consider an allowlist for exported env vars so preview services do not inherit unnecessary host secrets.

**Automation verification writes readiness state back to the database immediately:**
- Risk: `hub/src/sync/projectAutomationReadiness.ts` persists readiness status and summaries after every check, including transient machine-offline or file-read failures.
- Current mitigation: The report records the failing check and keeps the last computed summary in the project row.
- Recommendations: Add a TTL or last-success marker so temporary machine failures do not look like durable project misconfiguration.

## Performance Bottlenecks

**Carryover history reconstruction is linear in session history:**
- Problem: `hub/src/sync/taskSessionService.ts` pages through old messages 200 at a time when rebuilding carryover context for a new session.
- Measurement: Not benchmarked here.
- Cause: The carryover path reconstructs history from persisted messages instead of storing a precomputed summary.
- Improvement path: Cap carryover depth, cache a summarized transcript, or persist a dedicated carryover payload per task/session.

**Preview startup does sequential port probing and per-service process setup:**
- Problem: `cli/src/runner/previewManager.ts` scans for a free port and prepares services one by one before the preview stack is ready.
- Measurement: Not benchmarked here.
- Cause: Safety-first startup logic and dependency ordering between preview services.
- Improvement path: Reserve ports earlier, parallelize independent readiness checks, and surface per-service timing so slow startups are visible.

## Fragile Areas

**Message heuristics drive task state transitions:**
- Why fragile: `hub/src/sync/taskAutomation.ts` distinguishes task prompts from internal automation using `localId` prefixes, `sentFrom`, and wrapped message envelope shapes.
- Common failures: Renaming local ID prefixes, changing message serializers, or adjusting agent envelope formats can silently stop task status transitions from firing.
- Safe modification: Update the serializer and the automation heuristics together, then extend `hub/src/sync/taskAutomation.test.ts` with the new envelope shapes before shipping.
- Test coverage: Good unit coverage for the common cases, but not for every new message shape the agents can emit.

**Workflow strategy fallback is string-keyed and silent:**
- Why fragile: `hub/src/sync/workflowStrategy.ts` normalizes workflow profiles to strings and falls back to the default strategy when a profile is unknown.
- Common failures: A typo or missing registry entry changes task behavior without a hard failure.
- Safe modification: Validate workflow profiles when tasks are created or edited, and add explicit tests for each new strategy id.
- Test coverage: There are tests for the known strategies, but not for invalid or newly introduced profile names.

**Project automation UI depends on a large, changing state surface:**
- Why fragile: `web/src/routes/projects/task-workbench.tsx` binds together task data, workflow profile, workspace selection, sessions, previews, diffs, and merge controls.
- Common failures: A backend payload change can cascade into disabled buttons, stale readiness state, or incorrect default permission/model choices.
- Safe modification: Keep route-level state changes small, prefer targeted query invalidation, and add regression tests around the specific action being changed.
- Test coverage: Route and hook tests exist, but there is still no full browser-level smoke path for refresh/reconnect behavior across hub and CLI.

## Missing Critical Features

**No full end-to-end smoke for the projects automation path:**
- Problem: Current coverage is mostly unit and route-level tests such as `hub/src/web/routes/projects.automation-readiness.test.ts`, `hub/src/sync/taskSessionService.test.ts`, `cli/src/runner/previewManager.test.ts`, and `web/src/routes/projects/kanban-new-task-dialog.test.tsx`.
- Current workaround: Manual verification in the browser and runner logs.
- Blocks: Regressions in task launch, preview startup, merge flow, or reconnect handling can still ship without a multi-process smoke test.
- Implementation complexity: High. This likely needs a harness that exercises hub, CLI, and web together.

## Test Coverage Gaps

**Fault injection for setup/preview failures is thin:**
- What's not tested: Partial setup-step failure, port exhaustion, runaway preview child processes, and shell-command failures in `hub/src/sync/setupWorkflowRunner.ts` and `cli/src/runner/previewManager.ts`.
- Risk: Error summaries can be misleading, and cleanup bugs can leave processes behind on real workspaces.
- Priority: High
- Difficulty to test: Medium. These paths need temp dirs plus synthetic child-process failures.

**Store migration coverage still tracks selected snapshots, not the full current shape:**
- What's not tested: All migration branches for the newer task/project automation columns and JSON runtime payloads in `hub/src/store/schemaMigration.test.ts`.
- Risk: A future schema bump can break older databases or silently drop runtime data.
- Priority: Medium
- Difficulty to test: Medium. Requires fixture databases and explicit assertions on post-migration task/project rows.

---

*Concerns audit: 2026-03-29*
*Update as issues are fixed or new ones discovered*
