import { randomUUID } from 'node:crypto'
import type {
    OmcCoordinationAgentState,
    OmcDecisionTopic,
    OmcDecisionTopicReplyRequest,
    OmcDecisionTopicReplyResponse,
    OmcDecisionTopicTurn,
    OmcMailboxMessage,
    OmcProgram,
    OmcProgramRuntimeStateResponse,
    OmcReviewVerdict,
    OmcWorkAttempt,
    OmcWorkOrder,
} from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import {
    buildOmcCoordinationAgentUpdatedEvent,
    buildOmcDirectiveLedgerUpdatedEvent,
    buildOmcMailboxMessageAddedEvent,
    buildOmcTopicTurnAddedEvent,
    buildOmcTopicUpdatedEvent,
    buildOmcWorkAttemptAddedEvent,
    buildOmcWorkAttemptUpdatedEvent,
    buildOmcWorkOrderUpdatedEvent,
} from './events'

function createId(prefix: string): string {
    return `${prefix}-${randomUUID()}`
}

function classifyUserTurnKind(text: string): OmcDecisionTopicTurn['kind'] {
    if (/[?？]/.test(text) || /(为什么|是否|是不是|符合预期|how|why|what|is it|should)/i.test(text)) {
        return 'question'
    }

    if (/(批准|放行|合并|继续|重试|回规划|resume|retry|approve|merge)/i.test(text)) {
        return 'decision'
    }

    return 'directive'
}

function buildManagerAck(input: {
    sessionId?: string | null
    userTurnKind: OmcDecisionTopicTurn['kind']
    resumedWorkOrder?: boolean
}): string {
    if (input.resumedWorkOrder) {
        return '已记录这个要求，当前卡会按这个方向恢复执行。'
    }

    if (input.userTurnKind === 'question' && input.sessionId) {
        return '已把这个问题转给当前执行会话，收到答复后会回到这个线程。'
    }

    if (input.userTurnKind !== 'question' && input.sessionId) {
        return '已记录这个要求，也会同步给当前执行上下文继续推进。'
    }

    if (input.sessionId) {
        return '已转交 Manager。接下来会结合当前执行上下文决定是直接派给 Driver，还是先回到这个线程继续澄清。'
    }

    if (input.userTurnKind !== 'question') {
        return '已记录这个要求，等执行上下文就绪后会继续往下派发。'
    }

    return '已转交 Manager。当前先把这条回复挂在线程里，等可执行上下文就绪后会继续往下派发。'
}

function mapReviewVerdictToAttemptStatus(verdict: OmcReviewVerdict): OmcWorkAttempt['status'] {
    switch (verdict) {
        case 'accepted':
            return 'accepted'
        case 'revision_needed':
            return 'revision_needed'
        case 'needs_user':
            return 'needs_user'
        case 'replan_needed':
            return 'failed'
    }
}

export class OmcManagerController {
    constructor(private readonly options: {
        store: Store
        namespace: string
        engine?: SyncEngine | null
    }) {
    }

    private emitTopicUpdated(topic: OmcDecisionTopic): void {
        this.options.engine?.handleRealtimeEvent(buildOmcTopicUpdatedEvent(topic, this.options.namespace))
    }

    private emitTurnAdded(topic: OmcDecisionTopic, turn: OmcDecisionTopicTurn): void {
        this.options.engine?.handleRealtimeEvent(buildOmcTopicTurnAddedEvent(topic, turn, this.options.namespace))
    }

    private emitMailboxAdded(message: OmcMailboxMessage): void {
        this.options.engine?.handleRealtimeEvent(buildOmcMailboxMessageAddedEvent(message, this.options.namespace))
    }

    private emitWorkOrderUpdated(workOrder: OmcWorkOrder): void {
        this.options.engine?.handleRealtimeEvent(buildOmcWorkOrderUpdatedEvent(workOrder, this.options.namespace))
    }

    private emitWorkAttemptAdded(workAttempt: OmcWorkAttempt): void {
        this.options.engine?.handleRealtimeEvent(buildOmcWorkAttemptAddedEvent(workAttempt, this.options.namespace))
    }

    private emitWorkAttemptUpdated(workAttempt: OmcWorkAttempt): void {
        this.options.engine?.handleRealtimeEvent(buildOmcWorkAttemptUpdatedEvent(workAttempt, this.options.namespace))
    }

    private emitAgentUpdated(agent: OmcCoordinationAgentState): void {
        this.options.engine?.handleRealtimeEvent(buildOmcCoordinationAgentUpdatedEvent(agent, this.options.namespace))
    }

    private emitDirectiveUpdated(entryId: string): void {
        const directive = this.options.store.omcRuntime.getDirectiveLedgerEntryByNamespace(entryId, this.options.namespace)
        if (!directive) {
            return
        }

        this.options.engine?.handleRealtimeEvent(buildOmcDirectiveLedgerUpdatedEvent(directive, this.options.namespace))
    }

    private appendTurn(topic: OmcDecisionTopic, input: {
        author: OmcDecisionTopicTurn['author']
        kind: OmcDecisionTopicTurn['kind']
        body: string
        sessionId?: string | null
        sessionMessageId?: string | null
        replyState?: OmcDecisionTopicTurn['replyState']
        createdAt?: number
    }): OmcDecisionTopicTurn {
        const turn = this.options.store.omcRuntime.addDecisionTopicTurn(this.options.namespace, {
            id: createId('omc-topic-turn'),
            topicId: topic.id,
            programId: topic.programId,
            author: input.author,
            kind: input.kind,
            body: input.body,
            sessionId: input.sessionId ?? null,
            sessionMessageId: input.sessionMessageId ?? null,
            replyState: input.replyState ?? 'none',
            createdAt: input.createdAt,
        })
        this.emitTurnAdded(topic, turn)
        return turn
    }

    private requireWorkOrder(programId: string, workOrderId: string): OmcWorkOrder {
        const workOrder = this.options.store.omcRuntime.getWorkOrderByNamespace(workOrderId, this.options.namespace)
        if (!workOrder || workOrder.programId !== programId) {
            throw new Error(`OMC work order ${workOrderId} was not found.`)
        }
        return workOrder
    }

    private requireWorkAttempt(workAttemptId: string, expectedRole: OmcWorkAttempt['role']): OmcWorkAttempt {
        const attempt = this.options.store.omcRuntime.getWorkAttemptByNamespace(workAttemptId, this.options.namespace)
        if (!attempt || attempt.role !== expectedRole) {
            throw new Error(`OMC ${expectedRole} attempt ${workAttemptId} was not found.`)
        }
        return attempt
    }

    private findLinkedWorkOrder(programId: string, input: {
        topicId: string
        planKey?: string | null
    }): OmcWorkOrder | null {
        const existingTopic = this.options.store.omcRuntime.getDecisionTopicByNamespace(input.topicId, this.options.namespace)
        if (existingTopic?.workOrderId) {
            const workOrder = this.options.store.omcRuntime.getWorkOrderByNamespace(existingTopic.workOrderId, this.options.namespace)
            if (workOrder?.programId === programId) {
                return workOrder
            }
        }

        if (!input.planKey) {
            return null
        }

        return this.options.store.omcRuntime
            .listWorkOrders(programId, this.options.namespace)
            .find((workOrder) => workOrder.planKey === input.planKey)
            ?? null
    }

    private upsertAgentState(input: {
        programId: string
        role: 'manager' | 'driver' | 'reviewer' | 'planner'
        busy: boolean
        currentWorkOrderId?: string | null
        activeSessionId?: string | null
        model?: string | null
        mode?: string | null
    }): OmcCoordinationAgentState {
        const current = this.options.store.omcRuntime.getCoordinationAgentState(
            input.programId,
            input.role,
            this.options.namespace
        )
        return this.options.store.omcRuntime.upsertCoordinationAgentState(this.options.namespace, {
            programId: input.programId,
            role: input.role,
            busy: input.busy,
            currentWorkOrderId: input.currentWorkOrderId ?? null,
            activeSessionId: input.activeSessionId ?? null,
            model: input.model !== undefined ? input.model : current?.model ?? null,
            mode: input.mode !== undefined ? input.mode : current?.mode ?? null,
            lastHeartbeat: Date.now(),
        })
    }

    assignWorkOrderToDriver(programId: string, input: {
        workOrderId: string
        body: string
        sessionId?: string | null
        model?: string | null
        mode?: string | null
    }): {
        workOrder: OmcWorkOrder
        attempt: OmcWorkAttempt
        mailbox: OmcMailboxMessage
    } {
        const workOrder = this.requireWorkOrder(programId, input.workOrderId)
        const now = Date.now()
        const mailbox = this.options.store.omcRuntime.addMailboxMessage(this.options.namespace, {
            id: createId('omc-mailbox'),
            programId,
            from: 'manager',
            to: 'driver',
            thread: workOrder.id,
            kind: 'task-assignment',
            priority: 'high',
            body: input.body,
            createdAt: now,
        })
        this.emitMailboxAdded(mailbox)
        const attempt = this.options.store.omcRuntime.addWorkAttempt(this.options.namespace, {
            id: createId('omc-work-attempt'),
            programId,
            workOrderId: workOrder.id,
            role: 'driver',
            sessionId: input.sessionId ?? null,
            status: 'running',
            summary: input.body,
            sourceMailboxMessageId: mailbox.id,
            createdAt: now,
        })
        this.emitWorkAttemptAdded(attempt)
        const nextWorkOrder = this.options.store.omcRuntime.updateWorkOrder(this.options.namespace, workOrder.id, {
            owner: 'driver',
            status: 'in_progress',
            currentAttemptId: attempt.id,
            reviewerVerdict: null,
            blockedReason: null,
            updatedAt: now,
        })
        if (!nextWorkOrder) {
            throw new Error(`Failed to update OMC work order ${workOrder.id}.`)
        }
        this.emitWorkOrderUpdated(nextWorkOrder)

        const driverState = this.upsertAgentState({
            programId,
            role: 'driver',
            busy: true,
            currentWorkOrderId: workOrder.id,
            activeSessionId: input.sessionId ?? null,
            model: input.model ?? null,
            mode: input.mode ?? null,
        })
        this.emitAgentUpdated(driverState)

        return {
            workOrder: nextWorkOrder,
            attempt,
            mailbox,
        }
    }

    requestReview(programId: string, input: {
        workOrderId: string
        driverAttemptId: string
        body: string
    }): {
        workOrder: OmcWorkOrder
        reviewAttempt: OmcWorkAttempt
        mailbox: OmcMailboxMessage
    } {
        const workOrder = this.requireWorkOrder(programId, input.workOrderId)
        const driverAttempt = this.requireWorkAttempt(input.driverAttemptId, 'driver')
        if (driverAttempt.workOrderId !== workOrder.id || driverAttempt.programId !== programId) {
            throw new Error(`Driver attempt ${driverAttempt.id} does not belong to work order ${workOrder.id}.`)
        }

        const now = Date.now()
        const mailbox = this.options.store.omcRuntime.addMailboxMessage(this.options.namespace, {
            id: createId('omc-mailbox'),
            programId,
            from: 'driver',
            to: 'reviewer',
            thread: workOrder.id,
            kind: 'review-request',
            priority: 'high',
            body: input.body,
            createdAt: now,
        })
        this.emitMailboxAdded(mailbox)
        const reviewAttempt = this.options.store.omcRuntime.addWorkAttempt(this.options.namespace, {
            id: createId('omc-work-attempt'),
            programId,
            workOrderId: workOrder.id,
            role: 'reviewer',
            status: 'reviewing',
            summary: input.body,
            sourceMailboxMessageId: mailbox.id,
            createdAt: now,
        })
        this.emitWorkAttemptAdded(reviewAttempt)
        const nextWorkOrder = this.options.store.omcRuntime.updateWorkOrder(this.options.namespace, workOrder.id, {
            owner: 'reviewer',
            status: 'in_review',
            currentAttemptId: driverAttempt.id,
            reviewerVerdict: null,
            blockedReason: null,
            updatedAt: now,
        })
        if (!nextWorkOrder) {
            throw new Error(`Failed to move OMC work order ${workOrder.id} into review.`)
        }
        this.emitWorkOrderUpdated(nextWorkOrder)

        const driverState = this.upsertAgentState({
            programId,
            role: 'driver',
            busy: false,
            currentWorkOrderId: null,
            activeSessionId: null,
        })
        this.emitAgentUpdated(driverState)
        const reviewerState = this.upsertAgentState({
            programId,
            role: 'reviewer',
            busy: true,
            currentWorkOrderId: workOrder.id,
            activeSessionId: null,
        })
        this.emitAgentUpdated(reviewerState)

        return {
            workOrder: nextWorkOrder,
            reviewAttempt,
            mailbox,
        }
    }

    submitReviewVerdict(programId: string, input: {
        workOrderId: string
        reviewAttemptId: string
        verdict: OmcReviewVerdict
        body: string
    }): {
        workOrder: OmcWorkOrder
        reviewAttempt: OmcWorkAttempt
        mailbox: OmcMailboxMessage
    } {
        const workOrder = this.requireWorkOrder(programId, input.workOrderId)
        const reviewAttempt = this.requireWorkAttempt(input.reviewAttemptId, 'reviewer')
        if (reviewAttempt.workOrderId !== workOrder.id || reviewAttempt.programId !== programId) {
            throw new Error(`Reviewer attempt ${reviewAttempt.id} does not belong to work order ${workOrder.id}.`)
        }

        const now = Date.now()
        const mailbox = this.options.store.omcRuntime.addMailboxMessage(this.options.namespace, {
            id: createId('omc-mailbox'),
            programId,
            from: 'reviewer',
            to: 'manager',
            thread: workOrder.id,
            kind: 'review-verdict',
            priority: 'high',
            body: input.body,
            createdAt: now,
        })
        this.emitMailboxAdded(mailbox)
        const nextReviewAttempt = this.options.store.omcRuntime.updateWorkAttempt(this.options.namespace, reviewAttempt.id, {
            status: mapReviewVerdictToAttemptStatus(input.verdict),
            summary: input.body,
            sourceMailboxMessageId: mailbox.id,
            completedAt: now,
        })
        if (!nextReviewAttempt) {
            throw new Error(`Failed to update reviewer attempt ${reviewAttempt.id}.`)
        }
        this.emitWorkAttemptUpdated(nextReviewAttempt)

        const nextWorkOrder = this.options.store.omcRuntime.updateWorkOrder(this.options.namespace, workOrder.id, {
            owner: null,
            status: input.verdict === 'accepted'
                ? 'done'
                : input.verdict === 'needs_user'
                    ? 'waiting_user'
                    : input.verdict === 'replan_needed'
                        ? 'replanning'
                        : 'ready',
            reviewerVerdict: input.verdict,
            blockedReason: input.verdict === 'needs_user' || input.verdict === 'replan_needed'
                ? input.body
                : null,
            latestAcceptedAttemptId: input.verdict === 'accepted'
                ? workOrder.currentAttemptId ?? workOrder.latestAcceptedAttemptId ?? null
                : workOrder.latestAcceptedAttemptId ?? null,
            updatedAt: now,
        })
        if (!nextWorkOrder) {
            throw new Error(`Failed to apply reviewer verdict to work order ${workOrder.id}.`)
        }
        this.emitWorkOrderUpdated(nextWorkOrder)

        const reviewerState = this.upsertAgentState({
            programId,
            role: 'reviewer',
            busy: false,
            currentWorkOrderId: null,
            activeSessionId: null,
        })
        this.emitAgentUpdated(reviewerState)

        return {
            workOrder: nextWorkOrder,
            reviewAttempt: nextReviewAttempt,
            mailbox,
        }
    }

    consumeTopicReplyAsMailboxMessage(
        program: OmcProgram,
        input: OmcDecisionTopicReplyRequest
    ): OmcDecisionTopicReplyResponse {
        const turnClock = Date.now()
        const userTurnKind = classifyUserTurnKind(input.text)
        const linkedWorkOrder = this.findLinkedWorkOrder(program.id, {
            topicId: input.topicId,
            planKey: input.planKey ?? null,
        })
        const topic = this.options.store.omcRuntime.upsertDecisionTopic(this.options.namespace, {
            id: input.topicId,
            programId: program.id,
            kind: input.kind,
            title: input.title,
            goalId: input.goalId ?? null,
            planKey: input.planKey ?? null,
            workOrderId: linkedWorkOrder?.id ?? null,
            lifecycle: 'in-progress',
            unread: false,
            bridgeSessionId: input.sessionId ?? null,
            updatedAt: turnClock,
        })
        this.emitTopicUpdated(topic)

        const turns: OmcDecisionTopicTurn[] = []
        turns.push(this.appendTurn(topic, {
            author: 'user',
            kind: userTurnKind,
            body: input.text,
            sessionId: input.sessionId ?? null,
            replyState: 'forwarded',
            createdAt: turnClock,
        }))

        const mailbox = this.options.store.omcRuntime.addMailboxMessage(this.options.namespace, {
            id: createId('omc-mailbox'),
            programId: program.id,
            from: 'user',
            to: 'manager',
            thread: topic.id,
            kind: 'user-reply',
            priority: 'normal',
            body: input.text,
            createdAt: turnClock,
        })
        this.emitMailboxAdded(mailbox)

        let resumedWorkOrder = false
        if (userTurnKind !== 'question') {
            const scopeType = linkedWorkOrder
                ? 'work_order'
                : input.planKey
                    ? 'plan'
                    : input.goalId
                        ? 'goal'
                        : 'program'
            const scopeId = linkedWorkOrder?.id ?? input.planKey ?? input.goalId ?? program.id
            const directive = this.options.store.omcRuntime.upsertDirectiveLedgerEntry(this.options.namespace, {
                id: createId('omc-directive'),
                programId: program.id,
                scopeType,
                scopeId,
                sourceTopicId: topic.id,
                key: `topic-reply:${topic.id}:${turnClock}`,
                summary: input.text.trim(),
                rawText: input.text.trim(),
                createdAt: turnClock,
                updatedAt: turnClock,
            })
            this.emitDirectiveUpdated(directive.id)

            if (linkedWorkOrder && (linkedWorkOrder.status === 'waiting_user' || linkedWorkOrder.status === 'blocked')) {
                const updatedWorkOrder = this.options.store.omcRuntime.updateWorkOrder(this.options.namespace, linkedWorkOrder.id, {
                    owner: null,
                    status: 'ready',
                    reviewerVerdict: null,
                    blockedReason: null,
                    updatedAt: turnClock,
                })
                if (updatedWorkOrder) {
                    this.emitWorkOrderUpdated(updatedWorkOrder)
                    resumedWorkOrder = true
                }
            }
        }

        this.options.store.omcRuntime.markMailboxMessageRead(this.options.namespace, mailbox.id, turnClock)

        turns.push(this.appendTurn(topic, {
            author: 'manager',
            kind: 'ack',
            body: buildManagerAck({
                sessionId: input.sessionId ?? null,
                userTurnKind,
                resumedWorkOrder,
            }),
            sessionId: input.sessionId ?? null,
            replyState: 'forwarded',
            createdAt: turnClock + 1,
        }))

        return {
            topic,
            turns,
        }
    }

    getProgramRuntimeState(programId: string): OmcProgramRuntimeStateResponse {
        return {
            programId,
            mailbox: this.options.store.omcRuntime.listMailboxMessages(programId, this.options.namespace),
            workOrders: this.options.store.omcRuntime.listWorkOrders(programId, this.options.namespace),
            workAttempts: this.options.store.omcRuntime.listWorkAttemptsForProgram(programId, this.options.namespace),
            agents: this.options.store.omcRuntime.listCoordinationAgentStates(programId, this.options.namespace),
            directives: this.options.store.omcRuntime.listDirectiveLedgerEntries(programId, this.options.namespace),
        }
    }
}
