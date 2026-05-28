const OPTIMISTIC_TASK_ID_PREFIX = 'temp:'

export function createOptimisticTaskId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `${OPTIMISTIC_TASK_ID_PREFIX}${globalThis.crypto.randomUUID()}`
    }
    return `${OPTIMISTIC_TASK_ID_PREFIX}${Math.random().toString(36).slice(2)}`
}

export function isOptimisticTaskId(taskId: string): boolean {
    return taskId.startsWith(OPTIMISTIC_TASK_ID_PREFIX)
}
