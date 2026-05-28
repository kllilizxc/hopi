import { describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import { Store } from '../store'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { EventPublisher } from './eventPublisher'
import { MessageService } from './messageService'
import type { SessionDebugLogRecordInput } from './sessionDebugLogger'

function createIo(): Server {
    return {
        of() {
            return {
                to() {
                    return {
                        emit() {
                        }
                    }
                }
            }
        }
    } as unknown as Server
}

describe('MessageService session debug logging', () => {
    it('logs injected messages after persistence', () => {
        const store = new Store(':memory:')
        const visibilityTracker = new VisibilityTracker()
        const sseManager = new SSEManager(0, visibilityTracker)
        const publisher = new EventPublisher(sseManager, (event) => event.namespace)
        const records: SessionDebugLogRecordInput[] = []
        const session = store.sessions.getOrCreateSession(
            'session-injected',
            { path: '/tmp/project', host: 'test' },
            null,
            'default'
        )
        const service = new MessageService(store, createIo(), publisher, {
            append(record) {
                records.push(record)
            }
        })

        service.injectMessage(session.id, {
            localId: 'local-injected',
            content: {
                role: 'user',
                content: { type: 'text', text: 'hello' },
                meta: { sentFrom: 'webapp' }
            }
        })

        const stored = store.messages.getMessages(session.id, 1)
        expect(stored).toHaveLength(1)
        expect(records).toEqual([
            expect.objectContaining({
                sessionId: session.id,
                event: 'message.injected',
                direction: 'hub-to-cli',
                seq: stored[0]!.seq,
                localId: 'local-injected',
                payload: stored[0]!.content
            })
        ])
    })
})
