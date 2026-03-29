# Testing Patterns

**Analysis Date:** 2026-03-29

Testing is split by package. Match the local runner and test style for the package you are editing.

## Test Framework

**Runner:**
- `hub/` uses Bun test via `hub/package.json` (`"test": "bun test"`)
- `cli/` uses Vitest via `cli/package.json` (`"test": "bun run tools:unpack && vitest run"`)
- `web/` uses Vitest via `web/package.json` (`"test": "vitest run"`)

**Assertion Library:**
- Bun tests use `expect` from `bun:test`
- Vitest tests use `expect` from `vitest`
- Web UI tests also rely on `@testing-library/jest-dom` matchers from `web/src/test/setup.ts`

**Run Commands:**
```bash
bun run test          # all packages
bun run test:cli      # cli only
bun run test:hub      # hub only
bun run test:web      # web only
```

## Test File Organization

**Location:**
- Default pattern is colocated `*.test.ts` / `*.test.tsx` next to source files
- Examples: `cli/src/modules/common/handlers/files.test.ts`, `hub/src/sync/taskAutomation.test.ts`, `web/src/hooks/mutations/useStartTaskSession.test.tsx`

**Naming:**
- File name generally mirrors the module under test
- Most tests are simple unit-style files; there is no separate `tests/` tree

**Structure:**
```
cli/src/
  modules/
    ripgrep/
      index.ts
      index.test.ts
hub/src/
  store/
    schemaMigration.test.ts
web/src/
  test/
    setup.ts
    renderWithProviders.tsx
```

## Test Structure

**Suite Organization:**
- `describe('module', () => { it('behavior', () => { ... }) })` is the common shape
- Test names are behavior-oriented and usually written as plain English sentences
- Web tests often use small harness components or probe components to validate hooks/providers

**Patterns:**
- `beforeEach` is common for temp state, mocks, and DOM reset
- `afterEach` is used for cleanup when files, DBs, or global DOM state are involved
- Tests are usually explicit arrange/act/assert, even when comments are omitted

## Mocking

**Framework:**
- Vitest uses `vi.fn()`, `vi.mock()`, `vi.spyOn()`, and fake timers where needed
- Bun tests in `hub/` often prefer small handwritten fakes over heavy mocking

**Patterns:**
- Web component/hook tests stub API methods with `vi.fn()` and render via shared helpers
- CLI tests sometimes use real temporary directories or real subprocess-adjacent behavior instead of mocking everything
- Hub store tests often use `new Store(':memory:')` or temp SQLite files to exercise real persistence code

**What to Mock:**
- External services, network calls, and unstable platform APIs
- Environment variables and process state when the test is boundary-focused
- Time, filesystem, and subprocesses when the test would otherwise be non-deterministic

## Fixtures and Factories

**Test Data:**
- Inline factory helpers are common for complex objects: `createTask(...)` in `web/src/hooks/mutations/useStartTaskSession.test.tsx`
- SQLite fixtures are built with raw SQL in `hub/src/store/schemaMigration.test.ts`
- Temp directories are used for filesystem and git behavior in CLI tests

**Location:**
- Shared test utilities live in `web/src/test/`
- There is no repo-wide shared fixture directory

## Coverage

**Requirements:**
- No explicit coverage threshold is configured in the repo root
- `cli/vitest.config.ts` enables V8 coverage reporting with text/json/html reporters
- `web/vitest.config.ts` does not define a coverage block
- `hub/` has no explicit coverage config because it uses `bun test`

**View Coverage:**
```bash
bun run test:cli -- --coverage
```

## Test Types

**Unit Tests:**
- Most tests are unit or small integration-style checks around one module
- Common examples: `hub/src/utils/accessToken.test.ts`, `cli/src/modules/ripgrep/index.test.ts`, `web/src/lib/taskMerge.test.ts`

**Integration Tests:**
- Hub store tests exercise actual SQLite migration and persistence behavior
- CLI tests sometimes exercise real filesystem or git behavior
- Web tests use real DOM rendering plus Testing Library

**E2E Tests:**
- No Playwright/Cypress-style end-to-end suite was found

## Common Patterns

**Async Testing:**
- `async`/`await` is preferred over callback-style tests
- `waitFor` and `act` appear in web hook tests where React state updates are involved

**Error Testing:**
- Rejection and failure paths are asserted explicitly
- Web tests commonly check both DOM state and hook side effects after a failing action

**Setup Helpers:**
- `web/src/test/setup.ts` installs jest-dom matchers and cleans up after each test
- `web/src/test/renderWithProviders.tsx` centralizes providers for i18n, query client, and router

*Testing analysis: 2026-03-29*
*Update when test patterns change*
