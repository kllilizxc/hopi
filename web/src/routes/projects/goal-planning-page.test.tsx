import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { GoalTodoResponse } from '@/types/api'
import { GoalPlanningDocument, GoalPlanningPage } from './goal-planning-page'

const mocks = vi.hoisted(() => ({
    todoState: {
        todo: null as GoalTodoResponse | null,
        isLoading: false,
        error: null as string | null
    }
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: {} })
}))

vi.mock('@/hooks/queries/useGoalTodo', () => ({
    useGoalTodo: () => mocks.todoState
}))

vi.mock('@/routes/projects/goal-decision-topics', () => ({
    GoalDecisionTopicsPanel: () => (
        <section data-testid="mock-decisions" className="h-[900px] shrink-0">
            Decisions
        </section>
    )
}))

describe('GoalPlanningDocument', () => {
    it('renders the full planning document information', () => {
        const todo: GoalTodoResponse = {
            exists: true,
            path: '/repo/.hopi/docs/todo.md',
            rawMarkdown: [
                '## Goal `goal-1` - Story system',
                '',
                '### Ready candidates',
                '',
                '#### Ship the first playable slice'
            ].join('\n'),
            updatedAt: 1_700_000_000_000,
            sections: [
                {
                    kind: 'ready',
                    title: 'Ship the first playable slice',
                    body: '**Objective:** render the map.\n\n**Acceptance:** user can pick a path.',
                    taskId: null
                },
                {
                    kind: 'candidate',
                    title: 'Tune generated task contracts',
                    body: 'Notes: Keep contracts lightweight.',
                    taskId: 'task-123'
                }
            ]
        }

        renderWithProviders(
            <GoalPlanningDocument
                projectId="project-1"
                todo={todo}
                isLoading={false}
                error={null}
            />
        )

        expect(screen.getByRole('heading', { name: 'Planning' })).toBeInTheDocument()
        expect(screen.getByText('/repo/.hopi/docs/todo.md')).toBeInTheDocument()
        expect(screen.getByText('2 items')).toBeInTheDocument()
        expect(screen.getByText('Ship the first playable slice')).toBeInTheDocument()
        expect(screen.getByText(/\*\*Objective:\*\* render the map/)).toBeInTheDocument()
        expect(screen.getByText('Tune generated task contracts')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Task task-123' })).toHaveAttribute(
            'href',
            '/projects/project-1/tasks/task-123'
        )
        expect(screen.getByTestId('planning-raw-markdown')).toHaveTextContent('## Goal `goal-1` - Story system')
    })

    it('lays planning sections out as a responsive document workspace', () => {
        const todo: GoalTodoResponse = {
            exists: true,
            path: '/repo/.hopi/docs/todo.md',
            rawMarkdown: null,
            updatedAt: null,
            sections: [
                {
                    kind: 'ready',
                    title: 'Ship the first playable slice',
                    body: 'Ready now.',
                    taskId: null
                },
                {
                    kind: 'candidate',
                    title: 'Tune generated task contracts',
                    body: 'Candidate notes.',
                    taskId: null
                },
                {
                    kind: 'candidate',
                    title: 'Improve planning parser',
                    body: 'Parser notes.',
                    taskId: null
                }
            ]
        }

        renderWithProviders(
            <GoalPlanningDocument
                projectId="project-1"
                todo={todo}
                isLoading={false}
                error={null}
            />
        )

        const grid = screen.getByTestId('planning-section-grid')
        expect(grid).toHaveClass('grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]')
        expect(grid).not.toHaveClass('min-w-[960px]')

        const workspace = screen.getByTestId('planning-workspace')
        expect(workspace).toHaveClass('xl:grid-cols-[16rem_minmax(0,1fr)]')

        const sectionIndex = screen.getByTestId('planning-section-index')
        expect(sectionIndex).not.toHaveClass('app-shadow-border')
        expect(sectionIndex).toHaveClass('app-shadow-surface')
        expect(within(sectionIndex).getByRole('link', { name: 'Ready 1 items' })).toHaveAttribute(
            'href',
            '#planning-ready'
        )
        expect(within(sectionIndex).getByRole('link', { name: 'Candidate 2 items' })).toHaveAttribute(
            'href',
            '#planning-candidate'
        )

        const candidateColumn = screen.getByTestId('planning-section-candidate')
        expect(candidateColumn).not.toHaveClass('app-shadow-border')
        expect(candidateColumn).toHaveClass('app-shadow-surface')
        expect(within(candidateColumn).getByText('Tune generated task contracts')).toBeInTheDocument()
        expect(within(candidateColumn).getByText('Improve planning parser')).toBeInTheDocument()

        const candidateCard = within(candidateColumn).getByText('Tune generated task contracts').closest('article')
        expect(candidateCard).not.toBeNull()
        expect(candidateCard!).not.toHaveClass('app-shadow-border')
    })

    it('keeps missing planning documents as a full-page state', () => {
        const todo: GoalTodoResponse = {
            exists: false,
            path: '/repo/.hopi/docs/todo.md',
            rawMarkdown: null,
            updatedAt: null,
            sections: []
        }

        renderWithProviders(
            <GoalPlanningDocument
                projectId="project-1"
                todo={todo}
                isLoading={false}
                error={null}
            />
        )

        expect(screen.getByRole('heading', { name: 'Planning' })).toBeInTheDocument()
        expect(screen.getByText('.hopi/docs/todo.md not found.')).toBeInTheDocument()
        expect(screen.getAllByText('/repo/.hopi/docs/todo.md').length).toBeGreaterThan(0)
    })

    it('keeps decisions and planning in one scrollable page flow', () => {
        mocks.todoState.todo = {
            exists: true,
            path: '/repo/.hopi/docs/todo.md',
            rawMarkdown: null,
            updatedAt: null,
            sections: [
                {
                    kind: 'ready',
                    title: 'Keep planning reachable',
                    body: 'Planning should stay in the main page scroll after decisions.',
                    taskId: null
                }
            ]
        }
        mocks.todoState.isLoading = false
        mocks.todoState.error = null

        renderWithProviders(
            <GoalPlanningPage
                projectId="project-1"
                goalId="goal-1"
                isGoalsLoading={false}
            />
        )

        const page = screen.getByTestId('planning-page-scroll')
        expect(page).toHaveClass('overflow-y-auto')

        const content = screen.getByTestId('planning-page-content')
        expect(content).toContainElement(screen.getByTestId('mock-decisions'))
        expect(content).toContainElement(screen.getByTestId('planning-document'))
        expect(content).toHaveClass('space-y-4')

        expect(screen.getByTestId('planning-document')).not.toHaveClass('h-full')
    })
})
