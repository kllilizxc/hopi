import { normalizeSessionMessage } from '@hopi/protocol'
import type {
    OmcDecisionTopic,
    OmcDecisionTopicTurn,
    SyncEvent,
} from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { parseOmcAttemptOutcome, parseOmcFallbackTerminationMessage } from './attemptOutcome'
import { buildOmcTopicTurnAddedEvent, buildOmcTopicUpdatedEvent } from './events'

function createId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`
}

function extractVisibleAgentReply(message: Extract<SyncEvent, { type: 'message-received' }>['message']): string | null {
    if (parseOmcAttemptOutcome(message.content) || parseOmcFallbackTerminationMessage(message)) {
        return null
    }

    const normalized = normalizeSessionMessage(message)
    if (!normalized || normalized.role !== 'agent' || !Array.isArray(normalized.content)) {
        return null
    }

    const parts = normalized.content.flatMap((block): string[] => {
        if (block.type === 'text') {
            return block.text.trim() ? [block.text.trim()] : []
        }
        if (block.type === 'summary') {
            return block.summary.trim() ? [block.summary.trim()] : []
        }
        return []
    })

    if (parts.length === 0) {
        return null
    }

    return Array.from(new Set(parts)).join('\n\n')
}

function topicAwaitsReply(turns: OmcDecisionTopicTurn[]): boolean {
    const lastTurn = turns[turns.length - 1] ?? null
    if (!lastTurn) {
        return false
    }

    return (
        (lastTurn.author === 'user' || lastTurn.author === 'manager')
        && lastTurn.replyState === 'forwarded'
    )
}

function inferAgentTurnKind(turns: OmcDecisionTopicTurn[]): OmcDecisionTopicTurn['kind'] {
    const lastUserTurn = [...turns].reverse().find((turn) => turn.author === 'user') ?? null
    return lastUserTurn?.kind === 'question' ? 'answer' : 'status'
}

export class OmcTopicAutomation {
    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine,
    ) {}

    handleEvent(event: SyncEvent): void {
        if (!event.namespace || event.type !== 'message-received' || !event.sessionId) {
            return
        }

        void this.handleMessageEvent(event)
    }

    private findTargetTopic(sessionId: string, namespace: string): {
        topic: OmcDecisionTopic
        turns: OmcDecisionTopicTurn[]
    } | null {
        const topics = this.store.omcRuntime.listDecisionTopicsByBridgeSession(sessionId, namespace)

        for (const topic of topics) {
            const turns = this.store.omcRuntime.listDecisionTopicTurns(topic.id, namespace)
            if (topicAwaitsReply(turns)) {
                return { topic, turns }
            }
        }

        return null
    }

    private async handleMessageEvent(event: Extract<SyncEvent, { type: 'message-received' }>): Promise<void> {
        const target = this.findTargetTopic(event.sessionId, event.namespace ?? 'default')
        if (!target) {
            return
        }

        if (target.turns.some((turn) => turn.sessionMessageId === event.message.id)) {
            return
        }

        const body = extractVisibleAgentReply(event.message)
        if (!body) {
            return
        }

        const turn = this.store.omcRuntime.addDecisionTopicTurn(event.namespace ?? 'default', {
            id: createId('omc-topic-turn'),
            topicId: target.topic.id,
            programId: target.topic.programId,
            author: 'agent',
            kind: inferAgentTurnKind(target.turns),
            body,
            sessionId: event.sessionId,
            sessionMessageId: event.message.id,
            replyState: 'linked',
            createdAt: event.message.createdAt,
        })
        this.engine.handleRealtimeEvent(buildOmcTopicTurnAddedEvent(target.topic, turn, event.namespace ?? 'default'))

        const updatedTopic = this.store.omcRuntime.updateDecisionTopic(event.namespace ?? 'default', target.topic.id, {
            lifecycle: 'waiting',
            unread: true,
            bridgeSessionId: event.sessionId,
            updatedAt: event.message.createdAt,
        }) ?? target.topic
        this.engine.handleRealtimeEvent(buildOmcTopicUpdatedEvent(updatedTopic, event.namespace ?? 'default'))
    }
}
