import { z } from 'zod'
import { MODEL_MODES, PERMISSION_MODES } from './modes'
import { TaskSessionStartFailureSchema } from './task-session-start'
import { TASK_STATUS_ORDER } from './tasks'

export const PermissionModeSchema = z.enum(PERMISSION_MODES)
export const ModelModeSchema = z.enum(MODEL_MODES)
export const ModelNameSchema = z.string().trim().min(1)

export const AgentFlavorSchema = z.enum(['claude', 'codex', 'gemini', 'opencode'])

export const SessionTypeSchema = z.enum(['simple', 'worktree'])
export type SessionType = z.infer<typeof SessionTypeSchema>

export const WorktreeAutoCommitModeSchema = z.enum(['off', 'per_conversation'])
export type WorktreeAutoCommitMode = z.infer<typeof WorktreeAutoCommitModeSchema>

export const AgentOutputLanguageSchema = z.enum(['system', 'en', 'zh-CN'])
export type AgentOutputLanguage = z.infer<typeof AgentOutputLanguageSchema>
export const DEFAULT_AGENT_OUTPUT_LANGUAGE: AgentOutputLanguage = 'system'

export function normalizeAgentOutputLanguage(value?: string | null): AgentOutputLanguage {
    const parsed = AgentOutputLanguageSchema.safeParse(value)
    return parsed.success ? parsed.data : DEFAULT_AGENT_OUTPUT_LANGUAGE
}

export const DirectoryEntryTypeSchema = z.enum(['file', 'directory', 'other'])
export type DirectoryEntryType = z.infer<typeof DirectoryEntryTypeSchema>

export const DirectoryEntrySchema = z.object({
    name: z.string(),
    type: DirectoryEntryTypeSchema,
    size: z.number().nonnegative().optional(),
    modified: z.number().int().nonnegative().optional()
})

export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>

export const ListDirectoryQuerySchema = z.object({
    path: z.string().optional()
})

export type ListDirectoryQuery = z.infer<typeof ListDirectoryQuerySchema>

export const ListDirectoryRequestSchema = z.object({
    path: z.string(),
    cwd: z.string().optional()
})

export type ListDirectoryRequest = z.infer<typeof ListDirectoryRequestSchema>

export const ListDirectoryResponseSchema = z.discriminatedUnion('success', [
    z.object({
        success: z.literal(true),
        path: z.string(),
        entries: z.array(DirectoryEntrySchema)
    }),
    z.object({
        success: z.literal(false),
        error: z.string()
    })
])

export type ListDirectoryResponse = z.infer<typeof ListDirectoryResponseSchema>

const MetadataSummarySchema = z.object({
    text: z.string(),
    updatedAt: z.number()
})

export const WorktreeMetadataSchema = z.object({
    basePath: z.string(),
    branch: z.string(),
    name: z.string(),
    worktreePath: z.string().optional(),
    createdAt: z.number().optional(),
    baseCommit: z.string().optional()
})

export type WorktreeMetadata = z.infer<typeof WorktreeMetadataSchema>

export const HopiTaskRoleSchema = z.enum(['planner', 'generator', 'evaluator', 'radar'])
export type HopiTaskRole = z.infer<typeof HopiTaskRoleSchema>

export const AutomationLaneSchema = HopiTaskRoleSchema
export type AutomationLane = HopiTaskRole

const AutomationLaneLimitSchema = z.number().int().min(0).max(50)

export const AutomationLaneLimitsSchema = z.object({
    planner: AutomationLaneLimitSchema.optional(),
    generator: AutomationLaneLimitSchema.optional(),
    evaluator: AutomationLaneLimitSchema.optional(),
    radar: AutomationLaneLimitSchema.optional()
})
export type AutomationLaneLimits = z.infer<typeof AutomationLaneLimitsSchema>

export const DEFAULT_AUTOMATION_LANE_LIMITS: Record<AutomationLane, number> = {
    planner: 3,
    generator: 3,
    evaluator: 3,
    radar: 3
}

export function normalizeAutomationLaneLimits(value?: AutomationLaneLimits | null): Record<AutomationLane, number> {
    const parsed = AutomationLaneLimitsSchema.safeParse(value ?? {})
    const limits = parsed.success ? parsed.data : {}
    return {
        planner: limits.planner ?? DEFAULT_AUTOMATION_LANE_LIMITS.planner,
        generator: limits.generator ?? DEFAULT_AUTOMATION_LANE_LIMITS.generator,
        evaluator: limits.evaluator ?? DEFAULT_AUTOMATION_LANE_LIMITS.evaluator,
        radar: limits.radar ?? DEFAULT_AUTOMATION_LANE_LIMITS.radar
    }
}

export const MetadataSchema = z.object({
    path: z.string(),
    host: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    os: z.string().optional(),
    locale: z.string().optional(),
    summary: MetadataSummarySchema.optional(),
    machineId: z.string().optional(),
    projectId: z.string().optional(),
    taskId: z.string().optional(),
    hopiTaskRole: HopiTaskRoleSchema.optional(),
    claudeSessionId: z.string().optional(),
    codexSessionId: z.string().optional(),
    geminiSessionId: z.string().optional(),
    opencodeSessionId: z.string().optional(),
    tools: z.array(z.string()).optional(),
    slashCommands: z.array(z.string()).optional(),
    homeDir: z.string().optional(),
    happyHomeDir: z.string().optional(),
    happyLibDir: z.string().optional(),
    happyToolsDir: z.string().optional(),
    startedFromRunner: z.boolean().optional(),
    hostPid: z.number().optional(),
    startedBy: z.enum(['runner', 'terminal']).optional(),
    lifecycleState: z.string().optional(),
    lifecycleStateSince: z.number().optional(),
    archivedBy: z.string().optional(),
    archiveReason: z.string().optional(),
    flavor: z.string().nullish(),
    worktree: WorktreeMetadataSchema.optional()
})

export type Metadata = z.infer<typeof MetadataSchema>

export const AgentStateRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish()
})

export type AgentStateRequest = z.infer<typeof AgentStateRequestSchema>

export const AgentStateCompletedRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish(),
    completedAt: z.number().nullish(),
    status: z.enum(['canceled', 'denied', 'approved']),
    reason: z.string().optional(),
    mode: z.string().optional(),
    decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
    allowTools: z.array(z.string()).optional(),
    // Flat format: Record<string, string[]> (AskUserQuestion)
    // Nested format: Record<string, { answers: string[] }> (request_user_input)
    answers: z.union([
        z.record(z.string(), z.array(z.string())),
        z.record(z.string(), z.object({ answers: z.array(z.string()) }))
    ]).optional()
})

export type AgentStateCompletedRequest = z.infer<typeof AgentStateCompletedRequestSchema>

export const AgentStateSchema = z.object({
    controlledByUser: z.boolean().nullish(),
    requests: z.record(z.string(), AgentStateRequestSchema).nullish(),
    completedRequests: z.record(z.string(), AgentStateCompletedRequestSchema).nullish()
})

export type AgentState = z.infer<typeof AgentStateSchema>

export const TodoItemSchema = z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
    priority: z.enum(['high', 'medium', 'low']),
    id: z.string()
})

export type TodoItem = z.infer<typeof TodoItemSchema>

export const TodosSchema = z.array(TodoItemSchema)

export const AttachmentMetadataSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    path: z.string(),
    previewUrl: z.string().optional()
})

export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>

export const DecryptedMessageSchema = z.object({
    id: z.string(),
    seq: z.number().nullable(),
    localId: z.string().nullable(),
    content: z.unknown(),
    createdAt: z.number()
})

export type DecryptedMessage = z.infer<typeof DecryptedMessageSchema>

export const SessionSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    active: z.boolean(),
    activeAt: z.number(),
    metadata: MetadataSchema.nullable(),
    metadataVersion: z.number(),
    agentState: AgentStateSchema.nullable(),
    agentStateVersion: z.number(),
    thinking: z.boolean(),
    thinkingAt: z.number(),
    todos: TodosSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    modelMode: ModelModeSchema.optional()
})

export type Session = z.infer<typeof SessionSchema>

export const AutomationReadinessStatusSchema = z.enum(['unknown', 'checking', 'ready', 'degraded', 'blocked'])
export type AutomationReadinessStatus = z.infer<typeof AutomationReadinessStatusSchema>

export const ProjectSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    machineId: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    defaultWorkspaceId: z.string().nullable().optional(),
    defaultAgentFlavor: AgentFlavorSchema.nullable().optional(),
    defaultPermissionMode: PermissionModeSchema.nullable().optional(),
    defaultModel: ModelNameSchema.nullable().optional(),
    defaultModelMode: ModelModeSchema.nullable().optional(),
    defaultSessionType: SessionTypeSchema.nullable().optional(),
    worktreeTargetBranch: z.string().nullable().optional(),
    worktreeAutoCommitMode: WorktreeAutoCommitModeSchema.nullable().optional(),
    worktreeCleanupAfterMerge: z.boolean().optional(),
    agentOutputLanguage: AgentOutputLanguageSchema.optional(),
    autoRunEnabled: z.boolean().optional(),
    maxRunningSessions: z.number().int().min(1).max(50).optional(),
    automationLaneLimits: AutomationLaneLimitsSchema.optional(),
    improvementsEnabled: z.boolean().optional(),
    improvementsMaxPendingTasks: z.number().int().min(1).max(50).optional(),
    automationReadinessStatus: AutomationReadinessStatusSchema.optional(),
    automationReadinessSummary: z.string().nullable().optional(),
    automationReadinessCheckedAt: z.number().nullable().optional(),
    worktreeLocked: z.boolean().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastImprovementsAt: z.number().nullable().optional(),
    archivedAt: z.number().nullable().optional()
})

export type Project = z.infer<typeof ProjectSchema>

export const GoalStatusSchema = z.enum(['planning', 'active', 'blocked', 'paused', 'done', 'archived'])
export type GoalStatus = z.infer<typeof GoalStatusSchema>

export const GoalSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    namespace: z.string(),
    title: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    status: GoalStatusSchema,
    successCriteria: z.string().nullable().optional(),
    autopilotEnabled: z.boolean(),
    deployRequiresApproval: z.boolean(),
    currentFocus: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    archivedAt: z.number().nullable().optional()
})
export type Goal = z.infer<typeof GoalSchema>

export const GoalDecisionTopicStatusSchema = z.enum(['waiting', 'resolved'])
export type GoalDecisionTopicStatus = z.infer<typeof GoalDecisionTopicStatusSchema>

export const GoalDecisionTopicSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    goalId: z.string(),
    taskId: z.string().nullable().optional(),
    title: z.string().trim().min(1),
    body: z.string(),
    status: GoalDecisionTopicStatusSchema,
    blocking: z.boolean(),
    resolution: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number()
})
export type GoalDecisionTopic = z.infer<typeof GoalDecisionTopicSchema>

export const GoalListResponseSchema = z.object({
    goals: z.array(GoalSchema)
})
export type GoalListResponse = z.infer<typeof GoalListResponseSchema>

export const GoalResponseSchema = z.object({
    goal: GoalSchema
})
export type GoalResponse = z.infer<typeof GoalResponseSchema>

export const GoalDecisionTopicListResponseSchema = z.object({
    topics: z.array(GoalDecisionTopicSchema)
})
export type GoalDecisionTopicListResponse = z.infer<typeof GoalDecisionTopicListResponseSchema>

export const GoalDecisionTopicResponseSchema = z.object({
    topic: GoalDecisionTopicSchema
})
export type GoalDecisionTopicResponse = z.infer<typeof GoalDecisionTopicResponseSchema>

export const WorkspaceSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    label: z.string().nullable().optional(),
    path: z.string(),
    sort: z.number().int().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number()
})

export type Workspace = z.infer<typeof WorkspaceSchema>

export const TaskAttachmentSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number().int().min(0),
    dataUrl: z.string(),
    previewUrl: z.string().optional()
})

export type TaskAttachment = z.infer<typeof TaskAttachmentSchema>

export const TaskStatusSchema = z.enum(TASK_STATUS_ORDER)
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const TaskPrioritySchema = z.enum(['high', 'medium', 'low'])
export type TaskPriority = z.infer<typeof TaskPrioritySchema>
export const TaskWorkflowPhaseSchema = z.string().min(1).max(64).regex(/^[a-z0-9_.-]+$/i)
export type TaskWorkflowPhase = z.infer<typeof TaskWorkflowPhaseSchema>

export const TaskSourceSchema = z.enum(['manual', 'improvements_scan', 'project_init', 'planner', 'radar', 'evaluator'])
export type TaskSource = z.infer<typeof TaskSourceSchema>

export const GitFileStatusSchema = z.object({
    fileName: z.string(),
    filePath: z.string(),
    fullPath: z.string(),
    status: z.enum(['added', 'deleted', 'modified', 'renamed', 'untracked', 'conflicted']),
    isStaged: z.boolean(),
    linesAdded: z.number(),
    linesRemoved: z.number()
})

export type GitFileStatus = z.infer<typeof GitFileStatusSchema>

export const MergedDiffSnapshotSchema = z.object({
    files: z.array(GitFileStatusSchema),
    capturedAt: z.number(),
    baseCommit: z.string().optional()
})

export type MergedDiffSnapshot = z.infer<typeof MergedDiffSnapshotSchema>

const TASK_ACTION_RUNTIME_CORE_STATUSES = [
    'queued',
    'waiting',
    'approval_pending',
    'running',
    'retrying',
    'blocked',
    'succeeded',
    'canceled'
] as const

const TASK_MERGE_RUNTIME_STATUSES = [
    'queued',
    'waiting',
    'approval_pending',
    'running',
    'retrying',
    'blocked',
    'succeeded',
    'canceled'
] as const

const TASK_PREVIEW_RUNTIME_STATUSES = [
    'queued',
    'waiting',
    'approval_pending',
    'running',
    'retrying',
    'blocked',
    'ready',
    'stopped',
    'canceled'
] as const

const TASK_INIT_RUNTIME_STATUSES = [
    'running',
    'waiting',
    'retrying',
    'blocked',
    'succeeded'
] as const

export const TaskActionRuntimeCoreStatusSchema = z.enum(TASK_ACTION_RUNTIME_CORE_STATUSES)
export type TaskActionRuntimeCoreStatus = z.infer<typeof TaskActionRuntimeCoreStatusSchema>

export const TaskActionRuntimeEnvelopeSchema = z.object({
    sessionId: z.string().trim().min(1).max(128).nullable().optional(),
    updatedAt: z.number(),
    requestedAt: z.number().optional(),
    startedAt: z.number().nullable().optional(),
    completedAt: z.number().nullable().optional(),
    retryCount: z.number().int().min(0).optional(),
    failureFingerprint: z.string().trim().min(1).max(64).nullable().optional(),
    latestNote: z.string().trim().min(1).max(280).nullable().optional(),
    blockedReason: z.string().trim().min(1).max(280).nullable().optional(),
    failure: TaskSessionStartFailureSchema.nullable().optional()
})

export type TaskActionRuntimeEnvelope = z.infer<typeof TaskActionRuntimeEnvelopeSchema>

function createTaskActionRuntimeSchema<Statuses extends readonly [string, ...string[]]>(statuses: Statuses) {
    return TaskActionRuntimeEnvelopeSchema.extend({
        status: z.enum(statuses)
    })
}

export const TaskMergeRuntimeStatusSchema = z.enum(TASK_MERGE_RUNTIME_STATUSES)
export type TaskMergeRuntimeStatus = z.infer<typeof TaskMergeRuntimeStatusSchema>

export const TaskMergeRuntimeSchema = createTaskActionRuntimeSchema(TASK_MERGE_RUNTIME_STATUSES)
export type TaskMergeRuntime = z.infer<typeof TaskMergeRuntimeSchema>

export const TaskPreviewRuntimeStatusSchema = z.enum(TASK_PREVIEW_RUNTIME_STATUSES)
export type TaskPreviewRuntimeStatus = z.infer<typeof TaskPreviewRuntimeStatusSchema>

export const TaskPreviewRuntimeSchema = createTaskActionRuntimeSchema(TASK_PREVIEW_RUNTIME_STATUSES)
export type TaskPreviewRuntime = z.infer<typeof TaskPreviewRuntimeSchema>

export const TaskInitRuntimeStatusSchema = z.enum(TASK_INIT_RUNTIME_STATUSES)
export type TaskInitRuntimeStatus = z.infer<typeof TaskInitRuntimeStatusSchema>

export const TaskInitRuntimeSchema = createTaskActionRuntimeSchema(TASK_INIT_RUNTIME_STATUSES)
export type TaskInitRuntime = z.infer<typeof TaskInitRuntimeSchema>

export const TaskSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    goalId: z.string().nullable().optional(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema.nullable().optional(),
    sortKey: z.number().nullable().optional(),
    activeSessionId: z.string().nullable().optional(),
    workspaceId: z.string().nullable().optional(),
    agentFlavor: AgentFlavorSchema.nullable().optional(),
    permissionMode: PermissionModeSchema.nullable().optional(),
    model: ModelNameSchema.nullable().optional(),
    modelMode: ModelModeSchema.nullable().optional(),
    attachments: z.array(TaskAttachmentSchema).nullable().optional(),
    source: TaskSourceSchema.nullable().optional(),
    sourceTaskId: z.string().nullable().optional(),
    contract: z.string().nullable().optional(),
    handoff: z.string().nullable().optional(),
    evidence: z.string().nullable().optional(),
    workflowProfile: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i),
    workflowPhase: TaskWorkflowPhaseSchema.nullable().optional(),
    subTasks: TodosSchema.nullable().optional(),
    subTasksUpdatedAt: z.number().nullable().optional(),
    worktreeMergedAt: z.number().nullable().optional(),
    worktreeMergeCommit: z.string().nullable().optional(),
    mergedDiffSnapshot: MergedDiffSnapshotSchema.nullable().optional(),
    mergeRuntime: TaskMergeRuntimeSchema.nullable().optional(),
    previewRuntime: TaskPreviewRuntimeSchema.nullable().optional(),
    initRuntime: TaskInitRuntimeSchema.nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    finishedAt: z.number().nullable().optional(),
    archivedAt: z.number().nullable().optional()
})

export type Task = z.infer<typeof TaskSchema>

export const OmcBoardColumnSchema = z.enum(['Planning', 'Running', 'Review', 'Done'])
export type OmcBoardColumn = z.infer<typeof OmcBoardColumnSchema>

export const OmcLoopStatusSchema = z.enum(['idle', 'running', 'review', 'done', 'stopped'])
export type OmcLoopStatus = z.infer<typeof OmcLoopStatusSchema>

export const OmcAttemptStatusSchema = z.enum(['queued', 'running', 'progressed', 'blocked', 'completed', 'failed', 'canceled'])
export type OmcAttemptStatus = z.infer<typeof OmcAttemptStatusSchema>

export const OmcMergeStatusSchema = z.enum(['idle', 'ready', 'merging', 'blocked', 'conflict', 'merged'])
export type OmcMergeStatus = z.infer<typeof OmcMergeStatusSchema>

export const OmcAttemptOutcomeStatusSchema = z.enum(['progressed', 'blocked', 'completed', 'failed', 'canceled'])
export type OmcAttemptOutcomeStatus = z.infer<typeof OmcAttemptOutcomeStatusSchema>

export const OmcAttemptTerminationReasonSchema = z.enum([
    'structured-completion',
    'prompt-dispatch',
    'session-error',
    'session-inactive',
    'session-removed',
    'runner-offline',
    'user-canceled'
])
export type OmcAttemptTerminationReason = z.infer<typeof OmcAttemptTerminationReasonSchema>

export const OmcCheckResultSchema = z.enum(['passed', 'failed', 'warning', 'skipped'])
export type OmcCheckResult = z.infer<typeof OmcCheckResultSchema>

export const OmcEvidenceKindSchema = z.enum(['summary', 'check', 'diff', 'review', 'note'])
export type OmcEvidenceKind = z.infer<typeof OmcEvidenceKindSchema>

export const OmcEvidenceStatusSchema = z.enum(['info', 'passed', 'failed', 'warning'])
export type OmcEvidenceStatus = z.infer<typeof OmcEvidenceStatusSchema>

export const OmcAttemptCheckSchema = z.object({
    label: z.string().trim().min(1),
    result: OmcCheckResultSchema,
    detail: z.string().nullable().optional()
})
export type OmcAttemptCheck = z.infer<typeof OmcAttemptCheckSchema>

export const OmcAttemptOutcomeSchema = z.object({
    status: OmcAttemptOutcomeStatusSchema,
    summary: z.string().trim().min(1),
    failureFingerprint: z.string().trim().min(1).nullable().optional(),
    changedFiles: z.array(z.string().trim().min(1)).default([]),
    checks: z.array(OmcAttemptCheckSchema).default([]),
    nextSuggestedStep: z.string().trim().min(1).nullable().optional(),
    terminationReason: OmcAttemptTerminationReasonSchema,
    source: z.enum(['assistant-structured', 'system-fallback'])
})
export type OmcAttemptOutcome = z.infer<typeof OmcAttemptOutcomeSchema>

export const OmcContextPackSchema = z.object({
    identity: z.object({
        programId: z.string(),
        planKey: z.string().trim().min(1),
        attemptId: z.string(),
        loopRunId: z.string(),
        attemptNumber: z.number().int().min(1),
        phaseKey: z.string().trim().min(1),
        phaseLabel: z.string().trim().min(1),
        planTitle: z.string().trim().min(1),
        planPath: z.string().trim().min(1)
    }),
    workspace: z.object({
        repoRoot: z.string().trim().min(1),
        planningRoot: z.string().trim().min(1),
        worktreePath: z.string().trim().min(1).nullable().optional(),
        sessionId: z.string().nullable().optional(),
        currentBranch: z.string().nullable().optional(),
        targetBranch: z.string().nullable().optional()
    }),
    planningRefs: z.object({
        projectPath: z.string().trim().min(1),
        roadmapPath: z.string().trim().min(1),
        planPath: z.string().trim().min(1),
        contextPath: z.string().trim().min(1).optional(),
        researchPath: z.string().trim().min(1).optional()
    }),
    currentObjective: z.object({
        summary: z.string(),
        smallestNextStep: z.string().nullable().optional(),
        checklistDone: z.number().int().min(0),
        checklistOpen: z.number().int().min(0)
    }),
    acceptanceAndChecks: z.object({
        completionDefinition: z.string(),
        requiredChecks: z.array(z.string())
    }),
    previousAttemptMemory: z.object({
        attemptId: z.string(),
        summary: z.string().nullable().optional(),
        failureFingerprint: z.string().nullable().optional(),
        changedFiles: z.array(z.string()),
        checks: z.array(OmcAttemptCheckSchema),
        nextSuggestedStep: z.string().nullable().optional()
    }).nullable().optional(),
    operatingRules: z.array(z.string()),
    outputContract: z.object({
        allowedStatuses: z.array(z.string().trim().min(1)),
        requiredFields: z.array(z.string().trim().min(1))
    }),
    promptText: z.string().trim().min(1)
})
export type OmcContextPack = z.infer<typeof OmcContextPackSchema>

export const OmcProgramSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    machineId: z.string().nullable().optional(),
    name: z.string().trim().min(1),
    repoRoot: z.string().trim().min(1),
    planningRoot: z.string().trim().min(1),
    primaryBranch: z.string().nullable().optional(),
    targetBranch: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number()
})
export type OmcProgram = z.infer<typeof OmcProgramSchema>

export const OmcPlanRuntimeSchema = z.object({
    programId: z.string(),
    planKey: z.string().trim().min(1),
    planPath: z.string().trim().min(1),
    phaseKey: z.string().trim().min(1),
    phaseLabel: z.string().trim().min(1),
    column: OmcBoardColumnSchema,
    loopStatus: OmcLoopStatusSchema,
    currentLoopRunId: z.string().nullable().optional(),
    currentWorktreePath: z.string().nullable().optional(),
    currentBranch: z.string().nullable().optional(),
    targetBranch: z.string().nullable().optional(),
    attemptCount: z.number().int().min(0),
    consecutiveFailureCount: z.number().int().min(0),
    lastFailureFingerprint: z.string().nullable().optional(),
    reviewRequired: z.boolean(),
    reviewApprovedAt: z.number().nullable().optional(),
    mergeStatus: OmcMergeStatusSchema.optional(),
    mergeBlockedReason: z.string().trim().min(1).nullable().optional(),
    lastMergeAttemptAt: z.number().nullable().optional(),
    mergeApprovedAt: z.number().nullable().optional(),
    doneAt: z.number().nullable().optional(),
    latestEvidenceSummary: z.string().nullable().optional(),
    lastAttemptAt: z.number().nullable().optional(),
    updatedAt: z.number().nullable().optional()
})
export type OmcPlanRuntime = z.infer<typeof OmcPlanRuntimeSchema>

export const OmcAttemptSchema = z.object({
    id: z.string(),
    programId: z.string(),
    planKey: z.string().trim().min(1),
    planPath: z.string().trim().min(1),
    loopRunId: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    attemptNumber: z.number().int().min(1),
    status: OmcAttemptStatusSchema,
    summary: z.string().nullable().optional(),
    failureFingerprint: z.string().nullable().optional(),
    terminationReason: OmcAttemptTerminationReasonSchema.nullable().optional(),
    changedFiles: z.array(z.string()),
    checks: z.array(OmcAttemptCheckSchema),
    nextSuggestedStep: z.string().nullable().optional(),
    contextPack: OmcContextPackSchema.nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().nullable().optional()
})
export type OmcAttempt = z.infer<typeof OmcAttemptSchema>

export const OmcEvidenceSchema = z.object({
    id: z.string(),
    programId: z.string(),
    planKey: z.string().trim().min(1),
    attemptId: z.string().nullable().optional(),
    kind: OmcEvidenceKindSchema,
    label: z.string().trim().min(1),
    status: OmcEvidenceStatusSchema,
    summary: z.string().trim().min(1),
    payload: z.record(z.string(), z.unknown()).nullable().optional(),
    createdAt: z.number()
})
export type OmcEvidence = z.infer<typeof OmcEvidenceSchema>

export const OmcDecisionTopicKindSchema = z.enum(['status', 'approval', 'risk', 'direction'])
export type OmcDecisionTopicKind = z.infer<typeof OmcDecisionTopicKindSchema>

export const OmcDecisionTopicLifecycleSchema = z.enum(['pending', 'in-progress', 'waiting', 'silent', 'resolved'])
export type OmcDecisionTopicLifecycle = z.infer<typeof OmcDecisionTopicLifecycleSchema>

export const OmcDecisionTopicTurnAuthorSchema = z.enum(['user', 'manager', 'system', 'agent'])
export type OmcDecisionTopicTurnAuthor = z.infer<typeof OmcDecisionTopicTurnAuthorSchema>

export const OmcDecisionTopicTurnKindSchema = z.enum(['question', 'directive', 'decision', 'ack', 'answer', 'status', 'evidence'])
export type OmcDecisionTopicTurnKind = z.infer<typeof OmcDecisionTopicTurnKindSchema>

export const OmcDecisionTopicTurnReplyStateSchema = z.enum(['none', 'forwarded', 'linked', 'failed'])
export type OmcDecisionTopicTurnReplyState = z.infer<typeof OmcDecisionTopicTurnReplyStateSchema>

export const OmcDecisionTopicTurnSchema = z.object({
    id: z.string(),
    topicId: z.string().trim().min(1),
    programId: z.string(),
    author: OmcDecisionTopicTurnAuthorSchema,
    kind: OmcDecisionTopicTurnKindSchema,
    body: z.string(),
    sessionId: z.string().nullable().optional(),
    sessionMessageId: z.string().nullable().optional(),
    replyState: OmcDecisionTopicTurnReplyStateSchema,
    createdAt: z.number(),
})
export type OmcDecisionTopicTurn = z.infer<typeof OmcDecisionTopicTurnSchema>

export const OmcDecisionTopicSchema = z.object({
    id: z.string().trim().min(1),
    programId: z.string(),
    kind: OmcDecisionTopicKindSchema,
    title: z.string().trim().min(1),
    goalId: z.string().nullable().optional(),
    planKey: z.string().trim().min(1).nullable().optional(),
    workOrderId: z.string().nullable().optional(),
    lifecycle: OmcDecisionTopicLifecycleSchema,
    unread: z.boolean(),
    bridgeSessionId: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
})
export type OmcDecisionTopic = z.infer<typeof OmcDecisionTopicSchema>

export const OmcDecisionTopicThreadSchema = OmcDecisionTopicSchema.extend({
    turns: z.array(OmcDecisionTopicTurnSchema),
})
export type OmcDecisionTopicThread = z.infer<typeof OmcDecisionTopicThreadSchema>

export const OmcDecisionTopicListResponseSchema = z.object({
    programId: z.string(),
    topics: z.array(OmcDecisionTopicThreadSchema),
})
export type OmcDecisionTopicListResponse = z.infer<typeof OmcDecisionTopicListResponseSchema>

export const OmcDecisionTopicReplyRequestSchema = z.object({
    topicId: z.string().trim().min(1),
    kind: OmcDecisionTopicKindSchema,
    title: z.string().trim().min(1),
    goalId: z.string().nullable().optional(),
    planKey: z.string().trim().min(1).nullable().optional(),
    sessionId: z.string().nullable().optional(),
    text: z.string().trim().min(1),
})
export type OmcDecisionTopicReplyRequest = z.infer<typeof OmcDecisionTopicReplyRequestSchema>

export const OmcDecisionTopicReplyResponseSchema = z.object({
    topic: OmcDecisionTopicSchema,
    turns: z.array(OmcDecisionTopicTurnSchema),
})
export type OmcDecisionTopicReplyResponse = z.infer<typeof OmcDecisionTopicReplyResponseSchema>

export const OmcMailboxPrioritySchema = z.enum(['low', 'normal', 'high'])
export type OmcMailboxPriority = z.infer<typeof OmcMailboxPrioritySchema>

export const OmcMailboxMessageSchema = z.object({
    id: z.string(),
    programId: z.string(),
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
    thread: z.string().trim().min(1),
    kind: z.string().trim().min(1),
    priority: OmcMailboxPrioritySchema,
    body: z.string(),
    createdAt: z.number(),
    readAt: z.number().nullable().optional(),
})
export type OmcMailboxMessage = z.infer<typeof OmcMailboxMessageSchema>

export const OmcWorkOrderOwnerSchema = z.enum(['manager', 'driver', 'reviewer', 'planner'])
export type OmcWorkOrderOwner = z.infer<typeof OmcWorkOrderOwnerSchema>

export const OmcWorkOrderStatusSchema = z.enum([
    'ready',
    'in_progress',
    'in_review',
    'waiting_user',
    'replanning',
    'blocked',
    'done',
])
export type OmcWorkOrderStatus = z.infer<typeof OmcWorkOrderStatusSchema>

export const OmcReviewVerdictSchema = z.enum(['accepted', 'revision_needed', 'needs_user', 'replan_needed'])
export type OmcReviewVerdict = z.infer<typeof OmcReviewVerdictSchema>

export const OmcWorkOrderSchema = z.object({
    id: z.string(),
    programId: z.string(),
    goalId: z.string().nullable().optional(),
    planKey: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1),
    owner: OmcWorkOrderOwnerSchema.nullable().optional(),
    status: OmcWorkOrderStatusSchema,
    currentAttemptId: z.string().nullable().optional(),
    reviewerVerdict: OmcReviewVerdictSchema.nullable().optional(),
    blockedReason: z.string().nullable().optional(),
    latestAcceptedAttemptId: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
})
export type OmcWorkOrder = z.infer<typeof OmcWorkOrderSchema>

export const OmcWorkAttemptRoleSchema = z.enum(['driver', 'reviewer'])
export type OmcWorkAttemptRole = z.infer<typeof OmcWorkAttemptRoleSchema>

export const OmcWorkAttemptStatusSchema = z.enum([
    'running',
    'closing',
    'reviewing',
    'accepted',
    'revision_needed',
    'needs_user',
    'failed',
])
export type OmcWorkAttemptStatus = z.infer<typeof OmcWorkAttemptStatusSchema>

export const OmcWorkAttemptSchema = z.object({
    id: z.string(),
    programId: z.string(),
    workOrderId: z.string(),
    role: OmcWorkAttemptRoleSchema,
    sessionId: z.string().nullable().optional(),
    status: OmcWorkAttemptStatusSchema,
    summary: z.string().nullable().optional(),
    sourceMailboxMessageId: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().nullable().optional(),
})
export type OmcWorkAttempt = z.infer<typeof OmcWorkAttemptSchema>

export const OmcCoordinationAgentRoleSchema = z.enum(['manager', 'driver', 'reviewer', 'planner'])
export type OmcCoordinationAgentRole = z.infer<typeof OmcCoordinationAgentRoleSchema>

export const OmcCoordinationAgentStateSchema = z.object({
    programId: z.string(),
    role: OmcCoordinationAgentRoleSchema,
    busy: z.boolean(),
    currentWorkOrderId: z.string().nullable().optional(),
    activeSessionId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    mode: z.string().nullable().optional(),
    lastHeartbeat: z.number(),
})
export type OmcCoordinationAgentState = z.infer<typeof OmcCoordinationAgentStateSchema>

export const OmcDirectiveScopeTypeSchema = z.enum(['program', 'goal', 'plan', 'work_order'])
export type OmcDirectiveScopeType = z.infer<typeof OmcDirectiveScopeTypeSchema>

export const OmcDirectiveLedgerEntrySchema = z.object({
    id: z.string(),
    programId: z.string(),
    scopeType: OmcDirectiveScopeTypeSchema,
    scopeId: z.string().trim().min(1),
    sourceTopicId: z.string().nullable().optional(),
    key: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    rawText: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
})
export type OmcDirectiveLedgerEntry = z.infer<typeof OmcDirectiveLedgerEntrySchema>

export const OmcProgramRuntimeStateResponseSchema = z.object({
    programId: z.string(),
    mailbox: z.array(OmcMailboxMessageSchema),
    workOrders: z.array(OmcWorkOrderSchema),
    workAttempts: z.array(OmcWorkAttemptSchema),
    agents: z.array(OmcCoordinationAgentStateSchema),
    directives: z.array(OmcDirectiveLedgerEntrySchema),
})
export type OmcProgramRuntimeStateResponse = z.infer<typeof OmcProgramRuntimeStateResponseSchema>

export const OmcProgramSummarySchema = OmcProgramSchema.extend({
    counts: z.object({
        Planning: z.number().int().min(0),
        Running: z.number().int().min(0),
        Review: z.number().int().min(0),
        Done: z.number().int().min(0)
    }),
    lastActivityAt: z.number().nullable().optional()
})
export type OmcProgramSummary = z.infer<typeof OmcProgramSummarySchema>

export const OmcPlanSummarySchema = z.object({
    planKey: z.string().trim().min(1),
    planPath: z.string().trim().min(1),
    phaseKey: z.string().trim().min(1),
    phaseLabel: z.string().trim().min(1),
    dependsOn: z.array(z.string().trim().min(1)).optional(),
    planTitle: z.string().trim().min(1),
    summary: z.string(),
    checklistTotal: z.number().int().min(0),
    checklistDone: z.number().int().min(0),
    checklistOpen: z.number().int().min(0),
    firstOpenItem: z.string().nullable().optional(),
    lastModifiedAt: z.number()
})
export type OmcPlanSummary = z.infer<typeof OmcPlanSummarySchema>

export const OmcPlanChecklistItemSchema = z.object({
    text: z.string().trim().min(1),
    checked: z.boolean()
})
export type OmcPlanChecklistItem = z.infer<typeof OmcPlanChecklistItemSchema>

export const OmcPlanningPhaseSchema = z.object({
    phaseKey: z.string().trim().min(1),
    phaseLabel: z.string().trim().min(1),
    plans: z.array(OmcPlanSummarySchema)
})
export type OmcPlanningPhase = z.infer<typeof OmcPlanningPhaseSchema>

export const OmcPlanningIndexResponseSchema = z.object({
    program: z.object({
        id: z.string(),
        name: z.string(),
        repoRoot: z.string().trim().min(1)
    }),
    phases: z.array(OmcPlanningPhaseSchema)
})
export type OmcPlanningIndexResponse = z.infer<typeof OmcPlanningIndexResponseSchema>

export const OmcPlanDetailResponseSchema = z.object({
    programId: z.string(),
    plan: z.object({
        planKey: z.string().trim().min(1),
        planPath: z.string().trim().min(1),
        phaseKey: z.string().trim().min(1),
        phaseLabel: z.string().trim().min(1),
        planTitle: z.string().trim().min(1),
        summary: z.string(),
        checklist: z.array(OmcPlanChecklistItemSchema),
        refs: z.object({
            projectPath: z.string().trim().min(1),
            roadmapPath: z.string().trim().min(1),
            contextPath: z.string().trim().min(1).optional(),
            researchPath: z.string().trim().min(1).optional()
        }),
        lastModifiedAt: z.number()
    }),
    runtime: OmcPlanRuntimeSchema,
    attempts: z.array(OmcAttemptSchema),
    evidence: z.array(OmcEvidenceSchema)
})
export type OmcPlanDetailResponse = z.infer<typeof OmcPlanDetailResponseSchema>

export const OmcProgramListResponseSchema = z.object({
    programs: z.array(OmcProgramSummarySchema)
})
export type OmcProgramListResponse = z.infer<typeof OmcProgramListResponseSchema>

export const OmcProgramPlanningStatusSchema = z.enum(['detected', 'missing', 'attached', 'seeded'])
export type OmcProgramPlanningStatus = z.infer<typeof OmcProgramPlanningStatusSchema>

export const OmcProgramPlanningStateSchema = z.object({
    status: OmcProgramPlanningStatusSchema,
    planningRoot: z.string().trim().min(1),
    hasPlanning: z.boolean(),
    hasPlans: z.boolean(),
    phaseCount: z.number().int().min(0),
    planCount: z.number().int().min(0),
    seedFiles: z.array(z.string().trim().min(1)).default([])
})
export type OmcProgramPlanningState = z.infer<typeof OmcProgramPlanningStateSchema>

export const OmcGuidedPlanningRunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'canceled'])
export type OmcGuidedPlanningRunStatus = z.infer<typeof OmcGuidedPlanningRunStatusSchema>

export const OmcGuidedPlanningRunStageSchema = z.enum(['brief', 'discuss', 'plan', 'handoff'])
export type OmcGuidedPlanningRunStage = z.infer<typeof OmcGuidedPlanningRunStageSchema>

export const OmcGuidedPlanningBriefSchema = z.object({
    productIntent: z.string().trim().min(1),
    firstSlice: z.string().trim().min(1)
})
export type OmcGuidedPlanningBrief = z.infer<typeof OmcGuidedPlanningBriefSchema>

export const OmcGuidedPlanningRunSchema = z.object({
    id: z.string(),
    programId: z.string(),
    status: OmcGuidedPlanningRunStatusSchema,
    stage: OmcGuidedPlanningRunStageSchema,
    brief: OmcGuidedPlanningBriefSchema,
    sessionId: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    generatedPlanPaths: z.array(z.string().trim().min(1)).default([]),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().nullable().optional()
})
export type OmcGuidedPlanningRun = z.infer<typeof OmcGuidedPlanningRunSchema>

export const OmcGuidedPlanningStartRequestSchema = z.object({
    brief: OmcGuidedPlanningBriefSchema
})
export type OmcGuidedPlanningStartRequest = z.infer<typeof OmcGuidedPlanningStartRequestSchema>

export const OmcGuidedPlanningStateResponseSchema = z.object({
    programId: z.string(),
    planning: OmcProgramPlanningStateSchema,
    run: OmcGuidedPlanningRunSchema.nullable()
})
export type OmcGuidedPlanningStateResponse = z.infer<typeof OmcGuidedPlanningStateResponseSchema>

export const OmcGuidedPlanningControlResponseSchema = z.object({
    programId: z.string(),
    planning: OmcProgramPlanningStateSchema,
    run: OmcGuidedPlanningRunSchema
})
export type OmcGuidedPlanningControlResponse = z.infer<typeof OmcGuidedPlanningControlResponseSchema>

export const OmcAttachLocalRepoRequestSchema = z.object({
    repoRoot: z.string().trim().min(1),
    name: z.string().trim().min(1).optional()
})
export type OmcAttachLocalRepoRequest = z.infer<typeof OmcAttachLocalRepoRequestSchema>

export const OmcAttachPlanningRootRequestSchema = z.object({
    planningRoot: z.string().trim().min(1)
})
export type OmcAttachPlanningRootRequest = z.infer<typeof OmcAttachPlanningRootRequestSchema>

export const OmcCreatePlanningSeedRequestSchema = z.object({})
export type OmcCreatePlanningSeedRequest = z.infer<typeof OmcCreatePlanningSeedRequestSchema>

export const OmcProgramBootstrapResponseSchema = z.object({
    program: OmcProgramSummarySchema,
    planning: OmcProgramPlanningStateSchema
})
export type OmcProgramBootstrapResponse = z.infer<typeof OmcProgramBootstrapResponseSchema>

export const OmcProgramOverviewResponseSchema = z.object({
    program: OmcProgramSummarySchema,
    planning: OmcProgramPlanningStateSchema
})
export type OmcProgramOverviewResponse = z.infer<typeof OmcProgramOverviewResponseSchema>

export const OmcPlanRuntimeListResponseSchema = z.object({
    programId: z.string(),
    runtimes: z.array(OmcPlanRuntimeSchema)
})
export type OmcPlanRuntimeListResponse = z.infer<typeof OmcPlanRuntimeListResponseSchema>

export const OmcAttemptDetailResponseSchema = z.object({
    attempt: OmcAttemptSchema,
    evidence: z.array(OmcEvidenceSchema)
})
export type OmcAttemptDetailResponse = z.infer<typeof OmcAttemptDetailResponseSchema>

export const OmcPlanStartResponseSchema = z.object({
    programId: z.string(),
    planKey: z.string().trim().min(1),
    runtime: OmcPlanRuntimeSchema,
    attempt: OmcAttemptSchema,
    evidence: z.array(OmcEvidenceSchema)
})
export type OmcPlanStartResponse = z.infer<typeof OmcPlanStartResponseSchema>

export const OmcPlanControlResponseSchema = z.object({
    programId: z.string(),
    planKey: z.string().trim().min(1),
    runtime: OmcPlanRuntimeSchema,
    attempt: OmcAttemptSchema.nullable().optional(),
    sessionId: z.string().nullable().optional(),
    sessionUrl: z.string().nullable().optional()
})
export type OmcPlanControlResponse = z.infer<typeof OmcPlanControlResponseSchema>

export const OmcMergePacketFileSummarySchema = z.object({
    totalFiles: z.number().int().min(0),
    files: z.array(z.string().trim().min(1))
})
export type OmcMergePacketFileSummary = z.infer<typeof OmcMergePacketFileSummarySchema>

export const OmcMergePacketChecksSummarySchema = z.object({
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    warning: z.number().int().min(0),
    skipped: z.number().int().min(0),
    items: z.array(OmcAttemptCheckSchema)
})
export type OmcMergePacketChecksSummary = z.infer<typeof OmcMergePacketChecksSummarySchema>

export const OmcMergePacketCompletionSummarySchema = z.object({
    status: OmcAttemptStatusSchema.nullable().optional(),
    summary: z.string().trim().min(1),
    terminationReason: OmcAttemptTerminationReasonSchema.nullable().optional(),
    nextSuggestedStep: z.string().trim().min(1).nullable().optional()
})
export type OmcMergePacketCompletionSummary = z.infer<typeof OmcMergePacketCompletionSummarySchema>

export const OmcMergePacketPreconditionStatusSchema = z.enum(['ready', 'warning', 'blocked'])
export type OmcMergePacketPreconditionStatus = z.infer<typeof OmcMergePacketPreconditionStatusSchema>

export const OmcMergePacketPreconditionSchema = z.object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    status: OmcMergePacketPreconditionStatusSchema,
    detail: z.string().trim().min(1).nullable().optional()
})
export type OmcMergePacketPrecondition = z.infer<typeof OmcMergePacketPreconditionSchema>

export const OmcMergePacketSchema = z.object({
    phaseLabel: z.string().trim().min(1),
    planKey: z.string().trim().min(1),
    planTitle: z.string().trim().min(1),
    targetBranch: z.string().trim().min(1).nullable().optional(),
    sourceBranch: z.string().trim().min(1).nullable().optional(),
    worktreePath: z.string().trim().min(1).nullable().optional(),
    attemptCount: z.number().int().min(0),
    changedFilesSummary: OmcMergePacketFileSummarySchema,
    checksSummary: OmcMergePacketChecksSummarySchema,
    completionSummary: OmcMergePacketCompletionSummarySchema,
    warnings: z.array(z.string().trim().min(1)),
    blockers: z.array(z.string().trim().min(1)),
    preconditions: z.array(OmcMergePacketPreconditionSchema)
})
export type OmcMergePacket = z.infer<typeof OmcMergePacketSchema>

export const OmcMergePacketResponseSchema = z.object({
    packet: OmcMergePacketSchema
})
export type OmcMergePacketResponse = z.infer<typeof OmcMergePacketResponseSchema>

export const OmcReviewReopenActionSchema = z.enum(['resume_loop', 'back_to_planning'])
export type OmcReviewReopenAction = z.infer<typeof OmcReviewReopenActionSchema>

export const OmcReviewReopenRequestSchema = z.object({
    action: OmcReviewReopenActionSchema
})
export type OmcReviewReopenRequest = z.infer<typeof OmcReviewReopenRequestSchema>

const SessionEventBaseSchema = z.object({
    namespace: z.string().optional()
})

const SessionChangedSchema = SessionEventBaseSchema.extend({
    sessionId: z.string(),
    projectId: z.string().optional()
})

const MachineChangedSchema = SessionEventBaseSchema.extend({
    machineId: z.string()
})

export const SyncEventSchema = z.discriminatedUnion('type', [
    SessionChangedSchema.extend({
        type: z.literal('session-added'),
        data: z.unknown().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('session-updated'),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('session-removed'),
        sessionId: z.string(),
        projectId: z.string().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('message-received'),
        message: DecryptedMessageSchema
    }),
    MachineChangedSchema.extend({
        type: z.literal('machine-updated'),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('toast'),
        data: z.object({
            title: z.string(),
            body: z.string(),
            sessionId: z.string(),
            url: z.string(),
            taskStartFailure: TaskSessionStartFailureSchema.optional()
        })
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('connection-changed'),
        data: z.object({
            status: z.string(),
            subscriptionId: z.string().optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('project-added'),
        projectId: z.string(),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('project-updated'),
        projectId: z.string(),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('project-removed'),
        projectId: z.string()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('workspace-added'),
        workspaceId: z.string(),
        projectId: z.string(),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('workspace-updated'),
        workspaceId: z.string(),
        projectId: z.string(),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('workspace-removed'),
        workspaceId: z.string(),
        projectId: z.string()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('task-added'),
        taskId: z.string(),
        projectId: z.string(),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('task-updated'),
        taskId: z.string(),
        projectId: z.string(),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('task-removed'),
        taskId: z.string(),
        projectId: z.string()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-program-updated'),
        programId: z.string(),
        data: z.object({
            programId: z.string(),
            program: OmcProgramSchema.optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-guided-planning-updated'),
        programId: z.string(),
        runId: z.string(),
        data: z.object({
            runId: z.string(),
            run: OmcGuidedPlanningRunSchema.optional(),
            planning: OmcProgramPlanningStateSchema.optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-plan-runtime-updated'),
        programId: z.string(),
        planKey: z.string(),
        data: z.object({
            planKey: z.string(),
            runtime: OmcPlanRuntimeSchema.optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-attempt-added'),
        programId: z.string(),
        planKey: z.string(),
        attemptId: z.string(),
        data: z.object({
            attemptId: z.string(),
            attempt: OmcAttemptSchema.optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-attempt-updated'),
        programId: z.string(),
        planKey: z.string(),
        attemptId: z.string(),
        data: z.object({
            attemptId: z.string(),
            attempt: OmcAttemptSchema.optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-evidence-added'),
        programId: z.string(),
        planKey: z.string(),
        evidenceId: z.string(),
        attemptId: z.string().nullable().optional(),
        data: z.object({
            evidenceId: z.string(),
            evidence: OmcEvidenceSchema.optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-review-updated'),
        programId: z.string(),
        planKey: z.string(),
        data: z.object({
            planKey: z.string(),
            runtime: OmcPlanRuntimeSchema.optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-merge-updated'),
        programId: z.string(),
        planKey: z.string(),
        data: z.object({
            planKey: z.string(),
            runtime: OmcPlanRuntimeSchema.optional(),
            packet: OmcMergePacketSchema.optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-topic-updated'),
        programId: z.string(),
        topicId: z.string(),
        data: z.object({
            topicId: z.string(),
            topic: OmcDecisionTopicSchema.optional(),
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-topic-turn-added'),
        programId: z.string(),
        topicId: z.string(),
        turnId: z.string(),
        data: z.object({
            topicId: z.string(),
            turnId: z.string(),
            turn: OmcDecisionTopicTurnSchema.optional(),
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-mailbox-message-added'),
        programId: z.string(),
        messageId: z.string(),
        data: z.object({
            messageId: z.string(),
            message: OmcMailboxMessageSchema.optional(),
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-work-order-updated'),
        programId: z.string(),
        workOrderId: z.string(),
        data: z.object({
            workOrderId: z.string(),
            workOrder: OmcWorkOrderSchema.optional(),
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-work-attempt-added'),
        programId: z.string(),
        workOrderId: z.string(),
        workAttemptId: z.string(),
        data: z.object({
            workOrderId: z.string(),
            workAttemptId: z.string(),
            workAttempt: OmcWorkAttemptSchema.optional(),
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-work-attempt-updated'),
        programId: z.string(),
        workOrderId: z.string(),
        workAttemptId: z.string(),
        data: z.object({
            workOrderId: z.string(),
            workAttemptId: z.string(),
            workAttempt: OmcWorkAttemptSchema.optional(),
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-coordination-agent-updated'),
        programId: z.string(),
        role: OmcCoordinationAgentRoleSchema,
        data: z.object({
            role: OmcCoordinationAgentRoleSchema,
            agent: OmcCoordinationAgentStateSchema.optional(),
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('omc-directive-ledger-updated'),
        programId: z.string(),
        directiveId: z.string(),
        data: z.object({
            directiveId: z.string(),
            directive: OmcDirectiveLedgerEntrySchema.optional(),
        }).optional()
    })
])

export type SyncEvent = z.infer<typeof SyncEventSchema>
