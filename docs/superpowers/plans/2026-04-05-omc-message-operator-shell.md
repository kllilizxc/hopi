# OMC Message-Driven Operator Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mixed right-panel prototype with a message-driven operator shell where the right rail defaults to a thread inbox and each operator topic opens into a full chat-style detail view.

**Architecture:** Extract a pure `MessageWorkspace` list/detail shell, keep `MessagePanel` as a route-aware wrapper, tighten thread derivation so each topic has concise titles/previews plus compact first-agent messages, then strip decision controls from the main canvas so the right rail becomes the sole operator surface.

**Tech Stack:** React 19, TanStack Router, `@assistant-ui/react`, Vitest, Testing Library, TypeScript, Vite

---

### Task 1: Extract a testable message workspace shell

**Files:**
- Create: `omc-prototype/src/components/operator/MessageWorkspace.tsx`
- Create: `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`
- Create: `omc-prototype/src/test/setup.ts`
- Create: `omc-prototype/vitest.config.ts`
- Modify: `omc-prototype/package.json`
- Modify: `omc-prototype/src/components/MessagePanel.tsx`

- [ ] **Step 1: Write the failing workspace interaction test**

Add test tooling and a focused component test for the list -> detail -> list flow.

```tsx
// omc-prototype/src/components/operator/MessageWorkspace.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MessageWorkspace from '@/components/operator/MessageWorkspace'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

function buildThread(id: string, title: string): OperatorThread {
    return {
        id,
        kind: 'approval',
        goalId: 'goal-portfolio-foundation',
        title,
        preview: `${title} 预览`,
        updatedAt: '第 0 天 · 16:10',
        lifecycle: 'pending',
        priority: 'high',
        tone: 'accent',
        unread: true,
        passive: false,
        refs: [],
        firstMessage: {
            currentStatus: '现状',
            background: '背景',
            whyNow: '为什么',
            suggestedAction: '建议',
            freeformInvite: '直接告诉我'
        },
        quickActions: [],
        statusLabel: '待处理',
        detailSections: [],
    }
}

describe('MessageWorkspace', () => {
    it('defaults to the inbox, opens a thread, then returns to the list', () => {
        const onSelectThread = vi.fn()
        const onBackToList = vi.fn()
        const threads = [
            buildThread('approval:branch', '要不要现在放行导入分支'),
            buildThread('risk:scope', '周报范围还要不要继续收紧'),
        ]
        const messagesByThread: Record<string, OperatorMessage[]> = {
            'approval:branch': [],
            'risk:scope': [],
        }

        const { rerender } = render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: '真正需要你判断的事进收件箱。' }}
                threads={threads}
                messagesByThread={messagesByThread}
                selectedThread={null}
                showHandled={false}
                onToggleHandled={() => {}}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />
        )

        expect(screen.getByText('要不要现在放行导入分支')).toBeInTheDocument()
        expect(screen.queryByText('返回消息列表')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /要不要现在放行导入分支/i }))
        expect(onSelectThread).toHaveBeenCalledWith('approval:branch')

        rerender(
            <MessageWorkspace
                heading={{ title: '消息流', summary: '真正需要你判断的事进收件箱。' }}
                threads={threads}
                messagesByThread={messagesByThread}
                selectedThread={threads[0]}
                showHandled={false}
                onToggleHandled={() => {}}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />
        )

        expect(screen.getByRole('button', { name: /返回消息列表/i })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /返回消息列表/i }))
        expect(onBackToList).toHaveBeenCalled()
    })
})
```

```ts
// omc-prototype/vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
})
```

```ts
// omc-prototype/src/test/setup.ts
import '@testing-library/jest-dom/vitest'
```

```json
// omc-prototype/package.json
{
    "devDependencies": {
        "@testing-library/jest-dom": "^6.6.3",
        "@testing-library/react": "^16.3.0",
        "jsdom": "^26.1.0"
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx
```

Expected: FAIL with `Cannot find module '@/components/operator/MessageWorkspace'` or missing Testing Library dependencies.

- [ ] **Step 3: Implement the workspace shell extraction**

Create a pure shell component and turn `MessagePanel` into a thin wrapper that only:
- computes heading copy
- sorts threads
- maps route changes to selection resets
- passes selected thread into `MessageWorkspace`

```tsx
// omc-prototype/src/components/operator/MessageWorkspace.tsx
import ThreadConversation from '@/components/operator/ThreadConversation'
import ThreadInbox from '@/components/operator/ThreadInbox'
import { Glyph } from '@/components/Visuals'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

export default function MessageWorkspace(props: {
    className?: string
    heading: { title: string; summary: string }
    threads: OperatorThread[]
    messagesByThread: Record<string, OperatorMessage[]>
    selectedThread: OperatorThread | null
    showHandled: boolean
    onToggleHandled: () => void
    onSelectThread: (threadId: string) => void
    onBackToList: () => void
    onClose?: () => void
}) {
    return (
        <aside className={props.className ? `prototype-message-panel ${props.className}` : 'prototype-message-panel'}>
            <div className="prototype-message-panel__head">
                <div className="prototype-icon-pill prototype-icon-pill--small">
                    <Glyph name="digest" />
                </div>
                <div>
                    <h2>{props.heading.title}</h2>
                    <p>{props.heading.summary}</p>
                </div>
                {props.onClose ? (
                    <button type="button" className="prototype-message-panel__close" onClick={props.onClose} aria-label="关闭消息面板">
                        <Glyph name="close" />
                    </button>
                ) : null}
            </div>

            {props.selectedThread ? (
                <section className="prototype-thread-detail">
                    <button type="button" className="prototype-thread-detail__back" onClick={props.onBackToList}>
                        <Glyph name="back" />
                        <span>返回消息列表</span>
                    </button>
                    <ThreadConversation
                        thread={props.selectedThread}
                        messages={props.messagesByThread[props.selectedThread.id] ?? []}
                    />
                </section>
            ) : (
                <ThreadInbox
                    threads={props.threads}
                    activeThreadId={null}
                    showHandled={props.showHandled}
                    onToggleHandled={props.onToggleHandled}
                    onSelect={props.onSelectThread}
                />
            )}
        </aside>
    )
}
```

```tsx
// omc-prototype/src/components/MessagePanel.tsx
// replace inline shell markup with:
return (
    <MessageWorkspace
        className={props.className}
        heading={copy}
        threads={orderedThreads}
        messagesByThread={state.messagesByThread}
        selectedThread={selectedThread}
        showHandled={showHandled}
        onToggleHandled={() => setShowHandled((current) => !current)}
        onSelectThread={(threadId) => {
            actions.setActiveThread(threadId)
            setSelectedThreadId(threadId)
        }}
        onBackToList={() => setSelectedThreadId(null)}
        onClose={props.onClose}
    />
)
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx
```

Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/realizer/Code/hopi
git add omc-prototype/package.json omc-prototype/vitest.config.ts omc-prototype/src/test/setup.ts omc-prototype/src/components/operator/MessageWorkspace.tsx omc-prototype/src/components/operator/MessageWorkspace.test.tsx omc-prototype/src/components/MessagePanel.tsx
git commit -m "feat: extract message workspace shell"
```

### Task 2: Redesign thread derivation for operator topics

**Files:**
- Modify: `omc-prototype/src/prototype/types.ts`
- Modify: `omc-prototype/src/prototype/threads.ts`
- Modify: `omc-prototype/src/prototype/threads.test.ts`

- [ ] **Step 1: Write failing derivation tests for concise topics**

Replace the current report-like thread expectations with topic-oriented titles and compact first messages.

```ts
// omc-prototype/src/prototype/threads.test.ts
it('uses operator-topic titles instead of object labels', () => {
    const snapshot = getPrototypeSnapshot('approval')
    const threads = buildOperatorThreadSeeds(snapshot)

    expect(threads.map((thread) => thread.title)).toContain('要不要现在放行导入分支')
    expect(threads.map((thread) => thread.title)).not.toContain('把持仓导入跑稳 · 当前现状')
})

it('renders compact first agent messages instead of sectioned mini reports', () => {
    const snapshot = getPrototypeSnapshot('approval')
    const approvalThread = buildOperatorThreadSeeds(snapshot).find((thread) => thread.kind === 'approval')

    expect(approvalThread?.introMessage.body).not.toContain('### 现状')
    expect(approvalThread?.introMessage.body).not.toContain('### 背景')
    expect(approvalThread?.introMessage.body).toContain('我建议')
    expect(approvalThread?.detailSections).toHaveLength(3)
})
```

- [ ] **Step 2: Run the derivation tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/threads.test.ts
```

Expected: FAIL because titles still use object-label format and first messages still contain markdown section headings.

- [ ] **Step 3: Implement compact topic derivation**

Add a structured detail-section model and rewrite title/preview generation around operator questions.

```ts
// omc-prototype/src/prototype/types.ts
export type ThreadDetailSection = {
    id: 'evidence' | 'impact' | 'plan'
    label: string
    body: string
}

export type OperatorThread = {
    // existing fields...
    detailSections: ThreadDetailSection[]
}
```

```ts
// omc-prototype/src/prototype/threads.ts
function renderFirstMessage(firstMessage: OperatorFirstMessage) {
    return [
        `${firstMessage.currentStatus}`,
        '',
        `${firstMessage.suggestedAction}`,
        '',
        `${firstMessage.freeformInvite}`,
    ].join('\n')
}

function createApprovalTitle(item: PrototypeApprovalItem) {
    if (item.kind === 'branch-promotion') {
        return '要不要现在放行导入分支'
    }
    if (item.kind === 'scope-change') {
        return '周报范围还要不要继续收紧'
    }
    return '要不要接受这次路线调整'
}

function createDetailSections(params: {
    background: string
    confirmEffect?: string
    deferEffect?: string
    refs: ThreadContextRef[]
}) {
    return [
        { id: 'evidence', label: '查看依据', body: params.background },
        {
            id: 'impact',
            label: '查看影响',
            body: [params.confirmEffect, params.deferEffect].filter(Boolean).join('\n'),
        },
        {
            id: 'plan',
            label: '看关联计划',
            body: params.refs
                .filter((ref) => ref.kind === 'phase' || ref.kind === 'plan')
                .map((ref) => `- ${ref.label}`)
                .join('\n'),
        },
    ].filter((section) => section.body.trim().length > 0)
}
```

- [ ] **Step 4: Run derivation tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/threads.test.ts
```

Expected: PASS with updated title and compact-first-message assertions.

- [ ] **Step 5: Commit**

```bash
cd /Users/realizer/Code/hopi
git add omc-prototype/src/prototype/types.ts omc-prototype/src/prototype/threads.ts omc-prototype/src/prototype/threads.test.ts
git commit -m "feat: derive operator topics for message threads"
```

### Task 3: Rebuild inbox rows and thread detail as a real messaging surface

**Files:**
- Modify: `omc-prototype/src/components/operator/ThreadInbox.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadConversation.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadHeader.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadQuickActions.tsx`
- Modify: `omc-prototype/src/lib/omcAssistantRuntime.ts`
- Modify: `omc-prototype/src/index.css`

- [ ] **Step 1: Write the failing UI test for thread detail composition**

Add a test that checks:
- inbox rows are grouped into `等你处理 / 进行中 / 静默中 / 已解决`
- selecting a thread reveals a chat detail with:
  - back button
  - lightweight context strip
  - quick actions under the first agent message

```tsx
// append to omc-prototype/src/components/operator/MessageWorkspace.test.tsx
it('renders inbox groups and thread detail with compact chat structure', () => {
    const pendingThread = buildThread('approval:branch', '要不要现在放行导入分支')
    const silentThread = { ...buildThread('risk:scope', '周报范围还要不要继续收紧'), lifecycle: 'silent' as const }

    const { rerender } = render(
        <MessageWorkspace
            heading={{ title: '消息流', summary: '真正需要你判断的事进收件箱。' }}
            threads={[pendingThread, silentThread]}
            messagesByThread={{
                [pendingThread.id]: [{
                    id: 'm1',
                    threadId: pendingThread.id,
                    role: 'agent',
                    body: '我建议先放行导入分支，把火力转去加固合并后问题。',
                    createdAt: '第 0 天 · 16:10',
                }],
                [silentThread.id]: [],
            }}
            selectedThread={null}
            showHandled={false}
            onToggleHandled={() => {}}
            onSelectThread={() => {}}
            onBackToList={() => {}}
        />
    )

    expect(screen.getByText('等你处理')).toBeInTheDocument()
    expect(screen.getByText('已解决')).toBeInTheDocument()

    rerender(
        <MessageWorkspace
            heading={{ title: '消息流', summary: '真正需要你判断的事进收件箱。' }}
            threads={[pendingThread, silentThread]}
            messagesByThread={{
                [pendingThread.id]: [{
                    id: 'm1',
                    threadId: pendingThread.id,
                    role: 'agent',
                    body: '我建议先放行导入分支，把火力转去加固合并后问题。',
                    createdAt: '第 0 天 · 16:10',
                }],
                [silentThread.id]: [],
            }}
            selectedThread={pendingThread}
            showHandled={false}
            onToggleHandled={() => {}}
            onSelectThread={() => {}}
            onBackToList={() => {}}
        />
    )

    expect(screen.getByText('要不要现在放行导入分支')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('继续追问，或直接告诉 Agent 你要它怎么做')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx
```

Expected: FAIL because inbox grouping and thread detail still render with the old card-heavy structure.

- [ ] **Step 3: Implement the inbox/detail visual structure**

Make the inbox rows compact and the thread detail feel like a real messaging page.

```tsx
// omc-prototype/src/components/operator/ThreadInbox.tsx
const GROUPS = [
    { id: 'needs-attention', label: '等你处理', states: ['pending', 'waiting'] as const },
    { id: 'active', label: '进行中', states: ['in-progress'] as const },
]

// each row:
<button className="prototype-inbox-row">
    <div className="prototype-inbox-row__icon"><Glyph name={iconForThread(thread)} /></div>
    <div className="prototype-inbox-row__copy">
        <strong>{thread.title}</strong>
        <p>{thread.preview}</p>
    </div>
    <div className="prototype-inbox-row__tail">
        {thread.unread ? <span className="prototype-thread-dot" /> : null}
        <span>{thread.updatedAt}</span>
    </div>
</button>
```

```tsx
// omc-prototype/src/components/operator/ThreadConversation.tsx
<section className="prototype-thread-shell">
    <ThreadHeader thread={props.thread} />
    <ThreadPrimitive.Root className="prototype-thread-root">
        <ThreadPrimitive.Viewport className="prototype-thread-viewport" autoScroll>
            <div className="prototype-thread-message-list">
                <ThreadPrimitive.Messages components={THREAD_COMPONENTS} />
            </div>
        </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
    <ThreadQuickActions thread={props.thread} />
    <ComposerPrimitive.Root className="prototype-thread-composer">
        <ComposerPrimitive.Input
            className="prototype-thread-composer__input"
            placeholder="继续追问，或直接告诉 Agent 你要它怎么做"
            submitOnEnter
            maxRows={6}
        />
        <ComposerPrimitive.Send className="prototype-primary-button">发送</ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
</section>
```

```tsx
// omc-prototype/src/components/operator/ThreadHeader.tsx
<header className="prototype-thread-header">
    <div className="prototype-thread-header__title">
        <h3>{thread.title}</h3>
        <span>{thread.statusLabel}</span>
    </div>
    <div className="prototype-thread-context-strip">
        {thread.refs.slice(0, 3).map((ref) => (
            <span key={`${ref.kind}:${ref.id}`}>{ref.label}</span>
        ))}
    </div>
</header>
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx
TMPDIR=/tmp bun run typecheck
```

Expected:
- test file PASS
- `tsc --noEmit` exits 0

- [ ] **Step 5: Commit**

```bash
cd /Users/realizer/Code/hopi
git add omc-prototype/src/components/operator/ThreadInbox.tsx omc-prototype/src/components/operator/ThreadConversation.tsx omc-prototype/src/components/operator/ThreadHeader.tsx omc-prototype/src/components/operator/ThreadQuickActions.tsx omc-prototype/src/lib/omcAssistantRuntime.ts omc-prototype/src/index.css omc-prototype/src/components/operator/MessageWorkspace.test.tsx
git commit -m "feat: rebuild operator inbox and thread detail UI"
```

### Task 4: Remove decision duplication from the main canvas

**Files:**
- Modify: `omc-prototype/src/screens/DashboardPage.tsx`
- Modify: `omc-prototype/src/screens/GoalPage.tsx`
- Modify: `omc-prototype/src/screens/ExecutionDetailPage.tsx`
- Modify: `omc-prototype/src/components/DashboardPanels.tsx`
- Modify: `omc-prototype/src/components/StrategyPanel.tsx`
- Modify: `omc-prototype/src/prototype/threadSelectors.ts`
- Modify: `omc-prototype/src/prototype/store.tsx`

- [ ] **Step 1: Write the failing test for main-canvas handoff only**

Add assertions that main surfaces expose lightweight thread entry points rather than decision controls.

```tsx
// append to omc-prototype/src/components/operator/MessageWorkspace.test.tsx
// create a separate screen test if preferred:
// omc-prototype/src/screens/DashboardPage.test.tsx
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import DashboardPage from '@/screens/DashboardPage'
import { PrototypeStoreProvider } from '@/prototype/store'

it('keeps dashboard actions as thread handoffs instead of decision buttons', () => {
    render(
        <PrototypeStoreProvider>
            <DashboardPage />
        </PrototypeStoreProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '进入演示' }))
    expect(screen.queryByRole('button', { name: /确认放行|稍后|收紧范围/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /打开线程/i }).length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/screens/DashboardPage.test.tsx
```

Expected: FAIL because the current canvas still carries extra metadata/actions and lacks the final handoff-only posture.

- [ ] **Step 3: Implement handoff-only canvas**

Make every main-canvas module contextual and thread-oriented:

```tsx
// omc-prototype/src/components/DashboardPanels.tsx
<div className="prototype-inline-actions prototype-inline-actions--compact">
    {primaryThread ? (
        <button
            type="button"
            className="prototype-button--ghost"
            onClick={() => actions.setActiveThread(primaryThread.id)}
        >
            打开线程
        </button>
    ) : null}
</div>
```

```tsx
// omc-prototype/src/components/StrategyPanel.tsx
<section className="prototype-panel">
    <div className="prototype-section-head">
        <h2>路线</h2>
    </div>
    <div className="prototype-strategy-callout">
        <div className="prototype-icon-pill prototype-icon-pill--large">
            <Glyph name="strategy" />
        </div>
        <div>
            <h3>{view.thesis}</h3>
            <p>{view.reason}</p>
        </div>
    </div>
</section>
```

```tsx
// omc-prototype/src/screens/GoalPage.tsx
{primaryThread ? (
    <button
        type="button"
        className="prototype-button--ghost"
        onClick={() => actions.setActiveThread(primaryThread.id)}
    >
        打开线程
    </button>
) : null}
```

Also remove any remaining direct decision buttons or free-form instruction boxes from canvas modules.

- [ ] **Step 4: Run targeted tests, typecheck, and build**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx src/prototype/threads.test.ts
TMPDIR=/tmp bun run typecheck
TMPDIR=/tmp bun run build
```

Expected:
- all listed tests PASS
- typecheck exits 0
- Vite build succeeds

- [ ] **Step 5: Commit**

```bash
cd /Users/realizer/Code/hopi
git add omc-prototype/src/screens/DashboardPage.tsx omc-prototype/src/screens/GoalPage.tsx omc-prototype/src/screens/ExecutionDetailPage.tsx omc-prototype/src/components/DashboardPanels.tsx omc-prototype/src/components/StrategyPanel.tsx omc-prototype/src/prototype/threadSelectors.ts omc-prototype/src/prototype/store.tsx
git commit -m "feat: make main canvas hand off to operator threads"
```

### Task 5: Polish spacing, responsive shell, and full verification

**Files:**
- Modify: `omc-prototype/src/index.css`
- Modify: `omc-prototype/src/router.tsx`
- Modify: `omc-prototype/src/components/MessagePanel.tsx`

- [ ] **Step 1: Write the failing visual-shell test**

Add a narrow-screen shell test to ensure the workspace still behaves as list -> detail in drawer mode.

```tsx
// append to omc-prototype/src/components/operator/MessageWorkspace.test.tsx
it('keeps list-first behavior even when reused as a drawer shell', () => {
    const thread = buildThread('approval:branch', '要不要现在放行导入分支')

    render(
        <MessageWorkspace
            heading={{ title: '消息流', summary: '真正需要你判断的事进收件箱。' }}
            threads={[thread]}
            messagesByThread={{ [thread.id]: [] }}
            selectedThread={null}
            showHandled={false}
            onToggleHandled={() => {}}
            onSelectThread={() => {}}
            onBackToList={() => {}}
            onClose={() => {}}
        />
    )

    expect(screen.getByText('要不要现在放行导入分支')).toBeInTheDocument()
    expect(screen.queryByText('继续追问，或直接告诉 Agent 你要它怎么做')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the targeted test to verify failure**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx
```

Expected: FAIL if drawer/list behavior or copy still depends on the old mixed layout.

- [ ] **Step 3: Implement final shell polish**

Tighten spacing and unify the message workspace shell.

```tsx
// omc-prototype/src/router.tsx
<main className={portfolio ? 'prototype-shell__main prototype-shell__main--with-sidebar' : 'prototype-shell__main'}>
    <div className="prototype-shell__content">
        <Outlet />
    </div>
    {portfolio ? (
        <>
            <MessagePanel className="prototype-message-rail" />
            <div className={`prototype-message-overlay${messagePanelOpen ? ' is-open' : ''}`}>
                <div onClick={(event) => event.stopPropagation()}>
                    <MessagePanel className="prototype-message-drawer" onClose={() => setMessagePanelOpen(false)} />
                </div>
            </div>
        </>
    ) : null}
</main>
```

```css
/* omc-prototype/src/index.css */
.prototype-shell__main--with-sidebar {
    display: grid;
    gap: 20px;
    grid-template-columns: minmax(0, 1fr) 440px;
    align-items: start;
}

.prototype-message-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 14px;
    min-height: calc(100vh - 160px);
    padding: 18px;
    border-radius: 28px;
}

.prototype-message-panel__body--inbox,
.prototype-thread-detail {
    min-height: 0;
}

.prototype-thread-detail {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
}
```

- [ ] **Step 4: Run full verification**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test
TMPDIR=/tmp bun run typecheck
TMPDIR=/tmp bun run build
```

Then run repo-level verification:

```bash
cd /Users/realizer/Code/hopi
TMPDIR=/tmp bun run typecheck:omc-prototype
TMPDIR=/tmp bun run build:omc-prototype
```

Expected:
- all `omc-prototype` tests PASS
- local package typecheck exits 0
- package build succeeds
- root `typecheck:omc-prototype` exits 0
- root `build:omc-prototype` succeeds

- [ ] **Step 5: Commit**

```bash
cd /Users/realizer/Code/hopi
git add omc-prototype/src/index.css omc-prototype/src/router.tsx omc-prototype/src/components/MessagePanel.tsx omc-prototype/src/components/operator/MessageWorkspace.test.tsx
git commit -m "feat: polish message-driven operator shell"
```
