import type { ToolCallBlock } from '@/chat/types'
import type { SessionMetadataSummary } from '@/types/api'
import { isObject } from '@hopi/protocol'
import { getInputStringAny } from '@/lib/toolInputUtils'
import { resolveDisplayPath } from '@/utils/path'
import { getCodexPatchPaths } from '@/components/ToolCard/codexPatchTargets'

type Translate = (key: string, params?: Record<string, string | number>) => string

type ToolActionKind = 'read' | 'edit' | 'command' | 'other'

type ToolAction = {
    kind: ToolActionKind
    target: string | null
}

function getCommand(input: unknown): string | null {
    const direct = getInputStringAny(input, ['command', 'cmd'])
    if (direct) return direct

    if (isObject(input) && Array.isArray(input.command)) {
        const command = input.command
            .filter((part) => typeof part === 'string')
            .join(' ')
            .trim()
        return command.length > 0 ? command : null
    }

    return null
}

function getFileTarget(input: unknown, metadata: SessionMetadataSummary | null, keys: string[]): string | null {
    const file = getInputStringAny(input, keys)
    return file ? resolveDisplayPath(file, metadata) : null
}

function getFirstCodexParsedCommand(input: unknown): Record<string, unknown> | null {
    if (!isObject(input) || !Array.isArray(input.parsed_cmd) || input.parsed_cmd.length !== 1) {
        return null
    }

    const first = input.parsed_cmd[0]
    return isObject(first) ? first : null
}

function getCodexPatchTarget(block: ToolCallBlock, metadata: SessionMetadataSummary | null): string | null {
    const first = getCodexPatchPaths(block.tool.input, block.tool.result)[0]
    return first ? resolveDisplayPath(first, metadata) : null
}

function getDiffTarget(input: unknown, metadata: SessionMetadataSummary | null): string | null {
    const unified = getInputStringAny(input, ['unified_diff'])
    if (!unified) return null

    for (const line of unified.split('\n')) {
        if (line.startsWith('+++ b/') || line.startsWith('+++ ')) {
            const file = line.replace(/^\+\+\+ (b\/)?/, '')
            return resolveDisplayPath(file, metadata)
        }
    }

    return null
}

function getToolAction(block: ToolCallBlock, metadata: SessionMetadataSummary | null): ToolAction {
    const toolName = block.tool.name
    const input = block.tool.input

    if (toolName === 'Read') {
        return { kind: 'read', target: getFileTarget(input, metadata, ['file_path', 'path', 'file']) }
    }

    if (toolName === 'NotebookRead') {
        return { kind: 'read', target: getFileTarget(input, metadata, ['notebook_path']) }
    }

    if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
        return { kind: 'edit', target: getFileTarget(input, metadata, ['file_path', 'path']) }
    }

    if (toolName === 'NotebookEdit') {
        return { kind: 'edit', target: getFileTarget(input, metadata, ['notebook_path']) }
    }

    if (toolName === 'CodexPatch') {
        return { kind: 'edit', target: getCodexPatchTarget(block, metadata) }
    }

    if (toolName === 'CodexDiff') {
        return { kind: 'edit', target: getDiffTarget(input, metadata) }
    }

    if (toolName === 'CodexBash') {
        const parsed = getFirstCodexParsedCommand(input)
        const parsedType = typeof parsed?.type === 'string' ? parsed.type : null
        const parsedName = typeof parsed?.name === 'string' ? resolveDisplayPath(parsed.name, metadata) : null
        if (parsedType === 'read') return { kind: 'read', target: parsedName }
        if (parsedType === 'write') return { kind: 'edit', target: parsedName }
        return { kind: 'command', target: getCommand(input) }
    }

    if (toolName === 'Bash' || toolName === 'shell_command') {
        return { kind: 'command', target: getCommand(input) }
    }

    return { kind: 'other', target: null }
}

function getActionTitle(block: ToolCallBlock, metadata: SessionMetadataSummary | null, t: Translate): string | null {
    const action = getToolAction(block, metadata)
    if (action.kind === 'other' || !action.target) return null

    const status = block.tool.state === 'running' || block.tool.state === 'pending'
        ? 'running'
        : 'completed'

    return t(`tool.summary.${action.kind}.${status}`, { target: action.target })
}

function formatCount(t: Translate, baseKey: string, count: number): string {
    const key = count === 1 ? `${baseKey}.one` : `${baseKey}.other`
    return t(key, { count })
}

function sentenceCase(value: string): string {
    if (value.length === 0) return value
    return value.charAt(0).toLocaleUpperCase() + value.slice(1)
}

function getGroupedCompletedTitle(block: ToolCallBlock, metadata: SessionMetadataSummary | null, t: Translate): string | null {
    const readTargets = new Set<string>()
    const editTargets = new Set<string>()
    let readUntargeted = 0
    let editUntargeted = 0
    let commands = 0
    let other = 0

    for (const child of block.children) {
        if (child.kind !== 'tool-call') continue
        const action = getToolAction(child, metadata)
        if (action.kind === 'read') {
            if (action.target) {
                readTargets.add(action.target)
            } else {
                readUntargeted += 1
            }
            continue
        }
        if (action.kind === 'edit') {
            if (action.target) {
                editTargets.add(action.target)
            } else {
                editUntargeted += 1
            }
            continue
        }
        if (action.kind === 'command') {
            commands += 1
            continue
        }
        other += 1
    }

    const parts: string[] = []
    const reads = readTargets.size + readUntargeted
    const edits = editTargets.size + editUntargeted

    if (reads > 0) parts.push(formatCount(t, 'tool.summary.group.read', reads))
    if (edits > 0) parts.push(formatCount(t, 'tool.summary.group.edit', edits))
    if (commands > 0) parts.push(formatCount(t, 'tool.summary.group.command', commands))
    if (other > 0) parts.push(formatCount(t, 'tool.summary.group.other', other))
    if (parts.length === 0) return null

    return sentenceCase(parts.join(t('tool.summary.join')))
}

function getLatestCompletedChildTitle(block: ToolCallBlock, metadata: SessionMetadataSummary | null, t: Translate): string | null {
    for (let index = block.children.length - 1; index >= 0; index -= 1) {
        const child = block.children[index]
        if (child.kind !== 'tool-call') continue
        if (child.tool.state === 'running' || child.tool.state === 'pending') continue

        const title = getActionTitle(child, metadata, t)
        if (title) return title
    }

    return null
}

function getGroupedTitle(block: ToolCallBlock, metadata: SessionMetadataSummary | null, t: Translate): string | null {
    const isGroupRunning = block.tool.state === 'running' || block.tool.state === 'pending'
    const activeChild = block.children.find((child): child is ToolCallBlock => (
        child.kind === 'tool-call'
        && (child.tool.state === 'running' || child.tool.state === 'pending')
    ))

    if (activeChild) {
        const title = getActionTitle(activeChild, metadata, t)
        if (title) return title
        if (isGroupRunning) return getLatestCompletedChildTitle(block, metadata, t)
    }

    if (isGroupRunning) {
        const latestCompletedTitle = getLatestCompletedChildTitle(block, metadata, t)
        if (latestCompletedTitle) return latestCompletedTitle
    }

    return getGroupedCompletedTitle(block, metadata, t)
}

export function getToolSummaryTitle(args: {
    block: ToolCallBlock
    metadata: SessionMetadataSummary | null
    t: Translate
    fallbackTitle: string
}): string {
    if (args.block.tool.name === 'ToolGroup') {
        return getGroupedTitle(args.block, args.metadata, args.t) ?? args.fallbackTitle
    }

    return getActionTitle(args.block, args.metadata, args.t) ?? args.fallbackTitle
}
