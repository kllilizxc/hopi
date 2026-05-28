import { describe, expect, it } from 'bun:test'
import { Store } from '../../store'

describe('OmcRuntimeStore mailbox/task runtime', () => {
    it('stores mailbox messages by recipient and marks them read', () => {
        const store = new Store(':memory:')
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            planningRoot: '/tmp/card-game/.planning',
        })

        store.omcRuntime.addMailboxMessage('default', {
            id: 'mail-1',
            programId: 'program-1',
            from: 'reviewer',
            to: 'manager',
            thread: 'work-order/W1',
            kind: 'review-verdict',
            priority: 'normal',
            body: '需要用户确认山门入口应该先补最小可玩版还是完整过场。',
            createdAt: 101,
        })
        store.omcRuntime.addMailboxMessage('default', {
            id: 'mail-2',
            programId: 'program-1',
            from: 'user',
            to: 'manager',
            thread: 'work-order/W1',
            kind: 'user-reply',
            priority: 'high',
            body: '先做最小可玩版，文案短一点。',
            createdAt: 102,
        })

        const unread = store.omcRuntime.listMailboxMessagesByRecipient('program-1', 'manager', 'default', {
            unreadOnly: true,
        })
        expect(unread.map((message) => message.id)).toEqual(['mail-2', 'mail-1'])

        const read = store.omcRuntime.markMailboxMessageRead('default', 'mail-2', 200)
        expect(read?.readAt).toBe(200)

        const remainingUnread = store.omcRuntime.listMailboxMessagesByRecipient('program-1', 'manager', 'default', {
            unreadOnly: true,
        })
        expect(remainingUnread.map((message) => message.id)).toEqual(['mail-1'])
    })

    it('stores work orders, attempts, coordinator state, and directive ledger entries', () => {
        const store = new Store(':memory:')
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            planningRoot: '/tmp/card-game/.planning',
        })

        const workOrder = store.omcRuntime.upsertWorkOrder('default', {
            id: 'work-order:01-01',
            programId: 'program-1',
            goalId: 'goal-expedition',
            planKey: '01-01',
            title: 'Create the expedition entry scene',
            owner: 'driver',
            status: 'in_progress',
            currentAttemptId: 'attempt-driver-1',
        })
        expect(workOrder.status).toBe('in_progress')
        expect(workOrder.owner).toBe('driver')

        const driverAttempt = store.omcRuntime.addWorkAttempt('default', {
            id: 'attempt-driver-1',
            programId: 'program-1',
            workOrderId: workOrder.id,
            role: 'driver',
            sessionId: 'session-driver-1',
            status: 'running',
            summary: 'Implementing the mountain gate minimum playable flow.',
        })
        expect(driverAttempt.role).toBe('driver')
        expect(driverAttempt.status).toBe('running')

        const reviewerAttempt = store.omcRuntime.addWorkAttempt('default', {
            id: 'attempt-reviewer-1',
            programId: 'program-1',
            workOrderId: workOrder.id,
            role: 'reviewer',
            sessionId: 'session-reviewer-1',
            status: 'reviewing',
            summary: 'Checking whether the player can clearly continue.',
        })

        const updatedOrder = store.omcRuntime.updateWorkOrder('default', workOrder.id, {
            owner: 'reviewer',
            status: 'in_review',
            reviewerVerdict: 'accepted',
            latestAcceptedAttemptId: reviewerAttempt.id,
            currentAttemptId: reviewerAttempt.id,
        })
        expect(updatedOrder?.status).toBe('in_review')
        expect(updatedOrder?.reviewerVerdict).toBe('accepted')
        expect(updatedOrder?.latestAcceptedAttemptId).toBe('attempt-reviewer-1')

        const coordination = store.omcRuntime.upsertCoordinationAgentState('default', {
            programId: 'program-1',
            role: 'manager',
            busy: true,
            currentWorkOrderId: workOrder.id,
            activeSessionId: 'session-manager-1',
            model: 'gpt-5.4',
            mode: 'default',
            lastHeartbeat: 300,
        })
        expect(coordination.currentWorkOrderId).toBe(workOrder.id)
        expect(coordination.busy).toBe(true)

        store.omcRuntime.upsertDecisionTopic('default', {
            id: 'topic-1',
            programId: 'program-1',
            kind: 'status',
            title: 'Mountain gate follow-up',
            workOrderId: workOrder.id,
            lifecycle: 'waiting',
            unread: true,
        })

        const directive = store.omcRuntime.upsertDirectiveLedgerEntry('default', {
            id: 'directive-1',
            programId: 'program-1',
            scopeType: 'work_order',
            scopeId: workOrder.id,
            sourceTopicId: 'topic-1',
            key: 'entry_mode',
            summary: '先做最小可玩版，文案短一点。',
            rawText: '先做最小可玩版，文案短一点。',
        })
        expect(directive.scopeType).toBe('work_order')
        expect(directive.scopeId).toBe(workOrder.id)

        expect(store.omcRuntime.listWorkOrders('program-1', 'default')).toHaveLength(1)
        expect(store.omcRuntime.listWorkAttempts('program-1', workOrder.id, 'default').map((attempt) => attempt.id)).toEqual([
            'attempt-reviewer-1',
            'attempt-driver-1',
        ])
        expect(store.omcRuntime.listCoordinationAgentStates('program-1', 'default')).toHaveLength(1)
        expect(store.omcRuntime.listDirectiveLedgerEntries('program-1', 'default')).toHaveLength(1)
    })
})
