import type { Task } from '@/types/api'

export const GOAL_TASK_LANES = ['planned', 'in_progress', 'in_review', 'merging', 'done'] as const

export type GoalTaskLane = typeof GOAL_TASK_LANES[number]

export const GOAL_TASK_LANE_TITLE_KEY_BY_LANE = {
    planned: 'projects.columns.planned',
    in_progress: 'projects.columns.inProgress',
    in_review: 'projects.columns.inReview',
    merging: 'projects.columns.merging',
    done: 'projects.columns.done',
} as const satisfies Record<GoalTaskLane, string>

export type KanbanColumnDef = {
    status: GoalTaskLane
    titleKey: string
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = GOAL_TASK_LANES.map((status) => ({
    status,
    titleKey: GOAL_TASK_LANE_TITLE_KEY_BY_LANE[status],
}))

function hasMergeRuntime(task: Task): boolean {
    return Boolean(task.mergeRuntime && task.mergeRuntime.status !== 'succeeded')
}

function isMergeBlocked(task: Task): boolean {
    return task.mergeRuntime?.status === 'blocked' || task.mergeRuntime?.status === 'canceled'
}

function isReviewBlocked(task: Task): boolean {
    return task.blockedSource === 'evaluator'
}

function isExecutionBlocked(task: Task): boolean {
    return task.previewRuntime?.status === 'blocked'
        || task.previewRuntime?.status === 'canceled'
        || task.initRuntime?.status === 'blocked'
        || task.blockedSource === 'preview'
        || task.blockedSource === 'init'
}

export function hasTaskDerivedBlocker(task: Task | null | undefined): boolean {
    if (!task) {
        return false
    }

    return Boolean(
        task.blockedReason
        || task.status === 'blocked'
        || isMergeBlocked(task)
        || isExecutionBlocked(task)
        || isReviewBlocked(task)
    )
}

function resolveBlockedTaskLane(task: Task): GoalTaskLane {
    if (isMergeBlocked(task) || hasMergeRuntime(task)) {
        return 'merging'
    }
    if (isReviewBlocked(task)) {
        return 'in_review'
    }
    if (isExecutionBlocked(task) || task.activeSessionId) {
        return 'in_progress'
    }
    return 'planned'
}

export function getTaskLane(task: Task): GoalTaskLane {
    const status = (task.status ?? '').trim().toLowerCase()

    if (task.worktreeMergedAt || task.mergeRuntime?.status === 'succeeded' || status === 'done' || status === 'finished') {
        return 'done'
    }

    if (hasMergeRuntime(task)) {
        return 'merging'
    }

    switch (status) {
        case 'blocked':
            return resolveBlockedTaskLane(task)
        case 'review':
        case 'in_review':
            return 'in_review'
        case 'running':
        case 'in_progress':
            return 'in_progress'
        case 'planning':
        case 'planned':
        default:
            return 'planned'
    }
}
