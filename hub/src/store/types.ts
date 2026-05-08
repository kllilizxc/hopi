import type {
    OmcAttemptCheck,
    OmcDecisionTopicKind,
    OmcDecisionTopicLifecycle,
    OmcDecisionTopicTurnAuthor,
    OmcDecisionTopicTurnKind,
    OmcDecisionTopicTurnReplyState,
    OmcDirectiveScopeType,
    OmcAttemptTerminationReason,
    OmcCoordinationAgentRole,
    OmcContextPack,
    OmcGuidedPlanningBrief,
    OmcGuidedPlanningRunStage,
    OmcGuidedPlanningRunStatus,
    OmcMailboxPriority,
    OmcMergeStatus,
    OmcAttemptStatus,
    OmcBoardColumn,
    OmcEvidenceKind,
    OmcEvidenceStatus,
    OmcLoopStatus,
    OmcReviewVerdict,
    OmcWorkAttemptRole,
    OmcWorkAttemptStatus,
    OmcWorkOrderOwner,
    OmcWorkOrderStatus,
    TaskInitRuntime,
    TaskMergeRuntime,
    TaskPreviewRuntime
} from '@hopi/protocol/types'

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

export type OmcProgramRow = {
    id: string
    namespace: string
    machineId: string | null
    name: string
    repoRoot: string
    planningRoot: string
    primaryBranch: string | null
    targetBranch: string | null
    createdAt: number
    updatedAt: number
}

export type OmcPlanningRunRow = {
    id: string
    programId: string
    namespace: string
    status: OmcGuidedPlanningRunStatus
    stage: OmcGuidedPlanningRunStage
    brief: OmcGuidedPlanningBrief
    sessionId: string | null
    summary: string | null
    error: string | null
    generatedPlanPaths: string[]
    createdAt: number
    updatedAt: number
    completedAt: number | null
}

export type OmcPlanRuntimeRow = {
    programId: string
    namespace: string
    planKey: string
    planPath: string
    phaseKey: string
    phaseLabel: string
    column: OmcBoardColumn
    loopStatus: OmcLoopStatus
    currentLoopRunId: string | null
    currentWorktreePath: string | null
    currentBranch: string | null
    targetBranch: string | null
    attemptCount: number
    consecutiveFailureCount: number
    lastFailureFingerprint: string | null
    reviewRequired: boolean
    reviewApprovedAt: number | null
    mergeStatus: OmcMergeStatus
    mergeBlockedReason: string | null
    lastMergeAttemptAt: number | null
    mergeApprovedAt: number | null
    doneAt: number | null
    latestEvidenceSummary: string | null
    lastAttemptAt: number | null
    updatedAt: number
}

export type OmcAttemptRow = {
    id: string
    programId: string
    namespace: string
    planKey: string
    planPath: string
    loopRunId: string | null
    sessionId: string | null
    attemptNumber: number
    status: OmcAttemptStatus
    summary: string | null
    failureFingerprint: string | null
    terminationReason: OmcAttemptTerminationReason | null
    changedFiles: string[]
    checks: OmcAttemptCheck[]
    nextSuggestedStep: string | null
    contextPack: OmcContextPack | null
    createdAt: number
    updatedAt: number
    completedAt: number | null
}

export type OmcEvidenceRow = {
    id: string
    programId: string
    namespace: string
    planKey: string
    attemptId: string | null
    kind: OmcEvidenceKind
    label: string
    status: OmcEvidenceStatus
    summary: string
    payload: Record<string, unknown> | null
    createdAt: number
}

export type OmcDecisionTopicRow = {
    id: string
    programId: string
    namespace: string
    kind: OmcDecisionTopicKind
    title: string
    goalId: string | null
    planKey: string | null
    workOrderId: string | null
    lifecycle: OmcDecisionTopicLifecycle
    unread: boolean
    bridgeSessionId: string | null
    createdAt: number
    updatedAt: number
}

export type OmcDecisionTopicTurnRow = {
    id: string
    topicId: string
    programId: string
    namespace: string
    author: OmcDecisionTopicTurnAuthor
    kind: OmcDecisionTopicTurnKind
    body: string
    sessionId: string | null
    sessionMessageId: string | null
    replyState: OmcDecisionTopicTurnReplyState
    createdAt: number
}

export type OmcMailboxMessageRow = {
    id: string
    programId: string
    namespace: string
    from: string
    to: string
    thread: string
    kind: string
    priority: OmcMailboxPriority
    body: string
    createdAt: number
    readAt: number | null
}

export type OmcWorkOrderRow = {
    id: string
    programId: string
    namespace: string
    goalId: string | null
    planKey: string | null
    title: string
    owner: OmcWorkOrderOwner | null
    status: OmcWorkOrderStatus
    currentAttemptId: string | null
    reviewerVerdict: OmcReviewVerdict | null
    blockedReason: string | null
    latestAcceptedAttemptId: string | null
    createdAt: number
    updatedAt: number
}

export type OmcWorkAttemptRow = {
    id: string
    programId: string
    namespace: string
    workOrderId: string
    role: OmcWorkAttemptRole
    sessionId: string | null
    status: OmcWorkAttemptStatus
    summary: string | null
    sourceMailboxMessageId: string | null
    createdAt: number
    updatedAt: number
    completedAt: number | null
}

export type OmcCoordinationAgentStateRow = {
    programId: string
    namespace: string
    role: OmcCoordinationAgentRole
    busy: boolean
    currentWorkOrderId: string | null
    activeSessionId: string | null
    model: string | null
    mode: string | null
    lastHeartbeat: number
}

export type OmcDirectiveLedgerEntryRow = {
    id: string
    programId: string
    namespace: string
    scopeType: OmcDirectiveScopeType
    scopeId: string
    sourceTopicId: string | null
    key: string
    summary: string
    rawText: string | null
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
