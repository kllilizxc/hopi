# 01-02 Summary

Status: complete
Date: 2026-03-29

## Delivered

- Added `OMC-client/` as a second real frontend package in the Bun workspace.
- Wired root scripts for `build:omc`, `dev:omc`, and `typecheck:omc`.
- Added `/omc` serving in hub while preserving the existing session app at `/`.
- Extended embedded web asset generation to package both `web/dist` and `OMC-client/dist`.
- Built the first OMC board with phase grouping and `1 card = 1 PLAN.md`.

## Verification

- `bun run typecheck:omc`
- `bun run build:omc`
- `bun run build:hub`

## Notes

- Added a dev stub for `hub/src/web/embeddedAssets.generated.ts` so normal hub builds do not depend on a pre-generated asset manifest.
- OMC router now honors a production `basepath` so `/omc/programs/...` works on refresh.
