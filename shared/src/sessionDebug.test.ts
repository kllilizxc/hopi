import { describe, expect, it } from 'bun:test'
import { getSessionDebugId, SESSION_DEBUG_ID_PATTERN } from './sessionDebug'
import { SessionSchema } from './schemas'

describe('session debug ids', () => {
    it('uses a stable public format', () => {
        expect(getSessionDebugId('session-alpha')).toMatch(SESSION_DEBUG_ID_PATTERN)
    })

    it('hashes the exact session id without trimming whitespace', () => {
        expect(getSessionDebugId('abc')).not.toBe(getSessionDebugId('abc '))
        expect(getSessionDebugId('abc')).not.toBe(getSessionDebugId(' abc'))
    })

    it('validates the public debug id format in session payloads', () => {
        const baseSession = {
            id: 'session-alpha',
            debugId: 'not-a-debug-id',
            namespace: 'default',
            seq: 0,
            createdAt: 1,
            updatedAt: 1,
            active: false,
            activeAt: 1,
            metadata: null,
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0
        }

        expect(SessionSchema.safeParse(baseSession).success).toBe(false)
        expect(SessionSchema.safeParse({
            ...baseSession,
            debugId: getSessionDebugId(baseSession.id)
        }).success).toBe(true)
    })
})
