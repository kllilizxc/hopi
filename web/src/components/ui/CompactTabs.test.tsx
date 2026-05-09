import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { CompactTabs } from './CompactTabs'

describe('CompactTabs', () => {
    it('sizes tabs to their content by default', () => {
        renderWithProviders(
            <CompactTabs
                items={[
                    { id: 'cardgame', label: 'CardGame' },
                    { id: 'hopi', label: 'HOPI' },
                    { id: 'omc', label: 'OMC' }
                ]}
                selectedId="cardgame"
                onSelect={vi.fn()}
                ariaLabel="Projects"
            />
        )

        expect(screen.getByRole('tablist', { name: 'Projects' })).not.toHaveClass('w-full')
        expect(screen.getByRole('tab', { name: 'CardGame' })).toHaveClass('shrink-0')
        expect(screen.getByRole('tab', { name: 'CardGame' })).not.toHaveClass('flex-1')
    })

    it('fills its width and distributes tabs evenly when requested', () => {
        renderWithProviders(
            <CompactTabs
                items={[
                    { id: 'board', label: 'Board' },
                    { id: 'planning', label: 'Planning' }
                ]}
                selectedId="planning"
                onSelect={vi.fn()}
                ariaLabel="Project view"
                distribution="equal"
            />
        )

        expect(screen.getByRole('tablist', { name: 'Project view' })).toHaveClass('w-full')
        expect(screen.getByRole('tab', { name: 'Board' })).toHaveClass('flex-1')
        expect(screen.getByRole('tab', { name: 'Planning' })).toHaveClass('flex-1')
    })
})
