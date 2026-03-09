import {
    TaskInitRuntimeSchema,
    TaskMergeRuntimeSchema,
    TaskPreviewRuntimeSchema,
    type TaskActionRuntimeEnvelope,
    type TaskInitRuntime,
    type TaskMergeRuntime,
    type TaskPreviewRuntime
} from '@hopi/protocol/schemas'

export const TASK_ACTION_RUNTIME_TEXT_MAX_LENGTH = 280

type TaskActionRuntimeStatus = string

type TaskActionRuntimeWithStatus<Status extends TaskActionRuntimeStatus = string> =
    TaskActionRuntimeEnvelope & { status: Status }

type TaskActionRuntimeParser<Runtime extends TaskActionRuntimeWithStatus> = (value: unknown) => Runtime | null

type TaskActionRuntimeLifecycle<Status extends TaskActionRuntimeStatus> = {
    startedStatuses: readonly Status[]
    completedStatuses: readonly Status[]
    clearFailureFingerprintStatuses: readonly Status[]
}

const mergeRuntimeLifecycle: TaskActionRuntimeLifecycle<TaskMergeRuntime['status']> = {
    startedStatuses: ['running', 'retrying', 'succeeded'],
    completedStatuses: ['blocked', 'succeeded', 'canceled'],
    clearFailureFingerprintStatuses: ['succeeded', 'canceled']
}

const previewRuntimeLifecycle: TaskActionRuntimeLifecycle<TaskPreviewRuntime['status']> = {
    startedStatuses: ['running', 'waiting', 'retrying', 'ready'],
    completedStatuses: ['blocked', 'stopped', 'canceled'],
    clearFailureFingerprintStatuses: ['stopped', 'canceled']
}

const initRuntimeLifecycle: TaskActionRuntimeLifecycle<TaskInitRuntime['status']> = {
    startedStatuses: ['running', 'waiting', 'retrying', 'blocked', 'succeeded'],
    completedStatuses: ['blocked', 'succeeded'],
    clearFailureFingerprintStatuses: ['succeeded']
}

function normalizeRuntimeText(value: string | null | undefined): string | null | undefined {
    if (value === null) {
        return null
    }

    if (typeof value !== 'string') {
        return undefined
    }

    const normalized = value.trim().replace(/\s+/g, ' ').slice(0, TASK_ACTION_RUNTIME_TEXT_MAX_LENGTH)
    return normalized.length > 0 ? normalized : undefined
}

function normalizeRuntimeFingerprint(value: string | null | undefined): string | null | undefined {
    if (value === null) {
        return null
    }

    if (typeof value !== 'string') {
        return undefined
    }

    const normalized = value.trim().slice(0, 64)
    return normalized.length > 0 ? normalized : undefined
}

function normalizeRuntimeSessionId(value: string | null | undefined): string | null | undefined {
    if (value === null) {
        return null
    }

    if (typeof value !== 'string') {
        return undefined
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : undefined
}

function parseTaskRuntime<Runtime extends TaskActionRuntimeWithStatus>(
    value: unknown,
    parser: TaskActionRuntimeParser<Runtime>
): Runtime | null {
    return parser(value)
}

export function parseTaskMergeRuntime(value: unknown): TaskMergeRuntime | null {
    return parseTaskRuntime(value, (candidate) => {
        const parsed = TaskMergeRuntimeSchema.safeParse(candidate)
        return parsed.success ? parsed.data : null
    })
}

export function parseTaskPreviewRuntime(value: unknown): TaskPreviewRuntime | null {
    return parseTaskRuntime(value, (candidate) => {
        const parsed = TaskPreviewRuntimeSchema.safeParse(candidate)
        return parsed.success ? parsed.data : null
    })
}

export function parseTaskInitRuntime(value: unknown): TaskInitRuntime | null {
    return parseTaskRuntime(value, (candidate) => {
        const parsed = TaskInitRuntimeSchema.safeParse(candidate)
        return parsed.success ? parsed.data : null
    })
}

export function normalizeTaskActionRuntime<Runtime extends TaskActionRuntimeWithStatus>(
    value: Runtime | null | undefined,
    updatedAt: number,
    parse: TaskActionRuntimeParser<Runtime>
): Runtime | null | undefined {
    if (value === undefined) {
        return undefined
    }

    if (value === null) {
        return null
    }

    return parse({
        ...value,
        sessionId: normalizeRuntimeSessionId(value.sessionId),
        updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : updatedAt,
        retryCount: typeof value.retryCount === 'number' && Number.isFinite(value.retryCount)
            ? Math.max(0, Math.floor(value.retryCount))
            : undefined,
        requestedAt: typeof value.requestedAt === 'number' && Number.isFinite(value.requestedAt)
            ? value.requestedAt
            : undefined,
        startedAt: value.startedAt === null || (typeof value.startedAt === 'number' && Number.isFinite(value.startedAt))
            ? value.startedAt
            : undefined,
        completedAt: value.completedAt === null || (typeof value.completedAt === 'number' && Number.isFinite(value.completedAt))
            ? value.completedAt
            : undefined,
        failureFingerprint: normalizeRuntimeFingerprint(value.failureFingerprint),
        latestNote: normalizeRuntimeText(value.latestNote),
        blockedReason: normalizeRuntimeText(value.blockedReason)
    })
}

export function normalizeTaskMergeRuntime(
    value: TaskMergeRuntime | null | undefined,
    updatedAt: number
): TaskMergeRuntime | null | undefined {
    return normalizeTaskActionRuntime(value, updatedAt, parseTaskMergeRuntime)
}

export function normalizeTaskPreviewRuntime(
    value: TaskPreviewRuntime | null | undefined,
    updatedAt: number
): TaskPreviewRuntime | null | undefined {
    return normalizeTaskActionRuntime(value, updatedAt, parseTaskPreviewRuntime)
}

export function normalizeTaskInitRuntime(
    value: TaskInitRuntime | null | undefined,
    updatedAt: number
): TaskInitRuntime | null | undefined {
    return normalizeTaskActionRuntime(value, updatedAt, parseTaskInitRuntime)
}

export function syncTaskActionRuntimeSession<Runtime extends TaskActionRuntimeWithStatus>(
    runtime: Runtime | null | undefined,
    sessionId: string | null,
    now = Date.now()
): Runtime | null | undefined {
    if (runtime === undefined || runtime === null) {
        return runtime
    }

    return {
        ...runtime,
        sessionId,
        updatedAt: now
    }
}

export function hasMeaningfulTaskActionRuntimeChange<Runtime extends TaskActionRuntimeWithStatus>(
    current: Runtime | null | undefined,
    next: Runtime
): boolean {
    if (!current) {
        return true
    }

    return current.status !== next.status
        || current.sessionId !== next.sessionId
        || current.requestedAt !== next.requestedAt
        || current.startedAt !== next.startedAt
        || current.completedAt !== next.completedAt
        || current.retryCount !== next.retryCount
        || (current.failureFingerprint ?? null) !== (next.failureFingerprint ?? null)
        || (current.latestNote ?? null) !== (next.latestNote ?? null)
        || (current.blockedReason ?? null) !== (next.blockedReason ?? null)
}

function buildTaskActionRuntime<Status extends TaskActionRuntimeStatus>(options: {
    current: TaskActionRuntimeWithStatus<Status> | null | undefined
    activeSessionId?: string | null
    status: Status
    sessionId?: string | null
    requestedAt?: number
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
    lifecycle: TaskActionRuntimeLifecycle<Status>
    now?: number
}): TaskActionRuntimeWithStatus<Status> {
    const now = options.now ?? Date.now()
    const current = options.current
    const requestedAt = options.requestedAt ?? current?.requestedAt ?? now
    const startedAt = options.startedAt !== undefined
        ? options.startedAt
        : options.lifecycle.startedStatuses.includes(options.status)
            ? current?.startedAt ?? requestedAt
            : current?.startedAt ?? null
    const completedAt = options.completedAt !== undefined
        ? options.completedAt
        : options.lifecycle.completedStatuses.includes(options.status)
            ? now
            : null
    const failureFingerprint = options.failureFingerprint !== undefined
        ? options.failureFingerprint
        : options.lifecycle.clearFailureFingerprintStatuses.includes(options.status)
            ? null
            : current?.failureFingerprint ?? null

    return {
        status: options.status,
        sessionId: options.sessionId ?? current?.sessionId ?? options.activeSessionId ?? null,
        updatedAt: now,
        requestedAt,
        startedAt,
        completedAt,
        retryCount: options.retryCount ?? current?.retryCount,
        failureFingerprint,
        latestNote: options.latestNote ?? null,
        blockedReason: options.blockedReason ?? null
    }
}

export function buildTaskMergeRuntime(options: {
    current: TaskMergeRuntime | null | undefined
    activeSessionId?: string | null
    status: TaskMergeRuntime['status']
    sessionId?: string | null
    requestedAt?: number
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
    now?: number
}): TaskMergeRuntime {
    return buildTaskActionRuntime({
        ...options,
        lifecycle: mergeRuntimeLifecycle
    })
}

export function buildTaskPreviewRuntime(options: {
    current: TaskPreviewRuntime | null | undefined
    activeSessionId?: string | null
    status: TaskPreviewRuntime['status']
    sessionId?: string | null
    requestedAt?: number
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
    now?: number
}): TaskPreviewRuntime {
    return buildTaskActionRuntime({
        ...options,
        lifecycle: previewRuntimeLifecycle
    })
}

export function buildTaskInitRuntime(options: {
    current: TaskInitRuntime | null | undefined
    activeSessionId?: string | null
    status: TaskInitRuntime['status']
    sessionId?: string | null
    requestedAt?: number
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
    now?: number
}): TaskInitRuntime {
    return buildTaskActionRuntime({
        ...options,
        lifecycle: initRuntimeLifecycle
    })
}
