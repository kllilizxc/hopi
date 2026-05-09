import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { GoalSwitcher } from './goal-switcher'

describe('GoalSwitcher', () => {
    it('lays out project view, goal picker, and actions as a responsive header', () => {
        renderWithProviders(
            <GoalSwitcher
                goals={[{
                    id: 'goal-1',
                    projectId: 'project-1',
                    namespace: 'default',
                    title: 'Ship planning view',
                    description: null,
                    successCriteria: null,
                    status: 'active',
                    autopilotEnabled: false,
                    deployRequiresApproval: true,
                    createdAt: 1,
                    updatedAt: 1,
                    archivedAt: null
                }]}
                selectedGoalId="goal-1"
                onSelectGoal={vi.fn()}
                onCreateGoal={vi.fn()}
                leading={<div data-testid="project-view-tabs">Board Planning</div>}
            />
        )

        const toolbar = screen.getByTestId('goal-switcher-toolbar')
        expect(toolbar).toHaveClass('gap-2')
        expect(toolbar).toHaveClass('lg:grid-cols-[minmax(20rem,1fr)_auto_auto]')

        expect(screen.queryByText('Current goal')).not.toBeInTheDocument()

        const goalRow = screen.getByTestId('goal-switcher-goal-row')
        expect(goalRow).toHaveClass('grid-cols-[minmax(0,1fr)_auto]')
        expect(goalRow).toHaveClass('lg:contents')

        const leading = screen.getByTestId('goal-switcher-leading')
        expect(leading).toContainElement(screen.getByTestId('project-view-tabs'))
        expect(leading).toHaveClass('w-full')
        expect(leading).toHaveClass('lg:pb-0.5')
        expect(Array.from(toolbar.children).indexOf(goalRow)).toBeLessThan(
            Array.from(toolbar.children).indexOf(leading)
        )

        const goalPicker = screen.getByTestId('goal-switcher-current-goal')
        expect(goalPicker).toHaveClass('min-w-0')

        const actions = screen.getByTestId('goal-switcher-actions')
        expect(actions).toHaveClass('justify-end')
        expect(screen.getByRole('button', { name: 'New goal' })).not.toHaveClass('w-full')
    })
})
