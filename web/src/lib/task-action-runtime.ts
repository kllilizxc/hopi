import type { Task, TaskActionRuntimeEnvelope, TaskActionRuntimeCoreStatus, TaskPreviewStatus, TaskWorktreeMergeStateResponse } from '@/types/api'

export type TaskActionStatusSummary = {
    title: string
    detail?: string | null
    tone?: 'info' | 'success' | 'error'
    busy?: boolean
}

export type TaskActionPreviewStatusSummary = TaskActionStatusSummary & {
    url?: string | null
}

type TaskActionRuntimeLike<Status extends string = string> = TaskActionRuntimeEnvelope & { status: Status }

type MergeRuntimeStatus = NonNullable<Task['mergeRuntime']>['status']
type PreviewRuntimeStatus = NonNullable<Task['previewRuntime']>['status']
type InitRuntimeStatus = NonNullable<Task['initRuntime']>['status']

export function areTaskActionRuntimesEqual<Runtime extends TaskActionRuntimeLike>(
    left: Runtime | null | undefined,
    right: Runtime | null | undefined
): boolean {
    if (!left && !right) {
        return true
    }

    if (!left || !right) {
        return false
    }

    return left.status === right.status
        && left.sessionId === right.sessionId
        && left.updatedAt === right.updatedAt
        && left.requestedAt === right.requestedAt
        && left.startedAt === right.startedAt
        && left.completedAt === right.completedAt
        && left.retryCount === right.retryCount
        && left.failureFingerprint === right.failureFingerprint
        && left.latestNote === right.latestNote
        && left.blockedReason === right.blockedReason
}

export function buildTaskActionRetrySuffix(retryCount: number | null | undefined): string {
    return retryCount && retryCount > 0
        ? `（已重试 ${retryCount} 次）`
        : ''
}

export function isBusyTaskActionRuntimeStatus(status: TaskActionRuntimeCoreStatus | null | undefined): boolean {
    return status === 'queued'
        || status === 'waiting'
        || status === 'approval_pending'
        || status === 'running'
        || status === 'retrying'
}

export function isActiveMergeRuntimeStatus(status: MergeRuntimeStatus | null | undefined): boolean {
    return isBusyTaskActionRuntimeStatus(status)
}

export function isRetryableMergeRuntimeStatus(status: MergeRuntimeStatus | null | undefined): boolean {
    return status === 'blocked' || status === 'canceled'
}

export function shouldTreatBlockedMergeAsRecoveredSuccess(
    runtime: Task['mergeRuntime'] | null | undefined,
    mergeState: TaskWorktreeMergeStateResponse | null | undefined
): boolean {
    if (runtime?.status !== 'blocked' || !mergeState || mergeState.canMerge) {
        return false
    }

    return mergeState.reason === 'already_merged' || mergeState.reason === 'no_changes'
}

export function buildRecoveredBlockedMergeSummary(
    runtime: Task['mergeRuntime'] | null | undefined,
    mergeState: TaskWorktreeMergeStateResponse | null | undefined
): TaskActionStatusSummary | null {
    if (!shouldTreatBlockedMergeAsRecoveredSuccess(runtime, mergeState)) {
        return null
    }

    return {
        title: 'Merge 已完成',
        detail: mergeState?.reason === 'already_merged'
            ? '目标分支已包含当前任务变更。'
            : '当前已无待合并的已提交变更。',
        tone: 'success'
    }
}

export function shouldShowMergeActionButton(options: {
    task: Task | null | undefined
    hasActiveMergeRuntime: boolean
    mergeRuntimeStatus: MergeRuntimeStatus | null | undefined
    canStartMerge: boolean
}): boolean {
    const { task, hasActiveMergeRuntime, mergeRuntimeStatus, canStartMerge } = options

    return Boolean(
        task
        && task.status === 'in_review'
        && !task.archivedAt
        && !task.finishedAt
        && (hasActiveMergeRuntime || isRetryableMergeRuntimeStatus(mergeRuntimeStatus) || canStartMerge)
    )
}

export function buildMergeRuntimeSummary(
    task: Task | null | undefined,
    runtime: Task['mergeRuntime'] | null | undefined
): TaskActionStatusSummary | null {
    if (!runtime) {
        if (!task?.worktreeMergedAt) {
            return null
        }

        return {
            title: 'Merge 已完成',
            detail: task.worktreeMergeCommit ? `Commit: ${task.worktreeMergeCommit}` : '详细输出见对话记录。',
            tone: 'success'
        }
    }

    const retrySuffix = buildTaskActionRetrySuffix(runtime.retryCount)

    switch (runtime.status) {
        case 'queued':
            return {
                title: 'Merge 已排队',
                detail: runtime.latestNote ?? '等待当前会话回合结束后开始。',
                tone: 'info',
                busy: true
            }
        case 'waiting':
            return {
                title: '等待会话确认 Merge 结果',
                detail: runtime.latestNote ?? '等待链接会话汇报最终结果。',
                tone: 'info',
                busy: true
            }
        case 'approval_pending':
            return {
                title: '等待批准后继续 Merge',
                detail: runtime.latestNote ?? '先处理当前批准请求。',
                tone: 'info',
                busy: true
            }
        case 'running':
            return {
                title: 'Merge 进行中',
                detail: runtime.latestNote ?? '详细输出会出现在对话里。',
                tone: 'info',
                busy: true
            }
        case 'retrying':
            return {
                title: `Merge 重试中${retrySuffix}`,
                detail: runtime.latestNote ?? '正在根据最新输出继续重试。',
                tone: 'info',
                busy: true
            }
        case 'blocked':
            return {
                title: `Merge 受阻${retrySuffix}`,
                detail: runtime.latestNote ?? runtime.blockedReason ?? '需要先解决阻塞后再试。',
                tone: 'error'
            }
        case 'succeeded':
            return {
                title: 'Merge 已完成',
                detail: task?.worktreeMergeCommit
                    ? `${runtime.latestNote ?? '详细输出见对话记录。'} (${task.worktreeMergeCommit})`
                    : runtime.latestNote ?? '详细输出见对话记录。',
                tone: 'success'
            }
        case 'canceled':
            return {
                title: 'Merge 已取消',
                detail: runtime.latestNote ?? '可以随时重新发起 Merge。',
                tone: 'info'
            }
    }
}

export function isActivePreviewRuntimeStatus(status: PreviewRuntimeStatus | null | undefined): boolean {
    return status === 'queued'
        || status === 'waiting'
        || status === 'approval_pending'
        || status === 'running'
        || status === 'retrying'
}

export function isRetryablePreviewRuntimeStatus(status: PreviewRuntimeStatus | null | undefined): boolean {
    return status === 'blocked' || status === 'canceled' || status === 'stopped'
}

export function buildPreviewStatusSummary(
    runtime: Task['previewRuntime'] | null | undefined,
    preview: TaskPreviewStatus | null
): TaskActionPreviewStatusSummary | null {
    const retrySuffix = buildTaskActionRetrySuffix(runtime?.retryCount)

    if (preview?.status === 'ready') {
        return {
            title: 'Preview 已就绪',
            detail: preview.url ? '服务已就绪，可直接打开链接。' : '详细输出见对话记录。',
            tone: 'success',
            url: preview.url ?? null
        }
    }

    switch (runtime?.status) {
        case 'queued':
            return {
                title: 'Preview 已排队',
                detail: runtime.latestNote ?? '等待当前会话回合结束后自动启动。',
                tone: 'info',
                busy: true
            }
        case 'waiting':
            return {
                title: 'Preview 启动中',
                detail: runtime.latestNote ?? '等待服务报告 ready。',
                tone: 'info',
                busy: true
            }
        case 'approval_pending':
            return {
                title: '等待批准后继续 Preview',
                detail: runtime.latestNote ?? '当前批准请求处理完后会自动启动。',
                tone: 'info',
                busy: true
            }
        case 'running':
            return {
                title: 'Preview 启动中',
                detail: runtime.latestNote ?? '正在直接运行项目预览命令。',
                tone: 'info',
                busy: true
            }
        case 'retrying':
            return {
                title: `Preview 修复中${retrySuffix}`,
                detail: runtime.latestNote ?? '正在根据最新 CLI 输出修复后重试。',
                tone: 'info',
                busy: true
            }
        case 'blocked':
            return {
                title: `Preview 受阻${retrySuffix}`,
                detail: runtime.latestNote ?? runtime.blockedReason ?? '需要先解决阻塞后再试。',
                tone: 'error'
            }
        case 'ready':
            return {
                title: 'Preview 已就绪',
                detail: preview?.url
                    ? '服务已就绪，可直接打开链接。'
                    : runtime.latestNote ?? '详细输出见对话记录。',
                tone: 'success',
                url: preview?.url ?? null
            }
        case 'stopped':
            return {
                title: 'Preview 已停止',
                detail: runtime.latestNote ?? '可以随时重新启动 Preview。',
                tone: 'info'
            }
        case 'canceled':
            return {
                title: 'Preview 已取消',
                detail: runtime.latestNote ?? '队列或启动中的 Preview 已取消。',
                tone: 'info'
            }
    }
    if (preview?.status === 'starting') {
        return {
            title: 'Preview 启动中',
            detail: '等待服务报告 ready。',
            tone: 'info',
            busy: true
        }
    }

    if (preview?.status === 'error') {
        return {
            title: 'Preview 失败',
            detail: preview.error ?? '预览进程返回错误。',
            tone: 'error'
        }
    }

    if (preview?.status === 'stopped') {
        return {
            title: 'Preview 已停止',
            detail: '可以随时重新启动 Preview。',
            tone: 'info'
        }
    }

    return null
}

export function isActiveInitRuntimeStatus(status: InitRuntimeStatus | null | undefined): boolean {
    return status === 'running' || status === 'waiting' || status === 'retrying'
}

export function shouldShowInitRuntimeInSession(task: Task | null | undefined, sessionId: string | null | undefined): boolean {
    if (!task?.initRuntime || !sessionId) {
        return false
    }

    if (task.activeSessionId !== sessionId) {
        return false
    }

    if (!isActiveInitRuntimeStatus(task.initRuntime.status) && task.initRuntime.status !== 'blocked') {
        return false
    }

    const runtimeSessionId = task.initRuntime.sessionId
    return !runtimeSessionId || runtimeSessionId === sessionId
}

export function buildInitStatusSummary(task: Task | null | undefined): TaskActionStatusSummary | null {
    const runtime = task?.initRuntime ?? null
    if (!runtime) {
        return null
    }

    const retrySuffix = buildTaskActionRetrySuffix(runtime.retryCount)

    switch (runtime.status) {
        case 'running':
            return {
                title: 'Init 进行中',
                detail: runtime.latestNote ?? '正在先运行仓库 init 脚本，再继续任务 kickoff。',
                tone: 'info',
                busy: true
            }
        case 'waiting':
            return {
                title: '等待 Init 结果',
                detail: runtime.latestNote ?? '等待链接会话确认 init 结果。',
                tone: 'info',
                busy: true
            }
        case 'retrying':
            return {
                title: `Init 修复中${retrySuffix}`,
                detail: runtime.latestNote ?? 'Init 脚本失败后，正在同一会话里修复并重试。',
                tone: 'info',
                busy: true
            }
        case 'blocked':
            return {
                title: `Init 受阻${retrySuffix}`,
                detail: runtime.latestNote ?? runtime.blockedReason ?? '需要先解决 init 阻塞后再继续任务。',
                tone: 'error'
            }
        case 'succeeded':
            return {
                title: 'Init 已完成',
                detail: runtime.latestNote ?? '仓库 init 已完成，任务 kickoff 已继续。',
                tone: 'success'
            }
        default: {
            const _exhaustive: never = runtime.status
            return _exhaustive
        }
    }
}
