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

        const tablist = screen.getByRole('tablist', { name: 'Projects' })
        expect(tablist).not.toHaveClass('w-full')
        expect(tablist).not.toHaveClass('border')
        const cardGameTab = screen.getByRole('tab', { name: 'CardGame' })
        expect(cardGameTab).toHaveClass('shrink-0')
        expect(cardGameTab).toHaveClass('px-4')
        expect(cardGameTab).not.toHaveClass('flex-1')
        expect(cardGameTab).not.toHaveAttribute('title')
    })

    it('only renders native tab tooltips when explicitly provided', () => {
        renderWithProviders(
            <CompactTabs
                items={[{ id: 'planning', label: 'Planning', title: 'Planning view' }]}
                selectedId="planning"
                onSelect={vi.fn()}
                ariaLabel="Project view"
            />
        )

        expect(screen.getByRole('tab', { name: 'Planning' })).toHaveAttribute('title', 'Planning view')
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
        const selectedTab = screen.getByRole('tab', { name: 'Planning' })
        expect(selectedTab).toHaveClass('flex-1')
        expect(selectedTab).toHaveClass('px-4')
        expect(selectedTab).not.toHaveClass('border')
    })

    it('can disable all tab buttons', () => {
        renderWithProviders(
            <CompactTabs
                items={[{ id: 'claude', label: 'Claude' }]}
                selectedId="claude"
                onSelect={vi.fn()}
                ariaLabel="Agent"
                disabled
            />
        )

        expect(screen.getByRole('tab', { name: 'Claude' })).toBeDisabled()
    })
})
