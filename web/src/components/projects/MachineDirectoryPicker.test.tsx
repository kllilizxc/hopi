import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { renderWithProviders } from '@/test/renderWithProviders'
import { MachineDirectoryPicker } from './MachineDirectoryPicker'
import { useMachineDirectory } from '@/hooks/queries/useMachineDirectory'

vi.mock('@/hooks/queries/useMachineDirectory', () => ({
    useMachineDirectory: vi.fn(),
}))

const useMachineDirectoryMock = vi.mocked(useMachineDirectory)

function createDirectoryState(path: string, overrides?: Partial<ReturnType<typeof useMachineDirectory>>): ReturnType<typeof useMachineDirectory> {
    return {
        currentPath: path,
        entries: [],
        error: null,
        isLoading: false,
        refetch: vi.fn(async () => undefined),
        ...overrides,
    }
}

describe('MachineDirectoryPicker', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('shows directory API errors inline', () => {
        useMachineDirectoryMock.mockImplementation((_api, _machineId, path) => {
            if (path === '') {
                return createDirectoryState('/Users/test', { error: 'Machine not found' })
            }
            return createDirectoryState(path)
        })

        renderWithProviders(
            <MachineDirectoryPicker
                api={null as ApiClient | null}
                machineId="machine-1"
                selectedPath=""
                onSelect={vi.fn()}
            />
        )

        expect(screen.getByText('Machine not found')).toBeInTheDocument()
    })

    it('shows empty-directory state after expanding an empty folder', () => {
        useMachineDirectoryMock.mockImplementation((_api, _machineId, path) => {
            if (path === '') {
                return createDirectoryState('/Users/test', {
                    entries: [{ name: 'repo', type: 'directory' }],
                })
            }
            if (path === '/Users/test/repo') {
                return createDirectoryState('/Users/test/repo')
            }
            return createDirectoryState(path)
        })

        renderWithProviders(
            <MachineDirectoryPicker
                api={null as ApiClient | null}
                machineId="machine-1"
                selectedPath=""
                onSelect={vi.fn()}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Expand directory' }))

        expect(screen.getByText('Empty directory')).toBeInTheDocument()
    })

    it('returns the resolved directory path when selecting a folder', () => {
        const onSelect = vi.fn()
        useMachineDirectoryMock.mockImplementation((_api, _machineId, path) => {
            if (path === '') {
                return createDirectoryState('/Users/test', {
                    entries: [{ name: 'repo', type: 'directory' }],
                })
            }
            return createDirectoryState(path)
        })

        renderWithProviders(
            <MachineDirectoryPicker
                api={null as ApiClient | null}
                machineId="machine-1"
                selectedPath=""
                onSelect={onSelect}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: /repo/i }))

        expect(onSelect).toHaveBeenCalledWith('/Users/test/repo')
    })
})
