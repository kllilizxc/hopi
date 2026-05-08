import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hopi/protocol/types'
import { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { OmcTopicAutomation } from './topicAutomation'

describe('OmcTopicAutomation', () => {
    it('bridges the next visible assistant reply back into the freshest waiting topic', async () => {
        const store = new Store(':memory:')
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            planningRoot: '/tmp/card-game/.planning',
        })

        store.omcRuntime.upsertDecisionTopic('default', {
            id: 'status:01-foundation',
            programId: 'program-1',
            kind: 'status',
            title: '01 Foundation',
            goalId: '01-foundation',
            planKey: '01-01',
            lifecycle: 'in-progress',
            unread: false,
            bridgeSessionId: 'session-1',
            updatedAt: 100,
        })
        store.omcRuntime.addDecisionTopicTurn('default', {
            id: 'topic-turn-1',
            topicId: 'status:01-foundation',
            programId: 'program-1',
            author: 'user',
            kind: 'question',
            body: '怎么到了山门节点入口中间什么都没有，符合预期吗',
            sessionId: 'session-1',
            replyState: 'forwarded',
            createdAt: 101,
        })
        store.omcRuntime.addDecisionTopicTurn('default', {
            id: 'topic-turn-2',
            topicId: 'status:01-foundation',
            programId: 'program-1',
            author: 'manager',
            kind: 'ack',
            body: '已转给当前执行会话，收到结果后会回流到这个线程。',
            sessionId: 'session-1',
            replyState: 'forwarded',
            createdAt: 102,
        })

        const emitted: SyncEvent[] = []
        const engine = {
            handleRealtimeEvent(event: SyncEvent) {
                emitted.push(event)
            },
        } as unknown as SyncEngine

        const automation = new OmcTopicAutomation(store, engine)
        automation.handleEvent({
            type: 'message-received',
            namespace: 'default',
            sessionId: 'session-1',
            message: {
                id: 'session-msg-3',
                seq: 3,
                localId: null,
                createdAt: 103,
                content: {
                    role: 'assistant',
                    content: {
                        type: 'text',
                        text: '目前这里还是非战斗节点入口骨架，空白不是最终预期，后续会补节点说明和可操作内容。',
                    },
                },
            },
        })

        await Promise.resolve()

        const turns = store.omcRuntime.listDecisionTopicTurns('status:01-foundation', 'default')
        expect(turns).toHaveLength(3)
        expect(turns[2]?.author).toBe('agent')
        expect(turns[2]?.kind).toBe('answer')
        expect(turns[2]?.sessionMessageId).toBe('session-msg-3')
        expect(turns[2]?.body).toContain('空白不是最终预期')

        const topic = store.omcRuntime.getDecisionTopicByNamespace('status:01-foundation', 'default')
        expect(topic?.lifecycle).toBe('waiting')
        expect(topic?.unread).toBe(true)
        expect(emitted.map((event) => event.type)).toEqual(['omc-topic-turn-added', 'omc-topic-updated'])
    })
})
