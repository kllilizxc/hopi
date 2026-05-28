import type { ChatBlock, ToolCallBlock, ToolPermission } from '@/chat/types'
import type { TracedMessage } from '@/chat/tracer'
import { createCliOutputBlock, isCliOutputText, mergeCliOutputBlocks } from '@/chat/reducerCliOutput'
import { parseMessageAsEvent } from '@/chat/reducerEvents'
import { ensureToolBlock, type PermissionEntry } from '@/chat/reducerTools'

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null
    return value as Record<string, unknown>
}

function appendDelta(previous: string | null, delta: string): string {
    if (previous === null || previous.length === 0) {
        return delta
    }
    if (previous.endsWith(delta)) {
        return previous
    }
    return `${previous}${delta}`
}

function mergeToolResult(previous: unknown, next: unknown, isPartial: boolean): unknown {
    if (isPartial && typeof previous === 'string' && typeof next === 'string') {
        return appendDelta(previous, next)
    }

    const prevRecord = asRecord(previous)
    const nextRecord = asRecord(next)
    if (!nextRecord) {
        return next
    }

    const merged: Record<string, unknown> = {
        ...(prevRecord ?? {}),
        ...nextRecord
    }

    const prevOutput = typeof prevRecord?.output === 'string' ? prevRecord.output : null
    const nextOutput = typeof nextRecord.output === 'string' ? nextRecord.output : null
    const nextDelta = typeof nextRecord.delta === 'string' ? nextRecord.delta : null

    if (isPartial && nextOutput === null && nextDelta !== null) {
        merged.output = appendDelta(prevOutput, nextDelta)
    }

    if (!isPartial) {
        if (typeof merged.output !== 'string' && typeof prevRecord?.output === 'string') {
            merged.output = prevRecord.output
        }
        if (typeof merged.stdout !== 'string' && typeof prevRecord?.stdout === 'string') {
            merged.stdout = prevRecord.stdout
        }
        if (typeof merged.stderr !== 'string' && typeof prevRecord?.stderr === 'string') {
            merged.stderr = prevRecord.stderr
        }
    }

    return merged
}

export function reduceTimeline(
    messages: TracedMessage[],
    context: {
        permissionsById: Map<string, PermissionEntry>
        groups: Map<string, TracedMessage[]>
        consumedGroupIds: Set<string>
    }
): { blocks: ChatBlock[]; toolBlocksById: Map<string, ToolCallBlock>; hasReadyEvent: boolean } {
    const blocks: ChatBlock[] = []
    const toolBlocksById = new Map<string, ToolCallBlock>()
    let hasReadyEvent = false

    for (const msg of messages) {
        if (msg.role === 'event') {
            if (msg.content.type === 'ready') {
                hasReadyEvent = true
                continue
            }
            blocks.push({
                kind: 'agent-event',
                id: msg.id,
                createdAt: msg.createdAt,
                event: msg.content,
                meta: msg.meta
            })
            continue
        }

        const event = parseMessageAsEvent(msg)
        if (event) {
            blocks.push({
                kind: 'agent-event',
                id: msg.id,
                createdAt: msg.createdAt,
                event,
                meta: msg.meta
            })
            continue
        }

        if (msg.role === 'user') {
            if (isCliOutputText(msg.content.text, msg.meta)) {
                blocks.push(createCliOutputBlock({
                    id: msg.id,
                    localId: msg.localId,
                    createdAt: msg.createdAt,
                    text: msg.content.text,
                    source: 'user',
                    meta: msg.meta
                }))
                continue
            }
            blocks.push({
                kind: 'user-text',
                id: msg.id,
                localId: msg.localId,
                createdAt: msg.createdAt,
                text: msg.content.text,
                attachments: msg.content.attachments,
                status: msg.status,
                originalText: msg.originalText,
                meta: msg.meta
            })
            continue
        }

        if (msg.role === 'agent') {
            for (let idx = 0; idx < msg.content.length; idx += 1) {
                const c = msg.content[idx]
                if (c.type === 'text') {
                    if (isCliOutputText(c.text, msg.meta)) {
                        blocks.push(createCliOutputBlock({
                            id: `${msg.id}:${idx}`,
                            localId: msg.localId,
                            createdAt: msg.createdAt,
                            text: c.text,
                            source: 'assistant',
                            meta: msg.meta
                        }))
                        continue
                    }
                    blocks.push({
                        kind: 'agent-text',
                        id: `${msg.id}:${idx}`,
                        localId: msg.localId,
                        createdAt: msg.createdAt,
                        text: c.text,
                        meta: msg.meta
                    })
                    continue
                }

                if (c.type === 'reasoning') {
                    blocks.push({
                        kind: 'agent-reasoning',
                        id: `${msg.id}:${idx}`,
                        localId: msg.localId,
                        createdAt: msg.createdAt,
                        text: c.text,
                        meta: msg.meta
                    })
                    continue
                }

                if (c.type === 'summary') {
                    blocks.push({
                        kind: 'agent-event',
                        id: `${msg.id}:${idx}`,
                        createdAt: msg.createdAt,
                        event: { type: 'message', message: c.summary },
                        meta: msg.meta
                    })
                    continue
                }

                if (c.type === 'tool-call') {
                    const permission = context.permissionsById.get(c.id)?.permission

                    const block = ensureToolBlock(blocks, toolBlocksById, c.id, {
                        createdAt: msg.createdAt,
                        localId: msg.localId,
                        meta: msg.meta,
                        name: c.name,
                        input: c.input,
                        description: c.description,
                        permission
                    })

                    if (block.tool.state === 'pending') {
                        block.tool.state = 'running'
                        block.tool.startedAt = msg.createdAt
                    }

                    if (c.name === 'Task' && !context.consumedGroupIds.has(msg.id)) {
                        const sidechain = context.groups.get(msg.id) ?? null
                        if (sidechain && sidechain.length > 0) {
                            context.consumedGroupIds.add(msg.id)
                            const child = reduceTimeline(sidechain, context)
                            hasReadyEvent = hasReadyEvent || child.hasReadyEvent
                            block.children = child.blocks
                        }
                    }
                    continue
                }

                if (c.type === 'tool-result') {
                    const permissionEntry = context.permissionsById.get(c.tool_use_id)
                    const permissionFromResult = c.permissions ? ({
                        id: c.tool_use_id,
                        status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                        date: c.permissions.date,
                        mode: c.permissions.mode,
                        allowedTools: c.permissions.allowedTools,
                        decision: c.permissions.decision
                    } satisfies ToolPermission) : undefined

                    const permission = (() => {
                        if (permissionFromResult && permissionEntry?.permission) {
                            return {
                                ...permissionEntry.permission,
                                ...permissionFromResult,
                                allowedTools: permissionFromResult.allowedTools ?? permissionEntry.permission.allowedTools,
                                decision: permissionFromResult.decision ?? permissionEntry.permission.decision
                            } satisfies ToolPermission
                        }
                        return permissionFromResult ?? permissionEntry?.permission
                    })()

                    const block = ensureToolBlock(blocks, toolBlocksById, c.tool_use_id, {
                        createdAt: msg.createdAt,
                        localId: msg.localId,
                        meta: msg.meta,
                        name: permissionEntry?.toolName ?? 'Tool',
                        input: permissionEntry?.input ?? null,
                        description: null,
                        permission
                    })

                    block.tool.result = mergeToolResult(block.tool.result, c.content, Boolean(c.is_partial))
                    if (c.is_partial) {
                        block.tool.state = 'running'
                        block.tool.completedAt = null
                        if (block.tool.startedAt === null) {
                            block.tool.startedAt = msg.createdAt
                        }
                        continue
                    }

                    block.tool.completedAt = msg.createdAt
                    block.tool.state = c.is_error ? 'error' : 'completed'
                    continue
                }

                if (c.type === 'sidechain') {
                    blocks.push({
                        kind: 'user-text',
                        id: `${msg.id}:${idx}`,
                        localId: null,
                        createdAt: msg.createdAt,
                        text: c.prompt
                    })
                }
            }
        }
    }

    return { blocks: mergeCliOutputBlocks(blocks), toolBlocksById, hasReadyEvent }
}
