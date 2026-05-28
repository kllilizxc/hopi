import type { ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { renderWithProviders } from '@/test/renderWithProviders'
import { CreateProjectDialog } from './CreateProjectDialog'

vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
    DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/components/ui/AdaptiveSelectField', () => ({
    AdaptiveSelectField: ({
        title,
        value,
        options,
        onValueChange,
        disabled,
    }: {
        title: string
        value: string
        options: Array<{ value: string; label: string }>
        onValueChange: (value: string) => void
        disabled?: boolean
    }) => (
        <label>
            <span>{title}</span>
            <select
                aria-label={title}
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                disabled={disabled}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        </label>
    ),
}))

vi.mock('./MachineDirectoryPicker', () => ({
    MachineDirectoryPicker: ({ onSelect }: { onSelect: (path: string) => void }) => (
        <button type="button" onClick={() => onSelect('/tmp/workspace-alpha')}>
            Select workspace
        </button>
    ),
}))

function createMachine(overrides: Partial<Machine> = {}): Machine {
    return {
        id: overrides.id ?? 'machine-1',
        active: overrides.active ?? true,
        metadata: overrides.metadata ?? {
            host: 'MacBook Pro',
            platform: 'darwin',
            happyCliVersion: '0.0.0',
        },
    }
}

describe('CreateProjectDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('adds the selected workspace and includes it in project creation', async () => {
        const onCreate = vi.fn(async () => null)

        renderWithProviders(
            <CreateProjectDialog
                api={null as ApiClient | null}
                isOpen
                onClose={vi.fn()}
                machines={[createMachine()]}
                isMachinesLoading={false}
                onCreate={onCreate}
                isPending={false}
                error={null}
            />
        )

        fireEvent.click(await screen.findByRole('button', { name: 'Select workspace' }))
        fireEvent.click(screen.getByRole('button', { name: 'Add' }))

        expect(screen.getByText('/tmp/workspace-alpha')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Enter a path or select a directory below.')).toBeInTheDocument()

        fireEvent.change(screen.getAllByRole('textbox')[0], {
            target: { value: 'Project Alpha' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Create' }))

        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
                machineId: 'machine-1',
                name: 'Project Alpha',
                workspaces: [{ path: '/tmp/workspace-alpha', label: undefined }],
            }))
        })
    })

    it('adds a manually typed workspace path', async () => {
        const onCreate = vi.fn(async () => null)

        renderWithProviders(
            <CreateProjectDialog
                api={null as ApiClient | null}
                isOpen
                onClose={vi.fn()}
                machines={[createMachine()]}
                isMachinesLoading={false}
                onCreate={onCreate}
                isPending={false}
                error={null}
            />
        )

        fireEvent.change(screen.getByRole('textbox', { name: 'Path' }), {
            target: { value: '/tmp/manual-workspace' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Add' }))

        fireEvent.change(screen.getAllByRole('textbox')[0], {
            target: { value: 'Manual Project' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Create' }))

        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
                machineId: 'machine-1',
                name: 'Manual Project',
                workspaces: [{ path: '/tmp/manual-workspace', label: undefined }],
            }))
        })
    })
})
