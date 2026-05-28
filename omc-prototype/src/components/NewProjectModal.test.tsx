import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NewProjectModal from './NewProjectModal'

function renderModal(overrides: Partial<React.ComponentProps<typeof NewProjectModal>> = {}) {
    const props: React.ComponentProps<typeof NewProjectModal> = {
        open: true,
        repoRoot: '/Users/realizer/Code/hopi/sandbox',
        name: 'Sandbox Project',
        pending: false,
        error: null,
        partialSuccess: null,
        onRepoRootChange: vi.fn(),
        onNameChange: vi.fn(),
        onSubmit: vi.fn(),
        onRetrySeed: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    }

    return {
        props,
        ...render(<NewProjectModal {...props} />),
    }
}

describe('NewProjectModal', () => {
    it('renders both fields, forwards changes, submits through the primary action, and stops dialog clicks from closing', () => {
        const { props, container } = renderModal()

        expect(screen.getByRole('heading', { name: '新建项目' })).toBeInTheDocument()
        expect(screen.getByText('接入一个已有的本地 Git 仓库，缺少 planning 时会自动创建 seed 运行材料。')).toBeInTheDocument()

        const repoRootInput = screen.getByRole('textbox', { name: 'Repo 路径' })
        const nameInput = screen.getByRole('textbox', { name: '项目名' })
        const submitButton = screen.getByRole('button', { name: '创建项目' })
        const cancelButton = screen.getByRole('button', { name: '取消' })

        expect(repoRootInput).toHaveValue('/Users/realizer/Code/hopi/sandbox')
        expect(nameInput).toHaveValue('Sandbox Project')
        expect(submitButton).toBeEnabled()

        fireEvent.change(repoRootInput, { target: { value: '/Users/realizer/Code/hopi/new-repo' } })
        fireEvent.change(nameInput, { target: { value: 'New Project' } })

        expect(props.onRepoRootChange).toHaveBeenCalledWith('/Users/realizer/Code/hopi/new-repo')
        expect(props.onNameChange).toHaveBeenCalledWith('New Project')

        fireEvent.click(submitButton)
        expect(props.onSubmit).toHaveBeenCalledTimes(1)

        fireEvent.click(cancelButton)
        expect(props.onClose).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByRole('dialog'))
        expect(props.onClose).toHaveBeenCalledTimes(1)

        const backdrop = container.firstElementChild
        expect(backdrop).not.toBeNull()
        if (backdrop) {
            fireEvent.click(backdrop)
        }

        expect(props.onClose).toHaveBeenCalledTimes(2)
    })

    it('shows the seed retry action after a partial success', () => {
        const { props } = renderModal({
            partialSuccess: {
                programId: 'program-1',
                programName: 'PersonalQuant',
            },
        })

        const retryButton = screen.getByRole('button', { name: '重试 seed' })

        expect(retryButton).toBeInTheDocument()

        fireEvent.click(retryButton)

        expect(props.onRetrySeed).toHaveBeenCalledTimes(1)
    })

    it('announces errors and keeps the backdrop locked while pending', () => {
        const { props, container } = renderModal({
            pending: true,
            error: '创建失败，请重试。',
        })

        expect(screen.getByRole('alert')).toHaveTextContent('创建失败，请重试。')

        fireEvent.click(container.firstElementChild as HTMLElement)

        expect(props.onClose).not.toHaveBeenCalled()
    })

    it('moves focus into the dialog, traps tab, and restores focus on close', () => {
        const { rerender } = render(
            <div>
                <button type="button">outside</button>
                <NewProjectModal
                    open={false}
                    repoRoot="/Users/realizer/Code/hopi/sandbox"
                    name="Sandbox Project"
                    pending={false}
                    error={null}
                    partialSuccess={null}
                    onRepoRootChange={vi.fn()}
                    onNameChange={vi.fn()}
                    onSubmit={vi.fn()}
                    onRetrySeed={vi.fn()}
                    onClose={vi.fn()}
                />
            </div>,
        )

        const outsideButton = screen.getByRole('button', { name: 'outside' })
        outsideButton.focus()
        rerender(
            <div>
                <button type="button">outside</button>
                <NewProjectModal
                    open
                    repoRoot="/Users/realizer/Code/hopi/sandbox"
                    name="Sandbox Project"
                    pending={false}
                    error={null}
                    partialSuccess={null}
                    onRepoRootChange={vi.fn()}
                    onNameChange={vi.fn()}
                    onSubmit={vi.fn()}
                    onRetrySeed={vi.fn()}
                    onClose={vi.fn()}
                />
            </div>,
        )

        const dialog = screen.getByRole('dialog')
        const repoRootInput = screen.getByRole('textbox', { name: 'Repo 路径' })
        const cancelButton = screen.getByRole('button', { name: '取消' })

        expect(repoRootInput).toHaveFocus()

        fireEvent.keyDown(repoRootInput, { key: 'Tab', shiftKey: true })
        expect(cancelButton).toHaveFocus()

        cancelButton.focus()
        fireEvent.keyDown(dialog, { key: 'Tab' })
        expect(repoRootInput).toHaveFocus()

        rerender(
            <div>
                <button type="button">outside</button>
                <NewProjectModal
                    open={false}
                    repoRoot="/Users/realizer/Code/hopi/sandbox"
                    name="Sandbox Project"
                    pending={false}
                    error={null}
                    partialSuccess={null}
                    onRepoRootChange={vi.fn()}
                    onNameChange={vi.fn()}
                    onSubmit={vi.fn()}
                    onRetrySeed={vi.fn()}
                    onClose={vi.fn()}
                />
            </div>,
        )

        expect(outsideButton).toHaveFocus()
    })

    it('submits when Enter is pressed inside a field', () => {
        const { props } = renderModal()
        const repoRootInput = screen.getByRole('textbox', { name: 'Repo 路径' })

        fireEvent.keyDown(repoRootInput, { key: 'Enter', code: 'Enter' })

        expect(props.onSubmit).toHaveBeenCalledTimes(1)
    })

    it('disables inputs when pending and disables submit when the repo root is blank', () => {
        const { rerender } = render(
            <NewProjectModal
                open
                repoRoot="   "
                name="Sandbox Project"
                pending={false}
                error={null}
                partialSuccess={null}
                onRepoRootChange={vi.fn()}
                onNameChange={vi.fn()}
                onSubmit={vi.fn()}
                onRetrySeed={vi.fn()}
                onClose={vi.fn()}
            />,
        )

        expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()

        rerender(
            <NewProjectModal
                open
                repoRoot="/Users/realizer/Code/hopi/sandbox"
                name="Sandbox Project"
                pending
                error={null}
                partialSuccess={null}
                onRepoRootChange={vi.fn()}
                onNameChange={vi.fn()}
                onSubmit={vi.fn()}
                onRetrySeed={vi.fn()}
                onClose={vi.fn()}
            />,
        )

        expect(screen.getByRole('textbox', { name: 'Repo 路径' })).toBeDisabled()
        expect(screen.getByRole('textbox', { name: '项目名' })).toBeDisabled()
        expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()
    })
})
