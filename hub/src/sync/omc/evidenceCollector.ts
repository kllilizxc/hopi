import { randomUUID } from 'node:crypto'
import type { OmcAttempt, OmcEvidence, OmcEvidenceStatus } from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildOmcEvidenceAddedEvent } from './events'

type DiffSummaryFile = {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
}

function parseDiffNumstat(output: string): DiffSummaryFile[] {
    const lines = output.trim().split('\n').filter((line) => line.trim().length > 0)
    const files: DiffSummaryFile[] = []

    for (const line of lines) {
        const parts = line.split(/\t/)
        if (parts.length < 3) {
            continue
        }

        const added = parts[0]?.trim() === '-' ? 0 : Number.parseInt(parts[0]?.trim() ?? '0', 10)
        const removed = parts[1]?.trim() === '-' ? 0 : Number.parseInt(parts[1]?.trim() ?? '0', 10)
        let rawPath = parts.slice(2).join('\t').trim()

        if (rawPath.includes('{') && rawPath.includes('=>') && rawPath.includes('}')) {
            rawPath = rawPath.replace(/\{[^{}]+?\s*=>\s*([^{}]+?)\}/g, (_match, newPart: string) => newPart.trim())
        } else if (rawPath.includes('=>')) {
            const renameParts = rawPath.split(/\s*=>\s*/)
            rawPath = renameParts[renameParts.length - 1]?.trim() ?? rawPath
        }

        if (!rawPath) {
            continue
        }

        const pathParts = rawPath.split('/')
        const fileName = pathParts[pathParts.length - 1] ?? rawPath
        const filePath = pathParts.slice(0, -1).join('/')
        const normalizedAdded = Number.isFinite(added) ? added : 0
        const normalizedRemoved = Number.isFinite(removed) ? removed : 0
        const status = normalizedAdded > 0 && normalizedRemoved === 0
            ? 'added'
            : normalizedRemoved > 0 && normalizedAdded === 0
                ? 'deleted'
                : 'modified'

        files.push({
            fileName,
            filePath,
            fullPath: rawPath,
            status,
            isStaged: false,
            linesAdded: normalizedAdded,
            linesRemoved: normalizedRemoved
        })
    }

    return files
}

export function mapAttemptStatusToEvidenceStatus(status: OmcAttempt['status']): OmcEvidenceStatus {
    if (status === 'completed' || status === 'progressed') {
        return 'passed'
    }
    if (status === 'blocked' || status === 'failed' || status === 'canceled') {
        return 'warning'
    }
    return 'info'
}

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

export async function collectSystemOmcAttemptEvidence(options: {
    engine: SyncEngine
    attempt: OmcAttempt
    cwd?: string | null
}): Promise<{
    changedFiles: string[]
    diffSummary: DiffSummaryFile[]
}> {
    if (!options.attempt.sessionId) {
        return {
            changedFiles: [],
            diffSummary: []
        }
    }

    try {
        const diffResult = await options.engine.getGitDiffNumstat(options.attempt.sessionId, {
            cwd: options.cwd ?? undefined
        })
        if (!diffResult.success || !diffResult.stdout?.trim()) {
            return {
                changedFiles: [],
                diffSummary: []
            }
        }

        const diffSummary = parseDiffNumstat(diffResult.stdout)
        return {
            changedFiles: diffSummary.map((item) => item.fullPath),
            diffSummary
        }
    } catch {
        return {
            changedFiles: [],
            diffSummary: []
        }
    }
}
