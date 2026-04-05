import { randomUUID } from 'node:crypto'
import type {
    OmcGuidedPlanningBrief,
    OmcGuidedPlanningControlResponse,
    OmcGuidedPlanningRun,
    OmcProgram,
    OmcProgramPlanningState
} from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildOmcGuidedPlanningUpdatedEvent, buildOmcProgramUpdatedEvent } from './events'
import { buildPlanningIndex } from './planningIndex'
import { buildOmcGuidedPlanningPrompt } from './planningPromptBuilder'
import { inspectOmcPlanningRoot } from './programBootstrap'
import {
    createDefaultOmcPlanningRuntimeAdapter,
    type OmcPlanningRuntimeAdapter
} from './planningRuntimeAdapter'

export type OmcGuidedPlanningSignal = {
    status: 'completed' | 'failed'
    summary: string
    error?: string | null
    generatedPlanPaths?: string[]
}

function buildPlanningStatus(program: OmcProgram): OmcProgramPlanningState {
    const inspection = inspectOmcPlanningRoot(program.planningRoot)
    return {
        status: inspection.hasPlanning ? 'detected' : 'missing',
        planningRoot: inspection.planningRoot,
        hasPlanning: inspection.hasPlanning,
        hasPlans: inspection.hasPlans,
        phaseCount: inspection.phaseCount,
        planCount: inspection.planCount,
        seedFiles: []
    }
}

function collectGeneratedPlanPaths(program: OmcProgram): string[] {
    const index = buildPlanningIndex(program)
    return index.phases.flatMap((phase) => phase.plans.map((plan) => plan.planPath))
}

function uniquePlanPaths(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function isTerminal(status: OmcGuidedPlanningRun['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'canceled'
}

export class OmcPlanningRunController {
    private readonly adapter: OmcPlanningRuntimeAdapter

    constructor(private readonly options: {
        store: Store
        engine: SyncEngine
        namespace: string
        adapter?: OmcPlanningRuntimeAdapter
    }) {
        this.adapter = options.adapter ?? createDefaultOmcPlanningRuntimeAdapter()
    }

    private emitRunUpdated(program: OmcProgram, run: OmcGuidedPlanningRun): void {
        this.options.engine.handleRealtimeEvent(
            buildOmcGuidedPlanningUpdatedEvent(run, buildPlanningStatus(program), this.options.namespace)
        )
    }

    private buildControlResponse(program: OmcProgram, run: OmcGuidedPlanningRun): OmcGuidedPlanningControlResponse {
        return {
            programId: program.id,
            planning: buildPlanningStatus(program),
            run
        }
    }

    private resolveLatestRun(programId: string): OmcGuidedPlanningRun | null {
        return this.options.store.omcRuntime.getLatestPlanningRun(programId, this.options.namespace)
    }

    private resolveActiveRun(programId: string): OmcGuidedPlanningRun | null {
        return this.options.store.omcRuntime.getActivePlanningRun(programId, this.options.namespace)
    }

    private failRun(program: OmcProgram, runId: string, summary: string, error?: string | null): OmcGuidedPlanningRun {
        const updated = this.options.store.omcRuntime.updatePlanningRun(this.options.namespace, runId, {
            status: 'failed',
            summary,
            error: error ?? summary,
            completedAt: Date.now()
        })
        if (!updated) {
            throw new Error('Guided planning run no longer exists.')
        }
        this.emitRunUpdated(program, updated)
        return updated
    }

    private completeRun(program: OmcProgram, runId: string, summary: string, extraPaths: string[] = []): OmcGuidedPlanningRun {
        const generatedPlanPaths = uniquePlanPaths([
            ...collectGeneratedPlanPaths(program),
            ...extraPaths
        ])
        const updated = this.options.store.omcRuntime.updatePlanningRun(this.options.namespace, runId, {
            status: 'completed',
            stage: 'handoff',
            summary,
            error: null,
            generatedPlanPaths,
            completedAt: Date.now()
        })
        if (!updated) {
            throw new Error('Guided planning run no longer exists.')
        }
        this.emitRunUpdated(program, updated)
        return updated
    }

    reconcileRun(program: OmcProgram): OmcGuidedPlanningRun | null {
        const active = this.resolveActiveRun(program.id)
        if (!active || isTerminal(active.status)) {
            return this.resolveLatestRun(program.id)
        }

        const planning = buildPlanningStatus(program)
        if (planning.hasPlans) {
            return this.completeRun(
                program,
                active.id,
                active.summary?.trim() || `Detected ${planning.planCount} executable planning card(s).`
            )
        }

        if (active.stage === 'discuss' && active.sessionId) {
            const session = this.options.engine.getSessionByNamespace(active.sessionId, this.options.namespace)
            if (session) {
                const updated = this.options.store.omcRuntime.updatePlanningRun(this.options.namespace, active.id, {
                    stage: 'plan',
                    summary: 'Guided planning is actively drafting the first executable plan cards.'
                })
                if (updated) {
                    this.emitRunUpdated(program, updated)
                    return updated
                }
            }
        }

        return active
    }

    async startPlanning(program: OmcProgram, brief: OmcGuidedPlanningBrief): Promise<OmcGuidedPlanningControlResponse> {
        const planning = buildPlanningStatus(program)
        if (!planning.hasPlanning) {
            throw new Error('This program does not have a planning scaffold yet.')
        }
        if (planning.hasPlans) {
            throw new Error('This program already has executable PLAN cards.')
        }
        if (this.resolveActiveRun(program.id)) {
            throw new Error('Guided planning is already running for this program.')
        }

        const created = this.options.store.omcRuntime.addPlanningRun(this.options.namespace, {
            id: randomUUID(),
            programId: program.id,
            status: 'queued',
            stage: 'brief',
            brief,
            summary: 'Preparing guided planning runtime.'
        })
        this.emitRunUpdated(program, created)

        let launch
        try {
            launch = await this.adapter.startPlanningSession({
                engine: this.options.engine,
                namespace: this.options.namespace,
                program
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failed = this.failRun(
                program,
                created.id,
                'Guided planning could not start a runtime session.',
                message
            )
            return this.buildControlResponse(program, failed)
        }

        const persistedProgram = program.machineId === launch.machineId
            ? program
            : this.options.store.omcRuntime.upsertProgram({
                id: program.id,
                namespace: this.options.namespace,
                machineId: launch.machineId,
                name: program.name,
                repoRoot: program.repoRoot,
                planningRoot: program.planningRoot,
                primaryBranch: program.primaryBranch ?? null,
                targetBranch: program.targetBranch ?? null
            })

        if (persistedProgram.machineId !== program.machineId) {
            this.options.engine.handleRealtimeEvent(buildOmcProgramUpdatedEvent(persistedProgram))
        }

        const promptText = buildOmcGuidedPlanningPrompt({
            program: persistedProgram,
            brief
        })

        const running = this.options.store.omcRuntime.updatePlanningRun(this.options.namespace, created.id, {
            status: 'running',
            stage: 'discuss',
            sessionId: launch.sessionId,
            summary: launch.sessionConfigError
                ? `Guided planning session is starting. Session config warning: ${launch.sessionConfigError}`
                : 'Guided planning session is starting from the planning seed and preparing the first phase plans.'
        })

        if (!running) {
            throw new Error('Guided planning run disappeared before prompt dispatch.')
        }

        this.emitRunUpdated(persistedProgram, running)

        try {
            await this.adapter.dispatchPrompt({
                engine: this.options.engine,
                sessionId: launch.sessionId,
                promptText
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failed = this.failRun(
                persistedProgram,
                running.id,
                'Guided planning failed before the prompt reached the runtime session.',
                message
            )
            return this.buildControlResponse(persistedProgram, failed)
        }

        const reconciled = this.reconcileRun(persistedProgram) ?? running
        return this.buildControlResponse(persistedProgram, reconciled)
    }

    async retryPlanning(program: OmcProgram): Promise<OmcGuidedPlanningControlResponse> {
        if (this.resolveActiveRun(program.id)) {
            throw new Error('Guided planning is already running for this program.')
        }

        const latest = this.resolveLatestRun(program.id)
        if (!latest) {
            throw new Error('There is no previous guided planning brief to retry.')
        }

        return await this.startPlanning(program, latest.brief)
    }

    async cancelPlanning(program: OmcProgram): Promise<OmcGuidedPlanningControlResponse> {
        const active = this.resolveActiveRun(program.id)
        if (!active) {
            throw new Error('No guided planning run is currently active.')
        }

        if (active.sessionId) {
            try {
                await this.options.engine.abortSession(active.sessionId)
            } catch {
            }
        }

        const updated = this.options.store.omcRuntime.updatePlanningRun(this.options.namespace, active.id, {
            status: 'canceled',
            summary: 'Guided planning was canceled from the OMC control plane.',
            error: null,
            completedAt: Date.now()
        })

        if (!updated) {
            throw new Error('Guided planning run no longer exists.')
        }

        this.emitRunUpdated(program, updated)
        return this.buildControlResponse(program, updated)
    }

    async handleRunMessage(options: {
        program: OmcProgram
        runId: string
        signal?: OmcGuidedPlanningSignal | null
        summaryText?: string | null
    }): Promise<OmcGuidedPlanningRun | null> {
        const run = this.options.store.omcRuntime.getPlanningRunByNamespace(options.runId, this.options.namespace)
        if (!run || isTerminal(run.status)) {
            return run
        }

        const planning = buildPlanningStatus(options.program)
        if (planning.hasPlans) {
            return this.completeRun(
                options.program,
                run.id,
                options.signal?.summary ?? options.summaryText ?? `Detected ${planning.planCount} executable planning card(s).`,
                options.signal?.generatedPlanPaths ?? []
            )
        }

        if (options.signal?.status === 'failed') {
            return this.failRun(
                options.program,
                run.id,
                options.signal.summary,
                options.signal.error ?? options.signal.summary
            )
        }

        if (options.signal?.status === 'completed') {
            return this.failRun(
                options.program,
                run.id,
                'Guided planning reported completion, but no executable PLAN cards were created.',
                options.signal.error ?? options.signal.summary
            )
        }

        if (run.stage !== 'plan') {
            const updated = this.options.store.omcRuntime.updatePlanningRun(this.options.namespace, run.id, {
                stage: 'plan',
                summary: options.summaryText?.trim() || 'Guided planning is drafting the first executable plan cards.'
            })
            if (updated) {
                this.emitRunUpdated(options.program, updated)
                return updated
            }
        }

        return run
    }

    async handleRunStopped(options: {
        program: OmcProgram
        runId: string
        summary: string
        error?: string | null
    }): Promise<OmcGuidedPlanningRun | null> {
        const run = this.options.store.omcRuntime.getPlanningRunByNamespace(options.runId, this.options.namespace)
        if (!run || isTerminal(run.status)) {
            return run
        }

        const planning = buildPlanningStatus(options.program)
        if (planning.hasPlans) {
            return this.completeRun(
                options.program,
                run.id,
                `Guided planning stopped after executable PLAN cards appeared. ${options.summary}`
            )
        }

        return this.failRun(
            options.program,
            run.id,
            options.summary,
            options.error ?? options.summary
        )
    }
}
