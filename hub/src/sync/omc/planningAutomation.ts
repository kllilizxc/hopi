import { isObject } from '@hopi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import type { DecryptedMessage, SyncEvent } from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { OmcPlanningRunController, type OmcGuidedPlanningSignal } from './planningRunController'

const OMC_GUIDED_PLANNING_MARKER = 'OMC_GUIDED_PLANNING_OUTCOME'

function extractText(value: unknown): string | null {
    if (typeof value === 'string') {
        return value
    }

    if (Array.isArray(value)) {
        const parts = value
            .map((item) => extractText(item))
            .filter((item): item is string => Boolean(item))
        return parts.length > 0 ? parts.join('\n\n') : null
    }

    if (!isObject(value)) {
        return null
    }

    if (typeof value.text === 'string') {
        return value.text
    }

    if ('content' in value) {
        return extractText(value.content)
    }

    if ('message' in value) {
        return extractText(value.message)
    }

    return null
}

function extractAssistantText(value: unknown): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (record && (record.role === 'assistant' || record.role === 'agent')) {
        return extractText(record.content)
    }

    return null
}

function extractCodexMessageSummary(value: unknown): string | null {
    if (!isObject(value) || typeof value.type !== 'string') {
        return null
    }

    if (value.type === 'message' && typeof value.message === 'string' && value.message.trim()) {
        return value.message.trim()
    }

    if (value.type === 'plan') {
        if (typeof value.explanation === 'string' && value.explanation.trim()) {
            return `Plan updated: ${value.explanation.trim()}`
        }

        if (Array.isArray(value.entries) && value.entries.length > 0) {
            return `Plan updated (${value.entries.length} steps)`
        }
    }

    if (value.type === 'error' && typeof value.message === 'string' && value.message.trim()) {
        return value.message.trim()
    }

    return null
}

export function extractOmcGuidedPlanningSummary(value: unknown): string | null {
    const assistantText = extractAssistantText(value)?.trim()
    if (assistantText) {
        return assistantText
    }

    return extractCodexMessageSummary(value)
}

function parseJsonCandidate(text: string): unknown | null {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return null
    }
}

function parseSignalCandidate(value: unknown): OmcGuidedPlanningSignal | null {
    if (!isObject(value)) {
        return null
    }

    if (value.status !== 'completed' && value.status !== 'failed') {
        return null
    }

    if (typeof value.summary !== 'string' || !value.summary.trim()) {
        return null
    }

    return {
        status: value.status,
        summary: value.summary.trim(),
        error: typeof value.error === 'string' && value.error.trim()
            ? value.error.trim()
            : null,
        generatedPlanPaths: Array.isArray(value.generatedPlanPaths)
            ? value.generatedPlanPaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : []
    }
}

export function parseOmcGuidedPlanningSignal(value: unknown): OmcGuidedPlanningSignal | null {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (record && (record.role === 'assistant' || record.role === 'agent')) {
        const direct = parseSignalCandidate(record.content)
        if (direct) {
            return direct
        }

        const text = extractText(record.content)
        if (text) {
            return parseOmcGuidedPlanningSignal(text)
        }
    }

    if (typeof value !== 'string') {
        return parseSignalCandidate(value)
    }

    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }

    const direct = parseJsonCandidate(trimmed)
    const directSignal = direct ? parseSignalCandidate(direct) : null
    if (directSignal) {
        return directSignal
    }

    const fencedMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)]
    for (const match of fencedMatches) {
        const candidate = parseJsonCandidate(match[1] ?? '')
        const signal = candidate ? parseSignalCandidate(candidate) : null
        if (signal) {
            return signal
        }
    }

    const markerIndex = trimmed.indexOf(OMC_GUIDED_PLANNING_MARKER)
    if (markerIndex >= 0) {
        const afterMarker = trimmed.slice(markerIndex + OMC_GUIDED_PLANNING_MARKER.length).trim()
        const candidate = parseJsonCandidate(afterMarker)
        const signal = candidate ? parseSignalCandidate(candidate) : null
        if (signal) {
            return signal
        }
    }

    return null
}

export class OmcPlanningAutomation {
    private readonly controllers = new Map<string, OmcPlanningRunController>()

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine
    ) {}

    private getController(namespace: string): OmcPlanningRunController {
        const existing = this.controllers.get(namespace)
        if (existing) {
            return existing
        }

        const controller = new OmcPlanningRunController({
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
        const run = this.store.omcRuntime.getRunningPlanningRunBySessionId(event.sessionId, event.namespace ?? 'default')
        if (!run) {
            return
        }

        const program = this.store.omcRuntime.getProgramByNamespace(run.programId, event.namespace ?? 'default')
        if (!program) {
            return
        }

        await this.getController(event.namespace ?? 'default').handleRunMessage({
            program,
            runId: run.id,
            signal: parseOmcGuidedPlanningSignal(event.message.content),
            summaryText: extractOmcGuidedPlanningSummary(event.message.content)
        })
    }

    private async handleSessionUpdatedEvent(event: Extract<SyncEvent, { type: 'session-updated' }>): Promise<void> {
        if (!isObject(event.data) || event.data.active !== false) {
            return
        }

        const run = this.store.omcRuntime.getRunningPlanningRunBySessionId(event.sessionId, event.namespace ?? 'default')
        if (!run) {
            return
        }

        const program = this.store.omcRuntime.getProgramByNamespace(run.programId, event.namespace ?? 'default')
        if (!program) {
            return
        }

        await this.getController(event.namespace ?? 'default').handleRunStopped({
            program,
            runId: run.id,
            summary: 'The guided-planning session became inactive before OMC confirmed the first executable plan cards.',
            error: 'session-inactive'
        })
    }

    private async handleSessionRemovedEvent(event: Extract<SyncEvent, { type: 'session-removed' }>): Promise<void> {
        const run = this.store.omcRuntime.getRunningPlanningRunBySessionId(event.sessionId, event.namespace ?? 'default')
        if (!run) {
            return
        }

        const program = this.store.omcRuntime.getProgramByNamespace(run.programId, event.namespace ?? 'default')
        if (!program) {
            return
        }

        await this.getController(event.namespace ?? 'default').handleRunStopped({
            program,
            runId: run.id,
            summary: 'The guided-planning session was removed before OMC confirmed the first executable plan cards.',
            error: 'session-removed'
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
            const run = this.store.omcRuntime.getActivePlanningRun(program.id, namespace)
            if (!run) {
                continue
            }

            await this.getController(namespace).handleRunStopped({
                program,
                runId: run.id,
                summary: 'The runner machine went offline while guided planning was still running.',
                error: 'runner-offline'
            })
        }
    }
}
