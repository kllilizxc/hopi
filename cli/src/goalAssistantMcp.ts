import axios from 'axios'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
    GoalAssistantPreferenceResponseSchema,
    GoalAssistantRequestPlanningBodySchema,
    GoalAssistantRequestPlanningResponseSchema,
    GoalAssistantResolveDecisionTopicBodySchema,
    GoalAssistantResolveDecisionTopicResponseSchema,
    GoalAssistantRequestTaskLaneBodySchema,
    GoalAssistantRequestTaskLaneResponseSchema,
    GoalAssistantResumeGoalAutomationResponseSchema,
    GoalAssistantSnapshotSchema,
    GoalAssistantWritePreferenceBodySchema,
    type GoalAssistantSnapshot
} from '@hopi/protocol/goal-assistant'
import type { ZodType } from 'zod'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { initializeToken } from '@/ui/tokenInit'

type GoalAssistantMcpArgs = {
    projectId: string
    goalId: string
}

type GoalAssistantRequestOptions = {
    method: 'GET' | 'POST' | 'PUT'
    path: string
    body?: unknown
}

type GoalAssistantSchema<T> = Pick<ZodType<T>, 'safeParse'>
const GOAL_ASSISTANT_API_TIMEOUT_MS = 20_000
const GOAL_ASSISTANT_TOOL_TIMEOUT_MS = 25_000

function getOptionValue(args: string[], flag: '--project-id' | '--goal-id'): string | null {
    for (let index = 0; index < args.length; index += 1) {
        const value = args[index]
        if (value === flag) {
            const next = args[index + 1]
            return typeof next === 'string' && next.trim().length > 0 ? next.trim() : null
        }
        if (value.startsWith(`${flag}=`)) {
            const inline = value.slice(flag.length + 1).trim()
            return inline || null
        }
    }
    return null
}

export function parseGoalAssistantMcpArgs(args: string[]): GoalAssistantMcpArgs {
    const projectId = getOptionValue(args, '--project-id')
    const goalId = getOptionValue(args, '--goal-id')
    if (!projectId) {
        throw new Error('Missing --project-id for goal-assistant-mcp')
    }
    if (!goalId) {
        throw new Error('Missing --goal-id for goal-assistant-mcp')
    }
    return { projectId, goalId }
}

async function requestGoalAssistantApi<T>(
    options: GoalAssistantRequestOptions,
    schema: GoalAssistantSchema<T>
): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => {
        controller.abort()
    }, GOAL_ASSISTANT_API_TIMEOUT_MS)
    try {
        const response = await axios.request({
            method: options.method,
            url: `${configuration.apiUrl}${options.path}`,
            data: options.body,
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            timeout: GOAL_ASSISTANT_API_TIMEOUT_MS,
            signal: controller.signal
        })
        const parsed = schema.safeParse(response.data)
        if (!parsed.success) {
            throw new Error(`Invalid Goal Assistant API response for ${options.method} ${options.path}`)
        }
        return parsed.data
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const data = error.response?.data
            if (data && typeof data === 'object') {
                const message = (data as Record<string, unknown>).error
                if (typeof message === 'string' && message.trim()) {
                    throw new Error(message)
                }
            }
            if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED') {
                throw new Error(`Goal Assistant API timed out after ${GOAL_ASSISTANT_API_TIMEOUT_MS}ms for ${options.method} ${options.path}`)
            }
        }
        throw error
    } finally {
        clearTimeout(timer)
    }
}

async function withToolTimeout<T>(label: string, run: () => Promise<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Goal Assistant tool ${label} timed out after ${GOAL_ASSISTANT_TOOL_TIMEOUT_MS}ms`))
        }, GOAL_ASSISTANT_TOOL_TIMEOUT_MS)
        run().then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error) => {
                clearTimeout(timer)
                reject(error)
            }
        )
    })
}

function invalidGoalAssistantApiResponse(method: string, path: string): Error {
    return new Error(`Invalid Goal Assistant API response for ${method} ${path}`)
}

function ensureStructuredResponse<T>(value: unknown, schema: GoalAssistantSchema<T>, method: string, path: string): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
        throw invalidGoalAssistantApiResponse(method, path)
    }
    return parsed.data
}

function summarizeSnapshot(snapshot: GoalAssistantSnapshot): string {
    const goalState = snapshot.goalAutomationPaused
        ? `${snapshot.goalStatus}; automation paused`
        : snapshot.goalStatus
    return [
        `Goal: ${snapshot.goalTitle} (${goalState})`,
        `Tasks: ${snapshot.tasks.length}`,
        `Waiting decisions: ${snapshot.decisionTopics.filter((topic) => topic.status === 'waiting').length}`,
        `Open planning requests: ${snapshot.planningRequests.length}`
    ].join('\n')
}

function summarizePreference(markdown: string): string {
    const trimmed = markdown.trim()
    if (!trimmed) {
        return 'Preference is empty.'
    }
    const preview = trimmed.split('\n').slice(0, 6).join('\n')
    return preview.length === trimmed.length ? preview : `${preview}\n...`
}

function buildGoalAssistantPath(
    args: GoalAssistantMcpArgs,
    suffix: 'snapshot' | 'task-lane-requests' | 'planning-requests' | 'planner-mail' | 'decision-topic-resolutions' | 'automation-resume' | 'preference'
): string {
    return `/cli/goal-assistant/projects/${encodeURIComponent(args.projectId)}/goals/${encodeURIComponent(args.goalId)}/${suffix}`
}

export async function runGoalAssistantMcpServer(rawArgs: string[]): Promise<void> {
    await initializeToken()
    const args = parseGoalAssistantMcpArgs(rawArgs)

    const server = new McpServer({
        name: 'hopi-goal-assistant',
        version: '1.0.0'
    })

    server.registerTool('read_goal_snapshot', {
        title: 'Read goal snapshot',
        description: 'Read the current goal control-plane snapshot before answering or acting. This is the source of truth for Kanban questions and Kanban operations: use it for task ids, lane state, blockers, decisions, planner mail, budgets, active runtimes, and preferences.',
        outputSchema: GoalAssistantSnapshotSchema
    }, async () => await withToolTimeout('read_goal_snapshot', async () => {
        const path = buildGoalAssistantPath(args, 'snapshot')
        const snapshot = ensureStructuredResponse(await requestGoalAssistantApi({
            method: 'GET',
            path
        }, GoalAssistantSnapshotSchema), GoalAssistantSnapshotSchema, 'GET', path)
        return {
            content: [{ type: 'text', text: summarizeSnapshot(snapshot) }],
            structuredContent: snapshot
        }
    }))

    server.registerTool('request_task_lane', {
        title: 'Request task lane',
        description: 'Request a lane change for existing goal work already on the Kanban board. Use lane "planned" for retry/resume/continue/requeue with a message that includes the current problem/context. Use lane "merging" only for merge retry. Do not request in_progress; running is scheduler-owned after a runtime actually starts. Do not use for new work or scope expansion. HOPI may update the durable board immediately and scheduler-owned runtime starts later; use a fresh snapshot before claiming follow-on automation already started.',
        inputSchema: GoalAssistantRequestTaskLaneBodySchema,
        outputSchema: GoalAssistantRequestTaskLaneResponseSchema
    }, async (input) => await withToolTimeout('request_task_lane', async () => {
        const path = buildGoalAssistantPath(args, 'task-lane-requests')
        const response = ensureStructuredResponse(await requestGoalAssistantApi({
            method: 'POST',
            path,
            body: input
        }, GoalAssistantRequestTaskLaneResponseSchema), GoalAssistantRequestTaskLaneResponseSchema, 'POST', path)
        return {
            content: [{
                type: 'text',
                text: `Requested lane change: task ${response.taskId} -> ${response.lane}.`
            }],
            structuredContent: response
        }
    }))

    const requestPlanning = async (input: unknown, toolName: 'request_planning' | 'mail_to_planner') => await withToolTimeout(toolName, async () => {
        const path = buildGoalAssistantPath(args, 'planning-requests')
        const response = ensureStructuredResponse(await requestGoalAssistantApi({
            method: 'POST',
            path,
            body: input
        }, GoalAssistantRequestPlanningResponseSchema), GoalAssistantRequestPlanningResponseSchema, 'POST', path)
        return {
            content: [{
                type: 'text' as const,
                text: `Planning request queued as ${response.planningRequestId}.`
            }],
            structuredContent: response
        }
    })

    server.registerTool('request_planning', {
        title: 'Request planning',
        description: 'Send a structured planning request for new Kanban work, scope changes, follow-up batches, replanning, or a concrete bug/build/test failure that is not clearly owned by an existing board task. Use whenever the user intent would expand or reshape the task graph.',
        inputSchema: GoalAssistantRequestPlanningBodySchema,
        outputSchema: GoalAssistantRequestPlanningResponseSchema
    }, async (input) => await requestPlanning(input, 'request_planning'))

    server.registerTool('mail_to_planner', {
        title: 'Mail planner',
        description: 'Send a structured note to the Planner for new Kanban work, scope changes, follow-up batches, replanning, or a concrete bug/build/test failure that is not clearly owned by an existing board task. Use whenever the user intent would expand or reshape the task graph.',
        inputSchema: GoalAssistantRequestPlanningBodySchema,
        outputSchema: GoalAssistantRequestPlanningResponseSchema
    }, async (input) => await requestPlanning(input, 'mail_to_planner'))

    server.registerTool('resolve_decision_topic', {
        title: 'Resolve decision topic',
        description: 'Resolve an existing waiting DecisionTopic with the user answer. Use when the user directly provides the missing choice, answer, or approval for a currently open decision on this Goal. Do not use planner mail as a substitute for answering an existing DecisionTopic.',
        inputSchema: GoalAssistantResolveDecisionTopicBodySchema,
        outputSchema: GoalAssistantResolveDecisionTopicResponseSchema
    }, async (input) => await withToolTimeout('resolve_decision_topic', async () => {
        const path = buildGoalAssistantPath(args, 'decision-topic-resolutions')
        const response = ensureStructuredResponse(await requestGoalAssistantApi({
            method: 'POST',
            path,
            body: input
        }, GoalAssistantResolveDecisionTopicResponseSchema), GoalAssistantResolveDecisionTopicResponseSchema, 'POST', path)
        const lines = [`Resolved decision topic ${response.topicId}.`]
        if (response.reactivatedGoal) {
            lines.push('Goal reactivated.')
        }
        if (response.requeuedTaskId) {
            lines.push(`Task ${response.requeuedTaskId} requeued.`)
        }
        if (response.autoRunTriggered) {
            lines.push('Auto-run tick requested.')
        }
        return {
            content: [{
                type: 'text',
                text: lines.join(' ')
            }],
            structuredContent: response
        }
    }))

    server.registerTool('resume_goal_automation', {
        title: 'Resume goal automation',
        description: 'Resume paused automation for this Goal when the user wants it running again. Use this for automation pause/unpause, not as a substitute for resolving a blocking DecisionTopic.',
        outputSchema: GoalAssistantResumeGoalAutomationResponseSchema
    }, async () => await withToolTimeout('resume_goal_automation', async () => {
        const path = buildGoalAssistantPath(args, 'automation-resume')
        const response = ensureStructuredResponse(await requestGoalAssistantApi({
            method: 'POST',
            path,
            body: {}
        }, GoalAssistantResumeGoalAutomationResponseSchema), GoalAssistantResumeGoalAutomationResponseSchema, 'POST', path)
        return {
            content: [{
                type: 'text',
                text: `Goal automation resumed for ${response.goalId}.`
            }],
            structuredContent: response
        }
    }))

    server.registerTool('read_preference', {
        title: 'Read preference',
        description: 'Read the durable operator preference markdown for this HOPI workspace.',
        outputSchema: GoalAssistantPreferenceResponseSchema
    }, async () => await withToolTimeout('read_preference', async () => {
        const path = buildGoalAssistantPath(args, 'preference')
        const response = ensureStructuredResponse(await requestGoalAssistantApi({
            method: 'GET',
            path
        }, GoalAssistantPreferenceResponseSchema), GoalAssistantPreferenceResponseSchema, 'GET', path)
        return {
            content: [{ type: 'text', text: summarizePreference(response.markdown) }],
            structuredContent: response
        }
    }))

    server.registerTool('write_preference', {
        title: 'Write preference',
        description: 'Persist operator preference markdown for future Goal Assistant turns.',
        inputSchema: GoalAssistantWritePreferenceBodySchema,
        outputSchema: GoalAssistantPreferenceResponseSchema
    }, async (input) => await withToolTimeout('write_preference', async () => {
        const path = buildGoalAssistantPath(args, 'preference')
        const response = ensureStructuredResponse(await requestGoalAssistantApi({
            method: 'PUT',
            path,
            body: input
        }, GoalAssistantPreferenceResponseSchema), GoalAssistantPreferenceResponseSchema, 'PUT', path)
        return {
            content: [{ type: 'text', text: 'Preference saved.' }],
            structuredContent: response
        }
    }))

    await server.connect(new StdioServerTransport())
}
