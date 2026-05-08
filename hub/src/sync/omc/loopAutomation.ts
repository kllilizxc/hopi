import type { SyncEvent } from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { parseOmcAttemptOutcome, parseOmcFallbackTerminationMessage } from './attemptOutcome'
import { OmcLoopController } from './loopController'

export class OmcLoopAutomation {
    private readonly controllers = new Map<string, OmcLoopController>()

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine
    ) {}

    private getController(namespace: string): OmcLoopController {
        const existing = this.controllers.get(namespace)
        if (existing) {
            return existing
        }

        const controller = new OmcLoopController({
            store: this.store,
            engine: this.engine,
            namespace
        })
        this.controllers.set(namespace, controller)
        return controller
    }

    handleEvent(event: SyncEvent): void {
        if (!event.namespace) {
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            void this.handleMessageEvent(event)
        }
    }

    private async handleMessageEvent(event: Extract<SyncEvent, { type: 'message-received' }>): Promise<void> {
        const attempt = this.store.omcRuntime.getRunningAttemptBySessionId(event.sessionId, event.namespace ?? 'default')
        if (!attempt) {
            return
        }

        const outcome = parseOmcAttemptOutcome(event.message.content) ?? parseOmcFallbackTerminationMessage(event.message)
        if (!outcome) {
            return
        }

        const program = this.store.omcRuntime.getProgramByNamespace(attempt.programId, event.namespace ?? 'default')
        if (!program) {
            return
        }

        await this.getController(event.namespace ?? 'default').handleAttemptOutcome({
            program,
            attempt,
            outcome
        })
    }
}
