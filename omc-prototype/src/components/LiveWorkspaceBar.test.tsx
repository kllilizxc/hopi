import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import LiveWorkspaceBar from './LiveWorkspaceBar'
import { bootstrapNewProject } from '@/prototype/newProjectBootstrap'

const mockUsePrototypeRemoteApi = vi.fn()
const mockUsePrototypeStore = vi.fn()
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mockNavigate,
}))

vi.mock('@/prototype/remoteApi', () => ({
    usePrototypeRemoteApi: () => mockUsePrototypeRemoteApi(),
}))

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => mockUsePrototypeStore(),
}))

vi.mock('@/prototype/newProjectBootstrap', () => ({
    bootstrapNewProject: vi.fn(),
}))

describe('LiveWorkspaceBar', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockNavigate.mockReset()
    })

    function renderBar(overrides: Partial<React.ComponentProps<typeof LiveWorkspaceBar>> = {}) {
        return render(
            <LiveWorkspaceBar
                programName="Alpha Program"
                repoRoot="/tmp/alpha"
                checkpointLabel="LIVE"
                checkpointSynopsis="Running"
                activeInboxCount={2}
                programs={[
                    { id: 'program-1', name: 'Alpha Program', repoRoot: '/tmp/alpha' },
                    { id: 'program-2', name: 'Beta Program', repoRoot: '/tmp/beta' },
                ]}
                selectedProgramId="program-1"
                onProgramChange={vi.fn()}
                onOpenInbox={vi.fn()}
                {...overrides}
            />,
        )
    }

    it('resets back to the dashboard when the selected program changes', () => {
        const onProgramChange = vi.fn()

        mockUsePrototypeRemoteApi.mockReturnValue({
            attachLocalRepo: vi.fn(),
            createPlanningSeed: vi.fn(),
        })
        mockUsePrototypeStore.mockReturnValue({
            actions: {
                selectProgram: vi.fn(),
            },
            live: {
                error: null,
            },
        })

        renderBar({ onProgramChange })

        fireEvent.change(screen.getByRole('combobox', { name: '项目' }), {
            target: { value: 'program-2' },
        })

        expect(onProgramChange).toHaveBeenCalledWith('program-2')
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
    })

    it('opens the modal, submits a new project, closes the modal, selects the new program, and shows a standalone success banner', async () => {
        const api = {
            attachLocalRepo: vi.fn(),
            createPlanningSeed: vi.fn(),
        }
        const selectProgram = vi.fn()

        mockUsePrototypeRemoteApi.mockReturnValue(api)
        mockUsePrototypeStore.mockReturnValue({
            actions: {
                selectProgram,
            },
            live: {
                error: null,
            },
        })
        vi.mocked(bootstrapNewProject).mockResolvedValue({
            kind: 'success',
            programId: 'program-2',
            seedCreated: true,
            bootstrap: {
                program: {
                    id: 'program-2',
                    name: 'Beta Program',
                    repoRoot: '/tmp/beta',
                },
                planning: {
                    status: 'ready',
                },
            },
        } as never)

        const { container } = renderBar()

        fireEvent.click(screen.getByRole('button', { name: '新建项目' }))

        fireEvent.change(screen.getByRole('textbox', { name: 'Repo 路径' }), {
            target: { value: '/tmp/beta' },
        })
        fireEvent.change(screen.getByRole('textbox', { name: '项目名' }), {
            target: { value: 'Beta Program' },
        })

        fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

        await waitFor(() => {
            expect(bootstrapNewProject).toHaveBeenCalledWith(api, {
                repoRoot: '/tmp/beta',
                name: 'Beta Program',
            })
        })

        await waitFor(() => {
            expect(selectProgram).toHaveBeenCalledWith('program-2')
        })
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

        const successBanner = await screen.findByText('项目已接入，并已创建 planning seed')
        expect(successBanner).toBeInTheDocument()
        expect(successBanner.closest('.prototype-workspace-bar__actions')).toBeNull()
        expect(container.querySelector('.prototype-workspace-bar__toast')).toContainElement(successBanner)
    })

    it('clears stale partial success state after seed error when the modal is closed and reopened', async () => {
        const api = {
            attachLocalRepo: vi.fn(),
            createPlanningSeed: vi.fn(),
        }

        mockUsePrototypeRemoteApi.mockReturnValue(api)
        mockUsePrototypeStore.mockReturnValue({
            actions: {
                selectProgram: vi.fn(),
            },
            live: {
                error: null,
            },
        })
        vi.mocked(bootstrapNewProject).mockResolvedValue({
            kind: 'seed-error',
            programId: 'program-2',
            seedCreated: false,
            attach: {
                program: {
                    id: 'program-2',
                    name: 'Beta Program',
                    repoRoot: '/tmp/beta',
                },
                planning: {
                    status: 'missing',
                },
            },
            error: 'Seed creation failed: boom',
        } as never)

        renderBar()

        fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'Repo 路径' }), {
            target: { value: '/tmp/beta' },
        })
        fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

        expect(await screen.findByRole('button', { name: '重试 seed' })).toBeInTheDocument()
        expect(screen.getByText('seed 已部分完成：Beta Program')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '取消' }))

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        })

        fireEvent.click(screen.getByRole('button', { name: '新建项目' }))

        expect(screen.queryByRole('button', { name: '重试 seed' })).not.toBeInTheDocument()
        expect(screen.queryByText('seed 已部分完成：Beta Program')).not.toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('retries seed creation after partial success, selects the program, closes the modal, and shows the success banner', async () => {
        const api = {
            attachLocalRepo: vi.fn(),
            createPlanningSeed: vi.fn().mockResolvedValue({
                program: {
                    id: 'program-2',
                    name: 'Beta Program',
                    repoRoot: '/tmp/beta',
                },
                planning: {
                    status: 'ready',
                },
            }),
        }
        const selectProgram = vi.fn()

        mockUsePrototypeRemoteApi.mockReturnValue(api)
        mockUsePrototypeStore.mockReturnValue({
            actions: {
                selectProgram,
            },
            live: {
                error: null,
            },
        })
        vi.mocked(bootstrapNewProject).mockResolvedValue({
            kind: 'seed-error',
            programId: 'program-2',
            seedCreated: false,
            attach: {
                program: {
                    id: 'program-2',
                    name: 'Beta Program',
                    repoRoot: '/tmp/beta',
                },
                planning: {
                    status: 'missing',
                },
            },
            error: 'Seed creation failed: boom',
        } as never)

        const { container } = renderBar()

        fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'Repo 路径' }), {
            target: { value: '/tmp/beta' },
        })
        fireEvent.change(screen.getByRole('textbox', { name: '项目名' }), {
            target: { value: 'Beta Program' },
        })
        fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

        const retryButton = await screen.findByRole('button', { name: '重试 seed' })
        fireEvent.click(retryButton)

        await waitFor(() => {
            expect(api.createPlanningSeed).toHaveBeenCalledWith('program-2')
        })

        await waitFor(() => {
            expect(selectProgram).toHaveBeenCalledWith('program-2')
        })
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

        const successBanner = await screen.findByText('项目已接入，并已创建 planning seed')
        expect(container.querySelector('.prototype-workspace-bar__toast')).toContainElement(successBanner)
    })

    it('shows a live reload error banner when the store surfaces a failed program switch', () => {
        mockUsePrototypeRemoteApi.mockReturnValue({
            attachLocalRepo: vi.fn(),
            createPlanningSeed: vi.fn(),
        })
        mockUsePrototypeStore.mockReturnValue({
            actions: {
                selectProgram: vi.fn(),
            },
            live: {
                error: 'Next program failed to load',
            },
        })

        renderBar()

        expect(screen.getByRole('alert')).toHaveTextContent('切换项目失败：Next program failed to load。当前仍显示已加载项目。')
    })
})
