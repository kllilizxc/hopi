import type { OmcPlanRuntime, OmcPlanSummary, OmcProgram, OmcProgramSummary } from '@hopi/protocol/types'
import { Hono } from 'hono'
import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { startOmcPlanAttempt } from '../../sync/omc/attemptRunner'
import { buildPlanDetail, buildPlanningIndex } from '../../sync/omc/planningIndex'
import { resolveOmcPlanningRoot } from '../../sync/omc/programPaths'
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

export function createOmcRoutes(options: {
    store: Store
    getSyncEngine?: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

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
            program: buildProgramSummary(options.store, program, namespace)
        })
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

        const engine = options.getSyncEngine?.() ?? null
        if (!engine) {
            return c.json({ error: 'Sync engine is not available for OMC starts.' }, 503)
        }

        try {
            const result = await startOmcPlanAttempt({
                store: options.store,
                engine,
                namespace,
                program,
                plan,
                runtime
            })

            return c.json({
                programId: result.program.id,
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
