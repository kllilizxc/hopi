import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlanTraceDiffWorkspace from './PlanTraceDiffWorkspace'

const mockUsePrototypeRemoteApi = vi.fn()

vi.mock('@/prototype/remoteApi', () => ({
    usePrototypeRemoteApi: () => mockUsePrototypeRemoteApi(),
}))

describe('PlanTraceDiffWorkspace', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('loads current changed files and opens a file diff inline', async () => {
        const getGitDiffNumstat = vi.fn().mockResolvedValue({
            success: true,
            stdout: '4\t1\tsrc/game.ts\n1\t0\tREADME.md\n',
        })
        const getGitDiffFile = vi.fn().mockResolvedValue({
            success: true,
            stdout: [
                'diff --git a/src/game.ts b/src/game.ts',
                '--- a/src/game.ts',
                '+++ b/src/game.ts',
                '@@ -1,1 +1,2 @@',
                ' const version = 1',
                '+const phase = "expedition"',
            ].join('\n'),
        })
        mockUsePrototypeRemoteApi.mockReturnValue({
            getGitDiffNumstat,
            getGitDiffFile,
        })

        render(
            <PlanTraceDiffWorkspace
                sessionId="session-runtime-1"
                planTitle="CardGame"
            />,
        )

        expect(await screen.findByRole('button', { name: 'src/game.ts' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'README.md' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'src/game.ts' }))

        await waitFor(() => {
            expect(getGitDiffFile).toHaveBeenCalledWith('session-runtime-1', 'src/game.ts')
        })
        expect(await screen.findByText('+const phase = "expedition"')).toBeInTheDocument()
    })

    it('shows an empty-state message when the plan has no runtime session yet', () => {
        mockUsePrototypeRemoteApi.mockReturnValue({
            getGitDiffNumstat: vi.fn(),
            getGitDiffFile: vi.fn(),
        })

        render(
            <PlanTraceDiffWorkspace
                sessionId={null}
                planTitle="CardGame"
            />,
        )

        expect(screen.getByText('这张 plan 还没创建 runtime session，所以还看不到当前改动。')).toBeInTheDocument()
    })

    it('falls back to cumulative branch changes when the working tree is clean but the worktree base commit has diverged', async () => {
        const getSession = vi.fn().mockResolvedValue({
            session: {
                metadata: {
                    worktree: {
                        baseCommit: 'abc1234',
                    },
                },
            },
        })
        const getGitDiffNumstat = vi.fn()
            .mockResolvedValueOnce({
                success: true,
                stdout: '',
            })
            .mockResolvedValueOnce({
                success: true,
                stdout: '7\t2\tsrc/expedition.ts\n',
            })
        const getGitDiffFile = vi.fn().mockResolvedValue({
            success: true,
            stdout: [
                'diff --git a/src/expedition.ts b/src/expedition.ts',
                '--- a/src/expedition.ts',
                '+++ b/src/expedition.ts',
                '@@ -1,1 +1,2 @@',
                ' export const phase = "seed"',
                '+export const phase = "foundation"',
            ].join('\n'),
        })
        mockUsePrototypeRemoteApi.mockReturnValue({
            getSession,
            getGitDiffNumstat,
            getGitDiffFile,
        })

        render(
            <PlanTraceDiffWorkspace
                sessionId="session-runtime-1"
                planTitle="CardGame"
            />,
        )

        expect(await screen.findByRole('button', { name: 'src/expedition.ts' })).toBeInTheDocument()
        expect(screen.getByText('当前工作树为空，以下展示相对起点已经累计出的改动。')).toBeInTheDocument()
        expect(getGitDiffNumstat).toHaveBeenNthCalledWith(1, 'session-runtime-1')
        expect(getGitDiffNumstat).toHaveBeenNthCalledWith(2, 'session-runtime-1', { baseRef: 'abc1234' })

        fireEvent.click(screen.getByRole('button', { name: 'src/expedition.ts' }))

        await waitFor(() => {
            expect(getGitDiffFile).toHaveBeenCalledWith('session-runtime-1', 'src/expedition.ts', { baseRef: 'abc1234' })
        })
        expect(await screen.findByText('+export const phase = "foundation"')).toBeInTheDocument()
    })
})
