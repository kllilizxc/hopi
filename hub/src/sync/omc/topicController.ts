import type {
    OmcDecisionTopic,
    OmcDecisionTopicThread,
    OmcDecisionTopicReplyRequest,
    OmcDecisionTopicReplyResponse,
    OmcDecisionTopicTurn,
    OmcProgram,
} from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildOmcTopicTurnAddedEvent, buildOmcTopicUpdatedEvent } from './events'

function createId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`
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

export class OmcTopicController {
    constructor(private readonly options: {
        store: Store
        engine: SyncEngine
        namespace: string
    }) {
    }

    listTopics(programId: string): OmcDecisionTopicThread[] {
        return this.options.store.omcRuntime.listDecisionTopics(programId, this.options.namespace).map((topic) => ({
            id: topic.id,
            programId: topic.programId,
            kind: topic.kind,
            title: topic.title,
            goalId: topic.goalId ?? null,
            planKey: topic.planKey ?? null,
            workOrderId: topic.workOrderId ?? null,
            lifecycle: topic.lifecycle,
            unread: topic.unread,
            bridgeSessionId: topic.bridgeSessionId ?? null,
            createdAt: topic.createdAt,
            updatedAt: topic.updatedAt,
            turns: this.options.store.omcRuntime.listDecisionTopicTurns(topic.id, this.options.namespace),
        }))
    }

    private emitTopicUpdated(topic: OmcDecisionTopic): void {
        this.options.engine.handleRealtimeEvent(buildOmcTopicUpdatedEvent(topic, this.options.namespace))
    }

    private emitTurnAdded(topic: OmcDecisionTopic, turn: OmcDecisionTopicTurn): void {
        this.options.engine.handleRealtimeEvent(buildOmcTopicTurnAddedEvent(topic, turn, this.options.namespace))
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

    async replyToTopic(program: OmcProgram, input: OmcDecisionTopicReplyRequest): Promise<OmcDecisionTopicReplyResponse> {
        const baseTopic = this.options.store.omcRuntime.upsertDecisionTopic(this.options.namespace, {
            id: input.topicId,
            programId: program.id,
            kind: input.kind,
            title: input.title,
            goalId: input.goalId ?? null,
            planKey: input.planKey ?? null,
            lifecycle: 'in-progress',
            unread: false,
            bridgeSessionId: input.sessionId ?? null,
        })
        this.emitTopicUpdated(baseTopic)

        const turnClock = Date.now()
        const turns: OmcDecisionTopicTurn[] = []
        turns.push(this.appendTurn(baseTopic, {
            author: 'user',
            kind: classifyUserTurnKind(input.text),
            body: input.text,
            sessionId: input.sessionId ?? null,
            replyState: input.sessionId ? 'forwarded' : 'none',
            createdAt: turnClock,
        }))

        if (!input.sessionId) {
            const topic = this.options.store.omcRuntime.updateDecisionTopic(this.options.namespace, baseTopic.id, {
                lifecycle: 'waiting',
                unread: false,
                bridgeSessionId: null,
            }) ?? baseTopic
            this.emitTopicUpdated(topic)
            turns.push(this.appendTurn(topic, {
                author: 'system',
                kind: 'ack',
                body: '当前没有可关联的执行会话，这条消息已经记到线程里，但还不能自动转给底层 agent。',
                replyState: 'failed',
                createdAt: turnClock + 1,
            }))
            return { topic, turns }
        }

        try {
            await this.options.engine.sendMessage(input.sessionId, {
                text: input.text,
                sentFrom: 'webapp',
            })
        } catch (error) {
            const topic = this.options.store.omcRuntime.updateDecisionTopic(this.options.namespace, baseTopic.id, {
                lifecycle: 'waiting',
                unread: false,
                bridgeSessionId: input.sessionId,
            }) ?? baseTopic
            this.emitTopicUpdated(topic)
            turns.push(this.appendTurn(topic, {
                author: 'system',
                kind: 'ack',
                body: error instanceof Error && error.message.trim()
                    ? `消息已经记到线程里，但转发到底层会话失败了：${error.message.trim()}`
                    : '消息已经记到线程里，但转发到底层会话失败了。',
                sessionId: input.sessionId,
                replyState: 'failed',
                createdAt: turnClock + 1,
            }))
            return { topic, turns }
        }

        const topic = this.options.store.omcRuntime.updateDecisionTopic(this.options.namespace, baseTopic.id, {
            lifecycle: 'in-progress',
            unread: false,
            bridgeSessionId: input.sessionId,
        }) ?? baseTopic
        this.emitTopicUpdated(topic)

        turns.push(this.appendTurn(topic, {
            author: 'manager',
            kind: 'ack',
            body: '已转给当前执行会话，收到结果后会回流到这个线程。',
            sessionId: input.sessionId,
            replyState: 'forwarded',
            createdAt: turnClock + 1,
        }))

        return {
            topic,
            turns,
        }
    }
}
