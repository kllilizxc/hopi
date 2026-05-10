import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import type { ApiClient } from '@/api/client'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { renderWithProviders } from '@/test/renderWithProviders'

function createToolBlock(overrides: Partial<ToolCallBlock> & {
    id: string
    name: string
    input: unknown
}): ToolCallBlock {
    const createdAt = overrides.createdAt ?? 1

    return {
        kind: 'tool-call',
        id: overrides.id,
        localId: overrides.localId ?? null,
        createdAt,
        tool: {
            id: overrides.tool?.id ?? overrides.id,
            name: overrides.name,
            state: overrides.tool?.state ?? 'completed',
            input: overrides.input,
            createdAt,
            startedAt: overrides.tool?.startedAt ?? createdAt,
            completedAt: overrides.tool?.completedAt ?? createdAt + 1,
            description: overrides.tool?.description ?? null,
            result: overrides.tool?.result,
            permission: overrides.tool?.permission,
        },
        children: overrides.children ?? [],
        meta: overrides.meta,
    }
}

function renderToolMessage(block: ToolCallBlock) {
    return renderWithProviders(
        <HappyChatProvider
            value={{
                api: {} as ApiClient,
                sessionId: 'session-1',
                metadata: null,
                disabled: false,
                onRefresh: vi.fn(),
            }}
        >
            <HappyToolMessage
                type="tool-call"
                toolCallId={block.tool.id}
                artifact={block}
                toolName={block.tool.name}
                args={block.tool.input as never}
                argsText=""
                result={block.tool.result}
                isError={block.tool.state === 'error'}
                status={{ type: 'complete' }}
                addResult={vi.fn()}
                resume={vi.fn()}
            />
        </HappyChatProvider>
    )
}

function expectTextNotVisible(text: string) {
    const nodes = screen.queryAllByText(new RegExp(text))
    for (const node of nodes) {
        expect(node).not.toBeVisible()
    }
}

function expectTextVisible(text: string) {
    const nodes = screen.getAllByText(new RegExp(text))
    for (const node of nodes) {
        try {
            expect(node).toBeVisible()
            return
        } catch {
            // Try the next matching node.
        }
    }
    expect(nodes[0]).toBeVisible()
}

describe('HappyToolMessage', () => {
    it('keeps a single tool result collapsed until its row is opened', () => {
        const block = createToolBlock({
            id: 'tool-bash',
            name: 'Bash',
            input: { command: 'bun test' },
            tool: {
                id: 'tool-bash',
                name: 'Bash',
                state: 'completed',
                input: { command: 'bun test' },
                createdAt: 1,
                startedAt: 1,
                completedAt: 2,
                description: null,
                result: { stdout: 'BASH_RESULT_SENTINEL', exitCode: 0 },
            },
        })

        renderToolMessage(block)

        expectTextNotVisible('BASH_RESULT_SENTINEL')
        expect(screen.getByRole('button', { name: /Ran bun test/ })).toBeVisible()
        expect(screen.queryByRole('button', { name: /Terminal/ })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /Ran bun test/ }))

        expectTextVisible('BASH_RESULT_SENTINEL')
        expectTextVisible('bun test')
    })

    it('reveals a task tool list first, then expands each tool details independently', () => {
        const bashChild = createToolBlock({
            id: 'child-bash',
            name: 'Bash',
            input: { command: 'bun test' },
            tool: {
                id: 'child-bash',
                name: 'Bash',
                state: 'completed',
                input: { command: 'bun test' },
                createdAt: 2,
                startedAt: 2,
                completedAt: 3,
                description: null,
                result: { stdout: 'CHILD_BASH_RESULT_SENTINEL', exitCode: 0 },
            },
        })
        const readChild = createToolBlock({
            id: 'child-read',
            name: 'Read',
            input: { file_path: '/tmp/example.ts' },
            tool: {
                id: 'child-read',
                name: 'Read',
                state: 'completed',
                input: { file_path: '/tmp/example.ts' },
                createdAt: 4,
                startedAt: 4,
                completedAt: 5,
                description: null,
                result: { file: { filePath: '/tmp/example.ts', content: 'READ_RESULT_SENTINEL' } },
            },
        })
        const task = createToolBlock({
            id: 'task',
            name: 'Task',
            input: {
                description: 'Investigate tools',
            },
            children: [bashChild, readChild] satisfies ChatBlock[],
        })

        renderToolMessage(task)

        expect(screen.queryByText('Tool calls (2)')).not.toBeInTheDocument()
        expectTextNotVisible('CHILD_BASH_RESULT_SENTINEL')
        expectTextNotVisible('READ_RESULT_SENTINEL')

        fireEvent.click(screen.getByRole('button', { name: /Investigate tools/ }))

        expect(screen.getByText('Tool calls (2)')).toBeVisible()
        expect(screen.getByRole('button', { name: /Ran bun test/ })).toBeVisible()
        expectTextNotVisible('CHILD_BASH_RESULT_SENTINEL')
        expectTextNotVisible('READ_RESULT_SENTINEL')

        fireEvent.click(screen.getByRole('button', { name: /Ran bun test/ }))

        expectTextVisible('CHILD_BASH_RESULT_SENTINEL')
        expectTextNotVisible('READ_RESULT_SENTINEL')
    })

    it('summarizes a grouped run of completed tools while collapsed', () => {
        const bashChild = createToolBlock({
            id: 'group-child-bash',
            name: 'Bash',
            input: { command: 'bun test' },
            tool: {
                id: 'group-child-bash',
                name: 'Bash',
                state: 'completed',
                input: { command: 'bun test' },
                createdAt: 2,
                startedAt: 2,
                completedAt: 3,
                description: null,
                result: { stdout: 'GROUP_CHILD_BASH_RESULT_SENTINEL', exitCode: 0 },
            },
        })
        const readChild = createToolBlock({
            id: 'group-child-read',
            name: 'Read',
            input: { file_path: '/tmp/group.ts' },
            tool: {
                id: 'group-child-read',
                name: 'Read',
                state: 'completed',
                input: { file_path: '/tmp/group.ts' },
                createdAt: 4,
                startedAt: 4,
                completedAt: 5,
                description: null,
                result: { file: { filePath: '/tmp/group.ts', content: 'GROUP_READ_RESULT_SENTINEL' } },
            },
        })
        const editChild = createToolBlock({
            id: 'group-child-edit',
            name: 'Edit',
            input: { file_path: '/tmp/changed.ts', old_string: 'a', new_string: 'b' },
            tool: {
                id: 'group-child-edit',
                name: 'Edit',
                state: 'completed',
                input: { file_path: '/tmp/changed.ts', old_string: 'a', new_string: 'b' },
                createdAt: 6,
                startedAt: 6,
                completedAt: 7,
                description: null,
                result: { ok: true },
            },
        })
        const secondReadChild = createToolBlock({
            id: 'group-child-read-2',
            name: 'Read',
            input: { file_path: '/tmp/other.ts' },
            tool: {
                id: 'group-child-read-2',
                name: 'Read',
                state: 'completed',
                input: { file_path: '/tmp/other.ts' },
                createdAt: 8,
                startedAt: 8,
                completedAt: 9,
                description: null,
                result: { file: { filePath: '/tmp/other.ts', content: 'OTHER_READ_RESULT_SENTINEL' } },
            },
        })
        const group = createToolBlock({
            id: 'tool-group:group-child-bash',
            name: 'ToolGroup',
            input: { count: 4 },
            children: [bashChild, readChild, editChild, secondReadChild] satisfies ChatBlock[],
        })

        renderToolMessage(group)

        expect(screen.getByRole('button', { name: /Read 2 files, edited 1 file, ran 1 command/ })).toBeVisible()
        expect(screen.queryByText('Tool calls (4)')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Ran bun test/ })).not.toBeInTheDocument()
        expectTextNotVisible('GROUP_CHILD_BASH_RESULT_SENTINEL')
        expectTextNotVisible('GROUP_READ_RESULT_SENTINEL')

        fireEvent.click(screen.getByRole('button', { name: /Read 2 files, edited 1 file, ran 1 command/ }))

        expect(screen.getAllByText('Read 2 files, edited 1 file, ran 1 command')).toHaveLength(1)
        expect(screen.getByRole('button', { name: /Ran bun test/ })).toBeVisible()
        expectTextNotVisible('GROUP_CHILD_BASH_RESULT_SENTINEL')

        fireEvent.click(screen.getByRole('button', { name: /Ran bun test/ }))

        expectTextVisible('GROUP_CHILD_BASH_RESULT_SENTINEL')
        expectTextNotVisible('GROUP_READ_RESULT_SENTINEL')
    })

    it('summarizes a running tool group by the active child and hides group status', () => {
        const now = Date.now()
        const readChild = createToolBlock({
            id: 'running-group-child-read',
            name: 'Read',
            input: { file_path: '/tmp/seen.ts' },
            createdAt: now - 2000,
            tool: {
                id: 'running-group-child-read',
                name: 'Read',
                state: 'completed',
                input: { file_path: '/tmp/seen.ts' },
                createdAt: now - 2000,
                startedAt: now - 2000,
                completedAt: now - 1000,
                description: null,
                result: { file: { filePath: '/tmp/seen.ts', content: 'SEEN_RESULT_SENTINEL' } },
            },
        })
        const editChild = createToolBlock({
            id: 'running-group-child-edit',
            name: 'Edit',
            input: { file_path: '/tmp/active.ts', old_string: 'a', new_string: 'b' },
            createdAt: now,
            tool: {
                id: 'running-group-child-edit',
                name: 'Edit',
                state: 'running',
                input: { file_path: '/tmp/active.ts', old_string: 'a', new_string: 'b' },
                createdAt: now,
                startedAt: now,
                completedAt: null,
                description: null,
            },
        })
        const group = createToolBlock({
            id: 'tool-group:running-group-child-read',
            name: 'ToolGroup',
            input: { count: 2 },
            createdAt: now - 2000,
            tool: {
                id: 'tool-group:running-group-child-read',
                name: 'ToolGroup',
                state: 'running',
                input: { count: 2 },
                createdAt: now - 2000,
                startedAt: now,
                completedAt: null,
                description: null,
            },
            children: [readChild, editChild] satisfies ChatBlock[],
        })

        renderToolMessage(group)

        expect(screen.getByRole('button', { name: /Editing \/tmp\/active\.ts/ })).toBeVisible()
        expect(screen.queryByText(/0\.0s/)).not.toBeInTheDocument()
    })

    it('falls back to the latest completed child while a running tool group has no active summary', () => {
        const now = Date.now()
        const readChild = createToolBlock({
            id: 'fallback-running-group-child-read',
            name: 'Read',
            input: { file_path: '/tmp/seen.ts' },
            createdAt: now - 3000,
            tool: {
                id: 'fallback-running-group-child-read',
                name: 'Read',
                state: 'completed',
                input: { file_path: '/tmp/seen.ts' },
                createdAt: now - 3000,
                startedAt: now - 3000,
                completedAt: now - 2500,
                description: null,
                result: { file: { filePath: '/tmp/seen.ts', content: 'SEEN_RESULT_SENTINEL' } },
            },
        })
        const bashChild = createToolBlock({
            id: 'fallback-running-group-child-bash',
            name: 'Bash',
            input: { command: 'bun test' },
            createdAt: now - 2000,
            tool: {
                id: 'fallback-running-group-child-bash',
                name: 'Bash',
                state: 'completed',
                input: { command: 'bun test' },
                createdAt: now - 2000,
                startedAt: now - 2000,
                completedAt: now - 1500,
                description: null,
                result: { stdout: 'BASH_RESULT_SENTINEL', exitCode: 0 },
            },
        })
        const unknownChild = createToolBlock({
            id: 'fallback-running-group-child-unknown',
            name: 'UnknownTool',
            input: { payload: true },
            createdAt: now,
            tool: {
                id: 'fallback-running-group-child-unknown',
                name: 'UnknownTool',
                state: 'running',
                input: { payload: true },
                createdAt: now,
                startedAt: now,
                completedAt: null,
                description: null,
            },
        })
        const group = createToolBlock({
            id: 'tool-group:fallback-running-group-child-read',
            name: 'ToolGroup',
            input: { count: 3 },
            createdAt: now - 3000,
            tool: {
                id: 'tool-group:fallback-running-group-child-read',
                name: 'ToolGroup',
                state: 'running',
                input: { count: 3 },
                createdAt: now - 3000,
                startedAt: now,
                completedAt: null,
                description: null,
            },
            children: [readChild, bashChild, unknownChild] satisfies ChatBlock[],
        })

        renderToolMessage(group)

        expect(screen.getByRole('button', { name: /Ran bun test/ })).toBeVisible()
        expect(screen.queryByRole('button', { name: /Read 1 file, ran 1 command, used 1 tool/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Tool calls \(3\)/ })).not.toBeInTheDocument()
    })

    it('uses CodexPatch array entry paths instead of array indexes', () => {
        const block = createToolBlock({
            id: 'codex-patch-array',
            name: 'CodexPatch',
            input: { changes: [{ path: '/tmp/patched.ts' }] },
            tool: {
                id: 'codex-patch-array',
                name: 'CodexPatch',
                state: 'completed',
                input: { changes: [{ path: '/tmp/patched.ts' }] },
                createdAt: 1,
                startedAt: 1,
                completedAt: 2,
                description: null,
            },
        })

        renderToolMessage(block)

        expect(screen.getByRole('button', { name: /Edited \/tmp\/patched\.ts/ })).toBeVisible()
        expect(screen.queryByRole('button', { name: /Edited 0/ })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /Edited \/tmp\/patched\.ts/ }))

        expectTextVisible('patched.ts')
        expect(screen.queryByText(/^0$/)).not.toBeInTheDocument()
    })

    it('does not summarize pathless CodexPatch array entries as numeric indexes', () => {
        const block = createToolBlock({
            id: 'codex-patch-pathless-array',
            name: 'CodexPatch',
            input: { changes: [{ hunks: [] }] },
            tool: {
                id: 'codex-patch-pathless-array',
                name: 'CodexPatch',
                state: 'completed',
                input: { changes: [{ hunks: [] }] },
                createdAt: 1,
                startedAt: 1,
                completedAt: 2,
                description: null,
                result: { ok: true },
            },
        })

        renderToolMessage(block)

        expect(screen.getByRole('button', { name: /Apply changes/ })).toBeVisible()
        expect(screen.queryByRole('button', { name: /Edited 0/ })).not.toBeInTheDocument()
        expect(screen.queryByText(/^0$/)).not.toBeInTheDocument()
    })
})
