import { appendFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { StoredGoal, StoredWorkspace } from '../../store'
import { overlayGoalWithCanonicalDoc } from './goalDocs'

export type GoalWorkflowEventInput = {
    writer: string
    action: string
    entity: {
        type: string
        id: string
    }
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
    reason: string
    metadata?: Record<string, unknown> | null
}

export function createGoalWorkflowEventLine(input: GoalWorkflowEventInput): string {
    return `${JSON.stringify({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        writer: input.writer,
        action: input.action,
        entity: input.entity,
        before: input.before,
        after: input.after,
        reason: input.reason,
        metadata: input.metadata ?? null
    })}\n`
}

export function appendGoalWorkflowEvent(path: string, input: GoalWorkflowEventInput): void {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, createGoalWorkflowEventLine(input), 'utf8')
}

export function buildGoalWorkflowGoalSnapshot(goal: Pick<
    StoredGoal,
    'id' | 'goalKey' | 'title' | 'description' | 'status' | 'successCriteria' | 'autopilotEnabled' | 'automationPausedAt' | 'deployRequiresApproval' | 'currentFocus'
>): Record<string, unknown> {
    return {
        goalId: goal.id,
        goalKey: goal.goalKey,
        title: goal.title,
        description: goal.description,
        status: goal.status,
        successCriteria: goal.successCriteria,
        autopilotEnabled: goal.autopilotEnabled,
        automationPausedAt: goal.automationPausedAt,
        deployRequiresApproval: goal.deployRequiresApproval,
        currentFocus: goal.currentFocus
    }
}

export function buildDocsBackedGoalWorkflowGoalSnapshot(input: {
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): Record<string, unknown> {
    return buildGoalWorkflowGoalSnapshot(overlayGoalWithCanonicalDoc({
        goal: input.goal,
        defaultWorkspace: input.defaultWorkspace
    }))
}
