import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { GoalTodoResponse } from '@/types/api'
import { GoalPlanningDocument } from './goal-planning-page'

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
})
