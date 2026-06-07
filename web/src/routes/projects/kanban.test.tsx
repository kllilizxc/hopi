import { fireEvent, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { GoalTodoResponse, Task } from '@/types/api'
import { ProjectKanbanBoard } from './kanban'

const indexCss = readFileSync('src/index.css', 'utf8').replace(/\r\n/g, '\n')

const mocks = vi.hoisted(() => ({
    tasks: [] as Task[],
    goalTodo: null as GoalTodoResponse | null,
    tasksLoading: false,
    tasksError: null as string | null,
    goalTodoLoading: false,
    goalTodoError: null as string | null,
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
        isLoading: mocks.tasksLoading,
        error: mocks.tasksError,
        refetch: vi.fn()
    })
}))

vi.mock('@/hooks/queries/useGoalTodo', () => ({
    useGoalTodo: () => ({
        todo: mocks.goalTodo,
        isLoading: mocks.goalTodoLoading,
        error: mocks.goalTodoError,
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
        tag: overrides.tag ?? null,
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
        createdAt: overrides.createdAt ?? 1,
        updatedAt: overrides.updatedAt ?? 2,
        finishedAt: overrides.finishedAt ?? null,
        archivedAt: overrides.archivedAt ?? null
    }
}

function createGoalTodo(overrides: Partial<GoalTodoResponse> = {}): GoalTodoResponse {
    return {
        board: overrides.board ?? {
            goal: {
                goalKey: 'goal-1',
                goalId: 'goal-1',
                title: 'Goal 1'
            },
            items: []
        },
        tasks: overrides.tasks ?? []
    }
}

describe('ProjectKanbanBoard', () => {
    beforeEach(() => {
        mocks.tasks = []
        mocks.goalTodo = null
        mocks.tasksLoading = false
        mocks.tasksError = null
        mocks.goalTodoLoading = false
        mocks.goalTodoError = null
        vi.clearAllMocks()
    })

    it('keeps deferred and candidate reservoir notes out of the execution Kanban lanes', () => {
        mocks.tasks = [
            createTask({
                id: 'ready-task',
                title: 'Ready implementation slice',
                status: 'planning',
                tag: 'ready'
            }),
            createTask({
                id: 'deferred-note',
                title: 'Deferred presentation idea',
                status: 'planning',
                tag: 'deferred'
            }),
            createTask({
                id: 'candidate-note',
                title: 'Candidate follow-up idea',
                status: 'planning',
                tag: 'candidate'
            })
        ]
        mocks.goalTodo = createGoalTodo({
            tasks: mocks.tasks,
            board: {
                goal: {
                    goalKey: 'goal-1',
                    goalId: 'goal-1',
                    title: 'Goal 1'
                },
                items: [
                    {
                        ref: 'deferred-note',
                        kind: 'planning',
                        status: 'planned',
                        tag: 'deferred',
                        title: 'Deferred presentation idea',
                        description: 'Keep this as a later presentation pass.',
                        acceptanceCriteria: [],
                        dependencyTaskList: [],
                        blockedBy: [],
                        taskId: null
                    },
                    {
                        ref: 'candidate-note',
                        kind: 'planning',
                        status: 'planned',
                        tag: 'candidate',
                        title: 'Candidate follow-up idea',
                        description: '',
                        acceptanceCriteria: [],
                        dependencyTaskList: [],
                        blockedBy: [],
                        taskId: null
                    }
                ]
            }
        })

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        const plannedColumn = document.querySelector('[data-kanban-column-status="planned"]')
        expect(plannedColumn?.textContent).toContain('Ready implementation slice')
        expect(plannedColumn?.textContent).not.toContain('Deferred presentation idea')
        expect(plannedColumn?.textContent).not.toContain('Candidate follow-up idea')

        expect(screen.getByText('Todo / Backlog')).toBeInTheDocument()
        expect(screen.getByText('2 items')).toBeInTheDocument()
        expect(screen.getByText('Deferred presentation idea')).toBeInTheDocument()
        expect(screen.getByText('Candidate follow-up idea')).toBeInTheDocument()
    })

    it('keeps legacy blocked candidate notes in the reservoir when their derived lane is still planned', () => {
        mocks.tasks = [
            createTask({
                id: 'candidate-note',
                title: 'Candidate follow-up idea',
                status: 'blocked',
                tag: 'candidate'
            }),
            createTask({
                id: 'ready-task',
                title: 'Ready implementation slice',
                status: 'planning',
                tag: 'ready'
            })
        ]
        mocks.goalTodo = createGoalTodo({
            tasks: mocks.tasks,
            board: {
                goal: {
                    goalKey: 'goal-1',
                    goalId: 'goal-1',
                    title: 'Goal 1'
                },
                items: [
                    {
                        ref: 'candidate-note',
                        kind: 'planning',
                        status: 'planned',
                        tag: 'candidate',
                        title: 'Candidate follow-up idea',
                        description: '',
                        acceptanceCriteria: [],
                        dependencyTaskList: [],
                        blockedBy: [],
                        taskId: null
                    }
                ]
            }
        })

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        const plannedColumn = document.querySelector('[data-kanban-column-status="planned"]')
        expect(plannedColumn?.textContent).toContain('Ready implementation slice')
        expect(plannedColumn?.textContent).not.toContain('Candidate follow-up idea')
        expect(screen.getByText('Candidate follow-up idea')).toBeInTheDocument()
    })

    it('renders solid columns and theme-aware task hover surfaces', () => {
        mocks.tasks = [createTask()]
        mocks.goalTodo = createGoalTodo({ tasks: mocks.tasks })

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
        mocks.goalTodo = createGoalTodo({ tasks: mocks.tasks })

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
        mocks.goalTodo = createGoalTodo({ tasks: mocks.tasks })

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

    it('uses goal todo loading for goal-scoped boards', () => {
        mocks.tasksLoading = true
        mocks.goalTodoLoading = true

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('uses goal todo errors for goal-scoped boards', () => {
        mocks.tasksError = 'Project task query failed'
        mocks.goalTodoError = 'Goal todo query failed'

        renderWithProviders(
            <ProjectKanbanBoard
                projectId="project-1"
                goalId="goal-1"
                onOpenNewTask={vi.fn()}
            />
        )

        expect(screen.getByText('Goal todo query failed')).toBeInTheDocument()
        expect(screen.queryByText('Project task query failed')).toBeNull()
    })
})
