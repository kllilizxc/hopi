import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GoalPage from './GoalPage'

vi.mock('@tanstack/react-router', () => ({
    Navigate: function MockNavigate(props: {
        to: string
        search?: Record<string, string>
    }) {
        return (
            <div data-testid="navigate-target">{`${props.to}?goal=${props.search?.goal ?? ''}`}</div>
        )
    },
}))

describe('GoalPage', () => {
    it('redirects the legacy goal route back into the single workspace with the goal query preserved', () => {
        render(<GoalPage goalId="goal-portfolio-foundation" />)

        expect(screen.getByTestId('navigate-target')).toHaveTextContent('/?goal=goal-portfolio-foundation')
    })
})
