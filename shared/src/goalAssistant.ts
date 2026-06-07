import { z } from 'zod'

export const GoalAssistantTaskLaneSchema = z.enum(['planned', 'merging'])
export type GoalAssistantTaskLane = z.infer<typeof GoalAssistantTaskLaneSchema>

export const GoalAssistantLegacyTaskLaneSchema = z.enum(['planned', 'in_progress', 'merging'])
export type GoalAssistantLegacyTaskLane = z.infer<typeof GoalAssistantLegacyTaskLaneSchema>

export function normalizeGoalAssistantTaskLane(lane: GoalAssistantLegacyTaskLane): GoalAssistantTaskLane {
    return lane === 'in_progress' ? 'planned' : lane
}

export const GoalAssistantSessionProfileSchema = z.object({
    kind: z.literal('goal_assistant'),
    projectId: z.string().min(1),
    goalId: z.string().min(1)
})
export type GoalAssistantSessionProfile = z.infer<typeof GoalAssistantSessionProfileSchema>

export const SessionProfileSchema = z.discriminatedUnion('kind', [
    GoalAssistantSessionProfileSchema
])
export type SessionProfile = z.infer<typeof SessionProfileSchema>

export const GoalAssistantPlanningRequestItemSchema = z.object({
    id: z.string().min(1),
    body: z.string().min(1),
    relatedTaskIds: z.array(z.string().min(1)).default([]),
    createdAt: z.number(),
    status: z.enum(['pending', 'consumed']).default('pending')
})
export type GoalAssistantPlanningRequestItem = z.infer<typeof GoalAssistantPlanningRequestItemSchema>

export const GoalAssistantPlannerMailItemSchema = GoalAssistantPlanningRequestItemSchema
export type GoalAssistantPlannerMailItem = GoalAssistantPlanningRequestItem

export const GoalAssistantTaskSummarySchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(['planned', 'in_progress', 'in_review', 'merging', 'done']),
    lane: z.enum(['planned', 'in_progress', 'in_review', 'merging', 'done']),
    source: z.string().nullable().optional(),
    activeSessionId: z.string().nullable().optional(),
    blockers: z.array(z.string()).default([])
})
export type GoalAssistantTaskSummary = z.infer<typeof GoalAssistantTaskSummarySchema>

export const GoalAssistantDecisionTopicSchema = z.object({
    id: z.string().min(1),
    scope: z.enum(['goal', 'task']).optional(),
    taskId: z.string().nullable(),
    title: z.string().min(1),
    body: z.string().min(1),
    prompt: z.string().nullable().optional(),
    blocking: z.boolean(),
    status: z.enum(['waiting', 'resolved'])
})
export type GoalAssistantDecisionTopic = z.infer<typeof GoalAssistantDecisionTopicSchema>

export const GoalAssistantLaneBudgetEntrySchema = z.object({
    running: z.number().int().min(0),
    limit: z.number().int().min(0)
})
export type GoalAssistantLaneBudgetEntry = z.infer<typeof GoalAssistantLaneBudgetEntrySchema>

export const GoalAssistantLaneBudgetSchema = z.object({
    planner: GoalAssistantLaneBudgetEntrySchema,
    generator: GoalAssistantLaneBudgetEntrySchema,
    evaluator: GoalAssistantLaneBudgetEntrySchema,
    radar: GoalAssistantLaneBudgetEntrySchema
})
export type GoalAssistantLaneBudget = z.infer<typeof GoalAssistantLaneBudgetSchema>

export const GoalAssistantActiveRuntimeSchema = z.object({
    taskId: z.string().min(1),
    taskTitle: z.string().min(1),
    lane: z.enum(['planned', 'in_progress', 'in_review', 'merging', 'done']),
    sessionId: z.string().min(1),
    thinking: z.boolean().default(false)
})
export type GoalAssistantActiveRuntime = z.infer<typeof GoalAssistantActiveRuntimeSchema>

export const GoalAssistantSnapshotSchema = z.object({
    projectId: z.string().min(1),
    goalId: z.string().min(1),
    goalKey: z.string().min(1),
    goalTitle: z.string().min(1),
    goalStatus: z.enum(['planning', 'active', 'blocked', 'paused', 'done', 'archived']),
    goalAutomationPaused: z.boolean(),
    goalDescription: z.string().nullable(),
    currentFocus: z.string().nullable(),
    successCriteria: z.string().nullable(),
    tasks: z.array(GoalAssistantTaskSummarySchema),
    decisionTopics: z.array(GoalAssistantDecisionTopicSchema),
    planningRequests: z.array(GoalAssistantPlanningRequestItemSchema),
    laneBudgetSaturation: GoalAssistantLaneBudgetSchema,
    activeRuntimes: z.array(GoalAssistantActiveRuntimeSchema),
    preferenceMarkdown: z.string()
})
export type GoalAssistantSnapshot = z.infer<typeof GoalAssistantSnapshotSchema>

export const GoalAssistantRequestTaskLaneBodySchema = z.object({
    taskId: z.string().min(1),
    lane: GoalAssistantTaskLaneSchema,
    message: z.string().trim().min(1).max(2_000).optional()
})
export type GoalAssistantRequestTaskLaneBody = z.infer<typeof GoalAssistantRequestTaskLaneBodySchema>

export const GoalAssistantLegacyRequestTaskLaneBodySchema = z.object({
    taskId: z.string().min(1),
    lane: GoalAssistantLegacyTaskLaneSchema,
    message: z.string().trim().min(1).max(2_000).optional()
})
export type GoalAssistantLegacyRequestTaskLaneBody = z.infer<typeof GoalAssistantLegacyRequestTaskLaneBodySchema>

export const GoalAssistantRequestTaskLaneResponseSchema = z.object({
    ok: z.literal(true),
    requestId: z.string().min(1),
    taskId: z.string().min(1),
    lane: GoalAssistantTaskLaneSchema,
    message: z.string().min(1)
})
export type GoalAssistantRequestTaskLaneResponse = z.infer<typeof GoalAssistantRequestTaskLaneResponseSchema>

export const GoalAssistantRequestPlanningBodySchema = z.object({
    body: z.string().trim().min(1).max(10_000),
    relatedTaskIds: z.array(z.string().min(1)).max(50).optional()
})
export type GoalAssistantRequestPlanningBody = z.infer<typeof GoalAssistantRequestPlanningBodySchema>

export const GoalAssistantRequestPlanningResponseSchema = z.object({
    ok: z.literal(true),
    planningRequestId: z.string().min(1)
})
export type GoalAssistantRequestPlanningResponse = z.infer<typeof GoalAssistantRequestPlanningResponseSchema>

export const GoalAssistantMailToPlannerBodySchema = GoalAssistantRequestPlanningBodySchema
export type GoalAssistantMailToPlannerBody = GoalAssistantRequestPlanningBody

export const GoalAssistantMailToPlannerResponseSchema = GoalAssistantRequestPlanningResponseSchema
export type GoalAssistantMailToPlannerResponse = GoalAssistantRequestPlanningResponse

export const GoalAssistantResolveDecisionTopicBodySchema = z.object({
    topicId: z.string().min(1),
    resolution: z.string().trim().min(1).max(20_000)
})
export type GoalAssistantResolveDecisionTopicBody = z.infer<typeof GoalAssistantResolveDecisionTopicBodySchema>

export const GoalAssistantResolveDecisionTopicResponseSchema = z.object({
    ok: z.literal(true),
    topicId: z.string().min(1),
    goalId: z.string().min(1),
    status: z.literal('resolved'),
    resolution: z.string().min(1),
    goalStatus: z.enum(['planning', 'active', 'blocked', 'paused', 'done', 'archived']),
    goalAutomationPaused: z.boolean(),
    reactivatedGoal: z.boolean(),
    requeuedTaskId: z.string().nullable(),
    autoRunTriggered: z.boolean()
})
export type GoalAssistantResolveDecisionTopicResponse = z.infer<typeof GoalAssistantResolveDecisionTopicResponseSchema>

export const GoalAssistantResumeGoalAutomationResponseSchema = z.object({
    ok: z.literal(true),
    goalId: z.string().min(1),
    goalStatus: z.enum(['planning', 'active', 'blocked', 'paused', 'done', 'archived']),
    goalAutomationPaused: z.literal(false)
})
export type GoalAssistantResumeGoalAutomationResponse = z.infer<typeof GoalAssistantResumeGoalAutomationResponseSchema>

export const GoalAssistantPreferenceResponseSchema = z.object({
    markdown: z.string()
})
export type GoalAssistantPreferenceResponse = z.infer<typeof GoalAssistantPreferenceResponseSchema>

export const GoalAssistantWritePreferenceBodySchema = z.object({
    markdown: z.string().max(100_000)
})
export type GoalAssistantWritePreferenceBody = z.infer<typeof GoalAssistantWritePreferenceBodySchema>

export const GOAL_ASSISTANT_SYSTEM_PROMPT = [
    'You are HOPI Goal Assistant.',
    '',
    'Role:',
    '- Goal-scoped Kanban operator assistant for the user, not a coding agent.',
    '- Act like the user\'s butler for this Goal: questions about board state and instructions about board operations should come through you.',
    '- Explain state, blockers, likely next actions, and user choices.',
    '- Use typed HOPI operator tools for workflow actions.',
    '',
    'Authority:',
    '- You may inspect repo state with read-only tools.',
    '- You may use HOPI tools to read goal snapshot, request task lane changes, request planning, resolve decision topics, resume goal automation, and read/write .hopi/preference.md.',
    '- You may not create tasks directly, edit repo files, run write-capable shell work, change permission mode, or claim hidden side effects.',
    '',
    'Operational policy:',
    '- Infer tool choice from workflow effect, not exact keywords.',
    '- For Kanban questions or Kanban instructions, treat read_goal_snapshot() as the workflow source of truth before relying on repo inspection.',
    '- The user should be able to ask you what the board means, why a task is where it is, what is blocked, what is running, what should happen next, or to operate the board on their behalf.',
    '- Existing work that should retry, resume, continue, or requeue normally maps to request_task_lane(taskId, "planned", message).',
    '- Existing work that should retry merge maps to request_task_lane(taskId, "merging", message).',
    '- When the user answers an existing waiting DecisionTopic, prefer resolve_decision_topic(topicId, resolution). Do not downgrade an existing decision answer into planner mail.',
    '- When the user wants paused automation running again, prefer resume_goal_automation().',
    '- New work, scope expansion, replanning, future follow-up, or task-graph changes normally map to request_planning(...).',
    '- A concrete repo problem report such as a build failure, test failure, runtime stack trace, broken behavior report, or code regression is usually operational, not just informational.',
    '- For a concrete repo problem report, first decide whether it belongs to an existing task already on the board. If yes, prefer request_task_lane(...). If not, prefer request_planning(...) so the problem becomes tracked work.',
    '- If you are unsure whether the user means existing work or new work, read_goal_snapshot() first and decide from the current task graph.',
    '- If the user pasted a concrete error log or failure report and did not explicitly ask for explanation only, do not stop at diagnosis alone. Use the appropriate operator tool when available.',
    '- Do not bounce Kanban questions back to the user when the answer can be derived from the snapshot or current Goal state.',
    '- Do not bounce Kanban instructions back to the user when a typed operator tool can carry them out safely.',
    '- When the user wants an existing task retried, resumed, continued, or requeued, prefer request_task_lane(..., "planned", message) and include the current problem/context in message.',
    '- Do not request an in_progress lane. Running/in-progress is scheduler-owned state after a runtime actually starts.',
    '- When the user wants new work, replanning, scope changes, or future follow-up, prefer request_planning(...).',
    '- If resolve_decision_topic(...) succeeds, describe it as a resolved DecisionTopic. Only say the Goal or task already resumed if the tool response says it reactivated or requeued work, or a fresh snapshot confirms it.',
    '- If resume_goal_automation() succeeds, describe it as automation resumed or unpaused. Only say the Goal is actively progressing again if a fresh snapshot confirms scheduler-visible movement.',
    '- If request_task_lane(...) succeeds, describe it as a queued or requested lane change. Only say the card already moved if a fresh snapshot confirms the board state changed.',
    '- When you need current state before acting, call read_goal_snapshot().',
    '- Never say an action is done unless the typed tool call succeeded.',
    '- If a tool is unavailable or fails, say that explicitly and stay advisory.'
].join('\n')
