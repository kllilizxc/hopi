# OMC New Project Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live-mode `新建项目` flow to `omc-prototype` that attaches an existing local git repo, auto-creates a planning seed only when planning is missing, and switches the UI onto the new real OMC program.

**Architecture:** Extend the live remote API client with bootstrap endpoints, add a small attach-and-seed workflow helper, build a controlled modal plus a live-header integration component, and tighten the live store so re-selecting the current program forces a fresh projection reload after seed retries.

**Tech Stack:** React 19, TanStack Router, TypeScript, Vitest, Testing Library, existing hub OMC REST endpoints.

---

### Task 1: Add Bootstrap API Client Methods

**Files:**
- Create: `omc-prototype/src/prototype/remoteApi.test.ts`
- Modify: `omc-prototype/src/prototype/remoteApi.tsx`

- [ ] **Step 1: Write the failing API client tests**

```ts
// omc-prototype/src/prototype/remoteApi.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrototypeRemoteApiClient } from './remoteApi'

const bootstrapResponse = {
    program: {
        id: 'omc-fresh',
        namespace: 'default',
        name: 'Fresh Repo',
        repoRoot: '/tmp/fresh',
        planningRoot: '/tmp/fresh/.planning',
        primaryBranch: 'main',
        targetBranch: 'main',
        counts: {
            Planning: 0,
            Running: 0,
            Review: 0,
            Done: 0,
        },
        lastActivityAt: null,
        createdAt: 0,
        updatedAt: 0,
    },
    planning: {
        status: 'missing',
        planningRoot: '/tmp/fresh/.planning',
        hasPlanning: false,
        hasPlans: false,
        phaseCount: 0,
        planCount: 0,
        seedFiles: [],
    },
} as const

describe('PrototypeRemoteApiClient bootstrap methods', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('posts repoRoot and optional name to attach-local-repo', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(bootstrapResponse), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }))

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')
        await api.attachLocalRepo({
            repoRoot: '/tmp/fresh',
            name: 'Fresh Repo',
        })

        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/omc/programs/attach-local-repo',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    authorization: 'Bearer jwt-token',
                    'content-type': 'application/json',
                }),
                body: JSON.stringify({
                    repoRoot: '/tmp/fresh',
                    name: 'Fresh Repo',
                }),
            }),
        )
    })

    it('posts an empty payload to create-planning-seed', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(bootstrapResponse), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }))

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')
        await api.createPlanningSeed('omc-fresh')

        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/omc/programs/omc-fresh/create-planning-seed',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    authorization: 'Bearer jwt-token',
                    'content-type': 'application/json',
                }),
                body: JSON.stringify({}),
            }),
        )
    })
})
```

- [ ] **Step 2: Run the API tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/remoteApi.test.ts
```

Expected:

- FAIL because `PrototypeRemoteApiClient` does not yet expose `attachLocalRepo()` or `createPlanningSeed()`

- [ ] **Step 3: Implement the bootstrap client methods**

```ts
// omc-prototype/src/prototype/remoteApi.tsx
import type {
    OmcAttachLocalRepoRequest,
    OmcGuidedPlanningStateResponse,
    OmcMergeStatus,
    OmcPlanControlResponse,
    OmcPlanDetailResponse,
    OmcPlanRuntimeListResponse,
    OmcPlanningIndexResponse,
    OmcProgramBootstrapResponse,
    OmcProgramListResponse,
    OmcProgramOverviewResponse,
    OmcReviewReopenAction,
    Session,
} from '@hopi/protocol/types'

export class PrototypeRemoteApiClient {
    // existing constructor + request()

    async attachLocalRepo(input: OmcAttachLocalRepoRequest): Promise<OmcProgramBootstrapResponse> {
        return await this.request<OmcProgramBootstrapResponse>('/api/omc/programs/attach-local-repo', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify(input),
        })
    }

    async createPlanningSeed(programId: string): Promise<OmcProgramBootstrapResponse> {
        return await this.request<OmcProgramBootstrapResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/create-planning-seed`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({}),
            },
        )
    }
}
```

- [ ] **Step 4: Run the API tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/remoteApi.test.ts
```

Expected:

- PASS with 2 tests green

- [ ] **Step 5: Commit the API client slice**

```bash
git add omc-prototype/src/prototype/remoteApi.tsx omc-prototype/src/prototype/remoteApi.test.ts
git commit -m "feat: add OMC bootstrap API client methods"
```

### Task 2: Make Live Store Re-Selecting the Current Program Reload Projection

**Files:**
- Create: `omc-prototype/src/prototype/store.live.test.tsx`
- Modify: `omc-prototype/src/prototype/store.tsx`

- [ ] **Step 1: Write the failing live-store refresh test**

```tsx
// omc-prototype/src/prototype/store.live.test.tsx
import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrototypeRemoteApiProvider } from './remoteApi'
import { PrototypeStoreProvider, usePrototypeStore } from './store'

class FakeEventSource {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    close() {}
}

function createLiveApi() {
    return {
        getPrograms: vi.fn().mockResolvedValue({
            programs: [
                {
                    id: 'omc-fresh',
                    namespace: 'default',
                    name: 'Fresh Repo',
                    repoRoot: '/tmp/fresh',
                    planningRoot: '/tmp/fresh/.planning',
                    primaryBranch: 'main',
                    targetBranch: 'main',
                    counts: { Planning: 0, Running: 0, Review: 0, Done: 0 },
                    lastActivityAt: null,
                    createdAt: 0,
                    updatedAt: 0,
                },
            ],
        }),
        getProgram: vi.fn().mockResolvedValue({
            program: {
                id: 'omc-fresh',
                namespace: 'default',
                name: 'Fresh Repo',
                repoRoot: '/tmp/fresh',
                planningRoot: '/tmp/fresh/.planning',
                primaryBranch: 'main',
                targetBranch: 'main',
                counts: { Planning: 0, Running: 0, Review: 0, Done: 0 },
                lastActivityAt: null,
                createdAt: 0,
                updatedAt: 0,
            },
            planning: {
                status: 'seeded',
                planningRoot: '/tmp/fresh/.planning',
                hasPlanning: true,
                hasPlans: false,
                phaseCount: 0,
                planCount: 0,
                seedFiles: [],
            },
        }),
        getGuidedPlanningState: vi.fn().mockResolvedValue({
            programId: 'omc-fresh',
            planning: {
                status: 'seeded',
                planningRoot: '/tmp/fresh/.planning',
                hasPlanning: true,
                hasPlans: false,
                phaseCount: 0,
                planCount: 0,
                seedFiles: [],
            },
            run: null,
        }),
        getPlanningIndex: vi.fn().mockResolvedValue({
            program: {
                id: 'omc-fresh',
                name: 'Fresh Repo',
                repoRoot: '/tmp/fresh',
            },
            phases: [],
        }),
        getPlanRuntimes: vi.fn().mockResolvedValue({
            programId: 'omc-fresh',
            runtimes: [],
        }),
        createEventsUrl: vi.fn().mockReturnValue('http://example.test/events'),
    }
}

describe('LivePrototypeStoreProvider', () => {
    beforeEach(() => {
        vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('reloads the live projection when selecting the already-active program', async () => {
        const api = createLiveApi()
        const wrapper = ({ children }: { children: ReactNode }) => (
            createElement(PrototypeRemoteApiProvider, { api: api as never },
                createElement(PrototypeStoreProvider, null, children))
        )

        const { result } = renderHook(() => usePrototypeStore(), { wrapper })

        await waitFor(() => {
            expect(result.current.state.attachedProgramId).toBe('omc-fresh')
        })
        expect(api.getProgram).toHaveBeenCalledTimes(1)

        await act(async () => {
            result.current.actions.selectProgram?.('omc-fresh')
        })

        await waitFor(() => {
            expect(api.getProgram).toHaveBeenCalledTimes(2)
        })
    })
})
```

- [ ] **Step 2: Run the live-store test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/store.live.test.tsx
```

Expected:

- FAIL because selecting the current program id is currently a no-op and does not re-fetch projection

- [ ] **Step 3: Change same-program selection into an explicit refresh**

```ts
// omc-prototype/src/prototype/store.tsx
const actions = useMemo<PrototypeActionDispatcher>(() => ({
    attachDemoProgram() {
    },
    selectProgram(programId) {
        if (programId === selectedProgramId) {
            void refreshProjection()
            return
        }

        setTraceSelection(null)
        setProjection(null)
        setError(null)
        setLoading(true)
        setThreadState({
            threadsById: {},
            messagesByThread: {},
            activeThreadId: null,
            activeThreadSelectionId: 0,
        })
        setSelectedProgramId(programId)
    },
    // existing actions...
}), [appendConversationMessages, performQuickAction, refreshProjection, runThreadReply, selectedProgramId, setActiveThread])
```

- [ ] **Step 4: Run the live-store test to verify it passes**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/store.live.test.tsx
```

Expected:

- PASS with 1 test green

- [ ] **Step 5: Commit the live-store refresh fix**

```bash
git add omc-prototype/src/prototype/store.tsx omc-prototype/src/prototype/store.live.test.tsx
git commit -m "feat: refresh live projection on same-program selection"
```

### Task 3: Add the Attach-and-Seed Workflow Helper

**Files:**
- Create: `omc-prototype/src/prototype/newProjectBootstrap.ts`
- Create: `omc-prototype/src/prototype/newProjectBootstrap.test.ts`

- [ ] **Step 1: Write the failing workflow helper tests**

```ts
// omc-prototype/src/prototype/newProjectBootstrap.test.ts
import { describe, expect, it, vi } from 'vitest'
import { bootstrapNewProject } from './newProjectBootstrap'

function makeBootstrapResponse(status: 'missing' | 'detected' | 'seeded') {
    return {
        program: {
            id: 'omc-fresh',
            namespace: 'default',
            name: 'Fresh Repo',
            repoRoot: '/tmp/fresh',
            planningRoot: '/tmp/fresh/.planning',
            primaryBranch: 'main',
            targetBranch: 'main',
            counts: { Planning: 0, Running: 0, Review: 0, Done: 0 },
            lastActivityAt: null,
            createdAt: 0,
            updatedAt: 0,
        },
        planning: {
            status,
            planningRoot: '/tmp/fresh/.planning',
            hasPlanning: status !== 'missing',
            hasPlans: false,
            phaseCount: 0,
            planCount: 0,
            seedFiles: [],
        },
    } as const
}

describe('bootstrapNewProject', () => {
    it('returns attach success without creating a seed when planning already exists', async () => {
        const api = {
            attachLocalRepo: vi.fn().mockResolvedValue(makeBootstrapResponse('detected')),
            createPlanningSeed: vi.fn(),
        }

        const result = await bootstrapNewProject(api as never, {
            repoRoot: '/tmp/fresh',
            name: 'Fresh Repo',
        })

        expect(result).toEqual(expect.objectContaining({
            kind: 'success',
            programId: 'omc-fresh',
            seedCreated: false,
        }))
        expect(api.createPlanningSeed).not.toHaveBeenCalled()
    })

    it('creates a seed when attach returns missing planning', async () => {
        const api = {
            attachLocalRepo: vi.fn().mockResolvedValue(makeBootstrapResponse('missing')),
            createPlanningSeed: vi.fn().mockResolvedValue(makeBootstrapResponse('seeded')),
        }

        const result = await bootstrapNewProject(api as never, {
            repoRoot: '/tmp/fresh',
            name: 'Fresh Repo',
        })

        expect(api.createPlanningSeed).toHaveBeenCalledWith('omc-fresh')
        expect(result).toEqual(expect.objectContaining({
            kind: 'success',
            programId: 'omc-fresh',
            seedCreated: true,
        }))
    })

    it('returns partial success when seed creation fails after a successful attach', async () => {
        const api = {
            attachLocalRepo: vi.fn().mockResolvedValue(makeBootstrapResponse('missing')),
            createPlanningSeed: vi.fn().mockRejectedValue(new Error('seed failed')),
        }

        const result = await bootstrapNewProject(api as never, {
            repoRoot: '/tmp/fresh',
            name: 'Fresh Repo',
        })

        expect(result).toEqual(expect.objectContaining({
            kind: 'seed-error',
            programId: 'omc-fresh',
            error: 'seed failed',
        }))
    })
})
```

- [ ] **Step 2: Run the workflow tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/newProjectBootstrap.test.ts
```

Expected:

- FAIL because `bootstrapNewProject()` does not exist yet

- [ ] **Step 3: Implement the attach-and-seed helper**

```ts
// omc-prototype/src/prototype/newProjectBootstrap.ts
import type { OmcProgramBootstrapResponse } from '@hopi/protocol/types'
import type { PrototypeRemoteApiClient } from './remoteApi'

export type BootstrapNewProjectInput = {
    repoRoot: string
    name?: string
}

export type BootstrapNewProjectResult =
    | {
        kind: 'success'
        programId: string
        seedCreated: boolean
        bootstrap: OmcProgramBootstrapResponse
    }
    | {
        kind: 'seed-error'
        programId: string
        seedCreated: false
        attach: OmcProgramBootstrapResponse
        error: string
    }

export async function bootstrapNewProject(
    api: Pick<PrototypeRemoteApiClient, 'attachLocalRepo' | 'createPlanningSeed'>,
    input: BootstrapNewProjectInput,
): Promise<BootstrapNewProjectResult> {
    const attach = await api.attachLocalRepo({
        repoRoot: input.repoRoot,
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    })

    if (attach.planning.status !== 'missing') {
        return {
            kind: 'success',
            programId: attach.program.id,
            seedCreated: false,
            bootstrap: attach,
        }
    }

    try {
        const seeded = await api.createPlanningSeed(attach.program.id)
        return {
            kind: 'success',
            programId: attach.program.id,
            seedCreated: true,
            bootstrap: seeded,
        }
    } catch (error) {
        return {
            kind: 'seed-error',
            programId: attach.program.id,
            seedCreated: false,
            attach,
            error: error instanceof Error ? error.message : 'Could not create planning seed',
        }
    }
}
```

- [ ] **Step 4: Run the workflow tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/newProjectBootstrap.test.ts
```

Expected:

- PASS with 3 tests green

- [ ] **Step 5: Commit the workflow helper**

```bash
git add omc-prototype/src/prototype/newProjectBootstrap.ts omc-prototype/src/prototype/newProjectBootstrap.test.ts
git commit -m "feat: add OMC new-project bootstrap helper"
```

### Task 4: Build the Controlled New Project Modal

**Files:**
- Create: `omc-prototype/src/components/NewProjectModal.tsx`
- Create: `omc-prototype/src/components/NewProjectModal.test.tsx`

- [ ] **Step 1: Write the failing modal tests**

```tsx
// omc-prototype/src/components/NewProjectModal.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NewProjectModal from './NewProjectModal'

describe('NewProjectModal', () => {
    it('renders repo path and project name fields and submits through the primary action', () => {
        const onClose = vi.fn()
        const onSubmit = vi.fn()
        const onRepoRootChange = vi.fn()
        const onNameChange = vi.fn()
        const onRetrySeed = vi.fn()

        render(
            <NewProjectModal
                open
                repoRoot=""
                name=""
                pending={false}
                error={null}
                partialSuccess={null}
                onRepoRootChange={onRepoRootChange}
                onNameChange={onNameChange}
                onSubmit={onSubmit}
                onRetrySeed={onRetrySeed}
                onClose={onClose}
            />,
        )

        fireEvent.change(screen.getByLabelText('Repo 路径'), {
            target: { value: '/tmp/fresh' },
        })
        fireEvent.change(screen.getByLabelText('项目名'), {
            target: { value: 'Fresh Repo' },
        })
        fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

        expect(onRepoRootChange).toHaveBeenCalledWith('/tmp/fresh')
        expect(onNameChange).toHaveBeenCalledWith('Fresh Repo')
        expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('shows the seed retry action after partial success', () => {
        const onRetrySeed = vi.fn()

        render(
            <NewProjectModal
                open
                repoRoot="/tmp/fresh"
                name="Fresh Repo"
                pending={false}
                error="项目已接入，但 planning seed 创建失败"
                partialSuccess={{
                    programId: 'omc-fresh',
                    programName: 'Fresh Repo',
                }}
                onRepoRootChange={() => {}}
                onNameChange={() => {}}
                onSubmit={() => {}}
                onRetrySeed={onRetrySeed}
                onClose={() => {}}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: '重试 seed' }))
        expect(onRetrySeed).toHaveBeenCalledTimes(1)
    })
})
```

- [ ] **Step 2: Run the modal tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/NewProjectModal.test.tsx
```

Expected:

- FAIL because `NewProjectModal.tsx` does not exist yet

- [ ] **Step 3: Implement the controlled modal**

```tsx
// omc-prototype/src/components/NewProjectModal.tsx
type NewProjectPartialSuccess = {
    programId: string
    programName: string
}

export default function NewProjectModal(props: {
    open: boolean
    repoRoot: string
    name: string
    pending: boolean
    error: string | null
    partialSuccess: NewProjectPartialSuccess | null
    onRepoRootChange: (value: string) => void
    onNameChange: (value: string) => void
    onSubmit: () => void
    onRetrySeed: () => void
    onClose: () => void
}) {
    if (!props.open) {
        return null
    }

    return (
        <div className="prototype-modal-backdrop" role="presentation" onClick={props.onClose}>
            <div className="prototype-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onClick={(event) => event.stopPropagation()}>
                <div className="prototype-modal__header">
                    <div>
                        <p className="prototype-eyebrow">真实 OMC runtime</p>
                        <h2 id="new-project-title">新建项目</h2>
                    </div>
                    <button type="button" className="prototype-button--ghost" onClick={props.onClose} disabled={props.pending}>
                        取消
                    </button>
                </div>

                <p className="prototype-modal__lede">
                    关联一个已存在的本地 git 仓库。若仓库还没有 planning，OMC 会自动补一个最小 planning seed。
                </p>

                <label className="prototype-form-field">
                    <span>Repo 路径</span>
                    <input
                        value={props.repoRoot}
                        onChange={(event) => props.onRepoRootChange(event.target.value)}
                        placeholder="/absolute/path/to/repo"
                        disabled={props.pending}
                    />
                </label>

                <label className="prototype-form-field">
                    <span>项目名</span>
                    <input
                        value={props.name}
                        onChange={(event) => props.onNameChange(event.target.value)}
                        placeholder="可选；留空时使用仓库名"
                        disabled={props.pending}
                    />
                </label>

                {props.error ? (
                    <p className="prototype-form-error">{props.error}</p>
                ) : null}

                {props.partialSuccess ? (
                    <div className="prototype-inline-actions">
                        <button type="button" className="prototype-button--ghost" onClick={props.onRetrySeed} disabled={props.pending}>
                            重试 seed
                        </button>
                    </div>
                ) : null}

                <div className="prototype-inline-actions">
                    <button type="button" className="prototype-primary-button" onClick={props.onSubmit} disabled={props.pending || !props.repoRoot.trim()}>
                        {props.pending ? 'Creating…' : '创建项目'}
                    </button>
                </div>
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Run the modal tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/NewProjectModal.test.tsx
```

Expected:

- PASS with 2 tests green

- [ ] **Step 5: Commit the modal component**

```bash
git add omc-prototype/src/components/NewProjectModal.tsx omc-prototype/src/components/NewProjectModal.test.tsx
git commit -m "feat: add OMC new project modal"
```

### Task 5: Wire the Live Header Entry Point, Success States, and Styling

**Files:**
- Create: `omc-prototype/src/components/LiveWorkspaceBar.tsx`
- Create: `omc-prototype/src/components/LiveWorkspaceBar.test.tsx`
- Modify: `omc-prototype/src/router.tsx`
- Modify: `omc-prototype/src/index.css`

- [ ] **Step 1: Write the failing live-header integration test**

```tsx
// omc-prototype/src/components/LiveWorkspaceBar.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LiveWorkspaceBar from './LiveWorkspaceBar'

const selectProgram = vi.fn()
const bootstrapNewProject = vi.fn()

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => ({
        actions: {
            selectProgram,
            clearPlanTrace: vi.fn(),
        },
    }),
}))

vi.mock('@/prototype/remoteApi', () => ({
    usePrototypeRemoteApi: () => ({
        attachLocalRepo: vi.fn(),
        createPlanningSeed: vi.fn(),
    }),
}))

vi.mock('@/prototype/newProjectBootstrap', () => ({
    bootstrapNewProject: (...args: unknown[]) => bootstrapNewProject(...args),
}))

describe('LiveWorkspaceBar', () => {
    it('opens the modal and switches to the newly created program after success', async () => {
        bootstrapNewProject.mockResolvedValue({
            kind: 'success',
            programId: 'omc-fresh',
            seedCreated: true,
            bootstrap: {
                program: { id: 'omc-fresh', name: 'Fresh Repo' },
            },
        })

        render(
            <LiveWorkspaceBar
                programName="OMC Workspace"
                repoRoot="/Users/demo/repo"
                checkpointLabel="策略成形"
                checkpointSynopsis="系统正在建立第一批真实计划。"
                activeInboxCount={0}
                programs={[{ id: 'omc-default', name: 'OMC Workspace', repoRoot: '/Users/demo/repo' }]}
                selectedProgramId="omc-default"
                onProgramChange={() => {}}
                onOpenInbox={() => {}}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
        fireEvent.change(screen.getByLabelText('Repo 路径'), {
            target: { value: '/tmp/fresh' },
        })
        fireEvent.change(screen.getByLabelText('项目名'), {
            target: { value: 'Fresh Repo' },
        })
        fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

        await waitFor(() => {
            expect(selectProgram).toHaveBeenCalledWith('omc-fresh')
        })
        expect(screen.getByText('项目已接入，并已创建 planning seed')).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run the live-header test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/LiveWorkspaceBar.test.tsx
```

Expected:

- FAIL because `LiveWorkspaceBar.tsx` does not exist yet and the header flow is still hard-coded inside `router.tsx`

- [ ] **Step 3: Implement the live header component and route wiring**

```tsx
// omc-prototype/src/components/LiveWorkspaceBar.tsx
import { startTransition, useMemo, useState } from 'react'
import { Glyph } from '@/components/Visuals'
import NewProjectModal from '@/components/NewProjectModal'
import { bootstrapNewProject } from '@/prototype/newProjectBootstrap'
import { usePrototypeRemoteApi } from '@/prototype/remoteApi'
import { usePrototypeStore } from '@/prototype/store'

export default function LiveWorkspaceBar(props: {
    programName: string
    repoRoot: string
    checkpointLabel: string
    checkpointSynopsis: string
    activeInboxCount: number
    programs: Array<{ id: string; name: string; repoRoot: string }>
    selectedProgramId: string
    onProgramChange: (programId: string) => void
    onOpenInbox: () => void
}) {
    const api = usePrototypeRemoteApi()
    const { actions } = usePrototypeStore()
    const [modalOpen, setModalOpen] = useState(false)
    const [repoRoot, setRepoRoot] = useState('')
    const [name, setName] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [flash, setFlash] = useState<string | null>(null)
    const [partialSuccess, setPartialSuccess] = useState<null | { programId: string; programName: string }>(null)

    const selectedProgram = useMemo(
        () => props.programs.find((program) => program.id === props.selectedProgramId) ?? null,
        [props.programs, props.selectedProgramId],
    )

    async function handleSubmit() {
        setPending(true)
        setError(null)
        setFlash(null)

        const result = await bootstrapNewProject(api, {
            repoRoot,
            ...(name.trim() ? { name } : {}),
        }).catch((submitError) => {
            setError(submitError instanceof Error ? submitError.message : '项目未接入')
            return null
        })

        if (!result) {
            setPending(false)
            return
        }

        startTransition(() => {
            actions.selectProgram?.(result.programId)
        })

        if (result.kind === 'seed-error') {
            setPartialSuccess({
                programId: result.programId,
                programName: result.attach.program.name,
            })
            setError('项目已接入，但 planning seed 创建失败')
            setPending(false)
            return
        }

        setPartialSuccess(null)
        setPending(false)
        setModalOpen(false)
        setRepoRoot('')
        setName('')
        setFlash(result.seedCreated ? '项目已接入，并已创建 planning seed' : '项目已接入')
    }

    async function handleRetrySeed() {
        if (!partialSuccess) {
            return
        }

        setPending(true)
        setError(null)

        try {
            await api.createPlanningSeed(partialSuccess.programId)
            startTransition(() => {
                actions.selectProgram?.(partialSuccess.programId)
            })
            setFlash('项目已接入，并已创建 planning seed')
            setPartialSuccess(null)
            setModalOpen(false)
            setRepoRoot('')
            setName('')
        } catch (retryError) {
            setError(retryError instanceof Error ? retryError.message : 'planning seed 重试失败')
        } finally {
            setPending(false)
        }
    }

    return (
        <>
            <div className="prototype-workspace-bar">
                <div className="prototype-workspace-bar__identity">
                    <p className="prototype-eyebrow">One-Man-Company 2.0</p>
                    <strong>{props.programName}</strong>
                    <span>{props.repoRoot}</span>
                </div>

                <label className="prototype-program-picker">
                    <span>项目</span>
                    <select
                        value={props.selectedProgramId}
                        onChange={(event) => props.onProgramChange(event.target.value)}
                    >
                        {props.programs.map((program) => (
                            <option key={program.id} value={program.id}>
                                {program.name}
                            </option>
                        ))}
                    </select>
                </label>

                <div className="prototype-workspace-bar__status">
                    <span>{props.checkpointLabel}</span>
                    <small>{props.checkpointSynopsis}</small>
                    {selectedProgram ? <small>{selectedProgram.repoRoot}</small> : null}
                </div>

                <div className="prototype-workspace-bar__actions">
                    <button type="button" className="prototype-button--ghost" onClick={() => setModalOpen(true)}>
                        新建项目
                    </button>
                    <button type="button" className="prototype-message-toggle prototype-message-toggle--header" onClick={props.onOpenInbox}>
                        <Glyph name="digest" />
                        <span>消息</span>
                        {props.activeInboxCount > 0 ? <strong>{props.activeInboxCount}</strong> : null}
                    </button>
                </div>
            </div>

            {flash ? <p className="prototype-success-banner">{flash}</p> : null}

            <NewProjectModal
                open={modalOpen}
                repoRoot={repoRoot}
                name={name}
                pending={pending}
                error={error}
                partialSuccess={partialSuccess}
                onRepoRootChange={setRepoRoot}
                onNameChange={setName}
                onSubmit={() => void handleSubmit()}
                onRetrySeed={() => void handleRetrySeed()}
                onClose={() => {
                    if (!pending) {
                        setModalOpen(false)
                    }
                }}
            />
        </>
    )
}
```

```tsx
// omc-prototype/src/router.tsx
import LiveWorkspaceBar from '@/components/LiveWorkspaceBar'

function RootLayout() {
    // existing hooks and state

    return (
        <OperatorSurfaceProvider value={operatorSurface}>
            <div className="prototype-shell">
                <header className="prototype-shell__header">
                    {isLive ? (
                        <LiveWorkspaceBar
                            programName={portfolio?.program.name ?? 'OMC Workspace'}
                            repoRoot={portfolio?.program.repoRoot ?? '真实 OMC runtime'}
                            checkpointLabel={portfolio ? checkpoint.label : '未连接'}
                            checkpointSynopsis={portfolio ? checkpoint.synopsis : '输入 access token 后接入真实 OMC runtime'}
                            activeInboxCount={activeInboxCount}
                            programs={live?.programs ?? []}
                            selectedProgramId={live?.selectedProgramId ?? ''}
                            onProgramChange={(programId) => actions.selectProgram?.(programId)}
                            onOpenInbox={operatorSurface.openInbox}
                        />
                    ) : (
                        // existing demo header
                    )}
                </header>
                {/* existing layout */}
            </div>
        </OperatorSurfaceProvider>
    )
}
```

- [ ] **Step 4: Add the styling and run the integration test**

```css
/* omc-prototype/src/index.css */
.prototype-workspace-bar__actions {
    display: flex;
    align-items: center;
    gap: 12px;
}

.prototype-success-banner {
    margin: 12px 0 0;
    padding: 12px 16px;
    border: 1px solid rgba(55, 132, 102, 0.2);
    border-radius: 16px;
    background: rgba(233, 246, 240, 0.85);
    color: #1f5a44;
}

.prototype-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(226, 231, 226, 0.52);
    backdrop-filter: blur(18px);
}

.prototype-modal {
    width: min(560px, 100%);
    padding: 24px;
    border: 1px solid rgba(160, 172, 164, 0.28);
    border-radius: 28px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 28px 80px rgba(88, 100, 92, 0.18);
}

.prototype-modal__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
}

.prototype-modal__lede {
    margin: 12px 0 20px;
    color: rgba(35, 55, 46, 0.74);
}

.prototype-form-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
}

.prototype-form-field input {
    width: 100%;
}

.prototype-form-error {
    margin: 0 0 16px;
    color: #9b3d2f;
}
```

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/LiveWorkspaceBar.test.tsx
```

Expected:

- PASS with 1 test green

- [ ] **Step 5: Commit the live entrypoint integration**

```bash
git add omc-prototype/src/components/LiveWorkspaceBar.tsx omc-prototype/src/components/LiveWorkspaceBar.test.tsx omc-prototype/src/router.tsx omc-prototype/src/index.css
git commit -m "feat: add OMC new project live bootstrap entrypoint"
```

### Task 6: Run Full Regression and Close Out

**Files:**
- Verify only; no new files

- [ ] **Step 1: Run the focused test set together**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/remoteApi.test.ts src/prototype/store.live.test.tsx src/prototype/newProjectBootstrap.test.ts src/components/NewProjectModal.test.tsx src/components/LiveWorkspaceBar.test.tsx
```

Expected:

- PASS with all new tests green

- [ ] **Step 2: Run the full package test suite**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test
```

Expected:

- PASS with existing and new component/prototype tests green

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run typecheck
```

Expected:

- PASS with no TypeScript errors

- [ ] **Step 4: Run production build**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run build
```

Expected:

- PASS and emit a production Vite bundle

- [ ] **Step 5: Commit the verified final state**

```bash
git add omc-prototype
git commit -m "feat: add OMC new project bootstrap flow"
```

## Self-Review

Spec coverage check:

- header-level `新建项目` entry: Task 5
- attach existing local repo: Tasks 1, 3, 5
- auto-create seed only when planning is missing: Task 3
- same-program refresh after seed retry: Task 2
- inline error and partial-success handling: Tasks 3, 4, 5
- no repo creation / no guided planning in this slice: preserved by task scope

Placeholder scan:

- no `TBD`, `TODO`, or “implement later” instructions remain
- each code-touching step includes concrete code
- each verification step includes exact commands and expected results

Type consistency:

- remote API method names match the existing OMC client naming
- helper result kinds are stable: `success` and `seed-error`
- UI wiring consistently calls `actions.selectProgram?.(programId)` after attach and seed retry
