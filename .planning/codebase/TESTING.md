# Testing Patterns

**Analysis Date:** 2026-03-07

Multi-package repo; test tooling differs per package. Match the local package’s runner + style.

## Test Framework

**Hub (`hub/`):**
- Runner: Bun test (`hub/package.json` -> `"test": "bun test"`)
- API: import from `bun:test` (no globals): `hub/src/store/tasks.test.ts`, `hub/src/socket/handlers/terminal.test.ts`
- Optional SQLite tooling in tests: `bun:sqlite` used directly: `hub/src/store/schemaMigration.test.ts`

**CLI (`cli/`):**
- Runner: Vitest (`cli/package.json` -> `"test": "bun run tools:unpack && vitest run"`)
- Config: `cli/vitest.config.ts` (node env, coverage enabled, `@` alias)
- API: import from `vitest` (`describe/it/expect/beforeEach/afterEach/vi`), e.g. `cli/src/modules/common/handlers/git.test.ts`

**Web (`web/`):**
- Runner: Vitest (`web/package.json` -> `"test": "vitest run"`)
- Config: `web/vitest.config.ts` (jsdom env, `setupFiles`, include `src/**/*.test.{ts,tsx}`)
- UI assertions: Testing Library + jest-dom matchers (`web/src/test/setup.ts`)

**Run commands (repo root):**
```bash
bun run test          # all packages
bun run test:cli      # cli only (vitest run + tools unpack)
bun run test:hub      # hub only (bun test)
bun run test:web      # web only (vitest run)
```

## Test File Organization

**Collocation:**
- Predominant pattern: `*.test.ts` next to code:
  - `hub/src/store/tasks.test.ts`
  - `hub/src/notifications/eventParsing.test.ts`
  - `cli/src/modules/ripgrep/index.test.ts`
  - `web/src/lib/taskMerge.test.ts`

**Shared test utilities (web):**
- Test helpers live under `web/src/test/`:
  - Setup: `web/src/test/setup.ts`
  - Render helpers: `web/src/test/renderWithProviders.tsx`

**Notable exception:**
- `__tests__/` subfolder exists (CLI Codex): `cli/src/codex/__tests__/emitReadyIfIdle.test.ts`

## Test Structure

**Common suite style:**
- `describe('unit/feature', () => { it('behavior', () => { ... }) })`
- English behavior strings; focused expectations; minimal AAA comments (pattern across `hub/src/store/tasks.test.ts`, `web/src/lib/taskMerge.test.ts`)

**Setup/teardown patterns:**
- Hub: lightweight state + explicit cleanup in `afterEach` when files/DB created:
  - Temp file removal in `hub/src/store/schemaMigration.test.ts`
- CLI: async `beforeEach`/`afterEach` for temp dirs + env var restore:
  - `cli/src/modules/common/handlers/git.test.ts` (real git repo, worktrees, `process.env` stash/restore)
- Web: global RTL cleanup after each test:
  - `web/src/test/setup.ts` (`afterEach(cleanup)`)
  - per-suite resets often in `beforeEach` (`localStorage.clear()`, DOM state): `web/src/test/renderWithProviders.test.tsx`

## Mocking

**Hub (Bun tests):**
- Minimal mocking libs; prefers handwritten fakes/harness objects:
  - `hub/src/socket/handlers/terminal.test.ts` (`FakeSocket`, `FakeServer`, `createHarness`)

**CLI (Vitest):**
- Uses `vi` for module mocks/spies/timers:
  - Module mocking + hoisted harness: `cli/src/codex/codexRemoteLauncher.test.ts` (`vi.hoisted`, `vi.mock`)
  - Spies/timers exist elsewhere: `cli/src/ui/ink/useSwitchControls.test.ts` (fake timers + spies)

**Web (Vitest + RTL):**
- Prefer rendering + DOM assertions; use `vi.fn()` for small stubs:
  - `web/src/test/renderWithProviders.test.tsx` (stub translation function)

## Fixtures and Factories

**Hub:**
- In-memory DB for store-level unit tests: `new Store(':memory:')` in `hub/src/store/tasks.test.ts`
- File-based DB + schema/migration fixtures when needed:
  - Creates legacy schema via raw SQL: `hub/src/store/schemaMigration.test.ts`

**CLI:**
- Realistic integration-ish fixtures via temp dirs + git:
  - `cli/src/modules/common/handlers/git.test.ts` (`os.tmpdir()`, `git init`, `git worktree add`)

**Web:**
- Reusable render helper providing i18n/query/router wrappers:
  - `web/src/test/renderWithProviders.tsx`
- Small probe components for context validation:
  - `web/src/test/renderWithProviders.test.tsx` (`I18nProbe`)

## Coverage

- CLI: enabled via Vitest config:
  - `cli/vitest.config.ts` -> provider `v8`, reporters `text/json/html`, exclude patterns
- Web: no explicit coverage config in `web/vitest.config.ts`
- Hub: Bun test runner; no explicit coverage config found

## Test Types Present

- Unit tests (pure functions / small modules):
  - `web/src/lib/taskMerge.test.ts`
- Integration-ish tests (real FS/DB/git interactions, still in unit runner):
  - `hub/src/store/schemaMigration.test.ts` (SQLite schema + migration)
  - `cli/src/modules/common/handlers/git.test.ts` (real git worktrees)
- E2E: no Playwright/Cypress suite found in repo

## Common Patterns

- Async tests: `async` + `await` over callbacks (`cli/src/modules/common/handlers/git.test.ts`)
- DOM/UI tests: Testing Library `screen` + jest-dom matchers (`web/src/test/renderWithProviders.test.tsx`)

