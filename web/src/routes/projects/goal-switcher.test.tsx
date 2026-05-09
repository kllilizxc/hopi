import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { GoalSwitcher } from './goal-switcher'

describe('GoalSwitcher', () => {
    it('renders leading project view controls before the goal filter', () => {
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
        expect(toolbar.firstElementChild).toContainElement(screen.getByTestId('project-view-tabs'))
    })
})
