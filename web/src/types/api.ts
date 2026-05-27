import type {
    DirectoryEntry,
    Goal,
    GoalDecisionTopic,
    Project,
    Task,
    TaskWorkflowPhase,
    DecryptedMessage as ProtocolDecryptedMessage,
    ListDirectoryResponse,
    Session,
    SessionSummary,
    SyncEvent as ProtocolSyncEvent,
    TaskSessionStartFailure,
    Workspace,
    WorktreeMetadata
} from '@hopi/protocol/types'

export type {
    AgentState,
    AttachmentMetadata,
    AgentFlavor,
    AgentOutputLanguage,
    AutomationBackstopPolicy,
    AutomationLaneLimits,
    DirectoryEntry,
    Goal,
    GoalDecisionTopic,
    HopiTaskRole,
    ListDirectoryResponse,
    ModelMode,
    PermissionMode,
    Project,
    Session,
    SessionSummary,
    SessionSummaryMetadata,
    Task,
    TaskActionRuntimeCoreStatus,
    TaskActionRuntimeEnvelope,
    TaskAttachment,
    TaskDependency,
    TaskPriority,
    TaskSessionStartFailure,
    TaskWorkflowPhase,
    TaskStatus,
    TodoItem,
    Workspace,
    WorktreeMetadata
} from '@hopi/protocol/types'

export type SessionMetadataSummary = {
    path: string
    host: string
    version?: string
    name?: string
    os?: string
    summary?: { text: string; updatedAt: number }
    machineId?: string
    tools?: string[]
    flavor?: string | null
    worktree?: WorktreeMetadata
}

export type MessageStatus = 'sending' | 'sent' | 'failed'

export type DecryptedMessage = ProtocolDecryptedMessage & {
    status?: MessageStatus
    originalText?: string
}

export type Machine = {
    id: string
    active: boolean
    metadata: {
        host: string
        platform: string
        happyCliVersion: string
        displayName?: string
        homeDir?: string
    } | null
}

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type SessionsResponse = { sessions: SessionSummary[] }
export type SessionResponse = { session: Session }
export type ProjectsResponse = { projects: Array<Project & { workspaceCount: number }> }
export type ProjectResponse = { project: Project & { workspaceCount: number } }
export type ProjectControllerSessionResponse = {
    sessionId: string | null
    session: Session | null
    created?: boolean
}
export type ProjectControllerBriefingResponse = {
    queued: boolean
    reason: 'queued' | 'cooldown' | 'busy' | 'in_flight' | 'controller_unavailable' | 'empty_goal'
    sessionId: string | null
}
export type ProjectAutomationVerificationResponse = {
    project: Project & { workspaceCount: number }
    verification: {
        status: NonNullable<Project['automationReadinessStatus']>
        summary: string
        checkedAt: number
        workspaceId: string | null
        workspacePath: string | null
        checks: Array<{
            key: 'workspace' | 'contract' | 'init' | 'preview' | 'merge'
            label: string
            ok: boolean
            path: string | null
            detail: string
        }>
    }
}
export type WorkspacesResponse = { workspaces: Workspace[] }
export type WorkspaceResponse = { workspace: Workspace }
export type GoalsResponse = { goals: Goal[] }
export type GoalResponse = { goal: Goal }
export type GoalDecisionTopicsResponse = { topics: GoalDecisionTopic[] }
export type GoalDecisionTopicResponse = { topic: GoalDecisionTopic }
export type GoalAssistantCommandResponse = {
    ok?: boolean
    commandId?: string
    [key: string]: unknown
}
export type GoalTodoSectionKind = 'ready' | 'candidate' | 'promoted' | 'in_review' | 'blocked' | 'done' | 'unknown'
export type GoalTodoStatus = 'planning' | 'running' | 'review' | 'blocked' | 'done' | 'unknown'
export type GoalTodoSection = {
    id: string
    status: GoalTodoStatus
    tag: string | null
    kind: GoalTodoSectionKind
    title: string
    body: string
    taskId: string | null
    todoRef: string | null
    blocked: {
        kind: string | null
        summary: string | null
        updatedAt: number | null
    } | null
    dependencyTaskList: Array<{
        ref: string
    }>
}
export type GoalTodoResponse = {
    exists: boolean
    path: string | null
    rawYaml: string | null
    sections: GoalTodoSection[]
    updatedAt: number | null
}
export type TasksResponse = { tasks: Task[] }
export type TaskResponse = { task: Task }
export type WorkflowStrategyDescriptor = {
    id: string
    label: string
    defaultTaskPhase: TaskWorkflowPhase | null
    phaseOptions: TaskWorkflowPhase[]
}
export type WorkflowStrategiesResponse = { strategies: WorkflowStrategyDescriptor[] }
export type TaskStartSessionResponse = {
    task: Task
    sessionId: string
    initRecoveryAttempted?: boolean
    initRecoveryError?: TaskSessionStartFailure
}
export type TaskWorktreeMergeSkippedReason =
    | 'already_merged'
    | 'no_changes'
    | 'queued'
    | 'waiting'
    | 'approval_pending'
    | 'running'
    | 'retrying'

export type TaskWorktreeMergeResponse = {
    ok: true
    commitHash: string | null
    skippedReason: TaskWorktreeMergeSkippedReason | null
    mergedAt: number | null
    autoResolved?: boolean | null
    autoRetryScheduled?: boolean | null
}

export type TaskWorktreeMergeCancelResponse = {
    ok: true
    canceled: boolean
    mergeRuntime: Task['mergeRuntime'] | null | undefined
}

export type TaskWorktreeMergeStateResponse = {
    ok: true
    canMerge: boolean
    reason:
        | 'mergeable'
        | 'no_changes'
        | 'already_merged'
        | 'task_not_in_review'
        | 'task_has_no_active_session'
        | 'target_branch_not_configured'
        | 'not_connected'
        | 'session_not_found'
        | 'session_access_denied'
        | 'not_worktree_session'
        | 'session_busy'
        | 'merge_check_failed'
    targetBranch: string | null
    sourceBranch: string | null
    hasWorkingTreeChanges: boolean | null
    committedChangedCount: number | null
    mergedAt: number | null
    mergeCommit: string | null
    error: string | null
}
export type TaskPreviewStatus = {
    active: boolean
    status: 'idle' | 'starting' | 'ready' | 'error' | 'stopped'
    taskId?: string
    sessionId?: string
    mode?: 'local' | 'worktree'
    rootPath?: string
    runPath?: string
    command?: string
    port?: number
    url?: string
    pid?: number
    startedAt?: number
    updatedAt: number
    error?: string
    logTail: string[]
}
export type TaskPreviewRuntime = NonNullable<Task['previewRuntime']>
export type TaskPreviewKickoffSkippedReason =
    | 'queued'
    | 'waiting'
    | 'approval_pending'
    | 'running'
    | 'retrying'

export type TaskPreviewResponse = {
    preview: TaskPreviewStatus
    previewRuntime: TaskPreviewRuntime | null | undefined
    skippedReason?: TaskPreviewKickoffSkippedReason | null
    autoRepairAttempted?: boolean
    autoSetupAttempted?: boolean
}
export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}

export type MachinesResponse = { machines: Machine[] }
export type MachinePathsExistsResponse = { exists: Record<string, boolean> }

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

export type GitCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}

export type FileReadResponse = {
    success: boolean
    content?: string
    error?: string
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

export type GitFileStatus = {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
}

export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin'
    content?: string  // Expanded content for Codex user prompts
    pluginName?: string
}

export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

export type SkillSummary = {
    name: string
    description?: string
}

export type SkillsResponse = {
    success: boolean
    skills?: SkillSummary[]
    error?: string
}

export type PushSubscriptionKeys = {
    p256dh: string
    auth: string
}

export type PushSubscriptionPayload = {
    endpoint: string
    keys: PushSubscriptionKeys
}

export type PushUnsubscribePayload = {
    endpoint: string
}

export type PushVapidPublicKeyResponse = {
    publicKey: string
}

export type VisibilityPayload = {
    subscriptionId: string
    visibility: 'visible' | 'hidden'
}

export type SyncEvent = ProtocolSyncEvent
