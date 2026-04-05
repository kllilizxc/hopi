# 04-01 Summary

Status: complete
Date: 2026-03-30

## Delivered

- Added explicit OMC attach/bootstrap contracts in [shared/src/schemas.ts](/Users/realizer/Code/hopi/shared/src/schemas.ts) and [shared/src/types.ts](/Users/realizer/Code/hopi/shared/src/types.ts) for `attach-local-repo`, `attach-planning-root`, `create-planning-seed`, and the shared planning-state payload used by both backend and client.
- Added [programBootstrap.ts](/Users/realizer/Code/hopi/hub/src/sync/omc/programBootstrap.ts) to validate absolute local git repos, reject duplicate repo attachment within a namespace, inspect planning roots, generate stable program ids, and write the minimal repo-local `.planning/*` scaffold for Phase 4.
- Extended [programPaths.ts](/Users/realizer/Code/hopi/hub/src/sync/omc/programPaths.ts) with explicit repo-local planning-root helpers so attach flows fall back to the attached repo’s own `.planning` instead of ambient sibling paths when planning is missing.
- Added backend OMC routes in [omc.ts](/Users/realizer/Code/hopi/hub/src/web/routes/omc.ts) for attaching a local repo, attaching an explicit planning root, and creating a planning seed, while keeping the existing default-program fallback for the hub repo.
- Extended [omc.test.ts](/Users/realizer/Code/hopi/hub/src/web/routes/omc.test.ts) with focused temp-fixture coverage for valid attach, invalid attach, planning-root attach, and repo-local seed creation.

## Verification

- `bun test hub/src/web/routes/omc.test.ts`
- `bun run typecheck:hub`
- `bun run typecheck`

## Deviations from Plan

None.

## Notes

- Attach-local-repo now prefers the attached repo’s own `.planning` when automatic resolver candidates do not contain a real planning tree. This keeps flows like `/Users/realizer/Code/PersonalQuant` from accidentally binding to unrelated sibling `.planning` directories.

## Self-Check

- PASSED: OMC can persist a new program whose `repoRoot` is not the hub repo.
- PASSED: OMC can create a minimal repo-local planning seed and expose its file list through the response contract.
