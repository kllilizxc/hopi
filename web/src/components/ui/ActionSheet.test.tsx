import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/renderWithProviders'
import { ActionSheet, ActionSheetItem } from '@/components/ui/ActionSheet'

describe('ActionSheet', () => {
    it('does not render content when closed', () => {
        renderWithProviders(
            <ActionSheet open={false} onOpenChange={() => {}} title="Actions">
                <ActionSheetItem>Delete</ActionSheetItem>
            </ActionSheet>
        )

        expect(screen.queryByText('Actions')).toBeNull()
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    })

    it('renders title and children when open', () => {
        renderWithProviders(
            <ActionSheet open onOpenChange={() => {}} title="Actions" description="Pick one">
                <ActionSheetItem>Delete</ActionSheetItem>
            </ActionSheet>
        )

        expect(screen.getByText('Actions')).toBeInTheDocument()
        expect(screen.getByText('Pick one')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()

        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveClass('motion-reduce:animate-none')
    })

    it('fires item click handler', () => {
        const onClick = vi.fn()
        renderWithProviders(
            <ActionSheet open onOpenChange={() => {}} title="Actions">
                <ActionSheetItem onClick={onClick}>Delete</ActionSheetItem>
            </ActionSheet>
        )

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        expect(onClick).toHaveBeenCalledTimes(1)
    })
})
