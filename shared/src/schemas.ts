import { z } from 'zod'
import { MODEL_MODES, PERMISSION_MODES } from './modes'
import { TASK_STATUS_ORDER } from './tasks'

export const PermissionModeSchema = z.enum(PERMISSION_MODES)
export const ModelModeSchema = z.enum(MODEL_MODES)

export const AgentFlavorSchema = z.enum(['claude', 'codex', 'gemini', 'opencode'])

export const SessionTypeSchema = z.enum(['simple', 'worktree'])
export type SessionType = z.infer<typeof SessionTypeSchema>

export const WorktreeAutoCommitModeSchema = z.enum(['off', 'per_conversation'])
export type WorktreeAutoCommitMode = z.infer<typeof WorktreeAutoCommitModeSchema>

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

export const ProjectSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    machineId: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    defaultWorkspaceId: z.string().nullable().optional(),
    defaultAgentFlavor: AgentFlavorSchema.nullable().optional(),
    defaultPermissionMode: PermissionModeSchema.nullable().optional(),
    defaultModelMode: ModelModeSchema.nullable().optional(),
    defaultSessionType: SessionTypeSchema.nullable().optional(),
    worktreeTargetBranch: z.string().nullable().optional(),
    worktreeAutoCommitMode: WorktreeAutoCommitModeSchema.nullable().optional(),
    worktreeCleanupAfterMerge: z.boolean().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxRunningSessions: z.number().int().min(1).max(50).optional(),
    improvementsEnabled: z.boolean().optional(),
    improvementsMaxPendingTasks: z.number().int().min(1).max(50).optional(),
    workflowProfile: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i).nullable().optional(),
    worktreeLocked: z.boolean().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastImprovementsAt: z.number().nullable().optional(),
    archivedAt: z.number().nullable().optional()
})

export type Project = z.infer<typeof ProjectSchema>

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

export const TaskSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema.nullable().optional(),
    sortKey: z.number().nullable().optional(),
    activeSessionId: z.string().nullable().optional(),
    workspaceId: z.string().nullable().optional(),
    agentFlavor: AgentFlavorSchema.nullable().optional(),
    permissionMode: PermissionModeSchema.nullable().optional(),
    modelMode: ModelModeSchema.nullable().optional(),
    attachments: z.array(TaskAttachmentSchema).nullable().optional(),
    source: z.enum(['manual', 'improvements_scan', 'project_init']).nullable().optional(),
    sourceTaskId: z.string().nullable().optional(),
    workflowPhase: TaskWorkflowPhaseSchema.nullable().optional(),
    subTasks: TodosSchema.nullable().optional(),
    subTasksUpdatedAt: z.number().nullable().optional(),
    worktreeMergedAt: z.number().nullable().optional(),
    worktreeMergeCommit: z.string().nullable().optional(),
    mergedDiffSnapshot: MergedDiffSnapshotSchema.nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    finishedAt: z.number().nullable().optional(),
    archivedAt: z.number().nullable().optional()
})

export type Task = z.infer<typeof TaskSchema>

const SessionEventBaseSchema = z.object({
    namespace: z.string().optional()
})

const SessionChangedSchema = SessionEventBaseSchema.extend({
    sessionId: z.string()
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
        sessionId: z.string()
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
            url: z.string()
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
    })
])

export type SyncEvent = z.infer<typeof SyncEventSchema>
