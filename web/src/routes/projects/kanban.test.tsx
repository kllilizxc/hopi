import { fireEvent, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { Task } from '@/types/api'
import { ProjectKanbanBoard } from './kanban'

const indexCss = readFileSync('src/index.css', 'utf8').replace(/\r\n/g, '\n')

const mocks = vi.hoisted(() => ({
    tasks: [] as Task[],
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addToast: vi.fn()
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useMatchRoute: () => () => null
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: {} })
}))

vi.mock('@/lib/toast-context', () => ({
    useToast: () => ({ addToast: mocks.addToast })
}))

vi.mock('@/hooks/queries/useProject', () => ({
    useProject: () => ({
        project: { defaultAgentFlavor: 'codex' },
        isLoading: false,
        error: null,
        refetch: vi.fn()
    })
}))

vi.mock('@/hooks/queries/useTasks', () => ({
    useTasks: () => ({
        tasks: mocks.tasks,
        isLoading: false,
        error: null,
        refetch: vi.fn()
    })
}))

vi.mock('@/hooks/mutations/useUpdateTask', () => ({
    useUpdateTask: () => ({ updateTask: mocks.updateTask })
}))

vi.mock('@/hooks/mutations/useDeleteTask', () => ({
    useDeleteTask: () => ({ deleteTask: mocks.deleteTask })
}))

function createTask(overrides: Partial<Task> = {}): Task {
    return {
        id: overrides.id ?? 'task-1',
        projectId: overrides.projectId ?? 'project-1',
        goalId: overrides.goalId ?? 'goal-1',
        title: overrides.title ?? 'Inspect repository state',
        description: overrides.description ?? null,
        status: overrides.status ?? 'done',
        tag: overrides.tag ?? null,
        blockedReason: overrides.blockedReason ?? null,
        blockedAt: overrides.blockedAt ?? null,
        blockedSource: overrides.blockedSource ?? null,
        blockedSessionId: overrides.blockedSessionId ?? null,
        priority: overrides.priority ?? null,
        sortKey: overrides.sortKey ?? 1,
        activeSessionId: overrides.activeSessionId ?? null,
        workspaceId: overrides.workspaceId ?? null,
        agentFlavor: overrides.agentFlavor ?? 'codex',
        permissionMode: overrides.permissionMode ?? null,
        model: overrides.model ?? null,
        modelMode: overrides.modelMode ?? null,
        attachments: overrides.attachments ?? null,
        source: overrides.source ?? null,
        sourceTaskId: overrides.sourceTaskId ?? null,
        contract: overrides.contract ?? null,
        handoff: overrides.handoff ?? null,
        evidence: overrides.evidence ?? null,
        workflowProfile: overrides.workflowProfile ?? 'default',
        workflowPhase: overrides.workflowPhase ?? null,
        subTasks: overrides.subTasks ?? [
            {
                id: 'subtask-1',
                content: 'Review affected helper tests against contract',
                status: 'completed',
                priority: 'medium'
            }
        ],
        subTasksUpdatedAt: overrides.subTasksUpdatedAt ?? null,
        worktreeMergedAt: overrides.worktreeMergedAt ?? null,
        worktreeMergeCommit: overrides.worktreeMergeCommit ?? null,
        mergedDiffSnapshot: overrides.mergedDiffSnapshot ?? null,
        mergeRuntime: overrides.mergeRuntime ?? null,
        previewRuntime: overrides.previewRuntime ?? null,
        initRuntime: overrides.initRuntime ?? null,
        dependencyTaskList: overrides.dependencyTaskList ?? [],
        createdAt: overrides.createdAt ?? 1,
        updatedAt: overrides.updatedAt ?? 2,
        finishedAt: overrides.finishedAt ?? null,
        archivedAt: overrides.archivedAt ?? null
    }
}

describe('ProjectKanbanBoard', () => {
    it('renders solid columns and theme-aware task hover surfaces', () => {
        mocks.tasks = [createTask()]

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        const column = document.querySelector('[data-kanban-column-status="done"]') as HTMLElement | null
        const columnStyle = column?.getAttribute('style') ?? ''
        expect(column).not.toBeNull()
        expect(column!).toHaveClass('kanban-column')
        expect(columnStyle).toContain('--kanban-column-bg: var(--app-secondary-bg)')
        expect(columnStyle).not.toContain('color-mix')
        expect(columnStyle).not.toContain('radial-gradient')

        expect(indexCss).not.toContain('.kanban-column:hover')

        const taskCard = screen.getByText('Inspect repository state').closest('[data-kanban-task-id]')
        expect(taskCard).not.toBeNull()
        expect(taskCard!).not.toHaveClass('kanban-task-card')
        const taskCardStyle = taskCard?.getAttribute('style') ?? ''
        expect(taskCardStyle).toContain('--app-card-hover-bg: color-mix(in srgb, var(--app-bg) 90%, #000 10%)')
        expect(taskCardStyle).toContain('--app-card-hover-glow: color-mix(in srgb, var(--kanban-accent-1) 42%, transparent)')
        expect(taskCardStyle).toContain('--app-card-selected-bg: color-mix(in srgb, var(--app-bg) 94%, var(--kanban-accent-1) 6%)')
        expect(taskCardStyle).toContain('--app-card-selected-glow: color-mix(in srgb, var(--kanban-accent-1) 24%, transparent)')
        expect(indexCss).toContain('var(--app-card-hover-glow, transparent)')
        expect(indexCss).toContain('var(--app-card-hover-shadow-1')
        expect(indexCss).toContain('.app-interactive-card::before {\n    content: "";\n    position: absolute;\n    inset: 0;\n    z-index: 0;')
        expect(indexCss).toContain('.app-interactive-card > * {\n    position: relative;\n    z-index: 1;')
    })

    it('uses a soft shadow boundary for expanded subtasks', () => {
        mocks.tasks = [createTask()]

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Expand subtasks' }))

        const subTaskPanel = screen.getByText('Review affected helper tests against contract').parentElement?.parentElement
        expect(subTaskPanel).not.toBeNull()
        expect(subTaskPanel!).not.toHaveClass('app-shadow-border')
        expect(subTaskPanel!).toHaveClass('app-shadow-control')
    })

    it('projects blocked merge tasks into the merging lane instead of rendering a blocked column', () => {
        mocks.tasks = [createTask({
            id: 'task-merge-blocked',
            title: 'Repair merge conflict',
            status: 'blocked',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'merge-session-1',
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 20,
                completedAt: 30,
                retryCount: 1,
                failureFingerprint: 'merge-blocked',
                latestNote: 'Conflict still unresolved.',
                blockedReason: 'Need manual conflict resolution.'
            }
        })]

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        expect(document.querySelector('[data-kanban-column-status="blocked"]')).toBeNull()
        const mergingColumn = document.querySelector('[data-kanban-column-status="merging"]')
        expect(mergingColumn).not.toBeNull()
        expect(mergingColumn?.textContent).toContain('Repair merge conflict')
    })

    it('renders goal todo dependencies on task cards', () => {
        mocks.tasks = [createTask({
            id: 'integrate-flow',
            title: 'Integrate expedition deck flow',
            status: 'planning',
            dependencyTaskList: [
                {
                    ref: 'define-library',
                    taskId: 'define-library',
                    title: 'Define deck library ownership',
                    status: 'done'
                },
                {
                    ref: 'validate-services',
                    taskId: null,
                    title: null,
                    status: null
                }
            ]
        })]

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        const dependencyList = screen.getByTestId('task-dependencies-integrate-flow')
        expect(dependencyList).toHaveTextContent('Depends on')
        expect(dependencyList).toHaveTextContent('Define deck library ownership')
        expect(dependencyList).toHaveTextContent('validate-services')
    })

    it('labels decision-blocked candidates without treating every candidate as blocked', () => {
        mocks.tasks = [
            createTask({
                id: 'candidate-open-choice',
                title: 'Choose final story entry',
                status: 'blocked',
                tag: 'candidate',
                blockedSource: 'decision',
                blockedReason: 'Choose story entry: Use MainMenu or a debug button?'
            }),
            createTask({
                id: 'candidate-unblocked',
                title: 'Optional polish pass',
                status: 'planning',
                tag: 'candidate'
            })
        ]

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        expect(screen.getByText('Blocked by decision')).toBeInTheDocument()
        expect(screen.getByText('Choose story entry: Use MainMenu or a debug button?')).toBeInTheDocument()
        const unblockedCard = screen.getByText('Optional polish pass').closest('[data-kanban-task-id]')
        expect(unblockedCard).not.toBeNull()
        expect(unblockedCard!).toHaveTextContent('candidate')
        expect(unblockedCard!).not.toHaveTextContent('Blocked by decision')
    })
})
