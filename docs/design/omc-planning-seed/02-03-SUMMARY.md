# 02-03 Summary

Status: complete with one known non-OMC hub test baseline
Date: 2026-03-30

## Delivered

- Added OMC live updates through [`useOmcEvents`](/Users/realizer/Code/hopi/OMC-client/src/hooks/useOmcEvents.ts), driven by OMC sync events instead of mutation-only refreshes.
- Expanded the OMC API client with retry, resume, takeover, cancel, and SSE URL helpers.
- Reworked [`plan.tsx`](/Users/realizer/Code/hopi/OMC-client/src/routes/programs/plan.tsx) into an execution-first control surface with `Start plan`, `Resume loop`, `Retry`, `Take over`, `Cancel`, and `Open session`.
- Expanded [`AttemptInspector.tsx`](/Users/realizer/Code/hopi/OMC-client/src/components/AttemptInspector.tsx) with termination reason, retry memory, changed files, diff summary, and richer evidence display.
- Enriched board cards with loop status, review badges, failure counters, and latest evidence signals without adding new top-level columns.
- Regenerated [`embeddedAssets.generated.ts`](/Users/realizer/Code/hopi/hub/src/web/embeddedAssets.generated.ts) so the hub serves the latest `/omc` build correctly.

## Verification

- `bun run typecheck:omc`
- `bun run build:omc`
- `bun run typecheck:hub`
- `bun run build:hub`
- `cd hub && bun test src/web/routes/omc.test.ts src/sync/omc/attemptOutcome.test.ts src/sync/omc/runtimeAdapter.test.ts src/sync/omc/loopController.test.ts`

## Known baseline outside OMC

- `bun run test:hub` now fails only in the same pre-existing `hub/src/web/routes/tasks.start-session.test.ts` coverage area.
- OMC-specific route and sync tests pass.
