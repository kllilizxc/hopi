import { z } from 'zod'

const TASK_SESSION_START_FAILURE_CODES = [
    'invalid_request',
    'not_connected',
    'task_not_found',
    'project_not_found',
    'workspace_required',
    'workspace_not_found',
    'machine_not_found',
    'runner_offline',
    'spawn_failed',
    'session_activation_timeout',
    'unexpected_error',
    'init_script_failed',
    'init_repair_prompt_failed',
    'init_retry_session_inactive',
    'init_retry_wait_timeout'
] as const

const TASK_SESSION_START_RETRY_ACTIONS = [
    'retry_start',
    'manual_fix_then_retry_start',
    'relink_session_then_retry_start',
    'wait_then_retry_start',
    'none'
] as const

function normalizeFailureText(value: string | null | undefined): string | null | undefined {
    if (value === null) {
        return null
    }

    if (typeof value !== 'string') {
        return undefined
    }

    const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 280)
    return normalized.length > 0 ? normalized : undefined
}

export const TaskSessionStartFailureCodeSchema = z.enum(TASK_SESSION_START_FAILURE_CODES)
export type TaskSessionStartFailureCode = z.infer<typeof TaskSessionStartFailureCodeSchema>

export const TaskSessionStartRetryActionSchema = z.enum(TASK_SESSION_START_RETRY_ACTIONS)
export type TaskSessionStartRetryAction = z.infer<typeof TaskSessionStartRetryActionSchema>

export const TaskSessionStartRetrySchema = z.object({
    count: z.number().int().min(0),
    action: TaskSessionStartRetryActionSchema,
    available: z.boolean()
})
export type TaskSessionStartRetry = z.infer<typeof TaskSessionStartRetrySchema>

export const TaskSessionStartFailureSchema = z.object({
    code: TaskSessionStartFailureCodeSchema,
    message: z.string().trim().min(1).max(280),
    blockedReason: z.string().trim().min(1).max(280).nullable().optional(),
    retry: TaskSessionStartRetrySchema.nullable().optional()
})
export type TaskSessionStartFailure = z.infer<typeof TaskSessionStartFailureSchema>

export const TaskSessionStartErrorResponseSchema = z.object({
    error: TaskSessionStartFailureSchema
})
export type TaskSessionStartErrorResponse = z.infer<typeof TaskSessionStartErrorResponseSchema>

export function normalizeTaskSessionStartFailure(
    value: TaskSessionStartFailure | null | undefined
): TaskSessionStartFailure | null | undefined {
    if (value === undefined) {
        return undefined
    }

    if (value === null) {
        return null
    }

    const parsed = TaskSessionStartFailureSchema.safeParse({
        ...value,
        message: normalizeFailureText(value.message) ?? value.message,
        blockedReason: normalizeFailureText(value.blockedReason),
        retry: value.retry === null
            ? null
            : value.retry
                ? {
                    count: Number.isFinite(value.retry.count)
                        ? Math.max(0, Math.floor(value.retry.count))
                        : 0,
                    action: value.retry.action,
                    available: Boolean(value.retry.available)
                }
                : undefined
    })

    return parsed.success ? parsed.data : null
}

export function areTaskSessionStartFailuresEqual(
    left: TaskSessionStartFailure | null | undefined,
    right: TaskSessionStartFailure | null | undefined
): boolean {
    if (!left && !right) {
        return true
    }

    if (!left || !right) {
        return false
    }

    return left.code === right.code
        && left.message === right.message
        && (left.blockedReason ?? null) === (right.blockedReason ?? null)
        && (left.retry?.count ?? null) === (right.retry?.count ?? null)
        && (left.retry?.action ?? null) === (right.retry?.action ?? null)
        && (left.retry?.available ?? null) === (right.retry?.available ?? null)
}

export function getTaskSessionStartFailureHttpStatus(
    failure: Pick<TaskSessionStartFailure, 'code'>
): 400 | 404 | 500 | 503 {
    switch (failure.code) {
        case 'invalid_request':
        case 'workspace_required':
            return 400
        case 'task_not_found':
        case 'project_not_found':
        case 'workspace_not_found':
        case 'machine_not_found':
            return 404
        case 'not_connected':
        case 'runner_offline':
            return 503
        default:
            return 500
    }
}

export function isTaskSessionStartFailureRetryable(
    failure: Pick<TaskSessionStartFailure, 'retry'> | null | undefined
): boolean {
    return failure?.retry?.available === true && failure.retry.action !== 'none'
}

export function buildTaskSessionStartFailureToast(options: {
    taskTitle: string
    failure: TaskSessionStartFailure
}): {
    title: string
    body: string
} {
    const title = isTaskSessionStartFailureRetryable(options.failure)
        ? 'Auto-run blocked'
        : 'Auto-run failed'
    const taskTitle = options.taskTitle.trim()
    const detail = options.failure.message.trim()
    return {
        title,
        body: taskTitle ? `${taskTitle}: ${detail}` : detail
    }
}
