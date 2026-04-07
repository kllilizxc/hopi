import type {
    OmcAttempt,
    OmcEvidence,
    OmcGuidedPlanningRun,
    OmcPlanDetailResponse,
    OmcPlanRuntime,
    OmcPlanningIndexResponse,
    OmcProgramOverviewResponse,
} from '@hopi/protocol/types'
import type {
    AgentEvent,
    DecisionTopic,
    PrototypeApprovalBatch,
    PrototypeApprovalItem,
    PrototypeCheckpoint,
    PrototypeCheckpointId,
    PrototypeDigest,
    PrototypeGoal,
    PrototypeGoalPriority,
    PrototypeGoalStatus,
    PrototypePhase,
    PrototypePlanCard,
    PrototypePlanColumn,
    PrototypeProgram,
    PrototypeRisk,
    PrototypeRiskSeverity,
    PrototypeScenarioSnapshot,
    PrototypeStream,
    PrototypeStreamStatus,
    PrototypeStrategySnapshot,
    PrototypeTimeWindow,
    WorldModel,
    WorkOrder,
    WorkOrderState,
} from './types'

type OmcProjectionInput = {
    overview: OmcProgramOverviewResponse
    index: OmcPlanningIndexResponse
    runtimes: OmcPlanRuntime[]
    planningRun?: OmcGuidedPlanningRun | null
    details?: Record<string, OmcPlanDetailResponse>
}

type IndexedPlan = OmcPlanningIndexResponse['phases'][number]['plans'][number]

type IndexedPhase = OmcPlanningIndexResponse['phases'][number]

type PlanBundle = {
    plan: IndexedPlan
    phase: IndexedPhase
    runtime: OmcPlanRuntime | null
    detail: OmcPlanDetailResponse | null
}

const WINDOWS: PrototypeTimeWindow[] = ['today', 'last24h', 'yesterday']

function toIsoString(timestamp: number | null | undefined): string {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
        return new Date(0).toISOString()
    }

    return new Date(timestamp).toISOString()
}

function buildCheckpoint(id: PrototypeCheckpointId, input: OmcProjectionInput): PrototypeCheckpoint {
    const lastActivity = input.overview.program.lastActivityAt
        ?? Math.max(
            ...input.runtimes.map((runtime) => runtime.updatedAt ?? 0),
            input.planningRun?.updatedAt ?? 0,
            input.overview.program.updatedAt ?? 0,
        )

    switch (id) {
        case 'intake':
            return {
                id,
                label: '目标接入',
                stamp: toIsoString(lastActivity),
                synopsis: '规划入口仍在运行，系统还在收窄任务边界。',
            }
        case 'strategy':
            return {
                id,
                label: '策略成形',
                stamp: toIsoString(lastActivity),
                synopsis: '规划已落地，系统开始把 phase 拆成稳定执行单元。',
            }
        case 'execution':
            return {
                id,
                label: '静默执行',
                stamp: toIsoString(lastActivity),
                synopsis: '主要计划在后台推进，只把异常和关键边界抬给你。',
            }
        case 'approval':
            return {
                id,
                label: '审批边界',
                stamp: toIsoString(lastActivity),
                synopsis: '至少有一个 plan 到了 review / merge 的真实经营边界。',
            }
    }
}

function createProgram(overview: OmcProgramOverviewResponse): PrototypeProgram {
    return {
        id: overview.program.id,
        name: overview.program.name,
        repoRoot: overview.program.repoRoot,
        primaryBranch: overview.program.primaryBranch ?? overview.program.targetBranch ?? 'main',
        summary: `OMC 正在管理 ${overview.program.counts.Planning + overview.program.counts.Running + overview.program.counts.Review + overview.program.counts.Done} 个计划单元。`,
    }
}

function getRuntimeMap(runtimes: OmcPlanRuntime[]): Map<string, OmcPlanRuntime> {
    return new Map(runtimes.map((runtime) => [runtime.planKey, runtime] as const))
}

function getPlanDetailMap(details: Record<string, OmcPlanDetailResponse> | undefined): Map<string, OmcPlanDetailResponse> {
    return new Map(Object.entries(details ?? {}))
}

function collectPlanBundles(input: OmcProjectionInput): PlanBundle[] {
    const runtimeByPlan = getRuntimeMap(input.runtimes)
    const detailByPlan = getPlanDetailMap(input.details)

    return input.index.phases.flatMap((phase) => phase.plans.map((plan) => ({
        plan,
        phase,
        runtime: runtimeByPlan.get(plan.planKey) ?? null,
        detail: detailByPlan.get(plan.planKey) ?? null,
    })))
}

function deriveCheckpointId(input: OmcProjectionInput, bundles: PlanBundle[]): PrototypeCheckpointId {
    if (!input.index.phases.length || input.planningRun?.status === 'queued' || input.planningRun?.status === 'running') {
        return 'intake'
    }

    if (bundles.some(({ runtime }) =>
        runtime?.reviewRequired
        || runtime?.mergeStatus === 'ready'
        || runtime?.mergeStatus === 'blocked'
        || runtime?.mergeStatus === 'conflict',
    )) {
        return 'approval'
    }

    if (bundles.some(({ runtime }) => runtime?.loopStatus === 'running' || runtime?.column === 'Running')) {
        return 'execution'
    }

    return 'strategy'
}

function calculateGoalPriority(index: number): PrototypeGoalPriority {
    if (index === 0) {
        return 'highest'
    }
    if (index === 1) {
        return 'high'
    }
    return 'medium'
}

function deriveGoalStatus(planBundles: PlanBundle[]): PrototypeGoalStatus {
    if (planBundles.length === 0) {
        return 'intake'
    }

    if (planBundles.some(({ runtime }) => runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict')) {
        return 'blocked'
    }

    if (planBundles.some(({ runtime }) => runtime?.reviewRequired || runtime?.mergeStatus === 'ready')) {
        return 'ready-for-approval'
    }

    if (planBundles.some(({ runtime }) => (runtime?.consecutiveFailureCount ?? 0) > 0)) {
        return 'at-risk'
    }

    return 'on-track'
}

function deriveGoalConfidence(planBundles: PlanBundle[]): number {
    if (planBundles.length === 0) {
        return 20
    }

    const totals = planBundles.reduce(
        (acc, { plan, runtime }) => {
            acc.total += Math.max(plan.checklistTotal, 1)
            acc.done += plan.checklistDone
            if (runtime?.column === 'Done' || runtime?.doneAt) {
                acc.done += 1
                acc.total += 1
            }
            return acc
        },
        { done: 0, total: 0 },
    )

    return Math.max(18, Math.min(95, Math.round((totals.done / Math.max(totals.total, 1)) * 100)))
}

function buildGoal(phase: IndexedPhase, planBundles: PlanBundle[], programId: string, index: number): PrototypeGoal {
    const status = deriveGoalStatus(planBundles)
    const primary = planBundles[0]?.plan
    const lastWorkedAt = Math.max(...planBundles.map(({ runtime, plan }) => runtime?.updatedAt ?? runtime?.lastAttemptAt ?? plan.lastModifiedAt))
    const openPlans = planBundles.filter(({ runtime }) => runtime?.column !== 'Done' && !runtime?.doneAt).length

    return {
        id: phase.phaseKey,
        programId,
        title: phase.phaseLabel,
        summary: primary?.summary ?? `${phase.phaseLabel} phase`,
        successSignal: openPlans === 0
            ? '这一 phase 的计划已经全部合并或完成。'
            : `把 ${openPlans} 个未完成计划收敛到可 merge 的状态。`,
        status,
        confidence: deriveGoalConfidence(planBundles),
        priority: calculateGoalPriority(index),
        direction: status === 'blocked' || status === 'at-risk' ? 'tighten-scope' : 'maintain',
        headline: primary?.firstOpenItem ?? primary?.summary ?? `${phase.phaseLabel} 正在推进。`,
        progressLabel: `${planBundles.length - openPlans}/${planBundles.length} 个计划已收口`,
        needsApproval: planBundles.some(({ runtime }) => runtime?.reviewRequired || runtime?.mergeStatus === 'ready' || runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict'),
        lastWorkedAt: toIsoString(lastWorkedAt),
    }
}

function buildStrategy(phase: IndexedPhase, planBundles: PlanBundle[]): PrototypeStrategySnapshot {
    const primary = planBundles[0]?.plan
    const openPlans = planBundles.filter(({ plan }) => plan.checklistOpen > 0).length

    return {
        goalId: phase.phaseKey,
        thesis: primary?.summary ?? `${phase.phaseLabel} 保持当前路线。`,
        reason: openPlans > 0
            ? `还有 ${openPlans} 个计划存在未完成 checklist，先继续收口再扩范围。`
            : '当前 phase 的 checklist 已经清空，可以转向合并或后续 phase。',
        changedAt: toIsoString(Math.max(...planBundles.map(({ runtime, plan }) => runtime?.updatedAt ?? plan.lastModifiedAt))),
        confidenceDelta: openPlans > 0 ? '+0.08' : '+0.16',
        focusAreas: planBundles.map(({ plan }) => plan.planTitle),
        todayMoves: planBundles.map(({ plan }) => plan.firstOpenItem ?? plan.summary).slice(0, 3),
        nextQuestions: planBundles
            .filter(({ runtime }) => runtime?.reviewRequired || runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict')
            .map(({ plan, runtime }) => runtime?.mergeBlockedReason ?? `如何处理 ${plan.planTitle} 的 review / merge 边界？`)
            .slice(0, 3),
    }
}

function deriveStreamStatus(runtime: OmcPlanRuntime | null): PrototypeStreamStatus {
    if (!runtime) {
        return 'mapping'
    }
    if (runtime.reviewRequired || runtime.mergeStatus === 'ready') {
        return 'ready-for-approval'
    }
    if (runtime.mergeStatus === 'blocked' || runtime.mergeStatus === 'conflict' || runtime.consecutiveFailureCount > 0) {
        return 'blocked'
    }
    if (runtime.loopStatus === 'running' || runtime.column === 'Running') {
        return 'running'
    }
    if (runtime.column === 'Review') {
        return 'watching'
    }
    return 'mapping'
}

function buildStream(bundle: PlanBundle): PrototypeStream {
    const { plan, phase, runtime } = bundle
    const checklistTotal = Math.max(plan.checklistTotal, 1)
    const progress = Math.max(0, Math.min(100, Math.round((plan.checklistDone / checklistTotal) * 100)))

    return {
        id: plan.planKey,
        goalId: phase.phaseKey,
        title: plan.planTitle,
        summary: plan.summary,
        status: deriveStreamStatus(runtime),
        progress,
        whyNow: runtime?.reviewRequired
            ? 'review 已完成，等待人工边界决策。'
            : runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict'
                ? runtime.mergeBlockedReason ?? 'merge 边界被阻塞。'
                : plan.firstOpenItem ?? plan.summary,
        latestMove: runtime?.latestEvidenceSummary ?? plan.firstOpenItem ?? plan.summary,
        dependencyLabel: runtime?.targetBranch ? `目标分支 ${runtime.targetBranch}` : null,
        phaseIds: [phaseIdForPlan(plan.planKey)],
    }
}

function approvalKind(runtime: OmcPlanRuntime | null): PrototypeApprovalItem['kind'] {
    if (runtime?.mergeStatus === 'ready' || runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict') {
        return 'branch-promotion'
    }
    if (runtime?.reviewRequired) {
        return 'direction-change'
    }
    return 'scope-change'
}

function createApprovalLiveContext(bundle: PlanBundle, projectLabel: string): NonNullable<PrototypeApprovalItem['liveContext']> | null {
    const latest = latestAttempt(bundle.detail)
    if (!bundle.runtime) {
        return null
    }

    const terminationReason = latest?.terminationReason ?? null
    const category =
        terminationReason === 'session-inactive' || terminationReason === 'session-removed' || terminationReason === 'runner-offline'
            ? 'runtime-interruption'
            : bundle.runtime.mergeStatus === 'ready'
                ? 'merge-approval'
                : bundle.runtime.mergeStatus === 'blocked' || bundle.runtime.mergeStatus === 'conflict'
                    ? 'merge-blocked'
                    : 'review-approval'

    return {
        source: 'omc',
        category,
        projectLabel,
        goalLabel: bundle.phase.phaseLabel,
        planLabel: bundle.plan.planTitle,
        planKey: bundle.plan.planKey,
        sessionId: latest?.sessionId ?? null,
        attemptNumber: latest?.attemptNumber ?? null,
        latestSummary: latest?.summary ?? bundle.runtime.latestEvidenceSummary ?? bundle.plan.summary,
        terminationReason,
        nextSuggestedStep: latest?.nextSuggestedStep ?? null,
        failureFingerprint: latest?.failureFingerprint ?? bundle.runtime.lastFailureFingerprint ?? null,
    }
}

function createApprovalItem(bundle: PlanBundle, projectLabel: string): PrototypeApprovalItem | null {
    const { plan, phase, runtime } = bundle
    if (!runtime) {
        return null
    }

    if (!runtime.reviewRequired && runtime.mergeStatus !== 'ready' && runtime.mergeStatus !== 'blocked' && runtime.mergeStatus !== 'conflict') {
        return null
    }

    const kind = approvalKind(runtime)
    const liveContext = createApprovalLiveContext(bundle, projectLabel)
    const summary =
        runtime.mergeStatus === 'blocked' || runtime.mergeStatus === 'conflict'
            ? runtime.mergeBlockedReason ?? runtime.latestEvidenceSummary ?? plan.summary
            : runtime.reviewRequired
                ? runtime.latestEvidenceSummary ?? `Review 接受了 ${plan.planTitle}，需要你决定是否继续。`
                : runtime.latestEvidenceSummary ?? `准备把 ${plan.planTitle} 合并到 ${runtime.targetBranch ?? '目标分支'}。`

    return {
        id: plan.planKey,
        goalId: phase.phaseKey,
        title: plan.planTitle,
        kind,
        summary,
        branchName: runtime.currentBranch ?? null,
        requestedAt: toIsoString(runtime.updatedAt ?? runtime.lastAttemptAt ?? plan.lastModifiedAt),
        state: 'pending',
        liveContext,
    }
}

function riskSeverityForRuntime(runtime: OmcPlanRuntime): PrototypeRiskSeverity {
    if (runtime.mergeStatus === 'blocked' || runtime.mergeStatus === 'conflict' || runtime.consecutiveFailureCount >= 2) {
        return 'high'
    }
    if (runtime.consecutiveFailureCount === 1) {
        return 'medium'
    }
    return 'low'
}

function createRisk(bundle: PlanBundle): PrototypeRisk | null {
    const { plan, phase, runtime } = bundle
    if (!runtime) {
        return null
    }

    const risky =
        runtime.mergeStatus === 'blocked'
        || runtime.mergeStatus === 'conflict'
        || runtime.consecutiveFailureCount > 0
        || Boolean(runtime.lastFailureFingerprint)

    if (!risky) {
        return null
    }

    return {
        id: `risk:${plan.planKey}`,
        goalId: phase.phaseKey,
        title: `${plan.planTitle} 出现风险`,
        severity: riskSeverityForRuntime(runtime),
        state: 'open',
        summary: runtime.mergeBlockedReason ?? runtime.latestEvidenceSummary ?? plan.summary,
        signal: runtime.lastFailureFingerprint ?? runtime.mergeStatus ?? 'warning',
        owner: runtime.currentBranch ?? runtime.currentWorktreePath ?? 'runtime',
    }
}

function phaseIdForPlan(planKey: string): string {
    return `phase:${planKey}`
}

function buildPhase(bundle: PlanBundle): PrototypePhase {
    const { plan, phase, runtime } = bundle
    return {
        id: phaseIdForPlan(plan.planKey),
        goalId: phase.phaseKey,
        streamId: plan.planKey,
        title: phase.phaseLabel,
        status: runtime?.column === 'Planning' || !runtime ? 'Planned' : runtime.column,
        summary: plan.summary,
    }
}

function buildPlanBadges(runtime: OmcPlanRuntime | null, approvalItem: PrototypeApprovalItem | null, risk: PrototypeRisk | null): string[] {
    const badges: string[] = []

    if (!runtime) {
        badges.push('strategy-forming')
        return badges
    }

    if (runtime.loopStatus === 'running') {
        badges.push('autonomous')
    }
    if (approvalItem) {
        badges.push('ready-for-approval')
        badges.push('batch-item')
    }
    if (risk) {
        badges.push('at-risk')
    }
    if (runtime.column === 'Done' || runtime.doneAt) {
        badges.push('done')
    }
    if (runtime.column === 'Running') {
        badges.push('critical-path')
    }

    return badges
}

function buildPlanCard(bundle: PlanBundle, approvalItem: PrototypeApprovalItem | null, risk: PrototypeRisk | null): PrototypePlanCard {
    const { plan, phase, runtime } = bundle
    return {
        id: plan.planKey,
        goalId: phase.phaseKey,
        streamId: plan.planKey,
        phaseId: phaseIdForPlan(plan.planKey),
        title: plan.planTitle,
        column: (runtime?.column ?? 'Planning') as PrototypePlanColumn,
        summary: plan.summary,
        signal: runtime?.latestEvidenceSummary ?? plan.firstOpenItem ?? plan.summary,
        updatedAt: toIsoString(runtime?.updatedAt ?? runtime?.lastAttemptAt ?? plan.lastModifiedAt),
        badges: buildPlanBadges(runtime, approvalItem, risk),
    }
}

function buildDigest(window: PrototypeTimeWindow, goals: PrototypeGoal[], approvalItems: PrototypeApprovalItem[], risks: PrototypeRisk[]): PrototypeDigest {
    return {
        window,
        headline: approvalItems.length > 0
            ? `今天有 ${approvalItems.length} 个计划到了人工边界`
            : '当前没有新的人工边界',
        summary: risks.length > 0
            ? `${risks.length} 个风险仍需跟踪，系统会继续把主要推进面压成低打扰视图。`
            : '主路径仍然以静默执行为主。',
        highlights: goals.map((goal) => `${goal.title} · ${goal.progressLabel}`).slice(0, 3),
        decisions: approvalItems.map((item) => item.summary).slice(0, 3),
        watchlist: risks.map((risk) => risk.summary).slice(0, 3),
    }
}

function buildAttemptMap(detail: OmcPlanDetailResponse | null): Map<string, OmcAttempt> {
    return new Map((detail?.attempts ?? []).map((attempt) => [attempt.id, attempt] as const))
}

function latestAttempt(detail: OmcPlanDetailResponse | null): OmcAttempt | null {
    return [...(detail?.attempts ?? [])]
        .sort((left, right) => right.attemptNumber - left.attemptNumber || right.updatedAt - left.updatedAt)[0]
        ?? null
}

function latestEvidence(detail: OmcPlanDetailResponse | null): OmcEvidence | null {
    return [...(detail?.evidence ?? [])]
        .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))[0]
        ?? null
}

function buildWorkOrderState(bundle: PlanBundle): WorkOrderState {
    const { runtime } = bundle
    if (!runtime) {
        return 'drafting'
    }
    if (runtime.reviewRequired) {
        return 'waiting_user'
    }
    if (runtime.mergeStatus === 'blocked' || runtime.mergeStatus === 'conflict' || runtime.consecutiveFailureCount > 0) {
        return 'blocked'
    }
    if (runtime.mergeStatus === 'merged' || runtime.column === 'Done' || runtime.doneAt) {
        return 'integrated'
    }
    if (runtime.column === 'Running' || runtime.loopStatus === 'running') {
        return 'executing'
    }
    if (runtime.column === 'Review') {
        return runtime.reviewApprovedAt ? 'accepted' : 'reviewer_check'
    }
    if (runtime.column === 'Planning') {
        return 'queued'
    }
    return 'queued'
}

function buildWorkOrder(bundle: PlanBundle): WorkOrder {
    const { plan, phase, runtime, detail } = bundle
    const state = buildWorkOrderState(bundle)
    const latest = latestAttempt(detail)
    const reviewEvidence = [...(detail?.evidence ?? [])]
        .filter((evidence) => evidence.kind === 'review')
        .sort((left, right) => right.createdAt - left.createdAt)[0]
        ?? null

    return {
        id: plan.planKey,
        goalId: phase.phaseKey,
        streamId: plan.planKey,
        phaseId: phaseIdForPlan(plan.planKey),
        planId: plan.planKey,
        summary: runtime?.latestEvidenceSummary ?? latest?.summary ?? plan.summary,
        state,
        constraints: [
            runtime?.currentBranch ? `branch:${runtime.currentBranch}` : null,
            runtime?.targetBranch ? `target:${runtime.targetBranch}` : null,
            plan.firstOpenItem ? `next:${plan.firstOpenItem}` : null,
        ].filter((value): value is string => Boolean(value)),
        loop: {
            round: latest?.attemptNumber ?? runtime?.attemptCount ?? 0,
            reviewerVerdict: runtime?.reviewRequired
                ? 'needs_decision'
                : runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict'
                    ? 'blocked'
                    : runtime?.reviewApprovedAt || reviewEvidence?.status === 'passed'
                        ? 'accepted'
                        : null,
            lastDriverSummary: latest?.summary ?? runtime?.latestEvidenceSummary ?? null,
            lastReviewerSummary: reviewEvidence?.summary ?? null,
            lastDecisionSummary: null,
        },
        waitingOnTopicId: state === 'waiting_user' ? `approval:${plan.planKey}` : null,
    }
}

function createApprovalTopic(bundle: PlanBundle, workOrder: WorkOrder, projectLabel: string): DecisionTopic | null {
    const approvalItem = createApprovalItem(bundle, projectLabel)
    if (!approvalItem) {
        return null
    }

    return {
        id: `approval:${approvalItem.id}`,
        kind: 'approval',
        title: approvalItem.title,
        goalId: approvalItem.goalId,
        workOrderId: workOrder.id,
        lifecycle: 'pending',
        unread: true,
        messages: [approvalItem.summary],
    }
}

function createRiskTopic(bundle: PlanBundle, workOrder: WorkOrder): DecisionTopic | null {
    const risk = createRisk(bundle)
    if (!risk) {
        return null
    }

    return {
        id: `risk:${bundle.plan.planKey}`,
        kind: 'risk',
        title: risk.title,
        goalId: risk.goalId,
        workOrderId: workOrder.id,
        lifecycle: 'pending',
        unread: true,
        messages: [risk.summary],
    }
}

function createObservationEvent(workOrderId: string, attempt: OmcAttempt | null, runtime: OmcPlanRuntime | null): AgentEvent | null {
    const summary = attempt?.summary ?? runtime?.latestEvidenceSummary ?? null
    if (!summary) {
        return null
    }

    return {
        id: `observation:${workOrderId}:${attempt?.id ?? 'runtime'}`,
        kind: 'Observation',
        workOrderId,
        emittedBy: 'driver',
        createdAt: toIsoString(attempt?.updatedAt ?? runtime?.updatedAt ?? runtime?.lastAttemptAt ?? Date.now()),
        payload: { summary },
    }
}

function createReviewerEvent(workOrderId: string, bundle: PlanBundle): AgentEvent | null {
    const { runtime, detail } = bundle
    const reviewEvidence = [...(detail?.evidence ?? [])]
        .filter((evidence) => evidence.kind === 'review')
        .sort((left, right) => right.createdAt - left.createdAt)[0]
        ?? null

    if (!runtime?.reviewRequired && !runtime?.reviewApprovedAt && !reviewEvidence) {
        return null
    }

    const verdict =
        runtime?.reviewRequired
            ? 'needs_decision'
            : runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict'
                ? 'blocked'
                : runtime?.reviewApprovedAt || reviewEvidence?.status === 'passed'
                    ? 'accepted'
                    : reviewEvidence?.status === 'failed'
                        ? 'revision_needed'
                        : 'accepted'

    return {
        id: `reviewer:${workOrderId}:${reviewEvidence?.id ?? 'runtime'}`,
        kind: 'ReviewerVerdict',
        workOrderId,
        emittedBy: 'reviewer',
        createdAt: toIsoString(reviewEvidence?.createdAt ?? runtime?.reviewApprovedAt ?? runtime?.updatedAt ?? Date.now()),
        payload: {
            verdict,
            summary: reviewEvidence?.summary ?? runtime?.latestEvidenceSummary ?? 'Review state updated.',
        },
    }
}

function createConflictEvent(workOrderId: string, bundle: PlanBundle): AgentEvent | null {
    const { runtime, detail } = bundle
    const hasConflict = runtime?.mergeStatus === 'blocked' || runtime?.mergeStatus === 'conflict' || (runtime?.consecutiveFailureCount ?? 0) > 0
    if (!hasConflict) {
        return null
    }

    const summary = runtime?.mergeBlockedReason
        ?? latestEvidence(detail)?.summary
        ?? runtime?.latestEvidenceSummary
        ?? 'Runtime entered a blocked state.'

    return {
        id: `conflict:${workOrderId}`,
        kind: 'Conflict',
        workOrderId,
        emittedBy: 'gatekeeper',
        createdAt: toIsoString(runtime?.updatedAt ?? runtime?.lastAttemptAt ?? Date.now()),
        payload: { summary },
    }
}

function rankFocus(bundle: PlanBundle): number {
    const runtime = bundle.runtime
    if (!runtime) {
        return 7
    }
    if (runtime.reviewRequired) {
        return 0
    }
    if (runtime.mergeStatus === 'ready') {
        return 1
    }
    if (runtime.loopStatus === 'running' || runtime.column === 'Running') {
        return 2
    }
    if (runtime.mergeStatus === 'blocked' || runtime.mergeStatus === 'conflict') {
        return 3
    }
    if (runtime.column === 'Review') {
        return 4
    }
    if (runtime.column === 'Planning') {
        return 5
    }
    return 6
}

function chooseFocus(bundles: PlanBundle[]): { goalId: string | null; streamId: string | null } {
    const next = [...bundles].sort((left, right) => {
        const rankDelta = rankFocus(left) - rankFocus(right)
        if (rankDelta !== 0) {
            return rankDelta
        }

        const leftUpdated = left.runtime?.updatedAt ?? left.runtime?.lastAttemptAt ?? left.plan.lastModifiedAt
        const rightUpdated = right.runtime?.updatedAt ?? right.runtime?.lastAttemptAt ?? right.plan.lastModifiedAt
        return rightUpdated - leftUpdated
    })[0]

    if (!next) {
        return { goalId: null, streamId: null }
    }

    return {
        goalId: next.phase.phaseKey,
        streamId: next.plan.planKey,
    }
}

export function buildPrototypeSnapshotFromOmc(input: OmcProjectionInput): PrototypeScenarioSnapshot {
    const bundles = collectPlanBundles(input)
    const checkpointId = deriveCheckpointId(input, bundles)
    const checkpoint = buildCheckpoint(checkpointId, input)
    const program = createProgram(input.overview)
    const goals = input.index.phases.map((phase, index) => {
        const phaseBundles = bundles.filter((bundle) => bundle.phase.phaseKey === phase.phaseKey)
        return buildGoal(phase, phaseBundles, program.id, index)
    })
    const strategies = input.index.phases.map((phase) => buildStrategy(phase, bundles.filter((bundle) => bundle.phase.phaseKey === phase.phaseKey)))
    const streams = bundles.map(buildStream)
    const approvalItems = bundles
        .map((bundle) => createApprovalItem(bundle, program.name))
        .filter((item): item is PrototypeApprovalItem => Boolean(item))
    const risks = bundles.map(createRisk).filter((risk): risk is PrototypeRisk => Boolean(risk))
    const phases = bundles.map(buildPhase)
    const planCards = bundles.map((bundle) => {
        const approvalItem = approvalItems.find((item) => item.id === bundle.plan.planKey) ?? null
        const risk = risks.find((item) => item.id === `risk:${bundle.plan.planKey}`) ?? null
        return buildPlanCard(bundle, approvalItem, risk)
    })

    const approvalBatch: PrototypeApprovalBatch = {
        id: `approval-batch:${program.id}`,
        window: 'today',
        title: '真实 OMC 审批批次',
        summary: approvalItems.length > 0
            ? `${approvalItems.length} 个计划正等待边界决策。`
            : '当前没有待审批计划。',
        items: approvalItems,
    }

    const digests = Object.fromEntries(WINDOWS.map((window) => [window, buildDigest(window, goals, approvalItems, risks)])) as Record<PrototypeTimeWindow, PrototypeDigest>
    const approvalBatches = Object.fromEntries(WINDOWS.map((window) => [window, { ...approvalBatch, window }])) as Record<PrototypeTimeWindow, PrototypeApprovalBatch>

    return {
        checkpoint,
        program,
        goals,
        strategies,
        streams,
        digests,
        approvalBatches,
        risks,
        phases,
        planCards,
    }
}

export function buildWorldModelFromOmc(input: OmcProjectionInput): WorldModel {
    const bundles = collectPlanBundles(input)
    const workOrders = Object.fromEntries(bundles.map((bundle) => {
        const order = buildWorkOrder(bundle)
        return [order.id, order] as const
    }))

    const decisionTopics = Object.fromEntries(
        bundles.flatMap((bundle) => {
            const workOrder = workOrders[bundle.plan.planKey]
            if (!workOrder) {
                return []
            }

            const topics = [createApprovalTopic(bundle, workOrder, input.overview.program.name), createRiskTopic(bundle, workOrder)]
                .filter((topic): topic is DecisionTopic => Boolean(topic))

            return topics.map((topic) => [topic.id, topic] as const)
        }),
    )

    const agentEvents = bundles.flatMap((bundle) => {
        const workOrderId = bundle.plan.planKey
        const observation = createObservationEvent(workOrderId, latestAttempt(bundle.detail), bundle.runtime)
        const reviewer = createReviewerEvent(workOrderId, bundle)
        const conflict = createConflictEvent(workOrderId, bundle)
        return [observation, reviewer, conflict].filter((event): event is AgentEvent => Boolean(event))
    })

    return {
        currentFocus: chooseFocus(bundles),
        workOrders,
        decisionTopics,
        agentEvents,
    }
}
