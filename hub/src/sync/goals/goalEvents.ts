import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'
import { getDocsRoot, getGoalEventsPath } from './goalDocPaths'

export type GoalEventEntity = {
    type: 'goal' | 'task' | 'decision_topic' | 'preference' | 'command'
    id: string
}

export type GoalEventActor = Record<string, unknown>

export type GoalEvent = {
    id: string
    timestamp: string
    createdAt: number
    writer: 'hopi_server'
    action: string
    entity: GoalEventEntity
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    reason?: string | null
    initiator?: GoalEventActor | null
    source?: GoalEventActor | null
}

function getEventsPath(input: {
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): string | null {
    const docsRoot = getDocsRoot(input.defaultWorkspace)
    return docsRoot ? getGoalEventsPath(docsRoot, input.goal.goalKey) : null
}

function ensureEventsFile(path: string): void {
    mkdirSync(dirname(path), { recursive: true })
    if (!existsSync(path)) {
        writeFileSync(path, '', 'utf8')
    }
}

export function appendGoalEvent(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    action: string
    entity: GoalEventEntity
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    reason?: string | null
    initiator?: GoalEventActor | null
    source?: GoalEventActor | null
    now?: number
}): GoalEvent | null {
    const path = getEventsPath(input)
    if (!path) return null
    ensureEventsFile(path)
    const createdAt = input.now ?? Date.now()
    const event: GoalEvent = {
        id: randomUUID(),
        timestamp: new Date(createdAt).toISOString(),
        createdAt,
        writer: 'hopi_server',
        action: input.action,
        entity: input.entity,
        before: input.before ?? null,
        after: input.after ?? null,
        reason: input.reason?.trim() || null,
        initiator: input.initiator ?? null,
        source: input.source ?? null
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8')
    return event
}

export function readGoalEvents(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    limit?: number
    entity?: GoalEventEntity
}): GoalEvent[] {
    const path = getEventsPath(input)
    if (!path || !existsSync(path)) return []
    const events = readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
            try {
                const parsed = JSON.parse(line) as GoalEvent
                if (input.entity && (
                    parsed.entity?.type !== input.entity.type
                    || parsed.entity?.id !== input.entity.id
                )) {
                    return []
                }
                return [parsed]
            } catch {
                return []
            }
        })
    const limit = input.limit ?? events.length
    return limit > 0 ? events.slice(-limit) : events
}
