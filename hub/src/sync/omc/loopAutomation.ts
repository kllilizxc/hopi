import { isObject } from '@hopi/protocol'
import type { SyncEvent } from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildSystemOmcAttemptOutcome, parseOmcAttemptOutcome, parseOmcFallbackTerminationMessage } from './attemptOutcome'
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
            return
        }

        if (event.type === 'session-updated' && event.sessionId) {
            void this.handleSessionUpdatedEvent(event)
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            void this.handleSessionRemovedEvent(event)
            return
        }

        if (event.type === 'machine-updated' && event.machineId) {
            void this.handleMachineUpdatedEvent(event)
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

    private async handleSessionUpdatedEvent(event: Extract<SyncEvent, { type: 'session-updated' }>): Promise<void> {
        if (!isObject(event.data) || event.data.active !== false) {
            return
        }

        const attempt = this.store.omcRuntime.getRunningAttemptBySessionId(event.sessionId, event.namespace ?? 'default')
        if (!attempt) {
            return
        }

        const program = this.store.omcRuntime.getProgramByNamespace(attempt.programId, event.namespace ?? 'default')
        if (!program) {
            return
        }

        await this.getController(event.namespace ?? 'default').handleAttemptOutcome({
            program,
            attempt,
            outcome: buildSystemOmcAttemptOutcome({
                status: 'failed',
                summary: 'The linked session became inactive before the attempt reported a structured outcome.',
                terminationReason: 'session-inactive',
                failureFingerprint: 'session-inactive',
                nextSuggestedStep: 'Inspect the session history, then resume the loop when the machine is stable.'
            })
        })
    }

    private async handleSessionRemovedEvent(event: Extract<SyncEvent, { type: 'session-removed' }>): Promise<void> {
        const attempt = this.store.omcRuntime.getRunningAttemptBySessionId(event.sessionId, event.namespace ?? 'default')
        if (!attempt) {
            return
        }

        const program = this.store.omcRuntime.getProgramByNamespace(attempt.programId, event.namespace ?? 'default')
        if (!program) {
            return
        }

        await this.getController(event.namespace ?? 'default').handleAttemptOutcome({
            program,
            attempt,
            outcome: buildSystemOmcAttemptOutcome({
                status: 'failed',
                summary: 'The linked session was removed before the attempt reported a structured outcome.',
                terminationReason: 'session-removed',
                failureFingerprint: 'session-removed',
                nextSuggestedStep: 'Restart the loop after confirming the runner and session lifecycle are healthy.'
            })
        })
    }

    private async handleMachineUpdatedEvent(event: Extract<SyncEvent, { type: 'machine-updated' }>): Promise<void> {
        if (!isObject(event.data) || event.data.active !== false) {
            return
        }

        const namespace = event.namespace ?? 'default'
        const programs = this.store.omcRuntime.listProgramsByNamespace(namespace)
            .filter((program) => program.machineId === event.machineId)

        for (const program of programs) {
            const runtimes = this.store.omcRuntime.listPlanRuntimes(program.id, namespace)
                .filter((runtime) => runtime.loopStatus === 'running')

            for (const runtime of runtimes) {
                const attempt = this.store.omcRuntime.listAttempts(program.id, runtime.planKey, namespace)
                    .find((item) => item.status === 'running' && !item.completedAt)
                if (!attempt) {
                    continue
                }

                await this.getController(namespace).handleAttemptOutcome({
                    program,
                    attempt,
                    outcome: buildSystemOmcAttemptOutcome({
                        status: 'failed',
                        summary: 'The runner machine went offline while the OMC attempt was still running.',
                        terminationReason: 'runner-offline',
                        failureFingerprint: 'runner-offline',
                        nextSuggestedStep: 'Bring the runner back online, then resume the loop.'
                    })
                })
            }
        }
    }
}
