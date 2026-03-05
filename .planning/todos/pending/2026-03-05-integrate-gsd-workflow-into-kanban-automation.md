---
created: 2026-03-05T14:48:55.068Z
title: Integrate GSD workflow into Kanban automation
area: planning
files:
  - shared/src/schemas.ts:155
  - shared/src/schemas.ts:231
  - hub/src/sync/autoRunScheduler.ts:12
  - hub/src/sync/taskAutomation.ts:87
  - hub/src/sync/taskSessionService.ts:432
  - web/src/routes/projects/project-settings.tsx:91
  - web/src/routes/projects/task-workbench.tsx:439
---

## Problem

Current Kanban automation assumes a single status flow (`planned -> in_progress -> in_review -> finished`) and starts execution as soon as a task is picked from `planned`. GSD introduces additional pre-execution steps (`discuss`, `plan`) that can conflict with this auto-run behavior. Without an explicit sub-state model, GSD command prompts can incorrectly trigger task execution transitions and cause automation drift.

## Solution

Add a lightweight workflow layer compatible with existing status automation:
- Keep current Kanban primary statuses unchanged.
- Add `workflowProfile` (project) and `workflowPhase` (task) to represent GSD sub-steps.
- Gate auto-run for GSD tasks so only `workflowPhase=execute_ready` is eligible from `planned`.
- Exclude `auto:workflow:*` messages from progress-trigger logic in task automation.
- Add minimal web controls to move GSD phases without creating a second board/state machine.
