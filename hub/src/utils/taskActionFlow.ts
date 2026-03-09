import type { Session } from '@hopi/protocol/types'

import type { SyncEngine } from '../sync/syncEngine'

export type SessionRunnableState = 'ready' | 'queued' | 'approval_pending' | 'session_inactive'
export type WaitForSessionRunnableResult = 'ready' | 'session_inactive' | 'timeout'

export function waitWithUnrefTimer(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
            timer.unref()
        }
    })
}

export function sessionHasPendingRequests(session: Pick<Session, 'agentState'> | null | undefined): boolean {
    return Boolean(session?.agentState?.requests && Object.keys(session.agentState.requests).length > 0)
}

export function getSessionRunnableState(
    session: Pick<Session, 'active' | 'thinking' | 'agentState'> | null | undefined
): SessionRunnableState {
    if (!session || !session.active) {
        return 'session_inactive'
    }

    if (sessionHasPendingRequests(session)) {
        return 'approval_pending'
    }

    if (session.thinking) {
        return 'queued'
    }

    return 'ready'
}

export async function waitForSessionToBecomeRunnable(options: {
    engine: Pick<SyncEngine, 'getSessionByNamespace'>
    sessionId: string
    namespace: string
    timeoutMs: number
    pollIntervalMs: number
}): Promise<WaitForSessionRunnableResult> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < options.timeoutMs) {
        const state = getSessionRunnableState(options.engine.getSessionByNamespace(options.sessionId, options.namespace))
        if (state === 'ready') {
            return 'ready'
        }
        if (state === 'session_inactive') {
            return 'session_inactive'
        }

        await waitWithUnrefTimer(options.pollIntervalMs)
    }

    return 'timeout'
}

export function trimTaskActionOutput(output: string | undefined, maxChars: number): string | null {
    const trimmed = output?.trim() ?? ''
    if (!trimmed) {
        return null
    }

    if (trimmed.length <= maxChars) {
        return trimmed
    }

    return `${trimmed.slice(0, maxChars)}\n… [truncated ${trimmed.length - maxChars} chars]`
}

export function buildTaskActionCommandReportLines(options: {
    command: string
    summary: string
    stdout?: string
    stderr?: string
    maxChars: number
}): string[] {
    const stdout = trimTaskActionOutput(options.stdout, options.maxChars)
    const stderr = trimTaskActionOutput(options.stderr, options.maxChars)

    return [
        `Command: \`${options.command}\``,
        `Result: ${options.summary}`,
        stdout ? `stdout:\n\`\`\`\n${stdout}\n\`\`\`` : 'stdout: (empty)',
        stderr ? `stderr:\n\`\`\`\n${stderr}\n\`\`\`` : 'stderr: (empty)'
    ]
}

export function buildRepeatedTaskActionFailureNote(options: {
    blockedReason: string
    manualStep: string
}): string {
    return `Same blocker repeated with no repo progress: ${options.blockedReason}. ${options.manualStep}`
}

export function buildQueuedActionRuntimeNote(options: {
    actionLabel: string
    continuation: string
}): string {
    return `${options.actionLabel} queued behind the current session turn. ${options.continuation} when the session is free.`
}

export function buildApprovalPendingActionRuntimeNote(options: {
    actionLabel: string
    continuation: string
}): string {
    return `${options.actionLabel} queued until the current approval request is resolved. ${options.continuation} when the session is free.`
}
