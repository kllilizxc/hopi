import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { GoalSwitcher } from './goal-switcher'

describe('GoalSwitcher', () => {
    const baseGoal = {
        id: 'goal-1',
        projectId: 'project-1',
        namespace: 'default',
        goalKey: 'ship-planning-view',
        title: 'Ship planning view',
        description: null,
        successCriteria: null,
        status: 'active' as const,
        autopilotEnabled: false,
        automationPausedAt: null,
        deployRequiresApproval: true,
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null
    }

    it('lays out project view, goal picker, and actions as a responsive header', () => {
        renderWithProviders(
            <GoalSwitcher
                goals={[baseGoal]}
                selectedGoalId="goal-1"
                onSelectGoal={vi.fn()}
                onToggleGoalAutomationPause={vi.fn()}
                onCreateGoal={vi.fn()}
                leading={<div data-testid="project-view-tabs">Board Planning</div>}
            />
        )

        const toolbar = screen.getByTestId('goal-switcher-toolbar')
        expect(toolbar).toHaveClass('gap-2')
        expect(toolbar).toHaveClass('lg:grid-cols-[minmax(20rem,1fr)_auto_auto_auto]')

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
        const goalPickerTrigger = screen.getByRole('button', { name: /Ship planning view/ })
        expect(goalPickerTrigger).not.toHaveClass('app-shadow-border')
        expect(goalPickerTrigger).toHaveClass('app-shadow-control')
        const selectedSummary = screen.getByTestId('goal-switcher-selected-summary')
        const runningStatus = screen.getByText('Running')
        expect(selectedSummary).toHaveClass('justify-start')
        expect(selectedSummary).toContainElement(screen.getByText('Ship planning view'))
        expect(selectedSummary).toContainElement(runningStatus)
        expect(runningStatus).not.toHaveClass('border')
        expect(runningStatus).not.toHaveClass('app-shadow-border')

        const actions = screen.getByTestId('goal-switcher-actions')
        expect(actions).toHaveClass('justify-end')
        const newGoalButton = screen.getByRole('button', { name: 'New goal' })
        const pauseButton = screen.getByRole('button', { name: 'Pause automation' })
        const automation = screen.getByTestId('goal-switcher-automation')
        expect(newGoalButton).not.toHaveClass('w-full')
        expect(actions).toContainElement(newGoalButton)
        expect(automation).toContainElement(pauseButton)
        expect(Array.from(toolbar.children).indexOf(leading)).toBeLessThan(
            Array.from(toolbar.children).indexOf(automation)
        )
    })

    it('shows paused automation status and resume action for a paused goal', () => {
        renderWithProviders(
            <GoalSwitcher
                goals={[{ ...baseGoal, automationPausedAt: 1_700_000_000_000 }]}
                selectedGoalId="goal-1"
                onSelectGoal={vi.fn()}
                onToggleGoalAutomationPause={vi.fn()}
                onCreateGoal={vi.fn()}
            />
        )

        expect(screen.getByText('Paused')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Resume automation' })).toBeInTheDocument()
    })

    it('shows blocked automation status for a blocked goal that is not paused', () => {
        renderWithProviders(
            <GoalSwitcher
                goals={[{ ...baseGoal, status: 'blocked' as const }]}
                selectedGoalId="goal-1"
                onSelectGoal={vi.fn()}
                onToggleGoalAutomationPause={vi.fn()}
                onCreateGoal={vi.fn()}
            />
        )

        expect(screen.getByText('Blocked')).toBeInTheDocument()
        expect(screen.queryByText('Running')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Pause automation' })).toBeInTheDocument()
    })

    it('shows automation status for each goal in the dropdown menu', async () => {
        renderWithProviders(
            <GoalSwitcher
                goals={[
                    baseGoal,
                    {
                        ...baseGoal,
                        id: 'goal-2',
                        goalKey: 'draft-release-notes',
                        title: 'Draft release notes',
                        automationPausedAt: 1_700_000_000_000
                    },
                    {
                        ...baseGoal,
                        id: 'goal-3',
                        goalKey: 'choose-story-entry',
                        title: 'Choose story entry',
                        status: 'blocked' as const
                    }
                ]}
                selectedGoalId="goal-1"
                onSelectGoal={vi.fn()}
                onToggleGoalAutomationPause={vi.fn()}
                onCreateGoal={vi.fn()}
            />
        )

        fireEvent.keyDown(screen.getByRole('button', { name: /Ship planning view/ }), {
            key: 'ArrowDown'
        })

        const menu = await screen.findByRole('menu')
        const firstGoal = within(menu).getByText('Ship planning view').closest('[role="menuitem"]')
        const secondGoal = within(menu).getByText('Draft release notes').closest('[role="menuitem"]')
        const thirdGoal = within(menu).getByText('Choose story entry').closest('[role="menuitem"]')

        expect(firstGoal).not.toBeNull()
        expect(secondGoal).not.toBeNull()
        expect(thirdGoal).not.toBeNull()
        expect(within(firstGoal as HTMLElement).getByText('Running')).toBeInTheDocument()
        expect(within(secondGoal as HTMLElement).getByText('Paused')).toBeInTheDocument()
        expect(within(thirdGoal as HTMLElement).getByText('Blocked')).toBeInTheDocument()
    })
})
