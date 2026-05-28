// Canonical Kanban order for goal task statuses.
// Legacy DB rows may still carry planned/in_progress/in_review/finished while
// runtime overlay migration completes.
export const TASK_STATUS_ORDER = ['planning', 'running', 'review', 'blocked', 'done'] as const

export const LEGACY_TASK_STATUS_ORDER = ['planned', 'in_progress', 'in_review', 'finished'] as const

export const TASK_STATUS_VALUES = [
    ...TASK_STATUS_ORDER,
    ...LEGACY_TASK_STATUS_ORDER
] as const
