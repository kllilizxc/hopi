import { describe, expect, it } from 'vitest'
import { resolveTaskChatPanel } from './task-workbench'

describe('resolveTaskChatPanel', () => {
    it('keeps task chat on the linked task session even when an assistant intervention exists', () => {
        expect(resolveTaskChatPanel({
            sessionId: 'task-session-1',
            pendingAssistantInterventionId: 'assistant-intervention-1'
        })).toEqual({
            kind: 'task-session',
            sessionId: 'task-session-1'
        })
    })

    it('returns empty when a task has no linked session', () => {
        expect(resolveTaskChatPanel({
            sessionId: null,
            pendingAssistantInterventionId: 'assistant-intervention-1'
        })).toEqual({ kind: 'empty' })
    })
})
