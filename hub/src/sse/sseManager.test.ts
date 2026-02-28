import { describe, expect, it } from 'bun:test'
import { SSEManager } from './sseManager'
import type { SyncEvent } from '../sync/syncEngine'
import { VisibilityTracker } from '../visibility/visibilityTracker'

describe('SSEManager namespace filtering', () => {
    it('routes events to matching namespace', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const receivedAlpha: SyncEvent[] = []
        const receivedBeta: SyncEvent[] = []

        manager.subscribe({
            id: 'alpha',
            namespace: 'alpha',
            all: true,
            send: (event) => {
                receivedAlpha.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'beta',
            namespace: 'beta',
            all: true,
            send: (event) => {
                receivedBeta.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })

        expect(receivedAlpha).toHaveLength(1)
        expect(receivedBeta).toHaveLength(0)
    })

    it('broadcasts connection-changed to all namespaces', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: Array<{ id: string; event: SyncEvent }> = []

        manager.subscribe({
            id: 'alpha',
            namespace: 'alpha',
            all: true,
            send: (event) => {
                received.push({ id: 'alpha', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'beta',
            namespace: 'beta',
            all: true,
            send: (event) => {
                received.push({ id: 'beta', event })
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'connection-changed', data: { status: 'connected' } })

        expect(received).toHaveLength(2)
        expect(received.map((entry) => entry.id).sort()).toEqual(['alpha', 'beta'])
    })

    it('sends toast only to visible connections in a namespace', async () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: Array<{ id: string; event: SyncEvent }> = []

        manager.subscribe({
            id: 'visible',
            namespace: 'alpha',
            all: true,
            visibility: 'visible',
            send: (event) => {
                received.push({ id: 'visible', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'hidden',
            namespace: 'alpha',
            all: true,
            visibility: 'hidden',
            send: (event) => {
                received.push({ id: 'hidden', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'other',
            namespace: 'beta',
            all: true,
            visibility: 'visible',
            send: (event) => {
                received.push({ id: 'other', event })
            },
            sendHeartbeat: () => {}
        })

        const toastEvent: Extract<SyncEvent, { type: 'toast' }> = {
            type: 'toast',
            data: {
                title: 'Test',
                body: 'Toast body',
                sessionId: 'session-1',
                url: '/sessions/session-1'
            }
        }

        const delivered = await manager.sendToast('alpha', toastEvent)

        expect(delivered).toBe(1)
        expect(received).toHaveLength(1)
        expect(received[0]?.id).toBe('visible')
    })

    it('delivers message-received to all subscriptions in a namespace', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const receivedAll: SyncEvent[] = []
        const receivedOther: SyncEvent[] = []

        manager.subscribe({
            id: 'all',
            namespace: 'alpha',
            all: true,
            send: (event) => {
                receivedAll.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'other',
            namespace: 'alpha',
            all: false,
            sessionId: 's-other',
            send: (event) => {
                receivedOther.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({
            type: 'message-received',
            sessionId: 's1',
            namespace: 'alpha',
            message: {
                id: 'm1',
                seq: 1,
                localId: null,
                content: { role: 'assistant', content: { type: 'text', text: 'hello' } },
                createdAt: Date.now()
            }
        })

        expect(receivedAll.map((event) => event.type)).toEqual(['message-received'])
        expect(receivedOther).toHaveLength(0)
    })

    it('keeps broadcasting when one subscriber throws synchronously', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: SyncEvent[] = []

        manager.subscribe({
            id: 'broken',
            namespace: 'alpha',
            all: true,
            send: () => {
                throw new Error('broken-stream')
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'healthy',
            namespace: 'alpha',
            all: true,
            send: (event) => {
                received.push(event)
            },
            sendHeartbeat: () => {}
        })

        expect(() => {
            manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        }).not.toThrow()
        expect(received).toHaveLength(1)

        expect(() => {
            manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        }).not.toThrow()
        expect(received).toHaveLength(2)
    })

    it('sendToast ignores subscribers that throw synchronously', async () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: SyncEvent[] = []

        manager.subscribe({
            id: 'broken',
            namespace: 'alpha',
            all: true,
            visibility: 'visible',
            send: () => {
                throw new Error('broken-stream')
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'healthy',
            namespace: 'alpha',
            all: true,
            visibility: 'visible',
            send: (event) => {
                received.push(event)
            },
            sendHeartbeat: () => {}
        })

        const delivered = await manager.sendToast('alpha', {
            type: 'toast',
            data: {
                title: 'Done',
                body: 'Merged',
                sessionId: '',
                url: ''
            }
        })

        expect(delivered).toBe(1)
        expect(received).toHaveLength(1)
    })
})
