# 02-01 Summary

Status: complete
Date: 2026-03-30

## Delivered

- Added an OMC-owned runtime adapter seam with [`OmcAttemptRuntimeAdapter`](/Users/realizer/Code/hopi/hub/src/sync/omc/runtimeAdapter.ts) and a first [`CodexAttemptRuntimeAdapter`](/Users/realizer/Code/hopi/hub/src/sync/omc/runtimeAdapter.ts).
- Added normalized attempt outcome parsing in [`parseOmcAttemptOutcome`](/Users/realizer/Code/hopi/hub/src/sync/omc/attemptOutcome.ts) plus system fallback outcome builders.
- Added [`OmcLoopAutomation`](/Users/realizer/Code/hopi/hub/src/sync/omc/loopAutomation.ts) on the hub event bus so OMC reacts to `message-received`, `session-updated`, `session-removed`, and `machine-updated`.
- Extended OMC attempt/runtime schemas, store persistence, and sync events with `terminationReason`, previous-attempt retry memory, and `omc-attempt-updated`.
- Reworked [`startOmcPlanAttempt`](/Users/realizer/Code/hopi/hub/src/sync/omc/attemptRunner.ts) into a thin launch layer that uses the adapter seam and returns structured dispatch-failure results.

## Verification

- `bun run typecheck:hub`
- `cd hub && bun test src/sync/omc/attemptOutcome.test.ts src/sync/omc/runtimeAdapter.test.ts`

## Notes

- Prompt-dispatch failures are now normalized into the same OMC outcome path instead of being a route-local dead end.
- OMC completion parsing stays agent-agnostic at the orchestration layer; only the adapter knows how a runtime starts or resumes sessions.
