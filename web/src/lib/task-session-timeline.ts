import type { HopiTaskRole, SessionSummary, Task } from '@/types/api'
import { getTaskLane } from '@/lib/task-status'

export type TaskSessionTimelineItem = {
    session: SessionSummary
    role: HopiTaskRole | null
    roleLabel: string
    index: number
    isActiveTaskSession: boolean
    isMergeRuntimeSession: boolean
}

export type TaskReviewStage =
    | {
        state: 'queued' | 'running' | 'result_pending'
        evaluatorSessionId: string | null
    }
    | {
        state: 'merge_running' | 'merge_retrying' | 'merge_blocked'
        evaluatorSessionId: null
        mergeSessionId: string | null
        retryCount: number
        latestNote: string | null
        blockedReason: string | null
    }

type TaskMergeRuntime = NonNullable<Task['mergeRuntime']>
type TaskMergeReviewStageState = Extract<TaskReviewStage['state'], `merge_${string}`>

function getMergeReviewStageState(status: TaskMergeRuntime['status']): TaskMergeReviewStageState | null {
    switch (status) {
        case 'queued':
        case 'waiting':
        case 'approval_pending':
        case 'running':
            return 'merge_running'
        case 'retrying':
            return 'merge_retrying'
        case 'blocked':
        case 'canceled':
            return 'merge_blocked'
        case 'succeeded':
            return null
        default: {
            const _exhaustive: never = status
            return _exhaustive
        }
    }
}

function buildMergeReviewStage(runtime: TaskMergeRuntime): TaskReviewStage | null {
    const state = getMergeReviewStageState(runtime.status)
    if (!state) {
        return null
    }

    return {
        state,
        evaluatorSessionId: null,
        mergeSessionId: runtime.sessionId ?? null,
        retryCount: runtime.retryCount ?? 0,
        latestNote: runtime.latestNote ?? null,
        blockedReason: runtime.blockedReason ?? null
    }
}

const ROLE_LABELS: Record<HopiTaskRole, string> = {
    planner: 'Planner',
    generator: 'Generator',
    evaluator: 'Evaluator',
    radar: 'Radar'
}

const MERGE_ROLE_LABEL = 'Merge'

function normalizeRole(value: unknown): HopiTaskRole | null {
    return value === 'planner' || value === 'generator' || value === 'evaluator' || value === 'radar'
        ? value
        : null
}

function inferFallbackRole(task: Task, index: number, total: number): HopiTaskRole | null {
    const source = (task.source ?? '').trim().toLowerCase()
    if (source === 'planner') return 'planner'
    if (source === 'radar') return 'radar'
    const taskLane = getTaskLane(task)

    if (total > 1) {
        if (index === 0) {
            return 'generator'
        }

        const taskReachedReview = taskLane === 'in_review'
            || taskLane === 'merging'
            || taskLane === 'done'
            || source === 'evaluator'
        if (taskReachedReview && index === total - 1) {
            return 'evaluator'
        }
    }

    if (source === 'evaluator') return 'evaluator'
    if (task.goalId) return 'generator'
    return null
}

function getSessionCreatedAt(session: SessionSummary): number {
    return session.createdAt || session.activeAt || session.updatedAt || 0
}

function isTaskTimelineSession(task: Task, session: SessionSummary): boolean {
    return session.metadata?.taskId === task.id || session.id === task.mergeRuntime?.sessionId
}

export function buildTaskSessionTimeline(task: Task, sessions: SessionSummary[]): TaskSessionTimelineItem[] {
    const taskSessions = sessions
        .filter((session) => isTaskTimelineSession(task, session))
        .sort((a, b) => {
            const createdDiff = getSessionCreatedAt(a) - getSessionCreatedAt(b)
            if (createdDiff !== 0) {
                return createdDiff
            }
            return a.id.localeCompare(b.id)
        })

    return taskSessions.map((session, index) => {
        const isMergeRuntimeSession = session.id === task.mergeRuntime?.sessionId
        const role = normalizeRole(session.metadata?.hopiTaskRole) ?? inferFallbackRole(task, index, taskSessions.length)
        const roleLabel = isMergeRuntimeSession
            ? MERGE_ROLE_LABEL
            : role
                ? ROLE_LABELS[role]
                : `Session ${index + 1}`
        return {
            session,
            role,
            roleLabel,
            index,
            isActiveTaskSession: Boolean(task.activeSessionId && session.id === task.activeSessionId),
            isMergeRuntimeSession
        }
    })
}

export function resolveTaskSessionSelection(
    timeline: TaskSessionTimelineItem[],
    selectedSessionId: string | null,
    fallbackSessionId: string | null = null,
    preferredSessionId: string | null = null
): string | null {
    if (selectedSessionId && timeline.some((item) => item.session.id === selectedSessionId)) {
        return selectedSessionId
    }

    return preferredSessionId ?? timeline[timeline.length - 1]?.session.id ?? fallbackSessionId
}

export function buildTaskReviewStage(task: Task, timeline: TaskSessionTimelineItem[]): TaskReviewStage | null {
    const taskLane = getTaskLane(task)

    if (task.mergeRuntime && (taskLane === 'in_review' || taskLane === 'merging')) {
        return buildMergeReviewStage(task.mergeRuntime)
    }

    if (taskLane !== 'in_review') {
        return null
    }

    if (task.worktreeMergedAt) {
        return null
    }

    const evaluator = [...timeline].reverse().find((item) => item.role === 'evaluator' && !item.isMergeRuntimeSession)
    if (!evaluator) {
        return {
            state: 'queued',
            evaluatorSessionId: null
        }
    }

    if (evaluator.session.active || evaluator.session.thinking) {
        return {
            state: 'running',
            evaluatorSessionId: evaluator.session.id
        }
    }

    return {
        state: 'result_pending',
        evaluatorSessionId: evaluator.session.id
    }
}
