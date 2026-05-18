import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { ApiClient } from '@/api/client'
import type { Task } from '@/types/api'
import { TaskSessionDiffs } from './task-session-diffs'

const mocks = vi.hoisted(() => ({
    task: {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Task',
        status: 'finished',
        workflowProfile: 'default',
        activeSessionId: 'session-1',
        mergedDiffSnapshot: {
            rawNumstat: '2\t1\tsrc/app.ts\n',
            capturedAt: 1_700_000_000_000,
            baseCommit: 'abc123'
        },
        createdAt: 1,
        updatedAt: 1
    } as unknown as Task,
    session: {
        id: 'session-1',
        metadata: {
            path: '/repo/.hopi/worktrees/task-1',
            taskId: 'task-1',
            worktree: {
                basePath: '/repo',
                branch: 'task-1',
                name: 'task-1',
                worktreePath: '/repo/.hopi/worktrees/task-1',
                baseCommit: 'abc123'
            }
        }
    },
    gitStatus: {
        stagedFiles: [],
        unstagedFiles: [],
        branch: 'main',
        totalStaged: 0,
        totalUnstaged: 0
    }
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => ({ session: mocks.session })
}))

vi.mock('@/hooks/queries/useTask', () => ({
    useTask: () => ({ task: mocks.task, isLoading: false, error: null, refetch: vi.fn() })
}))

vi.mock('@/hooks/queries/useGitStatusFiles', () => ({
    useGitStatusFiles: () => ({ status: mocks.gitStatus, error: null, isLoading: false, refetch: vi.fn() })
}))

describe('TaskSessionDiffs', () => {
    it('renders legacy raw numstat merged snapshots without crashing', () => {
        renderWithProviders(<TaskSessionDiffs api={null} sessionId="session-1" />)

        expect(screen.getByText('Merged changes (1)')).toBeInTheDocument()
        expect(screen.getByText('app.ts')).toBeInTheDocument()
        expect(screen.getByText('+2')).toBeInTheDocument()
        expect(screen.getByText('-1')).toBeInTheDocument()
    })

    it('opens merged file diffs through the task-level merged diff API', async () => {
        const getTaskMergedDiffFile = vi.fn(async () => ({
            success: true,
            stdout: 'diff --git a/src/app.ts b/src/app.ts\n+merged\n'
        }))
        const api = {
            getTaskMergedDiffFile
        } as unknown as ApiClient

        renderWithProviders(<TaskSessionDiffs api={api} sessionId="session-1" />)

        fireEvent.click(screen.getByText('app.ts'))

        await waitFor(() => {
            expect(getTaskMergedDiffFile).toHaveBeenCalledWith('task-1', 'src/app.ts', { baseRef: 'abc123' })
        })
    })

    it('loads merged diff summaries live when only the merge refs are available', async () => {
        const originalTask = mocks.task
        mocks.task = {
            ...originalTask,
            worktreeMergeCommit: 'def456',
            mergedDiffSnapshot: {
                files: [],
                capturedAt: 1_700_000_000_000,
                baseCommit: 'abc123'
            }
        } as unknown as Task

        const getTaskMergedDiffNumstat = vi.fn(async () => ({
            success: true,
            stdout: '2\t1\tsrc/app.ts\n'
        }))
        const api = {
            getTaskMergedDiffNumstat
        } as unknown as ApiClient

        try {
            renderWithProviders(<TaskSessionDiffs api={api} sessionId="session-1" />)

            await waitFor(() => {
                expect(getTaskMergedDiffNumstat).toHaveBeenCalledWith('task-1', { baseRef: 'abc123' })
            })

            expect(await screen.findByText('Merged changes (1)')).toBeInTheDocument()
            expect(screen.getByText('app.ts')).toBeInTheDocument()
        } finally {
            mocks.task = originalTask
        }
    })
})
