import type { Machine, Session, SessionSummary } from '@/types/api'
import { basename } from '@/utils/path'

type SessionLike = Pick<Session, 'id' | 'metadata'> | Pick<SessionSummary, 'id' | 'metadata'>

export function getSessionDisplayTitle(session: SessionLike): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        return basename(session.metadata.path) || session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

export function getMachineDisplayTitle(machine: Machine | null, fallbackLabel = 'Machine'): string {
    if (!machine) {
        return fallbackLabel
    }
    if (machine.metadata?.displayName) {
        return machine.metadata.displayName
    }
    if (machine.metadata?.host) {
        return machine.metadata.host
    }
    return machine.id.slice(0, 8)
}
