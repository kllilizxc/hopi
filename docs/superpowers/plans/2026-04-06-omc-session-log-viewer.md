# OMC Session Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a raw session-log viewer to the OMC message panel, powered by shared headless session-message-store logic, so planning runs and plan runtimes can expose their underlying transcript without merging their domain models.

**Architecture:** Extract the headless session message window store from `web` into `@hopi/protocol`, rewire `web` to keep using that shared core, then add an OMC-specific `session-log` panel mode with a transcript workspace, session selection state, and entry points from guided planning and plan trace surfaces.

**Tech Stack:** TypeScript, React 19, Vitest, `@assistant-ui/react`, existing Hub session REST + SSE APIs, existing OMC message panel shell.

---

### Task 1: Extract Shared Headless Session Message Store

**Files:**
- Create: `shared/src/sessionMessages.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/package.json`
- Modify: `web/src/lib/message-window-store.ts`
- Test: `shared/src/sessionMessages.test.ts`

- [ ] **Step 1: Write the failing shared-store tests**

Create `shared/src/sessionMessages.test.ts` covering:

1. latest page fetch populates state
2. older page fetch prepends history
3. incoming messages merge into visible list when at bottom
4. incoming messages queue into pending when not at bottom

Use a fake API:

```ts
const api = {
    getMessages: vi.fn(),
}
```

and assert against store methods from:

```ts
const store = createSessionMessageWindowStore({
    isVisibleMessage: () => true,
})
```

- [ ] **Step 2: Run the shared-store tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/shared
TMPDIR=/tmp bun test src/sessionMessages.test.ts
```

Expected:

- FAIL because `createSessionMessageWindowStore` does not exist yet

- [ ] **Step 3: Implement the shared store**

Add `shared/src/sessionMessages.ts` with:

- shared session message types
- store factory
- methods equivalent to current `web` store:
  - `getMessageWindowState`
  - `subscribeMessageWindow`
  - `clearMessageWindow`
  - `fetchLatestMessages`
  - `fetchOlderMessages`
  - `flushPendingMessages`
  - `setAtBottom`
  - `ingestIncomingMessages`

Key design rule:

- the store must be UI-agnostic
- visibility filtering must be injected via `isVisibleMessage`

- [ ] **Step 4: Re-export the shared store**

Update `shared/src/index.ts` and `shared/package.json` exports so both `web` and `omc-prototype` can import:

```ts
import { createSessionMessageWindowStore } from '@hopi/protocol/session-messages'
```

- [ ] **Step 5: Rebase `web` wrapper onto the shared store**

Replace `web/src/lib/message-window-store.ts` internals with a thin wrapper:

```ts
const store = createSessionMessageWindowStore({
    isVisibleMessage: (message) => normalizeDecryptedMessage(message) !== null,
})
```

Then re-export the existing methods so current `web` callers remain unchanged.

- [ ] **Step 6: Run the shared-store and web message tests**

Run:

```bash
cd /Users/realizer/Code/hopi
TMPDIR=/tmp bun test shared/src/sessionMessages.test.ts
TMPDIR=/tmp bun run --cwd web test -- src/hooks/queries/useMessages.test.tsx
```

Expected:

- PASS for the shared store tests
- PASS for the focused `web` regression

### Task 2: Add OMC Session Message Store Wrapper and API Methods

**Files:**
- Modify: `omc-prototype/src/prototype/remoteApi.tsx`
- Modify: `omc-prototype/src/prototype/remoteApi.test.ts`
- Create: `omc-prototype/src/lib/sessionMessageStore.ts`
- Create: `omc-prototype/src/hooks/useSessionMessages.ts`
- Test: `omc-prototype/src/hooks/useSessionMessages.test.tsx`

- [ ] **Step 1: Write the failing OMC API tests**

Extend `omc-prototype/src/prototype/remoteApi.test.ts` with:

1. `getMessages(sessionId)` hits:

```ts
'/api/sessions/session-123/messages'
```

2. `getMessages(sessionId, { beforeSeq: 10, limit: 20 })` hits:

```ts
'/api/sessions/session-123/messages?beforeSeq=10&limit=20'
```

- [ ] **Step 2: Run the OMC API tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/remoteApi.test.ts
```

Expected:

- FAIL because `PrototypeRemoteApiClient.getMessages()` does not exist yet

- [ ] **Step 3: Implement `getMessages()`**

Add to `PrototypeRemoteApiClient`:

```ts
async getMessages(
    sessionId: string,
    options?: { beforeSeq?: number | null; limit?: number },
): Promise<SessionMessagesPage> {
    const params = new URLSearchParams()
    if (typeof options?.beforeSeq === 'number') params.set('beforeSeq', String(options.beforeSeq))
    if (typeof options?.limit === 'number') params.set('limit', String(options.limit))
    const qs = params.toString()
    return await this.request<SessionMessagesPage>(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`,
    )
}
```

- [ ] **Step 4: Build the OMC store wrapper**

Create `omc-prototype/src/lib/sessionMessageStore.ts` as:

```ts
import { createSessionMessageWindowStore } from '@hopi/protocol/session-messages'

export const sessionMessageStore = createSessionMessageWindowStore({
    isVisibleMessage: () => true,
})
```

- [ ] **Step 5: Build `useSessionMessages()`**

Create `omc-prototype/src/hooks/useSessionMessages.ts` mirroring `web`’s hook shape:

- `messages`
- `warning`
- `isLoading`
- `isLoadingMore`
- `hasMore`
- `pendingCount`
- `messagesVersion`
- `loadMore`
- `refetch`
- `flushPending`
- `setAtBottom`

- [ ] **Step 6: Write and run hook tests**

Add `omc-prototype/src/hooks/useSessionMessages.test.tsx` to verify:

- initial fetch occurs
- `loadMore()` fetches older messages
- `refetch()` refreshes latest messages

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/hooks/useSessionMessages.test.tsx src/prototype/remoteApi.test.ts
```

Expected:

- PASS

### Task 3: Add Session-Log Selection and Panel Mode to OMC

**Files:**
- Modify: `omc-prototype/src/prototype/types.ts`
- Modify: `omc-prototype/src/prototype/store.tsx`
- Modify: `omc-prototype/src/components/operator/OperatorSurfaceContext.tsx`
- Modify: `omc-prototype/src/router.tsx`
- Modify: `omc-prototype/src/components/MessagePanel.tsx`
- Modify: `omc-prototype/src/components/operator/MessageWorkspace.tsx`
- Test: `omc-prototype/src/components/MessagePanel.test.tsx`
- Test: `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`

- [ ] **Step 1: Write the failing panel-mode tests**

Add tests covering:

1. `openSessionLog()` puts the message panel into `session-log`
2. trace mode still works
3. back from `session-log` restores the previous mode

Use a new selection type:

```ts
type SessionLogSelection = {
    sessionId: string
    source: 'planning-run' | 'plan-runtime'
    title: string
    planId?: string | null
}
```

- [ ] **Step 2: Run the panel tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/MessagePanel.test.tsx src/components/operator/MessageWorkspace.test.tsx
```

Expected:

- FAIL because `session-log` mode and selection do not exist yet

- [ ] **Step 3: Add session-log selection state**

Extend prototype state/types with:

- `sessionLogSelection`
- `openSessionLog`
- `clearSessionLog`

Extend `OperatorSurfaceContext` with:

```ts
openSessionLog(input: SessionLogSelection): void
activeSessionLog: SessionLogSelection | null
```

- [ ] **Step 4: Wire message panel mode**

Update `MessagePanel` and `MessageWorkspace` so mode resolution becomes:

- `trace`
- `session-log`
- `thread`
- `inbox`

and `session-log` takes precedence when `sessionLogSelection` is active.

- [ ] **Step 5: Run panel tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/MessagePanel.test.tsx src/components/operator/MessageWorkspace.test.tsx
```

Expected:

- PASS

### Task 4: Build the OMC Session Log Workspace

**Files:**
- Create: `omc-prototype/src/components/operator/SessionLogWorkspace.tsx`
- Create: `omc-prototype/src/components/operator/SessionLogWorkspace.test.tsx`
- Create: `omc-prototype/src/lib/sessionAssistantRuntime.ts`
- Modify: `omc-prototype/src/index.css`

- [ ] **Step 1: Write the failing workspace tests**

Add tests for:

1. fetches and renders transcript
2. shows inactive banner when session is inactive
3. send on inactive resumes then sends
4. shows `打开终端` action
5. back button delegates to panel back handler

- [ ] **Step 2: Run the workspace tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/SessionLogWorkspace.test.tsx
```

Expected:

- FAIL because `SessionLogWorkspace` does not exist yet

- [ ] **Step 3: Implement transcript runtime conversion**

Create `sessionAssistantRuntime.ts` that converts protocol session messages into `assistant-ui` thread messages using:

- role envelope parsing from `@hopi/protocol/messages`
- safe fallback text rendering
- existing OMC markdown renderer

Do not import `web` Tailwind chat UI.

- [ ] **Step 4: Implement `SessionLogWorkspace`**

The workspace must:

- fetch session detail with `getSession()`
- use `useSessionMessages()`
- show header metadata
- show inactive banner
- load transcript into `assistant-ui`
- support sending and automatic resume
- expose `打开终端`

- [ ] **Step 5: Add styles**

Add only the CSS needed for:

- session-log header
- metadata row
- inactive banner
- transcript body
- top actions

Keep existing glass-panel language.

- [ ] **Step 6: Run workspace tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/SessionLogWorkspace.test.tsx
```

Expected:

- PASS

### Task 5: Add Planning and Runtime Entry Points

**Files:**
- Modify: `omc-prototype/src/components/SeedPlanningPanel.tsx`
- Modify: `omc-prototype/src/components/operator/PlanTraceWorkspace.tsx`
- Modify: `omc-prototype/src/screens/DashboardPage.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadHeader.tsx` (only if needed)
- Test: `omc-prototype/src/components/SeedPlanningPanel.test.tsx`
- Test: `omc-prototype/src/components/operator/PlanTraceWorkspace.test.tsx`
- Test: `omc-prototype/src/screens/DashboardPage.test.tsx`

- [ ] **Step 1: Write the failing entry-point tests**

Add tests that assert:

1. seed planning panel calls `operatorSurface.openSessionLog()` when `planningRun.sessionId` exists
2. dashboard hero shows `查看规划日志` when latest planning run has a session id
3. plan trace workspace shows `查看底层日志` when a runtime session id exists

- [ ] **Step 2: Run the entry-point tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- \
    src/components/SeedPlanningPanel.test.tsx \
    src/components/operator/PlanTraceWorkspace.test.tsx \
    src/screens/DashboardPage.test.tsx
```

Expected:

- FAIL because the viewer entry points do not exist yet

- [ ] **Step 3: Implement planning run entry points**

In `SeedPlanningPanel`:

- when `planningRun.sessionId` exists, render `查看底层日志`

In `DashboardPage`:

- when `live.planningRun?.sessionId` exists, render `查看规划日志`

Both actions call `operatorSurface.openSessionLog()`.

- [ ] **Step 4: Implement plan runtime entry point**

Expose runtime session id to `PlanTraceWorkspace`, then render:

- `查看底层日志`

when a current runtime session id exists.

- [ ] **Step 5: Run the entry-point tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- \
    src/components/SeedPlanningPanel.test.tsx \
    src/components/operator/PlanTraceWorkspace.test.tsx \
    src/screens/DashboardPage.test.tsx
```

Expected:

- PASS

### Task 6: Feed Live SSE Messages into the OMC Session Store and Verify End-to-End

**Files:**
- Modify: `omc-prototype/src/prototype/store.tsx`
- Modify only if failures require it elsewhere

- [ ] **Step 1: Add the SSE ingest bridge**

In the live EventSource handler, forward:

```ts
if (event.type === 'message-received') {
    sessionMessageStore.ingestIncomingMessages(event.sessionId, [event.message])
}
```

Keep existing OMC projection refresh behavior for `omc-*` events.

- [ ] **Step 2: Run the focused OMC verification suite**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- \
    src/prototype/remoteApi.test.ts \
    src/hooks/useSessionMessages.test.tsx \
    src/components/operator/SessionLogWorkspace.test.tsx \
    src/components/operator/PlanTraceWorkspace.test.tsx \
    src/components/SeedPlanningPanel.test.tsx \
    src/components/MessagePanel.test.tsx \
    src/components/operator/MessageWorkspace.test.tsx \
    src/screens/DashboardPage.test.tsx \
    src/prototype/store.live.test.tsx
```

Expected:

- PASS

- [ ] **Step 3: Run shared + web + OMC typecheck**

Run:

```bash
cd /Users/realizer/Code/hopi
TMPDIR=/tmp bun run --cwd shared test src/sessionMessages.test.ts
TMPDIR=/tmp bun run --cwd web typecheck
TMPDIR=/tmp bun run --cwd omc-prototype typecheck
```

Expected:

- PASS

- [ ] **Step 4: Run the package test suites**

Run:

```bash
cd /Users/realizer/Code/hopi
TMPDIR=/tmp bun run --cwd web test
TMPDIR=/tmp bun run --cwd omc-prototype test
```

Expected:

- PASS

- [ ] **Step 5: Run production builds**

Run:

```bash
cd /Users/realizer/Code/hopi
TMPDIR=/tmp bun run --cwd web build
TMPDIR=/tmp bun run --cwd omc-prototype build
```

Expected:

- PASS
