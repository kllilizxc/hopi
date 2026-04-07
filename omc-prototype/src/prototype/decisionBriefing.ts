import type { DecisionBriefing, PrototypeApprovalItem } from './types'

function buildRuntimeInterruptionTitle(terminationReason: string | null | undefined): string {
    switch (terminationReason) {
        case 'session-removed':
            return '执行会话已结束'
        case 'runner-offline':
            return '执行节点离线'
        case 'session-inactive':
        default:
            return '执行中断，等待恢复确认'
    }
}

function buildRuntimeInterruptionSummary(item: NonNullable<PrototypeApprovalItem['liveContext']>): DecisionBriefing {
    const projectLabel = item.projectLabel
    const planLabel = item.planLabel

    return {
        title: buildRuntimeInterruptionTitle(item.terminationReason),
        identity: {
            projectLabel,
            goalLabel: item.goalLabel,
            planLabel,
            attemptNumber: item.attemptNumber,
            sessionId: item.sessionId,
        },
        summaryRows: {
            whatHappened: `${projectLabel} 的「${planLabel}」在执行中失去了关联 session，这一轮还没来得及上报结果。`,
            whyEscalated: '系统现在无法判断这轮应该继续、重试，还是改方向，所以需要你确认下一步。',
            recommendedAction: item.nextSuggestedStep
                ? `建议先查看日志，再决定是否恢复：${item.nextSuggestedStep}`
                : '建议先查看这轮日志；如果只是会话意外断开，可以在环境稳定后重试这一轮。',
            currentImpact: '这张计划卡暂时不会继续自动推进，直到你确认如何处理。',
        },
        primaryAction: {
            label: '重试这一轮',
            helper: '建议先打开执行日志确认原因；重试后系统会重新拉起这一轮 attempt。',
        },
        secondaryAction: {
            label: '先保持现状',
            helper: '保留当前状态，不恢复自动推进，这条话题继续留在收件箱。',
        },
        rawEvidence: {
            summary: item.latestSummary,
            terminationReason: item.terminationReason,
            nextSuggestedStep: item.nextSuggestedStep,
            failureFingerprint: item.failureFingerprint,
            defaultExpanded: false,
        },
    }
}

function buildReviewApprovalSummary(item: NonNullable<PrototypeApprovalItem['liveContext']>): DecisionBriefing {
    return {
        title: item.planLabel,
        identity: {
            projectLabel: item.projectLabel,
            goalLabel: item.goalLabel,
            planLabel: item.planLabel,
            attemptNumber: item.attemptNumber,
            sessionId: item.sessionId,
        },
        summaryRows: {
            whatHappened: `「${item.planLabel}」已经走到人工确认边界。`,
            whyEscalated: item.category === 'merge-blocked'
                ? '当前合并或 review 结果有阻塞，系统不会在问题未明确前继续推进。'
                : '当前 review 已经完成，但是否继续推进仍需要你做人工确认。',
            recommendedAction: item.category === 'merge-blocked'
                ? '建议先查看阻塞原因和相关日志，再决定是继续修复还是保持现状。'
                : '如果你认可当前结果，系统就可以继续推进；不认可的话也可以直接改要求。',
            currentImpact: '在你确认之前，这条计划不会继续自动推进。',
        },
        primaryAction: {
            label: item.category === 'merge-approval' ? '批准合并' : '继续推进',
            helper: item.category === 'merge-approval'
                ? '系统会继续尝试把当前结果推进到目标分支。'
                : '系统会按当前 review 结论进入下一步。',
        },
        secondaryAction: {
            label: '先保持现状',
            helper: '不改变当前计划状态，保留这条话题等待后续处理。',
        },
        rawEvidence: {
            summary: item.latestSummary,
            terminationReason: item.terminationReason,
            nextSuggestedStep: item.nextSuggestedStep,
            failureFingerprint: item.failureFingerprint,
            defaultExpanded: false,
        },
    }
}

export function buildDecisionBriefing(context: PrototypeApprovalItem['liveContext']): DecisionBriefing | null {
    if (!context || context.source !== 'omc') {
        return null
    }

    if (context.category === 'runtime-interruption') {
        return buildRuntimeInterruptionSummary(context)
    }

    return buildReviewApprovalSummary(context)
}
