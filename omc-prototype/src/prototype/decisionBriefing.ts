import type { DecisionBriefing, PrototypeApprovalItem } from './types'

type OmcLiveContext = NonNullable<PrototypeApprovalItem['liveContext']>

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

function createIdentity(item: OmcLiveContext): DecisionBriefing['identity'] {
    return {
        projectLabel: item.projectLabel,
        goalLabel: item.goalLabel,
        planLabel: item.planLabel,
        attemptNumber: item.attemptNumber,
        sessionId: item.sessionId,
    }
}

function createRawEvidence(item: OmcLiveContext): DecisionBriefing['rawEvidence'] {
    return {
        summary: item.latestSummary,
        terminationReason: item.terminationReason,
        nextSuggestedStep: item.nextSuggestedStep,
        failureFingerprint: item.failureFingerprint,
        changedFiles: item.changedFiles ?? [],
        defaultExpanded: false,
    }
}

function buildTargetOutcome(item: OmcLiveContext): string | null {
    if (!item.planSummary?.trim()) {
        return null
    }

    return `这张卡要完成：${item.planSummary.trim()}`
}

function formatChangedFiles(changedFiles: string[] | undefined): string | null {
    const files = (changedFiles ?? []).map((file) => file.trim()).filter(Boolean)
    if (!files.length) {
        return null
    }

    if (files.length <= 3) {
        return files.join('、')
    }

    return `${files.slice(0, 3).join('、')} 等 ${files.length} 个文件`
}

function buildChangeSummary(item: OmcLiveContext): string | null {
    const summary = item.latestSummary?.trim() || null
    const filesLabel = formatChangedFiles(item.changedFiles)

    if (summary && filesLabel) {
        return `${summary} 涉及文件：${filesLabel}。`
    }

    if (summary) {
        return summary
    }

    if (filesLabel) {
        return `这轮主要涉及：${filesLabel}。`
    }

    return null
}

function buildRuntimeInterruptionSummary(item: OmcLiveContext): DecisionBriefing {
    return {
        title: buildRuntimeInterruptionTitle(item.terminationReason),
        decisionQuestion: '这一轮是否要在环境恢复后重试，还是先停在这里。',
        identity: createIdentity(item),
        summaryRows: {
            targetOutcome: buildTargetOutcome(item),
            changeSummary: formatChangedFiles(item.changedFiles)
                ? `系统最后观测到的改动涉及：${formatChangedFiles(item.changedFiles)}。`
                : null,
            whatHappened: `${item.projectLabel} 的「${item.planLabel}」这一轮在执行中失去了关联 session，还没来得及上报结构化结果。`,
            whyEscalated: '系统现在不知道这一步到底已经完成了多少，也不能安全判断该继续、重试还是改方向，所以需要你来拍板。',
            recommendedAction: item.nextSuggestedStep
                ? `建议先看执行日志和原始诊断，再决定是否重试：${item.nextSuggestedStep}`
                : '建议先看执行日志；如果只是会话意外断开，通常可以在环境稳定后重试这一轮。',
            currentImpact: '选“重试这一轮”后，系统会重新拉起这一轮 attempt；选“先停在这里”后，这张卡会继续留在收件箱，不会自动推进。',
        },
        primaryAction: {
            label: '重试这一轮',
            helper: '在确认环境已经恢复后再试一次；系统会重新拉起这一轮 attempt。',
        },
        secondaryAction: {
            label: '先停在这里',
            helper: '先不恢复自动推进，这条确认会继续留在收件箱。',
        },
        rawEvidence: createRawEvidence(item),
    }
}

function buildReviewApprovalSummary(item: OmcLiveContext): DecisionBriefing {
    return {
        title: item.planLabel,
        decisionQuestion: '当前这一步的结果是否已经够好，可以结束本轮确认，继续进入下一步。',
        identity: createIdentity(item),
        summaryRows: {
            targetOutcome: buildTargetOutcome(item),
            changeSummary: buildChangeSummary(item),
            whatHappened: `「${item.planLabel}」已经产出当前结果，系统现在停在人工确认点，等你判断要不要把这一轮视为通过。`,
            whyEscalated: '这里不是在问你要不要改技术细节，而是请你判断当前结果是否已经够好，可以继续下一步。',
            recommendedAction: '如果你认可当前结果，就直接放行继续下一步；如果还想再打磨，就先停在这里，再补充你希望 agent 调整什么。',
            currentImpact: '选“认可当前结果，继续下一步”后，状态机会把当前产物视为通过并继续下一步；选“先停在这里”后，这一轮不会继续自动推进。',
        },
        primaryAction: {
            label: '认可当前结果，继续下一步',
            helper: '把当前产物视为通过；状态机会离开这个确认点，继续往后执行。',
        },
        secondaryAction: {
            label: '先停在这里',
            helper: '不继续自动推进；这条确认会留在收件箱，等你补充下一步要求。',
        },
        rawEvidence: createRawEvidence(item),
    }
}

function buildMergeApprovalSummary(item: OmcLiveContext): DecisionBriefing {
    return {
        title: item.planLabel,
        decisionQuestion: '是否允许把当前结果合并到目标分支。',
        identity: createIdentity(item),
        summaryRows: {
            targetOutcome: buildTargetOutcome(item),
            changeSummary: buildChangeSummary(item),
            whatHappened: `「${item.planLabel}」的 review 已经通过，系统现在停在合并前最后一个人工确认点。`,
            whyEscalated: '一旦继续，结果就会进入目标分支，所以这一步必须由你最后拍板。',
            recommendedAction: '如果这次结果已经可以进主线，就批准合并；如果还不想进主线，就先不要合并。',
            currentImpact: '选“批准合并到目标分支”后，系统会继续执行 merge；选“先不要合并”后，当前结果会保留，但不会进入目标分支。',
        },
        primaryAction: {
            label: '批准合并到目标分支',
            helper: '允许系统继续执行 merge，把当前结果推进到目标分支。',
        },
        secondaryAction: {
            label: '先不要合并',
            helper: '当前结果会先保留，但不会进入目标分支。',
        },
        rawEvidence: createRawEvidence(item),
    }
}

function buildMergeBlockedSummary(item: OmcLiveContext): DecisionBriefing {
    return {
        title: item.planLabel,
        decisionQuestion: '当前结果没法直接合并，要继续尝试推进，还是先停在这里。',
        identity: createIdentity(item),
        summaryRows: {
            targetOutcome: buildTargetOutcome(item),
            changeSummary: buildChangeSummary(item),
            whatHappened: `「${item.planLabel}」已经走到合并阶段，但这次合并被阻塞，系统暂时没法自动收尾。`,
            whyEscalated: '现在需要你判断，是继续让 agent 处理这个阻塞并再试一次，还是先停在这里，等你看完情况再决定。',
            recommendedAction: item.nextSuggestedStep
                ? `建议先看阻塞原因和日志，再决定是否继续尝试推进：${item.nextSuggestedStep}`
                : '建议先看阻塞原因和日志；如果只是局部冲突，可以继续尝试推进，否则先停在这里更稳。',
            currentImpact: '选“继续尝试推进”后，系统会再做一轮补救并重新尝试合并；选“先停在这里”后，这条任务会继续停在当前确认点，不会自动推进。',
        },
        primaryAction: {
            label: '继续尝试推进',
            helper: '让系统继续处理当前阻塞，并在补救后重新尝试合并。',
        },
        secondaryAction: {
            label: '先停在这里',
            helper: '先不继续自动推进，等你看完阻塞情况再决定下一步。',
        },
        rawEvidence: createRawEvidence(item),
    }
}

export function buildDecisionBriefing(context: PrototypeApprovalItem['liveContext']): DecisionBriefing | null {
    if (!context || context.source !== 'omc') {
        return null
    }

    if (context.category === 'runtime-interruption') {
        return buildRuntimeInterruptionSummary(context)
    }

    if (context.category === 'review-approval') {
        return buildReviewApprovalSummary(context)
    }

    if (context.category === 'merge-approval') {
        return buildMergeApprovalSummary(context)
    }

    return buildMergeBlockedSummary(context)
}
