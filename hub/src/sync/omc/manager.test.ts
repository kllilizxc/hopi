import type { SyncEvent } from '@hopi/protocol/types'
import { describe, expect, it } from 'bun:test'
import { Store } from '../../store'
import { OmcManagerController } from './manager'

describe('OmcManagerController orchestration', () => {
    it('assigns a ready work order to driver and records a running driver attempt', () => {
        const store = new Store(':memory:')
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            planningRoot: '/tmp/card-game/.planning',
        })
        store.omcRuntime.upsertWorkOrder('default', {
            id: 'work-1',
            programId: 'program-1',
            goalId: 'goal-1',
            planKey: '01-01',
            title: 'Build the expedition entry flow',
            status: 'ready',
        })

        const manager = new OmcManagerController({
            store,
            namespace: 'default',
        })

        const result = manager.assignWorkOrderToDriver('program-1', {
            workOrderId: 'work-1',
            body: '继续做山门入口到地图探索这一段。',
            sessionId: 'session-driver-1',
            model: 'codex',
            mode: 'default',
        })

        expect(result.workOrder.owner).toBe('driver')
        expect(result.workOrder.status).toBe('in_progress')
        expect(result.workOrder.currentAttemptId).toBe(result.attempt.id)
        expect(result.attempt.role).toBe('driver')
        expect(result.attempt.status).toBe('running')
        expect(result.attempt.sessionId).toBe('session-driver-1')
        expect(result.mailbox.kind).toBe('task-assignment')
        expect(result.mailbox.to).toBe('driver')

        const driverState = store.omcRuntime.getCoordinationAgentState('program-1', 'driver', 'default')
        expect(driverState?.busy).toBe(true)
        expect(driverState?.currentWorkOrderId).toBe('work-1')
        expect(driverState?.activeSessionId).toBe('session-driver-1')
    })

    it('requests review and accepts the work order after a reviewer verdict', () => {
        const store = new Store(':memory:')
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            planningRoot: '/tmp/card-game/.planning',
        })
        const workOrder = store.omcRuntime.upsertWorkOrder('default', {
            id: 'work-1',
            programId: 'program-1',
            goalId: 'goal-1',
            planKey: '01-01',
            title: 'Build the expedition entry flow',
            owner: 'driver',
            status: 'in_progress',
            currentAttemptId: 'driver-attempt-1',
        })
        store.omcRuntime.addWorkAttempt('default', {
            id: 'driver-attempt-1',
            programId: 'program-1',
            workOrderId: workOrder.id,
            role: 'driver',
            status: 'closing',
            summary: 'Entry flow is ready for review.',
        })

        const manager = new OmcManagerController({
            store,
            namespace: 'default',
        })

        const review = manager.requestReview('program-1', {
            workOrderId: 'work-1',
            driverAttemptId: 'driver-attempt-1',
            body: '请检查山门入口、地图探索和非战斗节点流程。',
        })

        expect(review.workOrder.status).toBe('in_review')
        expect(review.workOrder.owner).toBe('reviewer')
        expect(review.reviewAttempt.role).toBe('reviewer')
        expect(review.reviewAttempt.status).toBe('reviewing')
        expect(review.mailbox.to).toBe('reviewer')
        expect(review.mailbox.kind).toBe('review-request')

        const verdict = manager.submitReviewVerdict('program-1', {
            workOrderId: 'work-1',
            reviewAttemptId: review.reviewAttempt.id,
            verdict: 'accepted',
            body: '山门入口链路完整，可以进入下一张卡。',
        })

        expect(verdict.workOrder.status).toBe('done')
        expect(verdict.workOrder.owner).toBeNull()
        expect(verdict.workOrder.reviewerVerdict).toBe('accepted')
        expect(verdict.workOrder.latestAcceptedAttemptId).toBe('driver-attempt-1')
        expect(verdict.reviewAttempt.status).toBe('accepted')
        expect(verdict.reviewAttempt.completedAt).toBeNumber()
        expect(verdict.mailbox.to).toBe('manager')
        expect(verdict.mailbox.kind).toBe('review-verdict')

        const reviewerState = store.omcRuntime.getCoordinationAgentState('program-1', 'reviewer', 'default')
        expect(reviewerState?.busy).toBe(false)
        expect(reviewerState?.currentWorkOrderId).toBeNull()
    })

    it('moves a reviewed work order into waiting_user when reviewer asks for user input', () => {
        const store = new Store(':memory:')
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            planningRoot: '/tmp/card-game/.planning',
        })
        store.omcRuntime.upsertWorkOrder('default', {
            id: 'work-1',
            programId: 'program-1',
            goalId: 'goal-1',
            planKey: '01-01',
            title: 'Build the expedition entry flow',
            owner: 'reviewer',
            status: 'in_review',
            currentAttemptId: 'driver-attempt-1',
        })
        store.omcRuntime.addWorkAttempt('default', {
            id: 'driver-attempt-1',
            programId: 'program-1',
            workOrderId: 'work-1',
            role: 'driver',
            status: 'closing',
            summary: 'Ready for review.',
        })
        store.omcRuntime.addWorkAttempt('default', {
            id: 'review-attempt-1',
            programId: 'program-1',
            workOrderId: 'work-1',
            role: 'reviewer',
            status: 'reviewing',
            summary: 'Checking the node flow.',
        })

        const manager = new OmcManagerController({
            store,
            namespace: 'default',
        })

        const verdict = manager.submitReviewVerdict('program-1', {
            workOrderId: 'work-1',
            reviewAttemptId: 'review-attempt-1',
            verdict: 'needs_user',
            body: '需要你确认山门节点是否应该先展示一段过场再进入地图。',
        })

        expect(verdict.workOrder.status).toBe('waiting_user')
        expect(verdict.workOrder.owner).toBeNull()
        expect(verdict.workOrder.reviewerVerdict).toBe('needs_user')
        expect(verdict.workOrder.blockedReason).toContain('需要你确认')
        expect(verdict.reviewAttempt.status).toBe('needs_user')
        expect(verdict.mailbox.to).toBe('manager')
    })

    it('records a directive ledger entry and readies the linked work order when a user reply resolves a waiting topic', () => {
        const store = new Store(':memory:')
        const program = store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            planningRoot: '/tmp/card-game/.planning',
        })
        store.omcRuntime.upsertWorkOrder('default', {
            id: '01-01',
            programId: program.id,
            goalId: 'goal-1',
            planKey: '01-01',
            title: 'Build the expedition entry flow',
            status: 'waiting_user',
            blockedReason: '需要确认山门入口先展示什么。',
        })

        const manager = new OmcManagerController({
            store,
            namespace: 'default',
        })

        manager.consumeTopicReplyAsMailboxMessage(program, {
            topicId: 'topic-1',
            kind: 'direction',
            title: '山门入口应该怎么展示',
            goalId: 'goal-1',
            planKey: '01-01',
            sessionId: null,
            text: '先给一个占位说明，再进入地图。',
        })

        const topic = store.omcRuntime.getDecisionTopicByNamespace('topic-1', 'default')
        const workOrder = store.omcRuntime.getWorkOrderByNamespace('01-01', 'default')
        const directives = store.omcRuntime.listDirectiveLedgerEntries(program.id, 'default')
        const mailbox = store.omcRuntime.listMailboxMessages(program.id, 'default')

        expect(topic?.workOrderId).toBe('01-01')
        expect(workOrder?.status).toBe('ready')
        expect(workOrder?.blockedReason).toBeNull()
        expect(directives).toHaveLength(1)
        expect(directives[0]?.scopeType).toBe('work_order')
        expect(directives[0]?.scopeId).toBe('01-01')
        expect(directives[0]?.summary).toContain('占位说明')
        expect(mailbox).toHaveLength(1)
        expect(mailbox[0]?.readAt).toBeNumber()
    })

    it('emits realtime runtime events when manager mutates mailbox, task board, and coordinator state', () => {
        const store = new Store(':memory:')
        const emitted: SyncEvent[] = []
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            planningRoot: '/tmp/card-game/.planning',
        })
        store.omcRuntime.upsertWorkOrder('default', {
            id: 'work-1',
            programId: 'program-1',
            goalId: 'goal-1',
            planKey: '01-01',
            title: 'Build the expedition entry flow',
            status: 'ready',
        })

        const manager = new OmcManagerController({
            store,
            namespace: 'default',
            engine: {
                handleRealtimeEvent(event: SyncEvent) {
                    emitted.push(event)
                }
            } as never,
        })

        const assignment = manager.assignWorkOrderToDriver('program-1', {
            workOrderId: 'work-1',
            body: 'Implement the expedition entry scene.',
            sessionId: 'session-driver-1',
            model: 'codex',
            mode: 'default',
        })

        manager.requestReview('program-1', {
            workOrderId: 'work-1',
            driverAttemptId: assignment.attempt.id,
            body: 'Review the expedition entry scene.',
        })

        expect(emitted.map((event) => event.type)).toEqual([
            'omc-mailbox-message-added',
            'omc-work-attempt-added',
            'omc-work-order-updated',
            'omc-coordination-agent-updated',
            'omc-mailbox-message-added',
            'omc-work-attempt-added',
            'omc-work-order-updated',
            'omc-coordination-agent-updated',
            'omc-coordination-agent-updated',
        ])
    })
})
