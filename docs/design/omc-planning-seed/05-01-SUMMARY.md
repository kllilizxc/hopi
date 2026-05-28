# 05-01 Summary

Status: complete
Date: 2026-03-30

## Delivered

- Added program-level guided-planning runtime contracts in [schemas.ts](/Users/realizer/Code/hopi/shared/src/schemas.ts) and [types.ts](/Users/realizer/Code/hopi/shared/src/types.ts), including brief payloads, run lifecycle state, and read/control response shapes.
- Extended the OMC SQLite/store layer with durable `omc_planning_runs` persistence in [index.ts](/Users/realizer/Code/hopi/hub/src/store/index.ts), [types.ts](/Users/realizer/Code/hopi/hub/src/store/types.ts), and [runtimeStore.ts](/Users/realizer/Code/hopi/hub/src/sync/omc/runtimeStore.ts).
- Added the new realtime event contract and builder for program-scoped guided-planning updates in [schemas.ts](/Users/realizer/Code/hopi/shared/src/schemas.ts), [events.ts](/Users/realizer/Code/hopi/hub/src/sync/omc/events.ts), and [sseManager.ts](/Users/realizer/Code/hopi/hub/src/sse/sseManager.ts).
- Exposed a read-side guided-planning state route at [omc.ts](/Users/realizer/Code/hopi/hub/src/web/routes/omc.ts) so OMC can read current planning-run state instead of inferring everything from missing plan cards.
- Added focused route coverage for the new read surface in [omc.test.ts](/Users/realizer/Code/hopi/hub/src/web/routes/omc.test.ts).

## Verification

- `bun run typecheck`
- `bun run typecheck:hub`
- `bun test hub/src/web/routes/omc.test.ts`

## Deviations from Plan

None.

## Notes

- Guided planning is now a first-class `Program` runtime with its own DB table and SSE event type, instead of faking a `planKey` before any real plan cards exist.

## Self-Check

- PASSED: guided planning has a canonical runtime contract before orchestration/UI work.
- PASSED: OMC can read current guided-planning state directly from the backend.
