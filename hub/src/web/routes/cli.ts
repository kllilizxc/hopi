import { Hono } from 'hono'
import { z } from 'zod'
import { PROTOCOL_VERSION } from '@hopi/protocol'
import {
    GoalAssistantLegacyRequestTaskLaneBodySchema,
    GoalAssistantRequestPlanningBodySchema,
    GoalAssistantResolveDecisionTopicBodySchema,
    GoalAssistantWritePreferenceBodySchema,
    normalizeGoalAssistantTaskLane
} from '@hopi/protocol/goal-assistant'
import { PRODUCT_HEADERS } from '@hopi/protocol/brand'
import type { Store } from '../../store'
import { configuration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import {
    appendGoalAssistantPlanningRequest,
    buildDefaultLaneRequestMessage,
    buildGoalAssistantSnapshot,
    resolveGoalAssistantContext,
    writeGoalAssistantPreference
} from '../../sync/goalAssistant'
import { requestGoalTaskLane, resolveGoalDecisionTopic, resumeGoalAutomation } from '../../sync/goals/goalControl'
import { overlayGoalWithCanonicalDoc } from '../../sync/goals/goalDocs'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import type { StoredGoal, StoredWorkspace } from '../../store/types'

const bearerSchema = z.string().regex(/^Bearer\s+(.+)$/i)

const createOrLoadSessionSchema = z.object({
    tag: z.string().min(1),
    metadata: z.unknown(),
    agentState: z.unknown().nullable().optional()
})

const createOrLoadMachineSchema = z.object({
    id: z.string().min(1),
    metadata: z.unknown(),
    runnerState: z.unknown().nullable().optional()
})

const getMessagesQuerySchema = z.object({
    afterSeq: z.coerce.number().int().min(0),
    limit: z.coerce.number().int().min(1).max(200).optional()
})

type CliEnv = {
    Variables: {
        namespace: string
    }
}

function resolveSessionForNamespace(
    engine: SyncEngine,
    sessionId: string,
    namespace: string
): { ok: true; session: Session; sessionId: string } | { ok: false; status: 403 | 404; error: string } {
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (access.ok) {
        return { ok: true, session: access.session, sessionId: access.sessionId }
    }
    return {
        ok: false,
        status: access.reason === 'access-denied' ? 403 : 404,
        error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
    }
}

function resolveMachineForNamespace(
    engine: SyncEngine,
    machineId: string,
    namespace: string
): { ok: true; machine: Machine } | { ok: false; status: 403 | 404; error: string } {
    const machine = engine.getMachineByNamespace(machineId, namespace)
    if (machine) {
        return { ok: true, machine }
    }
    if (engine.getMachine(machineId)) {
        return { ok: false, status: 403, error: 'Machine access denied' }
    }
    return { ok: false, status: 404, error: 'Machine not found' }
}

function overlayGoalAssistantResponseGoal(input: {
    store: Store
    namespace: string
    goalId: string
    fallbackGoal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): StoredGoal {
    const goal = input.store.goals.getGoalByNamespace(input.goalId, input.namespace) ?? input.fallbackGoal
    return overlayGoalWithCanonicalDoc({
        goal,
        defaultWorkspace: input.defaultWorkspace
    })
}

export function createCliRoutes(options: {
    getSyncEngine: () => SyncEngine | null
    store: Store
}): Hono<CliEnv> {
    const app = new Hono<CliEnv>()

    app.use('*', async (c, next) => {
        c.header(PRODUCT_HEADERS.PROTOCOL_VERSION, String(PROTOCOL_VERSION))

        const raw = c.req.header('authorization')
        if (!raw) {
            return c.json({ error: 'Missing Authorization header' }, 401)
        }

        const parsed = bearerSchema.safeParse(raw)
        if (!parsed.success) {
            return c.json({ error: 'Invalid Authorization header' }, 401)
        }

        const token = parsed.data.replace(/^Bearer\s+/i, '')
        const parsedToken = parseAccessToken(token)
        if (!parsedToken || !constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
            return c.json({ error: 'Invalid token' }, 401)
        }

        c.set('namespace', parsedToken.namespace)
        return await next()
    })

    app.post('/sessions', async (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = createOrLoadSessionSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const session = engine.getOrCreateSession(parsed.data.tag, parsed.data.metadata, parsed.data.agentState ?? null, namespace)
        return c.json({ session })
    })

    app.get('/sessions/:id', (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ session: resolved.session })
    })

    app.get('/sessions/:id/messages', (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const parsed = getMessagesQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const limit = parsed.data.limit ?? 200
        const messages = engine.getMessagesAfter(resolved.sessionId, { afterSeq: parsed.data.afterSeq, limit })
        return c.json({ messages })
    })

    app.post('/machines', async (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = createOrLoadMachineSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const existing = engine.getMachine(parsed.data.id)
        if (existing && existing.namespace !== namespace) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        const machine = engine.getOrCreateMachine(parsed.data.id, parsed.data.metadata, parsed.data.runnerState ?? null, namespace)
        return c.json({ machine })
    })

    app.get('/machines/:id', (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const machineId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveMachineForNamespace(engine, machineId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ machine: resolved.machine })
    })

    app.get('/goal-assistant/projects/:projectId/goals/:goalId/snapshot', async (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const namespace = c.get('namespace')
        try {
            const snapshot = await buildGoalAssistantSnapshot({
                store: options.store,
                engine,
                namespace,
                projectId: c.req.param('projectId'),
                goalId: c.req.param('goalId')
            })
            return c.json(snapshot)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read goal snapshot'
            return c.json({ error: message }, message.includes('not found') ? 404 : 400)
        }
    })

    app.post('/goal-assistant/projects/:projectId/goals/:goalId/task-lane-requests', async (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const namespace = c.get('namespace')
        const json = await c.req.json().catch(() => null)
        const parsed = GoalAssistantLegacyRequestTaskLaneBodySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const context = resolveGoalAssistantContext({
                store: options.store,
                namespace,
                projectId: c.req.param('projectId'),
                goalId: c.req.param('goalId')
            })
            const lane = normalizeGoalAssistantTaskLane(parsed.data.lane)
            const request = requestGoalTaskLane({
                store: options.store,
                engine,
                namespace,
                project: context.project,
                goal: context.goal,
                taskId: parsed.data.taskId,
                lane,
                message: parsed.data.message?.trim() || buildDefaultLaneRequestMessage(lane)
            })
            if (!request) {
                return c.json({ error: 'Task not found' }, 404)
            }
            return c.json({
                ok: true,
                requestId: request.requestId,
                taskId: request.task.id,
                lane: request.lane,
                message: request.message
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply task lane request'
            return c.json({ error: message }, message.includes('not found') ? 404 : 400)
        }
    })

    const handlePlanningRequest = async (c: any) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const namespace = c.get('namespace')
        const json = await c.req.json().catch(() => null)
        const parsed = GoalAssistantRequestPlanningBodySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const context = resolveGoalAssistantContext({
                store: options.store,
                namespace,
                projectId: c.req.param('projectId'),
                goalId: c.req.param('goalId')
            })
            const item = await appendGoalAssistantPlanningRequest({
                engine,
                machineId: context.project.machineId,
                docsRoot: context.docsRoot,
                goalKey: context.goal.goalKey,
                body: parsed.data.body,
                relatedTaskIds: parsed.data.relatedTaskIds
            })
            engine.requestAutoRunTick(namespace, context.project.id)
            return c.json({ ok: true, planningRequestId: item.id })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to append planning request'
            return c.json({ error: message }, message.includes('not found') ? 404 : 400)
        }
    }

    app.post('/goal-assistant/projects/:projectId/goals/:goalId/planning-requests', handlePlanningRequest)
    app.post('/goal-assistant/projects/:projectId/goals/:goalId/planner-mail', handlePlanningRequest)

    app.post('/goal-assistant/projects/:projectId/goals/:goalId/decision-topic-resolutions', async (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const namespace = c.get('namespace')
        const json = await c.req.json().catch(() => null)
        const parsed = GoalAssistantResolveDecisionTopicBodySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const context = resolveGoalAssistantContext({
                store: options.store,
                namespace,
                projectId: c.req.param('projectId'),
                goalId: c.req.param('goalId')
            })

            const resolved = resolveGoalDecisionTopic({
                store: options.store,
                engine,
                namespace,
                topicId: parsed.data.topicId,
                resolution: parsed.data.resolution,
                expectedProjectId: context.project.id,
                expectedGoalId: context.goal.id
            })
            if (!resolved) {
                return c.json({ error: 'Decision topic not found' }, 404)
            }

            const goal = overlayGoalAssistantResponseGoal({
                store: options.store,
                namespace,
                goalId: context.goal.id,
                fallbackGoal: context.goal,
                defaultWorkspace: context.defaultWorkspace
            })
            return c.json({
                ok: true,
                topicId: resolved.topic.id,
                goalId: resolved.topic.goalId,
                status: resolved.topic.status,
                resolution: resolved.topic.resolution ?? parsed.data.resolution,
                goalStatus: goal.status,
                goalAutomationPaused: goal.automationPausedAt !== null,
                reactivatedGoal: resolved.reactivatedGoal,
                requeuedTaskId: resolved.requeuedTaskId,
                autoRunTriggered: resolved.autoRunTriggered
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to resolve decision topic'
            return c.json({ error: message }, message.includes('not found') ? 404 : 400)
        }
    })

    app.post('/goal-assistant/projects/:projectId/goals/:goalId/automation-resume', async (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const namespace = c.get('namespace')

        try {
            const context = resolveGoalAssistantContext({
                store: options.store,
                namespace,
                projectId: c.req.param('projectId'),
                goalId: c.req.param('goalId')
            })
            const goal = resumeGoalAutomation({
                store: options.store,
                engine,
                namespace,
                goalId: context.goal.id
            })
            if (!goal) {
                return c.json({ error: 'Goal not found' }, 404)
            }
            const responseGoal = overlayGoalAssistantResponseGoal({
                store: options.store,
                namespace,
                goalId: goal.id,
                fallbackGoal: goal,
                defaultWorkspace: context.defaultWorkspace
            })

            return c.json({
                ok: true,
                goalId: goal.id,
                goalStatus: responseGoal.status,
                goalAutomationPaused: responseGoal.automationPausedAt !== null
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to resume goal automation'
            return c.json({ error: message }, message.includes('not found') ? 404 : 400)
        }
    })

    app.get('/goal-assistant/projects/:projectId/goals/:goalId/preference', async (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const namespace = c.get('namespace')
        try {
            const snapshot = await buildGoalAssistantSnapshot({
                store: options.store,
                engine,
                namespace,
                projectId: c.req.param('projectId'),
                goalId: c.req.param('goalId')
            })
            return c.json({ markdown: snapshot.preferenceMarkdown })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read preference'
            return c.json({ error: message }, message.includes('not found') ? 404 : 400)
        }
    })

    app.put('/goal-assistant/projects/:projectId/goals/:goalId/preference', async (c) => {
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const namespace = c.get('namespace')
        const json = await c.req.json().catch(() => null)
        const parsed = GoalAssistantWritePreferenceBodySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const context = resolveGoalAssistantContext({
                store: options.store,
                namespace,
                projectId: c.req.param('projectId'),
                goalId: c.req.param('goalId')
            })
            await writeGoalAssistantPreference({
                engine,
                machineId: context.project.machineId,
                docsRoot: context.docsRoot,
                markdown: parsed.data.markdown
            })
            return c.json({ markdown: parsed.data.markdown })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to write preference'
            return c.json({ error: message }, message.includes('not found') ? 404 : 400)
        }
    })

    return app
}
