import { describe, expect, it } from 'vitest'
import { createWorkOrder } from './orchestration'
import {
    applyReviewerVerdict,
    finishSelfCheck,
    queueWorkOrder,
    resumeAfterDecision,
    startExecutionRound,
} from './workOrderLoop'

describe('work order loop reducer', () => {
    it('moves a drafting work order through queued and executing states', () => {
        const order = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            summary: 'Lock the first broker import contract and proof path.',
        })

        const queued = queueWorkOrder(order)
        const executing = startExecutionRound(queued, 'Driver is starting the first execution pass.')

        expect(order.state).toBe('drafting')
        expect(queued.state).toBe('queued')
        expect(queued.loop).not.toBe(order.loop)
        expect(queued.constraints).not.toBe(order.constraints)
        expect(executing.state).toBe('executing')
        expect(executing.loop.round).toBe(1)
        expect(executing.loop.reviewerVerdict).toBe(null)
        expect(executing.loop.lastDecisionSummary).toBeNull()
        expect(executing.loop).not.toBe(queued.loop)
    })

    it('runs a revision loop from self check through reviewer verdict', () => {
        const order = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            summary: 'Lock the first broker import contract and proof path.',
        })

        const executing = startExecutionRound(queueWorkOrder(order), 'Driver is starting the first execution pass.')
        const selfChecked = finishSelfCheck(executing, 'Driver completed the pass and found one gap to tighten.')
        const reviewed = applyReviewerVerdict(selfChecked, 'revision_needed', 'Reviewer wants one more constraint added.')

        expect(executing.state).toBe('executing')
        expect(selfChecked.state).toBe('reviewer_check')
        expect(selfChecked.loop.lastDriverSummary).toBe('Driver completed the pass and found one gap to tighten.')
        expect(reviewed.state).toBe('revision_needed')
        expect(reviewed.loop.reviewerVerdict).toBe('revision_needed')
        expect(reviewed.loop.lastReviewerSummary).toBe('Reviewer wants one more constraint added.')
    })

    it('maps reviewer verdicts to the expected work order states', () => {
        const base = finishSelfCheck(
            startExecutionRound(queueWorkOrder(
                createWorkOrder({
                    id: 'wo-import-lane',
                    goalId: 'goal-portfolio-foundation',
                    summary: 'Lock the first broker import contract and proof path.',
                }),
            ), 'Driver is starting the first execution pass.'),
            'Driver completed the pass and found one gap to tighten.',
        )

        const accepted = applyReviewerVerdict(base, 'accepted', 'Reviewer accepted the pass.')
        const blocked = applyReviewerVerdict(base, 'blocked', 'Reviewer blocked the pass.')
        const replanningNeeded = applyReviewerVerdict(base, 'replanning_needed', 'Reviewer wants a replan.')

        expect(accepted.state).toBe('accepted')
        expect(blocked.state).toBe('blocked')
        expect(replanningNeeded.state).toBe('replanning_needed')
    })

    it('rejects invalid transitions with a clear error', () => {
        const order = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            summary: 'Lock the first broker import contract and proof path.',
        })

        expect(() => startExecutionRound(order, 'Driver tried to start too early.')).toThrow(
            'startExecutionRound: expected queued, revision_needed, or blocked, received drafting',
        )
    })

    it('routes a needs decision verdict through waiting_user and resumes without overwriting reviewer provenance', () => {
        const order = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            summary: 'Lock the first broker import contract and proof path.',
        })

        const waiting = applyReviewerVerdict(
            finishSelfCheck(startExecutionRound(queueWorkOrder(order), 'Driver is starting the first execution pass.'), 'Driver needs a user callout.'),
            'needs_decision',
            'Reviewer needs a user choice before the loop can continue.',
        )
        const resumed = resumeAfterDecision(waiting, 'User picked the follow-up path.')

        expect(waiting.state).toBe('waiting_user')
        expect(waiting.loop.reviewerVerdict).toBe('needs_decision')
        expect(waiting.loop.lastReviewerSummary).toBe('Reviewer needs a user choice before the loop can continue.')
        expect(waiting.waitingOnTopicId).toBeNull()
        expect(resumed.state).toBe('queued')
        expect(resumed.waitingOnTopicId).toBeNull()
        expect(resumed.loop).not.toBe(waiting.loop)
        expect(resumed.loop.reviewerVerdict).toBe('needs_decision')
        expect(resumed.loop.lastReviewerSummary).toBe('Reviewer needs a user choice before the loop can continue.')
        expect(resumed.loop.lastDecisionSummary).toBe('User picked the follow-up path.')
        expect(resumed.loop.lastDriverSummary).toBe('Driver needs a user callout.')
    })
})
