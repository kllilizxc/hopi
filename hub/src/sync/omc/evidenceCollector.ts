import { randomUUID } from 'node:crypto'
import type { OmcEvidence } from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildOmcEvidenceAddedEvent } from './events'

export function collectOmcEvidence(options: {
    store: Store
    engine?: SyncEngine | null
    namespace: string
    programId: string
    planKey: string
    attemptId?: string | null
    kind: OmcEvidence['kind']
    label: string
    status: OmcEvidence['status']
    summary: string
    payload?: Record<string, unknown> | null
}): OmcEvidence {
    const evidence = options.store.omcRuntime.addEvidence(options.namespace, {
        id: randomUUID(),
        programId: options.programId,
        planKey: options.planKey,
        attemptId: options.attemptId ?? null,
        kind: options.kind,
        label: options.label,
        status: options.status,
        summary: options.summary,
        payload: options.payload ?? null
    })

    options.engine?.handleRealtimeEvent(buildOmcEvidenceAddedEvent(evidence, options.namespace))
    return evidence
}
