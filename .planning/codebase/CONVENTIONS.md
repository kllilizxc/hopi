# Coding Conventions

**Analysis Date:** 2026-03-07

Repo-wide conventions; per-package deviations exist. Rule of thumb: follow the style of the file/package you’re editing; if unsure, prefer the 4-space / single-quote / no-semicolon style common in `hub/`, `shared/`, `web/`.

## Naming Patterns

**Files:**
- `camelCase.ts` for most modules: `hub/src/notifications/notificationHub.ts`, `cli/src/commands/runCli.ts`, `shared/src/sessionSummary.ts`
- `PascalCase.tsx` for React components: `web/src/App.tsx`, `web/src/components/app/AppThemeProvider.tsx`
- `index.ts` barrel/entry exports common: `shared/src/index.ts`, `hub/src/store/index.ts`, `cli/src/modules/ripgrep/index.ts`
- Tests: `*.test.ts` / `*.test.tsx` colocated with code: `hub/src/store/tasks.test.ts`, `cli/src/modules/common/handlers/git.test.ts`, `web/src/lib/taskMerge.test.ts`
- Exception pattern: `__tests__` folder used in places: `cli/src/codex/__tests__/emitReadyIfIdle.test.ts`

**Functions:**
- `camelCase` helpers + business functions: `cli/src/commands/runCli.ts` (`parseBooleanFlag`, `stripStrictWorkspaceWritesFlag`)
- React components as `PascalCase` functions, usually named exports: `web/src/components/app/AppThemeProvider.tsx`
- Async: no naming prefix; `async` keyword + `Promise<...>` return type when helpful (`cli/src/index.ts`, `cli/src/modules/common/handlers/git.test.ts`)

**Variables:**
- Locals: `camelCase`; `const` by default, `let` when reassignment needed (`hub/src/index.ts`, `web/src/App.tsx`)
- Exported constants: `UPPER_SNAKE_CASE`: `shared/src/brand.ts` (`PRODUCT_NAME`, `PRODUCT_ENV`, `PRODUCT_HEADERS`)
- Constant maps: `as const` for literal typing: `shared/src/brand.ts`

**Types:**
- `PascalCase` for type names (no `I*` prefix): `shared/src/schemas.ts` (`Session`, `Project`, `Workspace`)
- Both `type` and `interface` used:
  - `shared/`: `type` + Zod inference: `shared/src/schemas.ts` (`export type Session = z.infer<...>`)
  - `cli/`: local `interface` for request/response payload shapes: `cli/src/modules/common/handlers/files.ts`
- Type-only exports/imports used (TS 5+): `shared/src/index.ts` (`export type * from './types'`), `hub/src/index.ts` (`import { x, type T } from ...`)

## Code Style

**Formatting (most TS/TSX):**
- Indentation: 4 spaces common in `hub/`, `shared/`, `web/` (`hub/src/index.ts`, `shared/src/schemas.ts`, `web/src/main.tsx`)
- Strings: single quotes common in TS/TSX (`web/src/App.tsx`, `shared/src/brand.ts`)
- Semicolons: usually omitted; occasional semicolons in legacy/isolated files/tests (`cli/src/modules/ripgrep/index.ts`, `cli/src/codex/codexRemoteLauncher.test.ts`)
- Trailing commas: common in multi-line objects/arrays/config (`cli/vitest.config.ts`, `web/vitest.config.ts`)
- Intentional promise ignore: `void` operator used at entrypoints (`cli/src/index.ts`)

**Tooling:**
- TypeScript strict checks primary enforcement: `tsconfig.base.json`
- No repo-wide linter config found (no root ESLint/biome config); style mostly “by example” + TS checks (`CLAUDE.md`)
- Website package only: Prettier enforced via `website/.prettierrc` and `website/package.json` (`format` script)

## Import Organization

**Module system:**
- ESM everywhere (`"type": "module"` in package `package.json` files, e.g. `cli/package.json`, `hub/package.json`, `web/package.json`)

**Order (typical, not enforced):**
1. External deps (React, Hono, etc.)
2. Workspace package imports: `@hopi/protocol/*` (`hub/src/index.ts`, `cli/src/commands/runCli.ts`)
3. Internal alias imports (when used): `@/...` in `cli/` + `web/` (`web/src/App.tsx`, `cli/src/modules/common/handlers/files.ts`)
4. Relative imports (`./`, `../`) (common in `hub/`)
5. Type-only imports via `import type` or `type` specifier (`web/src/components/app/AppThemeProvider.tsx`, `hub/src/socket/handlers/terminal.test.ts`)

**Path aliases:**
- TS alias `@/* -> ./src/*` declared per package:
  - `cli/tsconfig.json`
  - `hub/tsconfig.json`
  - `shared/tsconfig.json`
  - `web/tsconfig.json`
- Runtime config for alias where needed:
  - Vite: `web/vite.config.ts`
  - Vitest: `cli/vitest.config.ts`, `web/vitest.config.ts`

## Error Handling

**General:**
- Guard clauses + early returns for invalid states (`web/src/App.tsx`, `cli/src/commands/runCli.ts`)
- Boundary code normalizes errors into structured responses:
  - CLI RPC handlers return `{ success: false, error }` helpers (`cli/src/modules/common/rpcResponses.ts`, usage in `cli/src/modules/common/handlers/files.ts`)
- “Throw vs return” varies by layer:
  - Deep utilities may `throw` (bubble to boundary)
  - Handlers tend to `catch` and return normalized shapes

## Logging

**CLI:**
- Dedicated logger; debug to file to avoid disturbing interactive agent sessions: `cli/src/ui/logger.ts`
- `logger.debug/info/warn` common across CLI code (`cli/src/terminal/TerminalManager.ts`, `cli/src/commands/runCli.ts`)

**Hub/Web:**
- `console.log` / `console.error` used at startup and for user-visible debug: `hub/src/index.ts`, `web/src/main.tsx`

## Comments

- File header blocks for major modules/entrypoints (`hub/src/index.ts`, `cli/src/modules/ripgrep/index.ts`)
- Inline comments for constraints/UX behavior in web (`web/src/App.tsx`)
- Prefer “why” over “what”; keep comments near the behavior being justified (pattern observed in `shared/src/schemas.ts`)

## Function + Module Design

- Small helpers for normalization/merging; pure-ish functions when possible: `hub/src/index.ts` (`normalizeOrigin`, `normalizeOrigins`, `mergeCorsOrigins`)
- Named exports preferred for domain logic and React components (`web/src/components/app/AppThemeProvider.tsx`, `cli/src/commands/runCli.ts`)
- Default exports mainly for config/entry files (`web/vite.config.ts`, `web/vitest.config.ts`, `cli/vitest.config.ts`)

