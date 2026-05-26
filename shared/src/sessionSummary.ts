import type { ModelMode } from './modes'
import type { HopiTaskRole, Session, WorktreeMetadata } from './schemas'

export type SessionSummaryMetadata = {
    name?: string
    path: string
    machineId?: string
    projectId?: string
    goalId?: string
    taskId?: string
    hopiTaskRole?: HopiTaskRole
    hopiController?: boolean
    summary?: { text: string }
    flavor?: string | null
    worktree?: WorktreeMetadata
}

export type SessionSummary = {
    id: string
    debugId: string
    active: boolean
    thinking: boolean
    createdAt: number
    activeAt: number
    updatedAt: number
    metadata: SessionSummaryMetadata | null
    todoProgress: { completed: number; total: number } | null
    pendingRequestsCount: number
    modelMode?: ModelMode
}

export function toSessionSummary(session: Session): SessionSummary {
    const pendingRequestsCount = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0

    const metadata: SessionSummaryMetadata | null = session.metadata ? {
        name: session.metadata.name,
        path: session.metadata.path,
        machineId: session.metadata.machineId ?? undefined,
        projectId: session.metadata.projectId ?? undefined,
        goalId: session.metadata.goalId ?? undefined,
        taskId: session.metadata.taskId ?? undefined,
        hopiTaskRole: session.metadata.hopiTaskRole,
        hopiController: session.metadata.hopiController,
        summary: session.metadata.summary ? { text: session.metadata.summary.text } : undefined,
        flavor: session.metadata.flavor ?? null,
        worktree: session.metadata.worktree
    } : null

    const todoProgress = session.todos?.length ? {
        completed: session.todos.filter(t => t.status === 'completed').length,
        total: session.todos.length
    } : null

    return {
        id: session.id,
        debugId: session.debugId,
        active: session.active,
        thinking: session.thinking,
        createdAt: session.createdAt,
        activeAt: session.activeAt,
        updatedAt: session.updatedAt,
        metadata,
        todoProgress,
        pendingRequestsCount,
        modelMode: session.modelMode
    }
}
