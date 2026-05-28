import type { ReviewerVerdict, WorkOrder } from './types'

function cloneWorkOrder(order: WorkOrder): WorkOrder {
    return {
        ...order,
        constraints: [...order.constraints],
        loop: {
            ...order.loop,
        },
    }
}

function formatAllowedStates(states: WorkOrder['state'][]): string {
    if (states.length === 0) {
        return ''
    }
    if (states.length === 1) {
        return states[0]
    }
    if (states.length === 2) {
        return `${states[0]} or ${states[1]}`
    }

    return `${states.slice(0, -1).join(', ')}, or ${states[states.length - 1]}`
}

function assertValidTransition(
    currentState: WorkOrder['state'],
    helperName: string,
    allowedStates: WorkOrder['state'][],
): void {
    if (!allowedStates.includes(currentState)) {
        throw new Error(`${helperName}: expected ${formatAllowedStates(allowedStates)}, received ${currentState}`)
    }
}

export function queueWorkOrder(order: WorkOrder): WorkOrder {
    assertValidTransition(order.state, 'queueWorkOrder', ['drafting', 'replanning_needed'])

    const next = cloneWorkOrder(order)
    next.state = 'queued'
    return next
}

export function startExecutionRound(order: WorkOrder, summary: string): WorkOrder {
    assertValidTransition(order.state, 'startExecutionRound', ['queued', 'revision_needed', 'blocked'])

    const next = cloneWorkOrder(order)
    next.state = 'executing'
    next.loop.round += 1
    next.loop.reviewerVerdict = null
    next.loop.lastDriverSummary = summary
    next.loop.lastReviewerSummary = null
    next.loop.lastDecisionSummary = null
    return next
}

export function finishSelfCheck(order: WorkOrder, summary: string): WorkOrder {
    assertValidTransition(order.state, 'finishSelfCheck', ['executing'])

    const next = cloneWorkOrder(order)
    next.state = 'reviewer_check'
    next.loop.lastDriverSummary = summary
    return next
}

export function applyReviewerVerdict(
    order: WorkOrder,
    verdict: ReviewerVerdict,
    summary: string,
): WorkOrder {
    assertValidTransition(order.state, 'applyReviewerVerdict', ['reviewer_check'])

    const nextState =
        verdict === 'accepted'
            ? 'accepted'
            : verdict === 'needs_decision'
                ? 'waiting_user'
                : verdict

    const next = cloneWorkOrder(order)
    next.state = nextState
    next.loop.reviewerVerdict = verdict
    next.loop.lastReviewerSummary = summary
    return next
}

export function resumeAfterDecision(order: WorkOrder, summary: string): WorkOrder {
    assertValidTransition(order.state, 'resumeAfterDecision', ['waiting_user'])

    const next = cloneWorkOrder(order)
    next.state = 'queued'
    next.loop.lastDecisionSummary = summary
    next.waitingOnTopicId = null
    return next
}
