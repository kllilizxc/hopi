import type {
    AgentEvent,
    DecisionTopic,
    PlanTraceEventView,
    PlanTraceInspection,
    PlanTraceMatch,
    PrototypePlanCard,
    WorldModel,
    WorkOrder,
} from './types'

function scoreWorkOrderForTrace(workOrder: WorkOrder, worldModel: WorldModel): number {
    let score = 0

    if (workOrder.planId) {
        score += 1
    }

    if (workOrder.state !== 'drafting') {
        score += 1
    }

    if (workOrder.waitingOnTopicId) {
        score += 2
    }

    if (worldModel.agentEvents.some((event) => event.workOrderId === workOrder.id)) {
        score += 4
    }

    if (workOrder.id.startsWith('work-order:')) {
        score += 1
    }

    return score
}

function pickBestWorkOrder(workOrders: WorkOrder[], worldModel: WorldModel): WorkOrder | null {
    return workOrders
        .slice()
        .sort((left, right) => {
            const scoreDelta = scoreWorkOrderForTrace(right, worldModel) - scoreWorkOrderForTrace(left, worldModel)
            if (scoreDelta !== 0) {
                return scoreDelta
            }

            return left.id.localeCompare(right.id)
        })[0] ?? null
}

function findExactWorkOrder(planCard: PrototypePlanCard, worldModel: WorldModel): WorkOrder | null {
    const candidates = Object.values(worldModel.workOrders).filter((order) => order.planId === planCard.id)
    return pickBestWorkOrder(candidates, worldModel)
}

function findInferredWorkOrder(planCard: PrototypePlanCard, worldModel: WorldModel): WorkOrder | null {
    const candidates = Object.values(worldModel.workOrders).filter((order) =>
        order.goalId === planCard.goalId
        && order.streamId === planCard.streamId
        && order.phaseId === planCard.phaseId,
    )

    return pickBestWorkOrder(candidates, worldModel)
}

function getPlanTraceMatch(workOrder: WorkOrder | null, planCard: PrototypePlanCard): PlanTraceMatch {
    if (workOrder?.planId === planCard.id) {
        return { kind: 'exact', label: '直连关联' }
    }

    if (workOrder) {
        return { kind: 'inferred', label: '推断关联' }
    }

    return { kind: 'none', label: '无运行态输出' }
}

function summarizeAgentEvent(event: AgentEvent): string {
    switch (event.kind) {
        case 'ReviewerVerdict':
            return `${event.payload.verdict} · ${event.payload.summary}`
        case 'ManagerDecision':
            return `${event.payload.decision} · ${event.payload.summary}`
        default:
            return event.payload.summary
    }
}

function buildPlanTraceEventView(event: AgentEvent): PlanTraceEventView {
    return {
        id: event.id,
        createdAt: event.createdAt,
        role: event.emittedBy,
        kind: event.kind,
        summary: summarizeAgentEvent(event),
        raw: event,
    }
}

function assertNever(value: never, context: string): never {
    throw new Error(`${context}: unexpected value ${String(value)}`)
}

function mapReviewerVerdictToState(verdict: WorkOrder['loop']['reviewerVerdict']): WorkOrder['state'] | null {
    switch (verdict) {
        case 'accepted':
            return 'accepted'
        case 'revision_needed':
            return 'revision_needed'
        case 'blocked':
            return 'blocked'
        case 'needs_decision':
            return 'waiting_user'
        case 'replanning_needed':
            return 'replanning_needed'
        case null:
            return null
        default:
            return assertNever(verdict, 'mapReviewerVerdictToState')
    }
}

function mapManagerDecisionToState(
    decision: Extract<AgentEvent, { kind: 'ManagerDecision' }>['payload']['decision'] | null,
): WorkOrder['state'] | null {
    if (decision === null) {
        return null
    }

    switch (decision) {
        case 'continue_loop':
            return 'queued'
        case 'accept':
            return 'accepted'
        case 'replan':
            return 'replanning_needed'
        case 'escalate_to_user':
            return 'waiting_user'
        default:
            return assertNever(decision, 'mapManagerDecisionToState')
    }
}

function buildStateTransitions(workOrder: WorkOrder, events: AgentEvent[]): string[] {
    const transitions: string[] = []

    const hasExecutionEvidence =
        workOrder.state === 'executing'
        || workOrder.state === 'self_check'
        || workOrder.state === 'reviewer_check'
        || workOrder.state === 'revision_needed'
        || workOrder.state === 'blocked'
        || workOrder.state === 'needs_decision'
        || workOrder.state === 'waiting_user'
        || workOrder.state === 'replanning_needed'
        || workOrder.state === 'accepted'
        || workOrder.state === 'integrated'
        || events.some((event) =>
            event.kind === 'Observation'
            || event.kind === 'Proposal'
            || event.kind === 'Constraint'
            || event.kind === 'Conflict'
            || event.kind === 'Resolution',
        )

    if (hasExecutionEvidence) {
        transitions.push('queued -> executing')
    }

    const reviewerVerdict =
        events.find((event): event is Extract<AgentEvent, { kind: 'ReviewerVerdict' }> => event.kind === 'ReviewerVerdict')
        ?? null

    const reviewOutcome =
        mapReviewerVerdictToState(reviewerVerdict?.payload.verdict ?? workOrder.loop.reviewerVerdict)
        ?? (workOrder.state === 'waiting_user'
            || workOrder.state === 'accepted'
            || workOrder.state === 'revision_needed'
            || workOrder.state === 'blocked'
            || workOrder.state === 'replanning_needed'
                ? workOrder.state
                : null)

    if (reviewOutcome) {
        transitions.push(`reviewer_check -> ${reviewOutcome}`)
    }

    const managerDecision =
        events.find((event): event is Extract<AgentEvent, { kind: 'ManagerDecision' }> => event.kind === 'ManagerDecision')
        ?? null

    const managerOutcome = mapManagerDecisionToState(managerDecision?.payload.decision ?? null)
    if (managerOutcome) {
        transitions.push(`waiting_user -> ${managerOutcome}`)
    }

    return [...new Set(transitions)]
}

function collectLinkedDecisionTopics(
    workOrder: WorkOrder,
    decisionTopics: Record<string, DecisionTopic>,
): DecisionTopic[] {
    return Object.values(decisionTopics)
        .filter((topic) => topic.workOrderId === workOrder.id)
        .sort((left, right) => {
            const kindOrder = left.kind.localeCompare(right.kind)
            if (kindOrder !== 0) {
                return kindOrder
            }

            return left.title.localeCompare(right.title)
        })
}

export function buildPlanTraceInspection(input: {
    planCard: PrototypePlanCard
    worldModel: WorldModel
    decisionTopics: Record<string, DecisionTopic>
}): PlanTraceInspection {
    const exact = findExactWorkOrder(input.planCard, input.worldModel)
    const inferred = exact ?? findInferredWorkOrder(input.planCard, input.worldModel)
    const workOrder = exact ?? inferred
    const match = getPlanTraceMatch(workOrder, input.planCard)

    if (!workOrder) {
        return {
            planId: input.planCard.id,
            planTitle: input.planCard.title,
            mappingConfidence: match.kind,
            match,
            workOrder: null,
            round: null,
            events: [],
            stateTransitions: [],
            linkedTopics: [],
            emptyState: {
                title: '这张卡还没有运行态输出，当前只有计划信息。',
                detail: input.planCard.summary,
            },
        }
    }

    const rawEvents = input.worldModel.agentEvents
        .filter((event) => event.workOrderId === workOrder.id)
        .slice()
        .sort((left, right) => {
            const createdAtOrder = right.createdAt.localeCompare(left.createdAt)
            if (createdAtOrder !== 0) {
                return createdAtOrder
            }

            return right.id.localeCompare(left.id)
        })

    return {
        planId: input.planCard.id,
        planTitle: input.planCard.title,
        mappingConfidence: match.kind,
        match,
        workOrder,
        round: workOrder.loop.round,
        events: rawEvents.map(buildPlanTraceEventView),
        stateTransitions: buildStateTransitions(workOrder, rawEvents),
        linkedTopics: collectLinkedDecisionTopics(workOrder, input.decisionTopics),
        emptyState: rawEvents.length === 0
            ? {
                title: '这张卡已经进入运行态，但还没有记录到原始事件。',
                detail: workOrder.summary,
            }
            : null,
    }
}
