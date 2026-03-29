import type { TaskInitRuntime, TaskMergeRuntime, TaskPreviewRuntime } from '@hopi/protocol/types'

export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    todos: unknown | null
    todosUpdatedAt: number | null
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
}

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    createdAt: number
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

export type StoredProject = {
    id: string
    namespace: string
    machineId: string
    name: string
    description: string | null
    defaultWorkspaceId: string | null
    defaultAgentFlavor: string | null
    defaultPermissionMode: string | null
    defaultModel: string | null
    defaultModelMode: string | null
    defaultSessionType: 'simple' | 'worktree' | null
    worktreeTargetBranch: string | null
    worktreeAutoCommitMode: 'off' | 'per_conversation' | null
    worktreeCleanupAfterMerge: boolean
    autoRunEnabled: boolean
    maxRunningSessions: number
    improvementsEnabled: boolean
    improvementsMaxPendingTasks: number
    automationReadinessStatus: 'unknown' | 'checking' | 'ready' | 'degraded' | 'blocked'
    automationReadinessSummary: string | null
    automationReadinessCheckedAt: number | null
    lastImprovementsAt: number | null
    createdAt: number
    updatedAt: number
    archivedAt: number | null
}

export type StoredWorkspace = {
    id: string
    projectId: string
    label: string | null
    path: string
    sort: number | null
    createdAt: number
    updatedAt: number
}

export type StoredTask = {
    id: string
    projectId: string
    title: string
    description: string | null
    status: string
    priority: string | null
    sortKey: number | null
    activeSessionId: string | null
    workspaceId: string | null
    agentFlavor: string | null
    permissionMode: string | null
    model: string | null
    modelMode: string | null
    attachments: unknown | null
    source: string | null
    sourceTaskId: string | null
    workflowProfile: string
    workflowPhase: string | null
    subTasks: unknown | null
    subTasksUpdatedAt: number | null
    worktreeMergedAt: number | null
    worktreeMergeCommit: string | null
    mergedDiffSnapshot: unknown | null
    mergeRuntime: TaskMergeRuntime | null
    previewRuntime: TaskPreviewRuntime | null
    initRuntime: TaskInitRuntime | null
    createdAt: number
    updatedAt: number
    finishedAt: number | null
    archivedAt: number | null
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }
