import {
    OmcAttachLocalRepoRequestSchema,
    OmcAttachPlanningRootRequestSchema,
    OmcCreatePlanningSeedRequestSchema,
    OmcGuidedPlanningStartRequestSchema,
    OmcGuidedPlanningStateResponseSchema,
    OmcReviewReopenRequestSchema
} from '@hopi/protocol/schemas'
import type {
    OmcGuidedPlanningStateResponse,
    OmcPlanRuntime,
    OmcPlanSummary,
    OmcProgram,
    OmcProgramPlanningState,
    OmcProgramSummary
} from '@hopi/protocol/types'
import { Hono } from 'hono'
import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { OmcLoopController } from '../../sync/omc/loopController'
import { OmcPlanningRunController } from '../../sync/omc/planningRunController'
import {
    OmcReviewController,
    OmcReviewControllerPreconditionError
} from '../../sync/omc/reviewController'
import {
    buildOmcGuidedPlanningUpdatedEvent,
    buildOmcProgramUpdatedEvent,
    buildOmcMergeUpdatedEvent,
    buildOmcPlanRuntimeUpdatedEvent,
    buildOmcReviewUpdatedEvent
} from '../../sync/omc/events'
import { buildPlanDetail, buildPlanningIndex } from '../../sync/omc/planningIndex'
import { buildRepoLocalOmcPlanningRoot, resolveOmcPlanningRoot } from '../../sync/omc/programPaths'
import {
    createProgramId,
    deriveProgramName,
    ensureRepoNotAlreadyAttached,
    inspectOmcPlanningRoot,
    validateLocalGitRepo,
    validatePlanningRoot,
    writePlanningSeed
} from '../../sync/omc/programBootstrap'
import { buildOmcMergePacket } from '../../sync/omc/reviewPacket'
import type { WebAppEnv } from '../middleware/auth'

function resolveRepoRoot(): string {
    const candidates = [
        process.cwd(),
        new URL('../../../..', import.meta.url).pathname,
        new URL('../../..', import.meta.url).pathname
    ]

    for (const candidate of candidates) {
        if (!candidate) {
            continue
        }

        const normalized = candidate.endsWith('/') ? candidate.slice(0, -1) : candidate
        if (normalized.endsWith('/hub')) {
            return normalized.slice(0, -4)
        }
        if (normalized.endsWith('/src')) {
            return normalized.slice(0, -4)
        }
        return normalized
    }

    return process.cwd()
}

function resolvePlanningRoot(repoRoot: string): string {
    return resolveOmcPlanningRoot(repoRoot)
}

function ensureDefaultProgram(store: Store, namespace: string): OmcProgram | null {
    const defaultProgram = store.omcRuntime.getProgramByNamespace('omc-default', namespace)
    const repoRoot = resolveRepoRoot()
    const planningRoot = resolvePlanningRoot(repoRoot)

    return store.omcRuntime.upsertProgram({
        id: 'omc-default',
        namespace,
        machineId: defaultProgram?.machineId ?? null,
        name: defaultProgram?.name ?? 'OMC Workspace',
        repoRoot,
        planningRoot,
        primaryBranch: defaultProgram?.primaryBranch ?? null,
        targetBranch: defaultProgram?.targetBranch ?? null
    })
}

function buildDefaultRuntime(programId: string, plan: OmcPlanSummary): OmcPlanRuntime {
    const done = plan.checklistTotal > 0 && plan.checklistOpen === 0
    return {
        programId,
        planKey: plan.planKey,
        planPath: plan.planPath,
        phaseKey: plan.phaseKey,
        phaseLabel: plan.phaseLabel,
        column: done ? 'Done' : 'Planning',
        loopStatus: done ? 'done' : 'idle',
        currentLoopRunId: null,
        currentWorktreePath: null,
        currentBranch: null,
        targetBranch: null,
        attemptCount: 0,
        consecutiveFailureCount: 0,
        lastFailureFingerprint: null,
        reviewRequired: false,
        reviewApprovedAt: null,
        mergeStatus: 'idle',
        mergeBlockedReason: null,
        lastMergeAttemptAt: null,
        mergeApprovedAt: null,
        doneAt: done ? plan.lastModifiedAt : null,
        latestEvidenceSummary: null,
        lastAttemptAt: null,
        updatedAt: done ? plan.lastModifiedAt : null
    }
}

function resolvePlanRuntime(store: Store, namespace: string, programId: string, plan: OmcPlanSummary): OmcPlanRuntime {
    return store.omcRuntime.getPlanRuntime(programId, plan.planKey, namespace)
        ?? buildDefaultRuntime(programId, plan)
}

function listMergedRuntimes(store: Store, program: OmcProgram, namespace: string): OmcPlanRuntime[] {
    const index = buildPlanningIndex(program)
    const storedRuntimes = new Map(
        store.omcRuntime
            .listPlanRuntimes(program.id, namespace)
            .map((runtime) => [runtime.planKey, runtime] as const)
    )

    return index.phases.flatMap((phase) => phase.plans.map((plan) => storedRuntimes.get(plan.planKey) ?? buildDefaultRuntime(program.id, plan)))
}

function buildProgramSummary(store: Store, program: OmcProgram, namespace: string): OmcProgramSummary {
    const runtimes = listMergedRuntimes(store, program, namespace)
    const counts: OmcProgramSummary['counts'] = {
        Planning: 0,
        Running: 0,
        Review: 0,
        Done: 0
    }

    let lastActivityAt: number | null = null
    for (const runtime of runtimes) {
        counts[runtime.column] += 1
        const candidate = runtime.updatedAt ?? null
        if (candidate !== null && (lastActivityAt === null || candidate > lastActivityAt)) {
            lastActivityAt = candidate
        }
    }

    return {
        ...program,
        counts,
        lastActivityAt
    }
}

function requireProgram(store: Store, namespace: string, programId: string): OmcProgram | null {
    const program = store.omcRuntime.getProgramByNamespace(programId, namespace)
    if (program) {
        return program
    }

    const defaultProgram = ensureDefaultProgram(store, namespace)
    if (defaultProgram?.id === programId) {
        return defaultProgram
    }

    return null
}

function buildProgramPlanningState(
    program: OmcProgram,
    status: OmcProgramPlanningState['status'],
    seedFiles: string[] = []
): OmcProgramPlanningState {
    const inspection = inspectOmcPlanningRoot(program.planningRoot)
    return {
        status,
        planningRoot: inspection.planningRoot,
        hasPlanning: inspection.hasPlanning,
        hasPlans: inspection.hasPlans,
        phaseCount: inspection.phaseCount,
        planCount: inspection.planCount,
        seedFiles
    }
}

function buildGuidedPlanningStateResponse(
    store: Store,
    program: OmcProgram,
    planningStatus?: OmcProgramPlanningState['status']
): OmcGuidedPlanningStateResponse {
    const planning = buildProgramPlanningState(
        program,
        planningStatus ?? (inspectOmcPlanningRoot(program.planningRoot).hasPlanning ? 'detected' : 'missing')
    )
    return OmcGuidedPlanningStateResponseSchema.parse({
        programId: program.id,
        planning,
        run: store.omcRuntime.getLatestPlanningRun(program.id, program.namespace)
    })
}

export function createOmcRoutes(options: {
    store: Store
    getSyncEngine?: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    function emitProgramState(program: OmcProgram): void {
        const engine = options.getSyncEngine?.() ?? null
        if (!engine) {
            return
        }

        engine.handleRealtimeEvent(buildOmcProgramUpdatedEvent(program))
    }

    function emitGuidedPlanningState(program: OmcProgram, planningStatus?: OmcProgramPlanningState['status']): void {
        const engine = options.getSyncEngine?.() ?? null
        if (!engine) {
            return
        }

        const run = options.store.omcRuntime.getLatestPlanningRun(program.id, program.namespace)
        if (!run) {
            return
        }

        const planning = buildProgramPlanningState(
            program,
            planningStatus ?? (inspectOmcPlanningRoot(program.planningRoot).hasPlanning ? 'detected' : 'missing')
        )

        engine.handleRealtimeEvent(buildOmcGuidedPlanningUpdatedEvent(run, planning, program.namespace))
    }

    function requireController(namespace: string): OmcLoopController | null {
        const engine = options.getSyncEngine?.() ?? null
        if (!engine) {
            return null
        }

        return new OmcLoopController({
            store: options.store,
            engine,
            namespace
        })
    }

    function requirePlanningController(namespace: string): OmcPlanningRunController | null {
        const engine = options.getSyncEngine?.() ?? null
        if (!engine) {
            return null
        }

        return new OmcPlanningRunController({
            store: options.store,
            engine,
            namespace
        })
    }

    function requireReviewController(namespace: string): OmcReviewController | null {
        const engine = options.getSyncEngine?.() ?? null
        if (!engine) {
            return null
        }

        return new OmcReviewController({
            store: options.store,
            engine,
            namespace
        })
    }

    function emitReviewAndMergeState(namespace: string, runtime: OmcPlanRuntime): void {
        const engine = options.getSyncEngine?.() ?? null
        if (!engine) {
            return
        }

        engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(runtime, namespace))
        engine.handleRealtimeEvent(buildOmcReviewUpdatedEvent(runtime, namespace))
        engine.handleRealtimeEvent(buildOmcMergeUpdatedEvent(runtime, namespace))
    }

    app.get('/omc/programs', (c) => {
        const namespace = c.get('namespace')
        ensureDefaultProgram(options.store, namespace)
        const programs = options.store.omcRuntime
            .listProgramsByNamespace(namespace)
            .map((program) => buildProgramSummary(options.store, program, namespace))

        return c.json({ programs })
    })

    app.get('/omc/programs/:programId', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        return c.json({
            program: buildProgramSummary(options.store, program, namespace),
            planning: buildProgramPlanningState(
                program,
                inspectOmcPlanningRoot(program.planningRoot).hasPlanning ? 'detected' : 'missing'
            )
        })
    })

    app.post('/omc/programs/attach-local-repo', async (c) => {
        const namespace = c.get('namespace')
        const payload = await c.req.json().catch(() => null)
        const parsed = OmcAttachLocalRepoRequestSchema.safeParse(payload)
        if (!parsed.success) {
            return c.json({ error: 'Invalid attach-local-repo payload' }, 400)
        }

        try {
            const programs = options.store.omcRuntime.listProgramsByNamespace(namespace)
            const repo = validateLocalGitRepo(parsed.data.repoRoot)
            ensureRepoNotAlreadyAttached(programs, repo.repoRoot)
            const detectedPlanningRoot = resolvePlanningRoot(repo.repoRoot)
            const detectedPlanning = inspectOmcPlanningRoot(detectedPlanningRoot)
            const planningRoot = detectedPlanning.hasPlanning
                ? detectedPlanning.planningRoot
                : buildRepoLocalOmcPlanningRoot(repo.repoRoot)

            const program = options.store.omcRuntime.upsertProgram({
                id: createProgramId(repo.repoRoot),
                namespace,
                name: deriveProgramName(repo.repoRoot, parsed.data.name),
                repoRoot: repo.repoRoot,
                planningRoot,
                primaryBranch: repo.primaryBranch,
                targetBranch: repo.primaryBranch
            })
            emitProgramState(program)
            emitGuidedPlanningState(program)

            return c.json({
                program: buildProgramSummary(options.store, program, namespace),
                planning: buildProgramPlanningState(
                    program,
                    inspectOmcPlanningRoot(program.planningRoot).hasPlanning ? 'detected' : 'missing'
                )
            })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Could not attach repo' }, 400)
        }
    })

    app.post('/omc/programs/:programId/attach-planning-root', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const payload = await c.req.json().catch(() => null)
        const parsed = OmcAttachPlanningRootRequestSchema.safeParse(payload)
        if (!parsed.success) {
            return c.json({ error: 'Invalid attach-planning-root payload' }, 400)
        }

        try {
            const inspection = validatePlanningRoot(parsed.data.planningRoot)
            const updatedProgram = options.store.omcRuntime.upsertProgram({
                id: program.id,
                namespace,
                machineId: program.machineId ?? null,
                name: program.name,
                repoRoot: program.repoRoot,
                planningRoot: inspection.planningRoot,
                primaryBranch: program.primaryBranch ?? null,
                targetBranch: program.targetBranch ?? null
            })
            emitProgramState(updatedProgram)
            emitGuidedPlanningState(updatedProgram, 'attached')

            return c.json({
                program: buildProgramSummary(options.store, updatedProgram, namespace),
                planning: buildProgramPlanningState(updatedProgram, 'attached')
            })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Could not attach planning root' }, 400)
        }
    })

    app.post('/omc/programs/:programId/create-planning-seed', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const payload = await c.req.json().catch(() => ({}))
        const parsed = OmcCreatePlanningSeedRequestSchema.safeParse(payload)
        if (!parsed.success) {
            return c.json({ error: 'Invalid create-planning-seed payload' }, 400)
        }

        try {
            const seeded = writePlanningSeed({
                repoRoot: program.repoRoot,
                programName: program.name
            })
            const updatedProgram = options.store.omcRuntime.upsertProgram({
                id: program.id,
                namespace,
                machineId: program.machineId ?? null,
                name: program.name,
                repoRoot: program.repoRoot,
                planningRoot: seeded.planningRoot,
                primaryBranch: program.primaryBranch ?? null,
                targetBranch: program.targetBranch ?? null
            })
            emitProgramState(updatedProgram)
            emitGuidedPlanningState(updatedProgram, 'seeded')

            return c.json({
                program: buildProgramSummary(options.store, updatedProgram, namespace),
                planning: buildProgramPlanningState(updatedProgram, 'seeded', seeded.seedFiles)
            })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Could not create planning seed' }, 400)
        }
    })

    app.get('/omc/programs/:programId/planning-run', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const controller = requirePlanningController(namespace)
        controller?.reconcileRun(program)

        return c.json(buildGuidedPlanningStateResponse(options.store, program))
    })

    app.post('/omc/programs/:programId/planning-run/start', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const payload = await c.req.json().catch(() => null)
        const parsed = OmcGuidedPlanningStartRequestSchema.safeParse(payload)
        if (!parsed.success) {
            return c.json({ error: 'Invalid guided-planning brief payload' }, 400)
        }

        const controller = requirePlanningController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for guided planning.' }, 503)
        }

        try {
            return c.json(await controller.startPlanning(program, parsed.data.brief))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start guided planning'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/omc/programs/:programId/planning-run/retry', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const controller = requirePlanningController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for guided planning.' }, 503)
        }

        try {
            return c.json(await controller.retryPlanning(program))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to retry guided planning'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/omc/programs/:programId/planning-run/cancel', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const controller = requirePlanningController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for guided planning.' }, 503)
        }

        try {
            return c.json(await controller.cancelPlanning(program))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to cancel guided planning'
            return c.json({ error: message }, 409)
        }
    })

    app.get('/omc/programs/:programId/planning-index', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        return c.json(buildPlanningIndex(program))
    })

    app.get('/omc/programs/:programId/plan-runtimes', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        return c.json({
            programId: program.id,
            runtimes: listMergedRuntimes(options.store, program, namespace)
        })
    })

    app.get('/omc/programs/:programId/plans/:planKey', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const plan = buildPlanDetail(program, c.req.param('planKey'))
        if (!plan) {
            return c.json({ error: 'Plan not found' }, 404)
        }

        const runtime = options.store.omcRuntime.getPlanRuntime(program.id, plan.planKey, namespace)
            ?? buildDefaultRuntime(program.id, {
                planKey: plan.planKey,
                planPath: plan.planPath,
                phaseKey: plan.phaseKey,
                phaseLabel: plan.phaseLabel,
                planTitle: plan.planTitle,
                summary: plan.summary,
                checklistTotal: plan.checklist.length,
                checklistDone: plan.checklist.filter((item) => item.checked).length,
                checklistOpen: plan.checklist.filter((item) => !item.checked).length,
                firstOpenItem: plan.checklist.find((item) => !item.checked)?.text ?? null,
                lastModifiedAt: plan.lastModifiedAt
            })
        const attempts = options.store.omcRuntime.listAttempts(program.id, plan.planKey, namespace)
        const evidence = options.store.omcRuntime.listEvidenceForPlan(program.id, plan.planKey, namespace)

        return c.json({
            programId: program.id,
            plan,
            runtime,
            attempts,
            evidence
        })
    })

    app.get('/omc/programs/:programId/plans/:planKey/runtime', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const plan = buildPlanDetail(program, c.req.param('planKey'))
        if (!plan) {
            return c.json({ error: 'Plan not found' }, 404)
        }

        const runtime = options.store.omcRuntime.getPlanRuntime(program.id, plan.planKey, namespace)
            ?? buildDefaultRuntime(program.id, {
                planKey: plan.planKey,
                planPath: plan.planPath,
                phaseKey: plan.phaseKey,
                phaseLabel: plan.phaseLabel,
                planTitle: plan.planTitle,
                summary: plan.summary,
                checklistTotal: plan.checklist.length,
                checklistDone: plan.checklist.filter((item) => item.checked).length,
                checklistOpen: plan.checklist.filter((item) => !item.checked).length,
                firstOpenItem: plan.checklist.find((item) => !item.checked)?.text ?? null,
                lastModifiedAt: plan.lastModifiedAt
            })

        return c.json({ runtime })
    })

    app.get('/omc/programs/:programId/plans/:planKey/attempts', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        return c.json({
            attempts: options.store.omcRuntime.listAttempts(program.id, c.req.param('planKey'), namespace)
        })
    })

    app.get('/omc/programs/:programId/plans/:planKey/merge-packet', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const plan = buildPlanDetail(program, c.req.param('planKey'))
        if (!plan) {
            return c.json({ error: 'Plan not found' }, 404)
        }

        const runtime = resolvePlanRuntime(options.store, namespace, program.id, {
            planKey: plan.planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            planTitle: plan.planTitle,
            summary: plan.summary,
            checklistTotal: plan.checklist.length,
            checklistDone: plan.checklist.filter((item) => item.checked).length,
            checklistOpen: plan.checklist.filter((item) => !item.checked).length,
            firstOpenItem: plan.checklist.find((item) => !item.checked)?.text ?? null,
            lastModifiedAt: plan.lastModifiedAt
        })
        const attempts = options.store.omcRuntime.listAttempts(program.id, plan.planKey, namespace)
        const evidence = options.store.omcRuntime.listEvidenceForPlan(program.id, plan.planKey, namespace)

        return c.json({
            packet: buildOmcMergePacket({
                program,
                plan,
                runtime,
                attempts,
                evidence
            })
        })
    })

    app.post('/omc/programs/:programId/plans/:planKey/review/approve', (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const plan = buildPlanDetail(program, c.req.param('planKey'))
        if (!plan) {
            return c.json({ error: 'Plan not found' }, 404)
        }

        const runtime = resolvePlanRuntime(options.store, namespace, program.id, {
            planKey: plan.planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            planTitle: plan.planTitle,
            summary: plan.summary,
            checklistTotal: plan.checklist.length,
            checklistDone: plan.checklist.filter((item) => item.checked).length,
            checklistOpen: plan.checklist.filter((item) => !item.checked).length,
            firstOpenItem: plan.checklist.find((item) => !item.checked)?.text ?? null,
            lastModifiedAt: plan.lastModifiedAt
        })

        if (runtime.column !== 'Review' && !runtime.reviewRequired) {
            return c.json({ error: 'Plan is not currently awaiting review.', runtime }, 409)
        }

        const nextRuntime = options.store.omcRuntime.upsertPlanRuntime(namespace, {
            programId: program.id,
            planKey: plan.planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: runtime.currentLoopRunId,
            currentWorktreePath: runtime.currentWorktreePath,
            currentBranch: runtime.currentBranch,
            targetBranch: runtime.targetBranch ?? program.targetBranch ?? null,
            attemptCount: runtime.attemptCount,
            consecutiveFailureCount: runtime.consecutiveFailureCount,
            lastFailureFingerprint: runtime.lastFailureFingerprint,
            reviewRequired: false,
            reviewApprovedAt: runtime.reviewApprovedAt ?? Date.now(),
            mergeStatus: runtime.mergeStatus === 'merged' ? 'merged' : 'ready',
            mergeBlockedReason: null,
            lastMergeAttemptAt: runtime.lastMergeAttemptAt ?? null,
            mergeApprovedAt: runtime.mergeApprovedAt ?? null,
            latestEvidenceSummary: 'Human review approved. Merge is ready for the next step.',
            lastAttemptAt: runtime.lastAttemptAt ?? null,
            updatedAt: Date.now()
        })

        emitReviewAndMergeState(namespace, nextRuntime)

        return c.json({
            programId: program.id,
            planKey: plan.planKey,
            runtime: nextRuntime,
            attempt: options.store.omcRuntime.listAttempts(program.id, plan.planKey, namespace)[0] ?? null
        })
    })

    app.post('/omc/programs/:programId/plans/:planKey/review/reopen', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const plan = buildPlanDetail(program, c.req.param('planKey'))
        if (!plan) {
            return c.json({ error: 'Plan not found' }, 404)
        }

        const payload = await c.req.json().catch(() => null)
        const parsed = OmcReviewReopenRequestSchema.safeParse(payload)
        if (!parsed.success) {
            return c.json({ error: 'Invalid review reopen action.' }, 400)
        }

        const runtime = resolvePlanRuntime(options.store, namespace, program.id, {
            planKey: plan.planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            planTitle: plan.planTitle,
            summary: plan.summary,
            checklistTotal: plan.checklist.length,
            checklistDone: plan.checklist.filter((item) => item.checked).length,
            checklistOpen: plan.checklist.filter((item) => !item.checked).length,
            firstOpenItem: plan.checklist.find((item) => !item.checked)?.text ?? null,
            lastModifiedAt: plan.lastModifiedAt
        })

        if (parsed.data.action === 'resume_loop') {
            const controller = requireController(namespace)
            if (!controller) {
                return c.json({ error: 'Sync engine is not available for OMC resume.' }, 503)
            }

            try {
                const result = await controller.resumePlan(program, plan.planKey)
                const normalizedRuntime = options.store.omcRuntime.upsertPlanRuntime(namespace, {
                    programId: program.id,
                    planKey: plan.planKey,
                    planPath: plan.planPath,
                    phaseKey: plan.phaseKey,
                    phaseLabel: plan.phaseLabel,
                    column: result.runtime.column,
                    loopStatus: result.runtime.loopStatus,
                    currentLoopRunId: result.runtime.currentLoopRunId,
                    currentWorktreePath: result.runtime.currentWorktreePath,
                    currentBranch: result.runtime.currentBranch,
                    targetBranch: result.runtime.targetBranch,
                    attemptCount: result.runtime.attemptCount,
                    consecutiveFailureCount: result.runtime.consecutiveFailureCount,
                    lastFailureFingerprint: result.runtime.lastFailureFingerprint,
                    reviewRequired: false,
                    reviewApprovedAt: null,
                    mergeStatus: 'idle',
                    mergeBlockedReason: null,
                    lastMergeAttemptAt: null,
                    mergeApprovedAt: null,
                    doneAt: result.runtime.doneAt ?? null,
                    latestEvidenceSummary: result.runtime.latestEvidenceSummary ?? 'Review reopened and loop resumed.',
                    lastAttemptAt: result.runtime.lastAttemptAt ?? null,
                    updatedAt: Date.now()
                })

                emitReviewAndMergeState(namespace, normalizedRuntime)

                return c.json({
                    ...result,
                    runtime: normalizedRuntime
                })
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to reopen review into the loop'
                return c.json({ error: message }, 500)
            }
        }

        const nextRuntime = options.store.omcRuntime.upsertPlanRuntime(namespace, {
            programId: program.id,
            planKey: plan.planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            column: 'Planning',
            loopStatus: 'idle',
            currentLoopRunId: runtime.currentLoopRunId,
            currentWorktreePath: runtime.currentWorktreePath,
            currentBranch: runtime.currentBranch,
            targetBranch: runtime.targetBranch ?? program.targetBranch ?? null,
            attemptCount: runtime.attemptCount,
            consecutiveFailureCount: runtime.consecutiveFailureCount,
            lastFailureFingerprint: runtime.lastFailureFingerprint,
            reviewRequired: false,
            reviewApprovedAt: null,
            mergeStatus: 'idle',
            mergeBlockedReason: null,
            lastMergeAttemptAt: null,
            mergeApprovedAt: null,
            doneAt: null,
            latestEvidenceSummary: 'Returned to planning for human revision.',
            lastAttemptAt: runtime.lastAttemptAt ?? null,
            updatedAt: Date.now()
        })

        emitReviewAndMergeState(namespace, nextRuntime)

        return c.json({
            programId: program.id,
            planKey: plan.planKey,
            runtime: nextRuntime,
            attempt: options.store.omcRuntime.listAttempts(program.id, plan.planKey, namespace)[0] ?? null
        })
    })

    app.post('/omc/programs/:programId/plans/:planKey/merge/approve', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const plan = buildPlanDetail(program, c.req.param('planKey'))
        if (!plan) {
            return c.json({ error: 'Plan not found' }, 404)
        }

        const controller = requireReviewController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for OMC merge approval.' }, 503)
        }

        try {
            return c.json(await controller.approveMerge({
                program,
                plan
            }))
        } catch (error) {
            if (error instanceof OmcReviewControllerPreconditionError) {
                return c.json({
                    error: error.message,
                    runtime: error.runtime
                }, 409)
            }

            const message = error instanceof Error ? error.message : 'Failed to approve OMC merge'
            return c.json({ error: message }, 500)
        }
    })

    app.post('/omc/programs/:programId/plans/:planKey/start', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const plan = buildPlanDetail(program, c.req.param('planKey'))
        if (!plan) {
            return c.json({ error: 'Plan not found' }, 404)
        }

        const runtime = resolvePlanRuntime(options.store, namespace, program.id, {
            planKey: plan.planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            planTitle: plan.planTitle,
            summary: plan.summary,
            checklistTotal: plan.checklist.length,
            checklistDone: plan.checklist.filter((item) => item.checked).length,
            checklistOpen: plan.checklist.filter((item) => !item.checked).length,
            firstOpenItem: plan.checklist.find((item) => !item.checked)?.text ?? null,
            lastModifiedAt: plan.lastModifiedAt
        })

        if (runtime.loopStatus === 'running') {
            return c.json({ error: 'This plan already has a running loop.', runtime }, 409)
        }

        const controller = requireController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for OMC starts.' }, 503)
        }

        try {
            const result = await controller.startPlan({
                program,
                plan,
                runtime
            })

            if (!result.attempt) {
                return c.json({ error: 'Attempt did not start correctly.' }, 500)
            }

            return c.json({
                programId: program.id,
                planKey: plan.planKey,
                runtime: result.runtime,
                attempt: result.attempt,
                evidence: result.evidence
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start OMC plan attempt'
            return c.json({ error: message }, 500)
        }
    })

    app.post('/omc/programs/:programId/plans/:planKey/retry', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const controller = requireController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for OMC retry.' }, 503)
        }

        try {
            return c.json(await controller.retryPlan(program, c.req.param('planKey')))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to retry plan loop'
            return c.json({ error: message }, 500)
        }
    })

    app.post('/omc/programs/:programId/plans/:planKey/resume', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const controller = requireController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for OMC resume.' }, 503)
        }

        try {
            return c.json(await controller.resumePlan(program, c.req.param('planKey')))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to resume plan loop'
            return c.json({ error: message }, 500)
        }
    })

    app.post('/omc/programs/:programId/plans/:planKey/takeover', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const controller = requireController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for OMC takeover.' }, 503)
        }

        try {
            return c.json(await controller.takeoverPlan(program, c.req.param('planKey')))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to prepare takeover session'
            return c.json({ error: message }, 500)
        }
    })

    app.post('/omc/programs/:programId/plans/:planKey/cancel', async (c) => {
        const namespace = c.get('namespace')
        const program = requireProgram(options.store, namespace, c.req.param('programId'))
        if (!program) {
            return c.json({ error: 'Program not found' }, 404)
        }

        const controller = requireController(namespace)
        if (!controller) {
            return c.json({ error: 'Sync engine is not available for OMC cancel.' }, 503)
        }

        try {
            return c.json(await controller.cancelPlan(program, c.req.param('planKey')))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to cancel loop'
            return c.json({ error: message }, 500)
        }
    })

    app.get('/omc/attempts/:attemptId', (c) => {
        const namespace = c.get('namespace')
        const attempt = options.store.omcRuntime.getAttemptByNamespace(c.req.param('attemptId'), namespace)
        if (!attempt) {
            return c.json({ error: 'Attempt not found' }, 404)
        }

        return c.json({
            attempt,
            evidence: options.store.omcRuntime.listEvidenceForAttempt(attempt.id, namespace)
        })
    })

    return app
}
