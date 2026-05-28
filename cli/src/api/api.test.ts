import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSessionDebugId } from '@hopi/protocol'

const harness = vi.hoisted(() => ({
    post: vi.fn()
}))

vi.mock('axios', () => ({
    default: {
        post: harness.post
    }
}))

vi.mock('@/configuration', () => ({
    configuration: {
        apiUrl: 'https://hub.example.com'
    }
}))

vi.mock('@/api/auth', () => ({
    getAuthToken: () => 'token-1'
}))

vi.mock('./apiMachine', () => ({
    ApiMachineClient: class {}
}))

vi.mock('./apiSession', () => ({
    ApiSessionClient: class {}
}))

import { ApiClient } from './api'

describe('ApiClient', () => {
    afterEach(() => {
        harness.post.mockReset()
    })

    it('preserves debugId from create session responses', async () => {
        const sessionId = 'session-alpha'
        const debugId = getSessionDebugId(sessionId)
        harness.post.mockResolvedValueOnce({
            data: {
                session: {
                    id: sessionId,
                    debugId,
                    namespace: 'default',
                    seq: 0,
                    createdAt: 1,
                    updatedAt: 1,
                    active: false,
                    activeAt: 1,
                    metadata: { path: '/tmp/project', host: 'test' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 1,
                    thinking: false,
                    thinkingAt: 0
                }
            }
        })

        const client = await ApiClient.create()
        const session = await client.getOrCreateSession({
            tag: 'session-alpha',
            metadata: { path: '/tmp/project', host: 'test' },
            state: null
        })

        expect(session.debugId).toBe(debugId)
    })
})
