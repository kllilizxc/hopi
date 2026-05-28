# Coding Conventions

**Analysis Date:** 2026-03-29

Repo-wide style is mostly conventional TypeScript by example. Follow the local package’s existing file when in doubt.

## Naming Patterns

**Files:**
- Colocated test files use `*.test.ts` / `*.test.tsx`: `cli/src/modules/ripgrep/index.test.ts`, `hub/src/store/schemaMigration.test.ts`, `web/src/components/LoginPrompt.test.tsx`
- Most source files use lower camel case or descriptive PascalCase where the file is a React component: `hub/src/sync/syncEngine.ts`, `web/src/components/SessionChat.tsx`
- `index.ts` files are used as entrypoints or barrels: `shared/src/index.ts`, `hub/src/store/index.ts`, `cli/src/index.ts`
- `__tests__/` exists in a few spots, but is not the default pattern: `cli/src/codex/__tests__/emitReadyIfIdle.test.ts`

**Functions:**
- camelCase for helpers and business logic: `normalizeOrigins` in `hub/src/index.ts`, `createTempDir` in `cli/src/modules/common/handlers/files.test.ts`
- React components are PascalCase function components: `web/src/router.tsx`, `web/src/components/LoginPrompt.test.tsx`
- Async functions do not use a special prefix; `async` + explicit `Promise<...>` is common

**Variables:**
- camelCase locals and parameters
- `const` is preferred; `let` is used only when reassignment is necessary
- Uppercase env/constants are common for shared product values: `PRODUCT_NAME`, `PRODUCT_ENV` in `shared/src/brand.ts`

**Types:**
- PascalCase for type aliases and inferred Zod types: `Session`, `Project`, `TaskStatus`
- `type` aliases are common; `interface` appears for some local test/helper shapes
- Type-only imports/exports are used where convenient: `shared/src/index.ts`, `hub/src/index.ts`

## Code Style

**Formatting:**
- 4-space indentation is the dominant style in `cli/`, `hub/`, `shared/`, and `web/`
- Single quotes are common in TS/TSX
- Semicolons are usually omitted in source, but a few legacy files/tests still include them
- Trailing commas are common in multiline arrays, objects, and config

**Tooling:**
- Strict TypeScript is enforced from `tsconfig.base.json` with `strict`, `noImplicitAny`, and `noImplicitReturns`
- No repo-wide ESLint or Prettier config was found in the root tree; style is mostly enforced by TypeScript + local conventions
- `website/.prettierrc` exists for the marketing site only

## Import Organization

**Order:**
1. External packages
2. Workspace packages such as `@hopi/protocol/*`
3. Internal alias imports like `@/` in `cli/` and `web/`
4. Relative imports
5. Type-only imports mixed in where useful

**Path Aliases:**
- `@/* -> ./src/*` is configured per package in `cli/tsconfig.json`, `hub/tsconfig.json`, `shared/tsconfig.json`, and `web/tsconfig.json`
- `web/vite.config.ts` and `cli/vitest.config.ts` also preserve the alias at runtime/test time

## Error Handling

**Patterns:**
- Guard clauses and early returns are common in boundary code
- Invalid input is usually rejected with thrown errors or normalized failure objects at the API boundary
- CLI RPC handlers often return `{ success: false, error }` instead of throwing through the transport layer
- Test code intentionally exercises both success paths and invalid-input rejection paths

**Boundary behavior:**
- Hub startup validates configuration then logs the resolved source and value in `hub/src/index.ts`
- CLI/web handlers often wrap external calls with try/catch and then rethrow or convert to a user-facing error

## Logging

**CLI:**
- The CLI uses a dedicated logger in `cli/src/ui/logger.ts`
- Debug logs are written to files; interactive console output is reserved for user-facing messages
- Many CLI modules log with `logger.debug(...)` / `logger.warn(...)`

**Hub/Web:**
- Hub startup uses `console.log(...)` for configuration and service status in `hub/src/index.ts`
- Web code uses `console.log`, `console.warn`, and `console.error` for runtime visibility in areas like voice and service-worker setup

## Comments

- File headers and module notes appear on major entrypoints and complex utilities: `hub/src/index.ts`, `cli/src/ui/logger.ts`
- Comments are mostly used to explain why a workaround exists, not to restate code
- Test files sometimes include brief setup comments, but not heavy narration

## Function Design

- Small helper functions are preferred for normalization, parsing, and boundary conversion
- Functions often accept an options object once parameters start to grow
- Early returns are used to keep control flow flat
- Async functions are typically explicit about return types when the signature is non-trivial

## Module Design

- Named exports are preferred for domain logic
- Default exports are common for config files, some React route modules, and setup helpers
- Public package surfaces are exposed through `index.ts` barrels, especially in `shared/src/index.ts`
- Package responsibilities are kept separate: CLI in `cli/`, HTTP/realtime server in `hub/`, UI in `web/`, shared schemas/types in `shared/`

*Convention analysis: 2026-03-29*
*Update when patterns change*
