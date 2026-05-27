import type { ReactNode } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { CreateGoalDialog } from './create-goal-dialog'

vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
    DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/components/ui/checkbox', () => ({
    Checkbox: ({ checked, onCheckedChange, disabled }: {
        checked: boolean
        onCheckedChange: (checked: boolean) => void
        disabled?: boolean
    }) => (
        <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onCheckedChange(event.target.checked)}
        />
    )
}))

describe('CreateGoalDialog', () => {
    it('submits only once per open dialog and sends a client request id', () => {
        const onCreate = vi.fn(() => new Promise<boolean>(() => {}))
        renderWithProviders(
            <CreateGoalDialog
                isOpen
                onOpenChange={vi.fn()}
                onCreate={onCreate}
                isPending={false}
                error={null}
            />
        )

        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: 'Retry Safe Goal' }
        })
        const submit = screen.getByRole('button', { name: 'New goal' })

        fireEvent.click(submit)
        fireEvent.click(submit)

        expect(onCreate).toHaveBeenCalledTimes(1)
        expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Retry Safe Goal',
            clientRequestId: expect.any(String)
        }))
    })
})
