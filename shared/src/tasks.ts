// Canonical Goal board order.
export const TASK_STATUS_ORDER = ['planned', 'in_progress', 'in_review', 'merging', 'done'] as const

// Legacy DB/runtime aliases still accepted while overlay migration completes.
export const LEGACY_TASK_STATUS_ORDER = ['planning', 'running', 'review', 'blocked', 'finished'] as const

export const TASK_STATUS_VALUES = [
    ...TASK_STATUS_ORDER,
    ...LEGACY_TASK_STATUS_ORDER
] as const
