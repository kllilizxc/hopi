import type { ReactNode } from 'react'
import { useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { NEW_TASK_DIALOG_STORAGE_KEY } from './new-task-dialog-storage'
import { NewTaskDialog } from './kanban-new-task-dialog'

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
        disabled
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
    )
}))

vi.mock('@/components/NewSession/AgentSelector', () => ({
    AgentSelector: ({
        agent,
        onAgentChange,
        isDisabled
    }: {
        agent: string
        onAgentChange: (value: 'claude' | 'codex' | 'gemini' | 'opencode') => void
        isDisabled: boolean
    }) => (
        <label>
            <span>Agent</span>
            <select
                aria-label="Agent"
                value={agent}
                onChange={(event) => onAgentChange(event.target.value as 'claude' | 'codex' | 'gemini' | 'opencode')}
                disabled={isDisabled}
            >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="gemini">Gemini</option>
                <option value="opencode">OpenCode</option>
            </select>
        </label>
    )
}))

vi.mock('@/components/NewSession/ModelSelector', () => ({
    ModelSelector: ({
        model,
        onModelChange,
        isDisabled
    }: {
        model: string
        onModelChange: (value: string) => void
        isDisabled: boolean
    }) => (
        <label>
            <span>Model</span>
            <input
                aria-label="Model"
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={isDisabled}
            />
        </label>
    )
}))

function renderDialog(open = true, defaultAgent: 'claude' | 'codex' | 'gemini' | 'opencode' = 'claude') {
    return renderWithProviders(
        <NewTaskDialog
            open={open}
            onOpenChange={vi.fn()}
            defaultAgent={defaultAgent}
            defaultPermissionMode="acceptEdits"
            workflowStrategies={[
                { id: 'default', label: 'Default', defaultTaskPhase: null, phaseOptions: [] },
                { id: 'gsd', label: 'GSD', defaultTaskPhase: 'discuss', phaseOptions: ['discuss'] },
            ]}
            isCreating={false}
            onCreate={vi.fn()}
        />
    )
}

function ReopenHarness() {
    const [open, setOpen] = useState(false)

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open</button>
            <NewTaskDialog
                open={open}
                onOpenChange={setOpen}
                defaultAgent="claude"
                defaultPermissionMode="acceptEdits"
                workflowStrategies={[
                    { id: 'default', label: 'Default', defaultTaskPhase: null, phaseOptions: [] },
                    { id: 'gsd', label: 'GSD', defaultTaskPhase: 'discuss', phaseOptions: ['discuss'] },
                ]}
                isCreating={false}
                onCreate={vi.fn()}
            />
        </>
    )
}

describe('NewTaskDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
    })

    it('stores every non-detail field in localStorage', async () => {
        renderDialog()

        fireEvent.change(screen.getByPlaceholderText(/Title on the first line/i), {
            target: { value: 'Task title\nTask details should not persist' }
        })
        fireEvent.change(screen.getByLabelText('Priority'), {
            target: { value: 'high' }
        })
        fireEvent.change(screen.getByLabelText('Workflow strategy'), {
            target: { value: 'gsd' }
        })
        fireEvent.change(screen.getByLabelText('Agent'), {
            target: { value: 'codex' }
        })

        await waitFor(() => {
            expect(localStorage.getItem(NEW_TASK_DIALOG_STORAGE_KEY)).not.toBeNull()
        })

        const stored = JSON.parse(localStorage.getItem(NEW_TASK_DIALOG_STORAGE_KEY) ?? '{}') as Record<string, string>
        expect(stored).toEqual({
            priority: 'high',
            agent: 'codex',
            model: 'auto',
            permissionMode: 'plan',
            workflowProfile: 'gsd',
        })
        expect(stored).not.toHaveProperty('title')
        expect(stored).not.toHaveProperty('description')
        expect(stored).not.toHaveProperty('draft')
    })

    it('uses GPT-5.5 when Codex is the default task agent', () => {
        renderDialog(true, 'codex')

        expect(screen.getByLabelText('Agent')).toHaveValue('codex')
        expect(screen.getByLabelText('Model')).toHaveValue('gpt-5.5')
    })

    it('reloads localStorage values when reopened', async () => {
        renderWithProviders(<ReopenHarness />)

        localStorage.setItem(NEW_TASK_DIALOG_STORAGE_KEY, JSON.stringify({
            priority: 'high',
            agent: 'codex',
            model: 'auto',
            permissionMode: 'plan',
            workflowProfile: 'gsd',
        }))

        fireEvent.click(screen.getByRole('button', { name: 'Open' }))

        await waitFor(() => {
            expect(screen.getByLabelText('Priority')).toHaveValue('high')
            expect(screen.getByLabelText('Workflow strategy')).toHaveValue('gsd')
            expect(screen.getByLabelText('Agent')).toHaveValue('codex')
            expect(screen.getByLabelText('Model')).toHaveValue('auto')
            expect(screen.getByLabelText('Permission Mode')).toHaveValue('plan')
        })
    })

    it('reloads non-claude permission modes from localStorage', async () => {
        renderWithProviders(<ReopenHarness />)

        localStorage.setItem(NEW_TASK_DIALOG_STORAGE_KEY, JSON.stringify({
            priority: '',
            agent: 'codex',
            model: 'auto',
            permissionMode: 'safe-yolo',
            workflowProfile: 'default',
        }))

        fireEvent.click(screen.getByRole('button', { name: 'Open' }))

        await waitFor(() => {
            expect(screen.getByLabelText('Agent')).toHaveValue('codex')
            expect(screen.getByLabelText('Permission Mode')).toHaveValue('safe-yolo')
        })
    })
})
