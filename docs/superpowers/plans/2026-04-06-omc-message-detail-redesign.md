# OMC Message Detail Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh `omc-prototype` message detail so the right rail reads as a conversation-first operator workspace with a stronger briefing header, clearer action hierarchy, and calmer chat styling.

**Architecture:** Keep the existing thread store and runtime wiring, but reshape the detail surface in place. `MessageWorkspace` owns the title layer, `ThreadHeader` becomes the briefing layer, `ThreadConversation` + `ThreadQuickActions` become one docked action surface, and `index.css` rebalances the visual hierarchy and responsive behavior.

**Tech Stack:** React 19, TypeScript, `@assistant-ui/react`, Vitest, Testing Library, Vite, Bun

---

## File Map

- `omc-prototype/src/components/operator/MessageWorkspace.tsx`
  Detail-mode title layer: back, title, updated time, status pill.
- `omc-prototype/src/components/operator/ThreadHeader.tsx`
  Briefing layer: context chips, `为什么现在需要你`, `执行动作`.
- `omc-prototype/src/components/operator/ThreadConversation.tsx`
  Conversation flow plus docked action area wrapper.
- `omc-prototype/src/components/operator/ThreadQuickActions.tsx`
  Suggested-action pills grouped above the composer.
- `omc-prototype/src/index.css`
  Visual hierarchy, spacing, bubbles, action dock, responsive tuning.
- `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`
  Detail title-layer expectations.
- `omc-prototype/src/components/operator/ThreadHeader.test.tsx`
  Briefing-header rendering expectations.
- `omc-prototype/src/components/operator/ThreadConversation.test.tsx`
  Docked action-area structure expectations.

### Task 1: Build the briefing header contract

**Files:**
- Create: `omc-prototype/src/components/operator/ThreadHeader.test.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadHeader.tsx`
- Modify: `omc-prototype/src/index.css`

- [ ] **Step 1: Write the failing briefing-header test**

Add a focused component test that proves the header renders:
- compact context chips
- a separate `为什么现在需要你` block
- a separate `执行动作` block
- no `impact` chip noise in the main context row

```tsx
// omc-prototype/src/components/operator/ThreadHeader.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ThreadHeader from './ThreadHeader'
import type { OperatorThread } from '@/prototype/types'

function buildThread(overrides: Partial<OperatorThread> = {}): OperatorThread {
    return {
        id: 'thread-1',
        kind: 'approval',
        goalId: 'goal-1',
        title: '做出每周投资简报',
        preview: '当前主线在周报框架',
        updatedAt: '12 分钟前',
        lifecycle: 'waiting',
        priority: 'high',
        tone: 'accent',
        unread: true,
        passive: false,
        refs: [
            { kind: 'goal', id: 'goal-1', label: '每周投资简报' },
            { kind: 'stream', id: 'stream-1', label: '周报框架' },
            { kind: 'phase', id: 'phase-1', label: '阶段 01 · 周报定调' },
            { kind: 'impact', id: 'impact-1', label: '会影响后续栏目顺序' },
        ],
        detailSections: [],
        firstMessage: {
            currentStatus: '现在在待启动，置信 24%。',
            background: '先把主线收进周报框架。',
            whyNow: '栏目优先级还没钉死，继续推进会影响后续内容顺序。',
            suggestedAction: '直接回复要保留的栏目，或者改掉当前主线。',
            freeformInvite: '也可以直接叫我改路线。',
        },
        quickActions: [],
        statusLabel: '等你回复',
        ...overrides,
    }
}

describe('ThreadHeader', () => {
    it('renders context chips plus separate why-now and action blocks', () => {
        render(<ThreadHeader thread={buildThread()} />)

        expect(screen.getByText('目标')).toBeInTheDocument()
        expect(screen.getByText('每周投资简报')).toBeInTheDocument()
        expect(screen.getByText('执行流')).toBeInTheDocument()
        expect(screen.getByText('阶段')).toBeInTheDocument()
        expect(screen.getByText('为什么现在需要你')).toBeInTheDocument()
        expect(screen.getByText(/栏目优先级还没钉死/)).toBeInTheDocument()
        expect(screen.getByText('执行动作')).toBeInTheDocument()
        expect(screen.getByText(/直接回复要保留的栏目/)).toBeInTheDocument()
        expect(screen.queryByText('影响')).not.toBeInTheDocument()
    })

    it('drops missing context chips without losing briefing copy', () => {
        render(
            <ThreadHeader
                thread={buildThread({
                    refs: [],
                })}
            />
        )

        expect(screen.queryByText('目标')).not.toBeInTheDocument()
        expect(screen.getByText('为什么现在需要你')).toBeInTheDocument()
        expect(screen.getByText('执行动作')).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run the header test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/ThreadHeader.test.tsx
```

Expected: FAIL because `ThreadHeader` still renders only the old status/context strip.

- [ ] **Step 3: Implement the briefing-header markup**

Replace the old one-line metadata strip with:
- compact context chips for goal / stream / phase / plan
- one block for `为什么现在需要你`
- one block for `执行动作`

```tsx
// omc-prototype/src/components/operator/ThreadHeader.tsx
import type { OperatorThread } from '@/prototype/types'

function labelRefKind(kind: OperatorThread['refs'][number]['kind']) {
    switch (kind) {
        case 'goal':
            return '目标'
        case 'stream':
            return '执行流'
        case 'phase':
            return '阶段'
        case 'plan':
            return '计划'
        case 'impact':
            return '影响'
    }
}

export default function ThreadHeader(props: { thread: OperatorThread }) {
    const contextRefs = props.thread.refs.filter((ref) => ref.kind !== 'impact').slice(0, 3)

    return (
        <header className="prototype-thread-header">
            {contextRefs.length > 0 ? (
                <div className="prototype-thread-header__chips">
                    {contextRefs.map((ref) => (
                        <span key={`${ref.kind}-${ref.id}`} className="prototype-thread-chip">
                            <strong>{labelRefKind(ref.kind)}</strong>
                            <span>{ref.label}</span>
                        </span>
                    ))}
                </div>
            ) : null}

            <div className="prototype-thread-header__summary">
                <section className="prototype-thread-brief prototype-thread-brief--why">
                    <span className="prototype-thread-brief__eyebrow">为什么现在需要你</span>
                    <p>{props.thread.firstMessage.whyNow}</p>
                </section>

                <section className="prototype-thread-brief prototype-thread-brief--action">
                    <span className="prototype-thread-brief__eyebrow">执行动作</span>
                    <p>{props.thread.firstMessage.suggestedAction}</p>
                </section>
            </div>
        </header>
    )
}
```

```css
/* omc-prototype/src/index.css */
.prototype-thread-header {
    display: grid;
    gap: 12px;
    padding: 0 1px 4px;
}

.prototype-thread-header__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.prototype-thread-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(20, 32, 23, 0.05);
    color: var(--prototype-muted);
    font-size: 12px;
}

.prototype-thread-chip strong {
    color: var(--prototype-ink);
}

.prototype-thread-header__summary {
    display: grid;
    gap: 10px;
}

.prototype-thread-brief {
    display: grid;
    gap: 6px;
    padding: 13px 14px;
    border-radius: 18px;
    border: 1px solid var(--prototype-line);
    background: rgba(255, 255, 255, 0.96);
}

.prototype-thread-brief--why {
    border-color: rgba(31, 138, 100, 0.14);
    background: rgba(31, 138, 100, 0.07);
}

.prototype-thread-brief--action {
    border-color: rgba(201, 138, 43, 0.18);
    background: rgba(201, 138, 43, 0.08);
}

.prototype-thread-brief__eyebrow {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--prototype-muted);
}

.prototype-thread-brief p {
    margin: 0;
    color: var(--prototype-ink);
    line-height: 1.6;
}
```

- [ ] **Step 4: Run the header tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/ThreadHeader.test.tsx
```

Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/realizer/Code/hopi
git add omc-prototype/src/components/operator/ThreadHeader.test.tsx omc-prototype/src/components/operator/ThreadHeader.tsx omc-prototype/src/index.css
git commit -m "feat: add thread briefing header"
```

### Task 2: Promote the detail title layer and dock the action area

**Files:**
- Create: `omc-prototype/src/components/operator/ThreadConversation.test.tsx`
- Modify: `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`
- Modify: `omc-prototype/src/components/operator/MessageWorkspace.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadConversation.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadQuickActions.tsx`
- Modify: `omc-prototype/src/index.css`

- [ ] **Step 1: Write the failing detail-shell tests**

Expand the workspace test so detail mode must show the status pill in the title layer, then add a conversation test that requires a single docked action area with `建议动作` above the composer.

```tsx
// append to omc-prototype/src/components/operator/MessageWorkspace.test.tsx
it('shows updated time and status in the detail title layer', () => {
    const thread = buildThread({
        title: '做出每周投资简报',
        updatedAt: '12 分钟前',
        statusLabel: '等你回复',
    })

    render(
        <MessageWorkspace
            heading={{ title: '消息流', summary: 'Inbox summary' }}
            threads={[thread]}
            messagesByThread={{ [thread.id]: [] }}
            selectedThread={thread}
            showHandled={false}
            onToggleHandled={onToggleHandled}
            onSelectThread={onSelectThread}
            onBackToList={onBackToList}
        />,
    )

    expect(screen.getByRole('heading', { name: '做出每周投资简报' })).toBeInTheDocument()
    expect(screen.getByText('12 分钟前')).toBeInTheDocument()
    expect(screen.getByText('等你回复')).toBeInTheDocument()
})
```

```tsx
// omc-prototype/src/components/operator/ThreadConversation.test.tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ThreadConversation from './ThreadConversation'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

const performQuickAction = vi.fn()
const sendThreadReply = vi.fn()

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => ({
        actions: {
            performQuickAction,
            sendThreadReply,
        },
    }),
}))

vi.mock('@/lib/omcAssistantRuntime', () => ({
    useOmcAssistantRuntime: () => ({}),
}))

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownMessagePart: () => <div>markdown</div>,
}))

vi.mock('@assistant-ui/react', () => ({
    AssistantRuntimeProvider: ({ children }: { children: any }) => <>{children}</>,
    ComposerPrimitive: {
        Root: ({ children, className }: { children: any; className?: string }) => <div className={className}>{children}</div>,
        Input: (props: any) => <textarea {...props} />,
        Send: ({ children, className }: { children: any; className?: string }) => <button className={className}>{children}</button>,
    },
    ThreadPrimitive: {
        Root: ({ children, className }: { children: any; className?: string }) => <div className={className}>{children}</div>,
        Viewport: ({ children, className }: { children: any; className?: string }) => <div className={className}>{children}</div>,
        Messages: () => <div data-testid="thread-messages">mock messages</div>,
    },
    MessagePrimitive: {
        Root: ({ children, className }: { children: any; className?: string }) => <div className={className}>{children}</div>,
        Content: () => <div>message</div>,
    },
}))

function buildThread(overrides: Partial<OperatorThread> = {}): OperatorThread {
    return {
        id: 'thread-1',
        kind: 'direction',
        goalId: 'goal-1',
        title: '做出每周投资简报',
        preview: '当前主线在周报框架',
        updatedAt: '12 分钟前',
        lifecycle: 'waiting',
        priority: 'high',
        tone: 'accent',
        unread: true,
        passive: false,
        refs: [],
        detailSections: [],
        firstMessage: {
            currentStatus: '现在在待启动，置信 24%。',
            background: '先把主线缩到周报框架。',
            whyNow: '栏目优先级还没钉死。',
            suggestedAction: '直接回复要保留的栏目。',
            freeformInvite: '也可以改路线。',
        },
        quickActions: [
            {
                id: 'keep-track',
                label: '沿用当前主线',
                tone: 'primary',
                operation: { type: 'direction-set', goalId: 'goal-1', direction: 'maintain' },
            },
            {
                id: 'tighten-scope',
                label: '收紧栏目',
                tone: 'secondary',
                operation: { type: 'direction-set', goalId: 'goal-1', direction: 'tighten-scope' },
            },
        ],
        statusLabel: '等你回复',
        ...overrides,
    }
}

describe('ThreadConversation', () => {
    beforeEach(() => {
        performQuickAction.mockClear()
        sendThreadReply.mockClear()
    })

    it('renders a docked action area with suggested actions above the composer', () => {
        const { container } = render(
            <ThreadConversation
                thread={buildThread()}
                messages={[
                    {
                        id: 'message-1',
                        threadId: 'thread-1',
                        role: 'agent',
                        body: '如果你不改方向，我会按“框架先行”推进。',
                        createdAt: '12 分钟前',
                    } satisfies OperatorMessage,
                ]}
            />
        )

        expect(screen.getByTestId('thread-messages')).toBeInTheDocument()
        expect(screen.getByText('建议动作')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '沿用当前主线' })).toBeInTheDocument()
        expect(screen.getByPlaceholderText('继续追问，或直接告诉 Agent 要怎么做')).toBeInTheDocument()

        const dock = container.querySelector('.prototype-thread-action-dock')
        expect(dock).not.toBeNull()
        expect(dock?.querySelector('.prototype-thread-quick-actions')).not.toBeNull()
        expect(dock?.querySelector('.prototype-thread-composer')).not.toBeNull()
    })
})
```

- [ ] **Step 2: Run the detail-shell tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx src/components/operator/ThreadConversation.test.tsx
```

Expected: FAIL because the selected-thread title row does not yet render a status pill and `ThreadConversation` does not yet group quick actions + composer into a single action dock.

- [ ] **Step 3: Implement the title layer and action-dock markup**

Update the selected-thread head so it carries the status pill, then wrap quick actions + composer in one action dock and label the quick actions as suggested actions.

```tsx
// omc-prototype/src/components/operator/MessageWorkspace.tsx
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
    const className = props.className ? `prototype-message-panel ${props.className}` : 'prototype-message-panel'
    const activeMessages = props.selectedThread ? props.messagesByThread[props.selectedThread.id] ?? [] : []

    return (
        <aside className={className}>
            <div className={`prototype-message-panel__head${props.selectedThread ? ' prototype-message-panel__head--detail' : ''}`}>
                {props.selectedThread ? (
                    <button type="button" className="prototype-thread-detail__back" onClick={props.onBackToList}>
                        <Glyph name="back" />
                        <span>返回列表</span>
                    </button>
                ) : (
                    <div className="prototype-icon-pill prototype-icon-pill--small">
                        <Glyph name="digest" />
                    </div>
                )}

                <div className="prototype-message-panel__title">
                    <div className="prototype-message-panel__title-row">
                        <h2>{props.selectedThread ? props.selectedThread.title : props.heading.title}</h2>
                        {props.selectedThread ? (
                            <span className="prototype-thread-status-pill">{props.selectedThread.statusLabel}</span>
                        ) : null}
                    </div>
                    <p>{props.selectedThread ? props.selectedThread.updatedAt : props.heading.summary}</p>
                </div>

                {props.onClose ? (
                    <button type="button" className="prototype-message-panel__close" onClick={props.onClose} aria-label="关闭消息面板">
                        <Glyph name="close" />
                    </button>
                ) : null}
            </div>

            {props.selectedThread ? (
                <div className="prototype-message-panel__body">
                    <section className="prototype-thread-detail">
                        <ThreadConversation thread={props.selectedThread} messages={activeMessages} />
                    </section>
                </div>
            ) : (
                <div className="prototype-message-panel__body prototype-message-panel__body--inbox">
                    <ThreadInbox
                        threads={props.threads}
                        activeThreadId={null}
                        showHandled={props.showHandled}
                        onToggleHandled={props.onToggleHandled}
                        onSelect={props.onSelectThread}
                    />
                </div>
            )}
        </aside>
    )
}
```

```tsx
// omc-prototype/src/components/operator/ThreadQuickActions.tsx
import { usePrototypeStore } from '@/prototype/store'
import type { OperatorThread } from '@/prototype/types'

export default function ThreadQuickActions(props: { thread: OperatorThread }) {
    const { actions } = usePrototypeStore()

    if (props.thread.quickActions.length === 0 || props.thread.lifecycle === 'resolved' || props.thread.lifecycle === 'silent') {
        return null
    }

    return (
        <div className="prototype-thread-quick-actions">
            <span className="prototype-thread-quick-actions__label">建议动作</span>
            <div className="prototype-thread-quick-actions__list">
                {props.thread.quickActions.map((action) => (
                    <button
                        key={action.id}
                        type="button"
                        className={action.tone === 'primary' ? 'prototype-primary-button' : 'prototype-button--ghost'}
                        onClick={() => actions.performQuickAction(props.thread.id, action.id)}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
        </div>
    )
}
```

```tsx
// omc-prototype/src/components/operator/ThreadConversation.tsx
export default function ThreadConversation(props: {
    thread: OperatorThread
    messages: OperatorMessage[]
}) {
    const { actions } = usePrototypeStore()
    const runtime = useOmcAssistantRuntime({
        messages: props.messages,
        onSend(text) {
            actions.sendThreadReply(props.thread.id, text)
        },
    })

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <section className="prototype-thread-shell">
                <ThreadHeader thread={props.thread} />

                <ThreadPrimitive.Root className="prototype-thread-root">
                    <ThreadPrimitive.Viewport className="prototype-thread-viewport" autoScroll>
                        <div className="prototype-thread-message-list">
                            <ThreadPrimitive.Messages components={THREAD_COMPONENTS} />
                        </div>
                    </ThreadPrimitive.Viewport>
                </ThreadPrimitive.Root>

                <div className="prototype-thread-action-dock">
                    <ThreadQuickActions thread={props.thread} />

                    <ComposerPrimitive.Root className="prototype-thread-composer">
                        <div className="prototype-thread-composer__row">
                            <ComposerPrimitive.Input
                                className="prototype-thread-composer__input"
                                placeholder="继续追问，或直接告诉 Agent 要怎么做"
                                submitOnEnter
                                maxRows={4}
                            />
                            <ComposerPrimitive.Send className="prototype-primary-button">
                                发送
                            </ComposerPrimitive.Send>
                        </div>
                    </ComposerPrimitive.Root>
                </div>
            </section>
        </AssistantRuntimeProvider>
    )
}
```

- [ ] **Step 4: Apply the CSS polish and responsive tuning**

Use the new structural hooks to make the panel read as one calm workspace:
- larger title rhythm in detail mode
- quiet status pill
- denser transcript spacing
- docked quick actions + composer
- stronger mobile wrapping for briefing and action layers

```css
/* omc-prototype/src/index.css */
.prototype-message-panel__head--detail {
    align-items: start;
    gap: 10px 12px;
    padding-bottom: 10px;
}

.prototype-message-panel__title {
    display: grid;
    gap: 4px;
    min-width: 0;
}

.prototype-message-panel__title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.prototype-thread-status-pill {
    display: inline-flex;
    align-items: center;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(20, 32, 23, 0.06);
    color: var(--prototype-muted);
    font-size: 12px;
}

.prototype-thread-shell {
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 12px;
}

.prototype-thread-root {
    display: grid;
    min-height: 0;
    padding-top: 2px;
}

.prototype-thread-message-list {
    gap: 12px;
    padding: 4px 0 2px;
}

.prototype-thread-bubble {
    padding: 14px 16px;
    border-radius: 20px;
    max-width: 82%;
}

.prototype-thread-bubble--agent {
    border-radius: 20px 20px 20px 8px;
    background: rgba(255, 255, 255, 0.98);
}

.prototype-thread-bubble--user {
    border-radius: 20px 20px 8px 20px;
}

.prototype-thread-action-dock {
    display: grid;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--prototype-line);
}

.prototype-thread-quick-actions {
    display: grid;
    gap: 8px;
}

.prototype-thread-quick-actions__label {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--prototype-muted);
}

.prototype-thread-quick-actions__list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.prototype-thread-composer {
    padding-top: 0;
    border-top: 0;
}

.prototype-thread-composer__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: end;
    padding: 4px;
    border-radius: 20px;
    border: 1px solid var(--prototype-line);
    background: rgba(255, 255, 255, 0.78);
}

.prototype-thread-composer__input {
    min-height: 56px;
    border: 0;
    background: transparent;
    padding: 10px 12px;
}

.prototype-thread-composer .prototype-primary-button {
    min-height: 52px;
    padding: 0 18px;
}

@media (max-width: 860px) {
    .prototype-message-panel__head--detail {
        grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .prototype-thread-header__chips,
    .prototype-thread-quick-actions__list {
        gap: 6px;
    }

    .prototype-thread-bubble {
        max-width: 88%;
    }
}
```

- [ ] **Step 5: Run the full message-detail verification**

Run the automated checks first:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx src/components/operator/ThreadHeader.test.tsx src/components/operator/ThreadConversation.test.tsx
TMPDIR=/tmp bun run build
```

Expected:
- tests: PASS
- build: Vite production build succeeds with no TypeScript errors

Then run the manual visual check:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run dev -- --host 127.0.0.1
```

Manual checklist:
- open `http://127.0.0.1:5173/`
- open the right-rail message panel from dashboard
- open a waiting thread such as `做出每周投资简报`
- confirm the selected-thread title row shows title, updated time, and status together
- confirm the briefing layer shows context chips, `为什么现在需要你`, and `执行动作`
- confirm quick actions sit immediately above the composer and feel like one docked area
- confirm narrow-screen drawer mode still wraps chips and action pills without crushing the transcript

- [ ] **Step 6: Commit**

```bash
cd /Users/realizer/Code/hopi
git add omc-prototype/src/components/operator/MessageWorkspace.test.tsx omc-prototype/src/components/operator/ThreadConversation.test.tsx omc-prototype/src/components/operator/MessageWorkspace.tsx omc-prototype/src/components/operator/ThreadConversation.tsx omc-prototype/src/components/operator/ThreadQuickActions.tsx omc-prototype/src/index.css
git commit -m "feat: polish omc message detail workspace"
```
