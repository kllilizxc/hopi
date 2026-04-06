import type { OmcPlanRuntime, OmcReviewReopenAction } from '@hopi/protocol/types'
import type { OperatorThread } from './types'

export type OmcThreadIntent =
    | { kind: 'approve-review'; planKey: string }
    | { kind: 'approve-merge'; planKey: string }
    | { kind: 'reopen-review'; planKey: string; action: OmcReviewReopenAction }
    | { kind: 'send-session-message'; sessionId: string; text: string }
    | { kind: 'no-op' }

function normalize(text: string): string {
    return text.trim().toLowerCase()
}

function includesAny(text: string, phrases: string[]): boolean {
    return phrases.some((phrase) => text.includes(phrase))
}

function isApproveLanguage(text: string): boolean {
    return includesAny(text, [
        '放行',
        '批准',
        '通过',
        '可以',
        'ok',
        'okay',
        'approve',
        'ship',
        'go ahead',
        'merge',
        '合并',
    ])
}

function isMergeLanguage(text: string): boolean {
    return includesAny(text, [
        '合并',
        'merge',
        '直接上',
        '直接发',
        'ship it',
        'release',
    ])
}

function isReworkLanguage(text: string): boolean {
    return includesAny(text, [
        '再跑',
        '再来一轮',
        '重做',
        '返工',
        '加固',
        '别合',
        '不要合',
        '不要 merge',
        'don\'t merge',
        'rework',
        'rerun',
        'retry',
        'tighten',
    ])
}

function isReplanLanguage(text: string): boolean {
    return includesAny(text, [
        '回规划',
        '重规划',
        '回到 planning',
        'replan',
        'back to planning',
    ])
}

function resolvePlanKey(thread: OperatorThread, runtime: OmcPlanRuntime | null | undefined): string | null {
    if (runtime?.planKey) {
        return runtime.planKey
    }

    const parts = thread.id.split(':')
    return parts[1] ?? null
}

export function resolveThreadIntent(input: {
    thread: OperatorThread
    text: string
    runtime?: OmcPlanRuntime | null
    sessionId?: string | null
}): OmcThreadIntent {
    const text = normalize(input.text)
    if (!text) {
        return { kind: 'no-op' }
    }

    const planKey = resolvePlanKey(input.thread, input.runtime)

    if (input.thread.kind === 'approval' && planKey) {
        if (isReplanLanguage(text)) {
            return {
                kind: 'reopen-review',
                planKey,
                action: 'back_to_planning',
            }
        }

        if (isReworkLanguage(text)) {
            return {
                kind: 'reopen-review',
                planKey,
                action: 'resume_loop',
            }
        }

        if (isApproveLanguage(text)) {
            if (
                !input.runtime?.reviewRequired
                && input.runtime?.mergeStatus
                && input.runtime.mergeStatus !== 'idle'
                && (
                    isMergeLanguage(text)
                    || input.runtime.mergeStatus === 'blocked'
                    || input.runtime.mergeStatus === 'conflict'
                )
            ) {
                return {
                    kind: 'approve-merge',
                    planKey,
                }
            }

            return {
                kind: 'approve-review',
                planKey,
            }
        }
    }

    if (input.sessionId) {
        return {
            kind: 'send-session-message',
            sessionId: input.sessionId,
            text: input.text,
        }
    }

    return { kind: 'no-op' }
}
