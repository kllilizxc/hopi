import { isObject } from '@hopi/protocol'
import type {
    OmcAttempt,
    OmcDirectiveLedgerEntry,
    OmcPlanRuntime,
    OmcPlanSummary,
    OmcProgram,
    OmcReviewVerdict,
    OmcWorkAttempt,
    OmcWorkOrder,
    SyncEvent,
} from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildOmcWorkOrderUpdatedEvent } from './events'
import { OmcLoopController } from './loopController'
import { OmcManagerController } from './manager'
import { buildPlanDetail, buildPlanningIndex } from './planningIndex'

type ProgramKey = `${string}:${string}`

function toProgramKey(namespace: string, programId: string): ProgramKey {
    return `${namespace}:${programId}`
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
        updatedAt: done ? plan.lastModifiedAt : Date.now()
    }
}

function isPlanDone(plan: OmcPlanSummary | null | undefined, runtime: OmcPlanRuntime | null | undefined): boolean {
    if (!plan) {
        return false
    }

    if (runtime?.mergeStatus === 'merged' || runtime?.column === 'Done' || Boolean(runtime?.doneAt)) {
        return true
    }

    return plan.checklistTotal > 0 && plan.checklistOpen === 0
}

function isPlanNotStarted(runtime: OmcPlanRuntime | null | undefined): boolean {
    if (!runtime) {
        return true
    }

    return runtime.column === 'Planning'
        && runtime.loopStatus === 'idle'
        && runtime.attemptCount === 0
        && !runtime.reviewRequired
        && runtime.mergeStatus === 'idle'
        && !runtime.doneAt
        && !runtime.lastAttemptAt
}

export class OmcExecutionAutomation {
    private readonly controllers = new Map<string, OmcLoopController>()
    private readonly managers = new Map<string, OmcManagerController>()
    private readonly tickTimers = new Map<ProgramKey, NodeJS.Timeout>()
    private readonly runningTicks = new Set<ProgramKey>()
    private readonly pendingTicks = new Set<ProgramKey>()

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine
    ) {}

    private getController(namespace: string): OmcLoopController {
        const existing = this.controllers.get(namespace)
        if (existing) {
            return existing
        }

        const controller = new OmcLoopController({
            store: this.store,
            engine: this.engine,
            namespace
        })
        this.controllers.set(namespace, controller)
        return controller
    }

    private getManager(namespace: string): OmcManagerController {
        const existing = this.managers.get(namespace)
        if (existing) {
            return existing
        }

        const manager = new OmcManagerController({
            store: this.store,
            engine: this.engine,
            namespace
        })
        this.managers.set(namespace, manager)
        return manager
    }

    private emitWorkOrderUpdated(workOrder: OmcWorkOrder, namespace: string): void {
        this.engine.handleRealtimeEvent(buildOmcWorkOrderUpdatedEvent(workOrder, namespace))
    }

    private getLatestDirective(programId: string, workOrder: OmcWorkOrder, namespace: string): OmcDirectiveLedgerEntry | null {
        return this.store.omcRuntime.listDirectiveLedgerEntries(programId, namespace)
            .filter((directive) =>
                (directive.scopeType === 'work_order' && directive.scopeId === workOrder.id)
                || (directive.scopeType === 'plan' && workOrder.planKey && directive.scopeId === workOrder.planKey)
            )
            .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))[0]
            ?? null
    }

    private ensureWorkOrders(program: OmcProgram): Map<string, OmcWorkOrder> {
        const index = buildPlanningIndex(program)
        const runtimeByPlanKey = new Map(
            this.store.omcRuntime.listPlanRuntimes(program.id, program.namespace)
                .map((runtime) => [runtime.planKey, runtime] as const)
        )
        const existingWorkOrders = this.store.omcRuntime.listWorkOrders(program.id, program.namespace)
        const workOrderByPlanKey = new Map(
            existingWorkOrders
                .filter((workOrder) => Boolean(workOrder.planKey))
                .map((workOrder) => [workOrder.planKey as string, workOrder] as const)
        )

        for (const phase of index.phases) {
            for (const plan of phase.plans) {
                const runtime = runtimeByPlanKey.get(plan.planKey) ?? null
                const current = workOrderByPlanKey.get(plan.planKey) ?? null
                const defaultStatus: OmcWorkOrder['status'] = isPlanDone(plan, runtime)
                    ? 'done'
                    : runtime?.loopStatus === 'running'
                        ? 'in_progress'
                        : runtime?.reviewRequired
                            ? 'waiting_user'
                            : runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict'
                                ? 'blocked'
                                : 'ready'
                const nextOwner: OmcWorkOrder['owner'] = current?.owner !== undefined
                    ? current.owner
                    : defaultStatus === 'in_progress'
                        ? 'driver'
                        : null
                const shouldUpsert = !current
                    || current.goalId !== phase.phaseKey
                    || current.planKey !== plan.planKey
                    || current.title !== plan.planTitle
                    || (isPlanDone(plan, runtime) && current.status !== 'done')
                    || (!current.currentAttemptId && runtime?.loopStatus === 'running' && current.status !== 'in_progress')

                if (!shouldUpsert) {
                    continue
                }

                const workOrder = this.store.omcRuntime.upsertWorkOrder(program.namespace, {
                    id: current?.id ?? plan.planKey,
                    programId: program.id,
                    goalId: phase.phaseKey,
                    planKey: plan.planKey,
                    title: plan.planTitle,
                    owner: isPlanDone(plan, runtime)
                        ? null
                        : (!current?.currentAttemptId && runtime?.loopStatus === 'running')
                            ? 'driver'
                            : nextOwner,
                    status: isPlanDone(plan, runtime)
                        ? 'done'
                        : (!current?.currentAttemptId && runtime?.loopStatus === 'running')
                            ? 'in_progress'
                            : current?.status ?? defaultStatus,
                    blockedReason: current?.blockedReason ?? runtime?.mergeBlockedReason ?? null,
                    latestAcceptedAttemptId: current?.latestAcceptedAttemptId ?? null,
                    reviewerVerdict: current?.reviewerVerdict ?? null,
                    currentAttemptId: current?.currentAttemptId ?? null,
                    createdAt: current?.createdAt,
                    updatedAt: current?.updatedAt,
                })
                this.emitWorkOrderUpdated(workOrder, program.namespace)
                workOrderByPlanKey.set(plan.planKey, workOrder)
            }
        }

        return workOrderByPlanKey
    }

    private buildAssignmentBody(plan: OmcPlanSummary, workOrder: OmcWorkOrder, namespace: string): string {
        const directive = this.getLatestDirective(workOrder.programId, workOrder, namespace)
        if (!directive) {
            return plan.summary
        }

        return `${plan.summary}\n\n最新用户指令：${directive.summary}`
    }

    private getLatestPlanAttempt(programId: string, planKey: string, namespace: string): OmcAttempt | null {
        return this.store.omcRuntime.listAttempts(programId, planKey, namespace)[0] ?? null
    }

    private getLatestWorkAttemptByRole(
        programId: string,
        workOrderId: string,
        role: OmcWorkAttempt['role'],
        namespace: string
    ): OmcWorkAttempt | null {
        return this.store.omcRuntime.listWorkAttempts(programId, workOrderId, namespace)
            .find((attempt) => attempt.role === role)
            ?? null
    }

    private classifyReviewerVerdict(runtime: OmcPlanRuntime | null, attempt: OmcAttempt): {
        verdict: OmcReviewVerdict
        body: string
    } | null {
        if (attempt.status === 'failed' || attempt.status === 'canceled') {
            return {
                verdict: 'revision_needed',
                body: attempt.summary?.trim()
                    ? `这一轮还没有稳定收口，建议继续修改后再来一轮。${attempt.summary.trim()}`
                    : '这一轮还没有稳定收口，建议继续修改后再来一轮。'
            }
        }

        if (attempt.status === 'blocked') {
            return {
                verdict: 'needs_user',
                body: runtime?.mergeBlockedReason
                    ?? attempt.summary
                    ?? '这一轮遇到了需要你确认的边界，先等你的决定。'
            }
        }

        if (attempt.status === 'progressed' || attempt.status === 'completed') {
            return {
                verdict: 'accepted',
                body: attempt.summary
                    ?? runtime?.latestEvidenceSummary
                    ?? '这一轮已经满足当前卡的验收边界，可以继续下一张卡。'
            }
        }

        return null
    }

    private async reconcileFinishedWorkOrder(program: OmcProgram, workOrder: OmcWorkOrder): Promise<OmcWorkOrder> {
        if (!workOrder.planKey) {
            return workOrder
        }

        const runtime = this.store.omcRuntime.getPlanRuntime(program.id, workOrder.planKey, program.namespace)
        const latestPlanAttempt = this.getLatestPlanAttempt(program.id, workOrder.planKey, program.namespace)
        if (!latestPlanAttempt || latestPlanAttempt.status === 'running' || !latestPlanAttempt.completedAt) {
            return workOrder
        }

        const reviewerDecision = this.classifyReviewerVerdict(runtime, latestPlanAttempt)
        if (!reviewerDecision) {
            return workOrder
        }

        const driverAttempt = workOrder.currentAttemptId
            ? this.store.omcRuntime.getWorkAttemptByNamespace(workOrder.currentAttemptId, program.namespace)
            : this.getLatestWorkAttemptByRole(program.id, workOrder.id, 'driver', program.namespace)
        if (!driverAttempt) {
            return workOrder
        }

        if (driverAttempt.status === 'running') {
            const updatedDriverAttempt = this.store.omcRuntime.updateWorkAttempt(program.namespace, driverAttempt.id, {
                status: latestPlanAttempt.status === 'failed' || latestPlanAttempt.status === 'canceled'
                    ? 'failed'
                    : 'closing',
                summary: latestPlanAttempt.summary ?? driverAttempt.summary,
                completedAt: latestPlanAttempt.completedAt ?? Date.now(),
            })
            if (!updatedDriverAttempt) {
                return workOrder
            }
        }

        let reviewAttempt = this.getLatestWorkAttemptByRole(program.id, workOrder.id, 'reviewer', program.namespace)
        if (!reviewAttempt || reviewAttempt.status !== 'reviewing') {
            reviewAttempt = this.getManager(program.namespace).requestReview(program.id, {
                workOrderId: workOrder.id,
                driverAttemptId: driverAttempt.id,
                body: latestPlanAttempt.summary
                    ?? runtime?.latestEvidenceSummary
                    ?? `请验收 ${workOrder.title} 这一轮的结果。`,
            }).reviewAttempt
        }

        return this.getManager(program.namespace).submitReviewVerdict(program.id, {
            workOrderId: workOrder.id,
            reviewAttemptId: reviewAttempt.id,
            verdict: reviewerDecision.verdict,
            body: reviewerDecision.body,
        }).workOrder
    }

    requestTick(namespace: string, programId: string, options?: { delayMs?: number }): void {
        const delayMs = options?.delayMs ?? 250
        const key = toProgramKey(namespace, programId)

        if (this.runningTicks.has(key)) {
            this.pendingTicks.add(key)
            return
        }

        if (this.tickTimers.has(key)) {
            return
        }

        const timer = setTimeout(() => {
            this.tickTimers.delete(key)
            void this.tickProgram(namespace, programId)
        }, delayMs)

        this.tickTimers.set(key, timer)
    }

    handleEvent(event: SyncEvent): void {
        if (!event.namespace) {
            return
        }

        if (
            (event.type === 'omc-program-updated'
                || event.type === 'omc-guided-planning-updated'
                || event.type === 'omc-plan-runtime-updated'
                || event.type === 'omc-merge-updated'
                || event.type === 'omc-work-order-updated'
                || event.type === 'omc-mailbox-message-added'
                || event.type === 'omc-directive-ledger-updated')
            && event.programId
        ) {
            this.requestTick(event.namespace, event.programId)
            return
        }

        if (event.type === 'machine-updated' && isObject(event.data) && event.data.active === true) {
            const programs = this.store.omcRuntime.listProgramsByNamespace(event.namespace)
            for (const program of programs) {
                this.requestTick(event.namespace, program.id)
            }
        }
    }

    async reconcileProgram(program: OmcProgram): Promise<boolean> {
        if (this.store.omcRuntime.getActivePlanningRun(program.id, program.namespace)) {
            return false
        }

        if (this.engine.getOnlineMachinesByNamespace(program.namespace).length === 0) {
            return false
        }

        const storedRuntimes = this.store.omcRuntime.listPlanRuntimes(program.id, program.namespace)
        if (storedRuntimes.some((runtime) => runtime.loopStatus === 'running')) {
            return false
        }

        const index = buildPlanningIndex(program)
        const plans = index.phases.flatMap((phase) => phase.plans)
        if (plans.length === 0) {
            return false
        }

        const seededWorkOrders = this.ensureWorkOrders(program)
        for (const workOrder of seededWorkOrders.values()) {
            if (workOrder.status === 'in_progress' || workOrder.status === 'in_review') {
                await this.reconcileFinishedWorkOrder(program, workOrder)
            }
        }

        const workOrderByPlanKey = new Map(
            this.store.omcRuntime.listWorkOrders(program.id, program.namespace)
                .filter((workOrder) => Boolean(workOrder.planKey))
                .map((workOrder) => [workOrder.planKey as string, workOrder] as const)
        )
        const planByKey = new Map(plans.map((plan) => [plan.planKey, plan] as const))
        const runtimeByPlanKey = new Map(storedRuntimes.map((runtime) => [runtime.planKey, runtime] as const))
        const activeWorkOrder = [...workOrderByPlanKey.values()].find((workOrder) => workOrder.status === 'in_progress')
        if (activeWorkOrder) {
            return false
        }

        for (const plan of plans) {
            const runtime = runtimeByPlanKey.get(plan.planKey) ?? null
            const workOrder = workOrderByPlanKey.get(plan.planKey) ?? null
            if (!workOrder || workOrder.status !== 'ready' || !isPlanNotStarted(runtime)) {
                continue
            }

            const dependenciesReady = (plan.dependsOn ?? []).every((dependencyKey) => (
                workOrderByPlanKey.get(dependencyKey)?.status === 'done'
                || isPlanDone(planByKey.get(dependencyKey), runtimeByPlanKey.get(dependencyKey))
            ))
            if (!dependenciesReady) {
                continue
            }

            const detail = buildPlanDetail(program, plan.planKey)
            if (!detail) {
                continue
            }

            try {
                const result = await this.getController(program.namespace).startPlan({
                    program,
                    plan: detail,
                    runtime: runtime ?? buildDefaultRuntime(program.id, plan)
                })
                if (result.attempt?.status !== 'running' || !result.attempt.sessionId) {
                    const blocked = this.store.omcRuntime.updateWorkOrder(program.namespace, workOrder.id, {
                        owner: null,
                        status: 'blocked',
                        blockedReason: result.attempt?.summary
                            ?? result.runtime.latestEvidenceSummary
                            ?? 'Driver launch failed before a live session became available.',
                        updatedAt: Date.now(),
                    })
                    if (blocked) {
                        this.emitWorkOrderUpdated(blocked, program.namespace)
                    }
                    return false
                }

                this.getManager(program.namespace).assignWorkOrderToDriver(program.id, {
                    workOrderId: workOrder.id,
                    body: this.buildAssignmentBody(plan, workOrder, program.namespace),
                    sessionId: result.attempt.sessionId,
                })
                return true
            } catch (error) {
                console.error(
                    `[OmcExecutionAutomation] Failed to auto-start ${program.name} ${plan.planKey}:`,
                    error
                )
                return false
            }
        }

        return false
    }

    async reconcileAllPrograms(): Promise<void> {
        const programs = this.store.omcRuntime.listPrograms()
        for (const program of programs) {
            await this.reconcileProgram(program)
        }
    }

    private async tickProgram(namespace: string, programId: string): Promise<void> {
        const key = toProgramKey(namespace, programId)
        if (this.runningTicks.has(key)) {
            return
        }

        this.runningTicks.add(key)

        try {
            const program = this.store.omcRuntime.getProgramByNamespace(programId, namespace)
            if (!program) {
                return
            }

            await this.reconcileProgram(program)
        } finally {
            this.runningTicks.delete(key)
            if (this.pendingTicks.has(key)) {
                this.pendingTicks.delete(key)
                this.requestTick(namespace, programId, { delayMs: 0 })
            }
        }
    }
}
