import {
    approvalContextPresentation,
    approvalPresentation,
    formatMoment,
    goalPresentation,
    goalTitle,
    labelDirection,
    labelGoalStatus,
    labelPriority,
    labelRiskSeverity,
    labelStreamStatus,
    phasePresentation,
    planPresentation,
    riskContextPresentation,
    riskPresentation,
    streamPresentation,
} from './presenter'
import { buildDecisionBriefing } from './decisionBriefing'
import type {
    DecisionBriefing,
    OperatorFirstMessage,
    OperatorMessage,
    OperatorThread,
    DecisionTopic,
    QuickActionSpec,
    PrototypeApprovalItem,
    PrototypeGoal,
    PrototypePhase,
    PrototypePlanCard,
    PrototypeRisk,
    PrototypeScenarioSnapshot,
    PrototypeStream,
    PrototypeTimeWindow,
    ThreadContextRef,
    ThreadDetailSection,
    ThreadLifecycleState,
    ThreadPriority,
} from './types'

type ThreadSeed = Omit<OperatorThread, 'unread'> & {
    introMessage: OperatorMessage
}

function overlayDecisionTopic(seed: ThreadSeed, topic: DecisionTopic | null): ThreadSeed {
    if (!topic || topic.kind !== seed.kind) {
        return seed
    }

    const lifecycle = topic.lifecycle
    return {
        ...seed,
        goalId: topic.goalId ?? seed.goalId,
        lifecycle,
        statusLabel: lifecycleLabel(lifecycle),
        tone: lifecycle === 'pending'
            ? (seed.kind === 'risk' ? 'warning' : seed.kind === 'status' ? 'default' : 'accent')
            : 'default',
    }
}

type ExistingThreadState = {
    threadsById: Record<string, OperatorThread>
    messagesByThread: Record<string, OperatorMessage[]>
    activeThreadId: string | null
}

function createMessageId(prefix: string, id: string) {
    return `${prefix}:${id}`
}

function createThreadMessage(params: {
    id: string
    threadId: string
    role: OperatorMessage['role']
    body: string
    createdAt: string
    status?: OperatorMessage['status']
}): OperatorMessage {
    return {
        id: params.id,
        threadId: params.threadId,
        role: params.role,
        body: params.body,
        createdAt: params.createdAt,
        status: params.status,
    }
}

function lifecycleRank(state: ThreadLifecycleState) {
    switch (state) {
        case 'pending':
            return 0
        case 'waiting':
            return 1
        case 'in-progress':
            return 2
        case 'silent':
            return 3
        case 'resolved':
            return 4
    }
}

function priorityRank(priority: ThreadPriority) {
    switch (priority) {
        case 'critical':
            return 0
        case 'high':
            return 1
        case 'medium':
            return 2
        case 'low':
            return 3
    }
}

function lifecycleLabel(state: ThreadLifecycleState) {
    switch (state) {
        case 'pending':
            return '待处理'
        case 'in-progress':
            return '处理中'
        case 'waiting':
            return '等你回复'
        case 'silent':
            return '静默'
        case 'resolved':
            return '已解决'
    }
}

function pushRef(list: ThreadContextRef[], ref: ThreadContextRef | null) {
    if (!ref) {
        return
    }
    if (list.some((item) => item.kind === ref.kind && item.id === ref.id)) {
        return
    }
    list.push(ref)
}

function goalDisplayLabel(goal: PrototypeGoal) {
    const title = goalTitle(goal.id)
    return title === goal.id ? goal.title : title
}

function goalRef(goal: PrototypeGoal): ThreadContextRef {
    return {
        kind: 'goal',
        id: goal.id,
        label: goalDisplayLabel(goal),
    }
}

function streamRef(stream: PrototypeStream): ThreadContextRef {
    return {
        kind: 'stream',
        id: stream.id,
        label: streamPresentation(stream, 'execution').title,
    }
}

function phaseRef(phase: PrototypePhase): ThreadContextRef {
    return {
        kind: 'phase',
        id: phase.id,
        label: phasePresentation(phase).title,
    }
}

function planRef(plan: PrototypePlanCard): ThreadContextRef {
    return {
        kind: 'plan',
        id: plan.id,
        label: planPresentation(plan).title,
    }
}

function impactRef(id: string, label: string): ThreadContextRef {
    return {
        kind: 'impact',
        id,
        label,
    }
}

function normalizeMatchText(value: string) {
    return value.toLowerCase()
}

function tokenizeMatchText(value: string) {
    return Array.from(new Set(normalizeMatchText(value).match(/[a-z0-9]+/g) ?? [])).filter((token) => token.length >= 3)
}

function scoreMatch(queryTexts: Array<string | null | undefined>, candidateTexts: Array<string | null | undefined>) {
    const queryTokens = new Set(queryTexts.flatMap((text) => tokenizeMatchText(text ?? '')))
    const candidateText = candidateTexts
        .filter((text): text is string => Boolean(text && text.trim()))
        .map((text) => normalizeMatchText(text))
        .join(' ')

    let score = 0
    for (const token of queryTokens) {
        if (candidateText.includes(token)) {
            score += 1
        }
    }
    return score
}

function chooseBestStream(snapshot: PrototypeScenarioSnapshot, goalId: string, queryTexts: Array<string | null | undefined>) {
    const streams = snapshot.streams.filter((stream) => stream.goalId === goalId)
    if (streams.length === 0) {
        return null
    }

    const scored = streams.map((stream) => {
        const phases = snapshot.phases.filter((phase) => phase.streamId === stream.id)
        const plans = snapshot.planCards.filter((plan) => plan.streamId === stream.id)

        return {
            stream,
            score: scoreMatch(queryTexts, [
                stream.title,
                stream.summary,
                stream.whyNow,
                stream.latestMove,
                stream.dependencyLabel,
                ...phases.map((phase) => `${phase.title} ${phase.summary}`),
                ...plans.map((plan) => `${plan.title} ${plan.summary} ${plan.signal}`),
            ]),
        }
    })

    scored.sort((left, right) => {
        const scoreDiff = right.score - left.score
        if (scoreDiff !== 0) {
            return scoreDiff
        }
        return left.stream.title.localeCompare(right.stream.title, 'zh-Hans')
    })

    const best = scored[0]
    if (!best || best.score === 0) {
        // Generic fallback: keep the first stream for the goal when text matching is too weak to distinguish topics.
        return streams[0]
    }

    return best.stream
}

function chooseBestPhase(snapshot: PrototypeScenarioSnapshot, streamId: string, queryTexts: Array<string | null | undefined>) {
    const phases = snapshot.phases.filter((phase) => phase.streamId === streamId)
    if (phases.length === 0) {
        return null
    }

    const scored = phases.map((phase) => ({
        phase,
        score: scoreMatch(queryTexts, [phase.title, phase.summary]),
    }))

    scored.sort((left, right) => {
        const scoreDiff = right.score - left.score
        if (scoreDiff !== 0) {
            return scoreDiff
        }
        const leftDone = left.phase.status === 'Done' ? 1 : 0
        const rightDone = right.phase.status === 'Done' ? 1 : 0
        if (leftDone !== rightDone) {
            return leftDone - rightDone
        }
        return left.phase.title.localeCompare(right.phase.title, 'zh-Hans')
    })

    const best = scored[0]
    if (!best || best.score === 0) {
        return phases.find((phase) => phase.status !== 'Done') ?? phases[0]
    }

    return best.phase
}

function chooseBestPlan(snapshot: PrototypeScenarioSnapshot, streamId: string, phaseId: string | null, queryTexts: Array<string | null | undefined>) {
    const plans = snapshot.planCards.filter((plan) => plan.streamId === streamId && (!phaseId || plan.phaseId === phaseId))
    if (plans.length === 0) {
        return null
    }

    const scored = plans.map((plan) => ({
        plan,
        score: scoreMatch(queryTexts, [plan.title, plan.summary, plan.signal, plan.badges.join(' ')]),
    }))

    scored.sort((left, right) => {
        const scoreDiff = right.score - left.score
        if (scoreDiff !== 0) {
            return scoreDiff
        }
        const leftDone = left.plan.column === 'Done' ? 1 : 0
        const rightDone = right.plan.column === 'Done' ? 1 : 0
        if (leftDone !== rightDone) {
            return leftDone - rightDone
        }
        return left.plan.title.localeCompare(right.plan.title, 'zh-Hans')
    })

    const best = scored[0]
    if (!best || best.score === 0) {
        return plans.find((plan) => plan.column !== 'Done') ?? plans[0]
    }

    return best.plan
}

function buildTopicContextRefs(snapshot: PrototypeScenarioSnapshot, goalId: string, queryTexts: Array<string | null | undefined>, impact: ThreadContextRef): ThreadContextRef[] {
    const refs: ThreadContextRef[] = []
    const goal = findGoal(snapshot, goalId)
    if (goal) {
        pushRef(refs, goalRef(goal))
    }

    const stream = chooseBestStream(snapshot, goalId, queryTexts)
    const phase = stream ? chooseBestPhase(snapshot, stream.id, queryTexts) : null
    const plan = stream ? chooseBestPlan(snapshot, stream.id, phase?.id ?? null, queryTexts) : null

    pushRef(refs, stream ? streamRef(stream) : null)
    pushRef(refs, phase ? phaseRef(phase) : null)
    pushRef(refs, plan ? planRef(plan) : null)
    pushRef(refs, impact)
    return refs
}

function compactLines(lines: Array<string | null | undefined>) {
    return lines.filter((line): line is string => Boolean(line && line.trim())).map((line) => line.trim()).join('\n')
}

function renderMessageParagraphs(lines: Array<string | null | undefined>) {
    return Array.from(new Set(
        lines
            .filter((line): line is string => Boolean(line && line.trim()))
            .map((line) => line.trim()),
    )).join('\n\n')
}

function createDetailSection(title: ThreadDetailSection['title'], body: string, refs: ThreadContextRef[]): ThreadDetailSection | null {
    const trimmedBody = body.trim()
    if (!trimmedBody && refs.length === 0) {
        return null
    }
    return {
        title,
        body: trimmedBody,
        refs,
    }
}

function buildDetailSections(params: {
    background: string
    impactLines: Array<string | null | undefined>
    planBody: string
    refs: ThreadContextRef[]
}): ThreadDetailSection[] {
    const baseRefs = params.refs.filter((ref) => ref.kind !== 'impact' && ref.kind !== 'plan')
    const impactRefs = params.refs.filter((ref) => ref.kind === 'impact')
    const planRefs = params.refs.filter((ref) => ref.kind === 'plan')
    const sections = [
        createDetailSection('查看依据', params.background, baseRefs),
        createDetailSection('查看影响', compactLines(params.impactLines), impactRefs),
        createDetailSection('看关联计划', params.planBody, planRefs),
    ]

    return sections.filter((section): section is ThreadDetailSection => Boolean(section))
}

function findGoal(snapshot: PrototypeScenarioSnapshot, goalId: string) {
    return snapshot.goals.find((goal) => goal.id === goalId) ?? null
}

function findPrimaryStream(snapshot: PrototypeScenarioSnapshot, goalId: string, preferredStreamId?: string | null) {
    if (preferredStreamId) {
        const preferred = snapshot.streams.find((stream) => stream.id === preferredStreamId && stream.goalId === goalId)
        if (preferred) {
            return preferred
        }
    }
    return snapshot.streams.find((stream) => stream.goalId === goalId) ?? null
}

function findPrimaryPhase(snapshot: PrototypeScenarioSnapshot, streamId: string | null) {
    if (!streamId) {
        return null
    }
    return snapshot.phases.find((phase) => phase.streamId === streamId && phase.status !== 'Done')
        ?? snapshot.phases.find((phase) => phase.streamId === streamId)
        ?? null
}

function findPrimaryPlan(snapshot: PrototypeScenarioSnapshot, streamId: string | null, phaseId?: string | null) {
    if (!streamId) {
        return null
    }
    return snapshot.planCards.find((plan) => plan.streamId === streamId && (!phaseId || plan.phaseId === phaseId) && plan.column !== 'Done')
        ?? snapshot.planCards.find((plan) => plan.streamId === streamId && (!phaseId || plan.phaseId === phaseId))
        ?? null
}

function approvalRefs(snapshot: PrototypeScenarioSnapshot, item: PrototypeApprovalItem): ThreadContextRef[] {
    return buildTopicContextRefs(snapshot, item.goalId, [
        item.title,
        item.summary,
        item.branchName,
        item.kind === 'branch-promotion' ? 'branch promotion review lane hardening' : 'scope reduction direction change',
    ], impactRef(`impact:${item.id}`, item.kind === 'branch-promotion' ? '影响主线放行' : '影响路线和范围'))
}

function riskRefs(snapshot: PrototypeScenarioSnapshot, risk: PrototypeRisk): ThreadContextRef[] {
    return buildTopicContextRefs(snapshot, risk.goalId, [
        risk.title,
        risk.summary,
        risk.signal,
    ], impactRef(`impact:${risk.id}`, '影响当前自动推进路线'))
}

function statusRefs(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal): ThreadContextRef[] {
    const refs: ThreadContextRef[] = [goalRef(goal)]
    const stream = findPrimaryStream(snapshot, goal.id, null)
    const phase = findPrimaryPhase(snapshot, stream?.id ?? null)
    const plan = findPrimaryPlan(snapshot, stream?.id ?? null, phase?.id ?? null)
    const goalView = goalPresentation(goal, snapshot.checkpoint.id)
    pushRef(refs, stream ? streamRef(stream) : null)
    pushRef(refs, phase ? phaseRef(phase) : null)
    pushRef(refs, plan ? planRef(plan) : null)
    pushRef(refs, impactRef(`impact:${goal.id}:status`, goalView.progressLabel))
    return refs
}

function directionRefs(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal): ThreadContextRef[] {
    const refs = statusRefs(snapshot, goal)
    pushRef(refs, impactRef(`impact:${goal.id}:direction`, `当前路线：${labelDirection(goal.direction)}`))
    return refs
}

function approvalWindowOrder(): PrototypeTimeWindow[] {
    return ['today', 'last24h', 'yesterday']
}

function collectApprovalItems(snapshot: PrototypeScenarioSnapshot) {
    const seen = new Set<string>()
    const items: PrototypeApprovalItem[] = []

    for (const window of approvalWindowOrder()) {
        const batch = snapshot.approvalBatches[window]
        if (!batch) {
            continue
        }
        for (const item of batch.items) {
            if (seen.has(item.id)) {
                continue
            }
            seen.add(item.id)
            items.push(item)
        }
    }

    return items
}

function threadMeaningfulSignature(thread: Pick<OperatorThread, 'title' | 'preview' | 'updatedAt' | 'firstMessage' | 'detailSections' | 'briefing'>) {
    return [
        thread.title,
        thread.preview,
        thread.updatedAt,
        thread.firstMessage.currentStatus,
        thread.firstMessage.background,
        thread.firstMessage.whyNow,
        thread.firstMessage.suggestedAction,
        thread.firstMessage.freeformInvite,
        thread.firstMessage.confirmEffect ?? '',
        thread.firstMessage.deferEffect ?? '',
        thread.firstMessage.continueSilentlyEffect ?? '',
        thread.firstMessage.changeDirectionEffect ?? '',
        thread.briefing?.title ?? '',
        thread.briefing?.decisionQuestion ?? '',
        thread.briefing?.identity.projectLabel ?? '',
        thread.briefing?.identity.goalLabel ?? '',
        thread.briefing?.identity.planLabel ?? '',
        thread.briefing?.identity.attemptNumber?.toString() ?? '',
        thread.briefing?.identity.sessionId ?? '',
        thread.briefing?.summaryRows.whatHappened ?? '',
        thread.briefing?.summaryRows.whyEscalated ?? '',
        thread.briefing?.summaryRows.recommendedAction ?? '',
        thread.briefing?.summaryRows.currentImpact ?? '',
        thread.briefing?.primaryAction?.label ?? '',
        thread.briefing?.primaryAction?.helper ?? '',
        thread.briefing?.secondaryAction?.label ?? '',
        thread.briefing?.secondaryAction?.helper ?? '',
        thread.briefing?.rawEvidence.summary ?? '',
        thread.briefing?.rawEvidence.terminationReason ?? '',
        thread.briefing?.rawEvidence.nextSuggestedStep ?? '',
        thread.briefing?.rawEvidence.failureFingerprint ?? '',
        ...thread.detailSections.map((section) => `${section.title}:${section.body}:${section.refs.map((ref) => `${ref.kind}:${ref.id}`).join('|')}`),
    ].join('||')
}

function renderFirstMessage(firstMessage: OperatorFirstMessage) {
    return renderMessageParagraphs([
        firstMessage.currentStatus,
        firstMessage.suggestedAction,
        firstMessage.freeformInvite,
    ])
}

function renderApprovalFirstMessage(firstMessage: OperatorFirstMessage) {
    return renderMessageParagraphs([
        firstMessage.currentStatus,
        firstMessage.suggestedAction,
        firstMessage.confirmEffect ? `按建议执行后：${firstMessage.confirmEffect}` : null,
        firstMessage.deferEffect ? `如果先不处理：${firstMessage.deferEffect}` : null,
        firstMessage.freeformInvite,
    ])
}

function statusThreadTitle(goal: PrototypeGoal) {
    return `${goalDisplayLabel(goal)} · 当前主线`
}

function directionThreadTitle(goal: PrototypeGoal) {
    return `${goalDisplayLabel(goal)} · 路线调整`
}

function approvalThreadTitle(item: PrototypeApprovalItem) {
    switch (item.kind) {
        case 'branch-promotion':
            return '放行导入分支'
        case 'direction-change':
            return '调整周报路线'
        case 'scope-change':
            return '收窄周报范围'
    }
}

function approvalDecisionPrompt(item: PrototypeApprovalItem) {
    switch (item.kind) {
        case 'branch-promotion':
            return '你要决定的是：要不要按系统建议放行导入分支。'
        case 'direction-change':
            return '你要决定的是：要不要按系统建议调整周报路线。'
        case 'scope-change':
            return '你要决定的是：要不要按系统建议收紧周报范围。'
    }
}

function approvalDecisionQuestion(item: PrototypeApprovalItem) {
    switch (item.kind) {
        case 'branch-promotion':
            return '要不要按系统建议放行导入分支。'
        case 'direction-change':
            return '要不要按系统建议调整周报路线。'
        case 'scope-change':
            return '要不要按系统建议收紧周报范围。'
    }
}

function approvalApproveLabel(item: PrototypeApprovalItem) {
    switch (item.kind) {
        case 'branch-promotion':
            return '按建议放行'
        case 'direction-change':
            return '按建议调整路线'
        case 'scope-change':
            return '按建议收紧范围'
    }
}

function approvalDeferLabel(item: PrototypeApprovalItem) {
    switch (item.kind) {
        case 'branch-promotion':
            return '先不放行'
        case 'direction-change':
        case 'scope-change':
            return '先保持现状'
    }
}

function approvalGuideLabel(item: PrototypeApprovalItem, label: string | null) {
    if (!label) {
        return null
    }

    if (item.kind === 'branch-promotion') {
        return label
    }

    if (label === '保持原路线') {
        return '不收紧，保持原路线'
    }

    return label
}

function findRefLabel(refs: ThreadContextRef[], kind: ThreadContextRef['kind']) {
    return refs.find((ref) => ref.kind === kind)?.label ?? null
}

function createThreadIdentity(snapshot: PrototypeScenarioSnapshot, refs: ThreadContextRef[], explicitPlanLabel?: string | null) {
    return {
        projectLabel: snapshot.program.name,
        goalLabel: findRefLabel(refs, 'goal'),
        planLabel: explicitPlanLabel ?? findRefLabel(refs, 'plan'),
        attemptNumber: null,
        sessionId: null,
    }
}

function createStatusBriefing(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal, refs: ThreadContextRef[], goalView: ReturnType<typeof goalPresentation>): DecisionBriefing {
    return {
        title: statusThreadTitle(goal),
        decisionQuestion: null,
        identity: createThreadIdentity(snapshot, refs),
        summaryRows: {
            whatHappened: `${goalDisplayLabel(goal)} 当前处于${labelGoalStatus(goal.status)}，置信度约 ${goal.confidence}%。`,
            whyEscalated: goal.needsApproval
                ? '相关审批或风险已经进入收件箱；这条线程负责给你完整说明当前主线为什么会走到这里。'
                : '这条线程是当前主线的状态简报，帮助你先理解系统现在在做什么。',
            recommendedAction: goal.needsApproval
                ? '真正需要拍板的事项已经单独进入收件箱；这里先帮助你建立背景。'
                : '如果你想追问为什么这样排，或者想直接改路线、改优先级，可以直接回复。',
            currentImpact: goalView.progressLabel,
        },
        primaryAction: null,
        secondaryAction: null,
        rawEvidence: {
            summary: null,
            terminationReason: null,
            nextSuggestedStep: null,
            failureFingerprint: null,
            defaultExpanded: false,
        },
    }
}

function createDirectionBriefing(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal, refs: ThreadContextRef[], firstMessage: OperatorFirstMessage): DecisionBriefing {
    return {
        title: directionThreadTitle(goal),
        decisionQuestion: null,
        identity: createThreadIdentity(snapshot, refs),
        summaryRows: {
            whatHappened: firstMessage.currentStatus,
            whyEscalated: firstMessage.whyNow,
            recommendedAction: firstMessage.suggestedAction,
            currentImpact: firstMessage.changeDirectionEffect ?? '系统会继续按当前路线和优先级推进。',
        },
        primaryAction: {
            label: '收紧范围',
            helper: '系统会用更保守的路线重排执行流、风险语气和后续摘要。',
        },
        secondaryAction: {
            label: '保持路线',
            helper: '维持当前路线和优先级继续推进；如果要更激进，再用下面按钮单独调整。',
        },
        rawEvidence: {
            summary: null,
            terminationReason: null,
            nextSuggestedStep: null,
            failureFingerprint: null,
            defaultExpanded: false,
        },
    }
}

function createLiveApprovalBriefing(item: PrototypeApprovalItem): DecisionBriefing | null {
    return buildDecisionBriefing(item.liveContext ?? null)
}

function liveApprovalTitle(item: PrototypeApprovalItem, briefing: DecisionBriefing | null) {
    if (!item.liveContext) {
        return approvalThreadTitle(item)
    }

    if (item.liveContext.category === 'runtime-interruption') {
        return briefing?.title ?? item.title
    }

    return item.title
}

function createApprovalBriefing(snapshot: PrototypeScenarioSnapshot, item: PrototypeApprovalItem, firstMessage: OperatorFirstMessage, context: ReturnType<typeof approvalContextPresentation>, refs: ThreadContextRef[]): DecisionBriefing {
    const liveBriefing = createLiveApprovalBriefing(item)
    if (liveBriefing) {
        return liveBriefing
    }

    return {
        title: approvalThreadTitle(item),
        decisionQuestion: approvalDecisionQuestion(item),
        identity: createThreadIdentity(snapshot, refs, item.title),
        summaryRows: {
            whatHappened: firstMessage.currentStatus,
            whyEscalated: `${context.background} ${firstMessage.whyNow}`.trim(),
            recommendedAction: firstMessage.suggestedAction,
            currentImpact: `${firstMessage.confirmEffect ?? ''} ${firstMessage.deferEffect ?? ''}`.trim(),
        },
        primaryAction: {
            label: approvalApproveLabel(item),
            helper: firstMessage.confirmEffect ?? context.approveEffect,
        },
        secondaryAction: {
            label: approvalDeferLabel(item),
            helper: firstMessage.deferEffect ?? context.deferEffect,
        },
        rawEvidence: {
            summary: null,
            terminationReason: null,
            nextSuggestedStep: null,
            failureFingerprint: null,
            defaultExpanded: false,
        },
    }
}

function createRiskBriefing(snapshot: PrototypeScenarioSnapshot, risk: PrototypeRisk, refs: ThreadContextRef[], view: ReturnType<typeof riskPresentation>, context: ReturnType<typeof riskContextPresentation>, firstMessage: OperatorFirstMessage): DecisionBriefing {
    return {
        title: riskThreadTitle(risk),
        decisionQuestion: null,
        identity: createThreadIdentity(snapshot, refs),
        summaryRows: {
            whatHappened: `${view.title}，当前被系统判定为${labelRiskSeverity(risk.severity)}风险。`,
            whyEscalated: `${context.background} ${firstMessage.whyNow}`.trim(),
            recommendedAction: firstMessage.suggestedAction,
            currentImpact: firstMessage.changeDirectionEffect ?? firstMessage.continueSilentlyEffect ?? firstMessage.deferEffect ?? risk.summary,
        },
        primaryAction: {
            label: context.guideLabel,
            helper: firstMessage.changeDirectionEffect ?? '系统会按更保守的方式处理这条风险。',
        },
        secondaryAction: {
            label: '已知，继续跑',
            helper: firstMessage.continueSilentlyEffect ?? '系统会继续按当前路线推进，但会把这条风险记账。',
        },
        rawEvidence: {
            summary: null,
            terminationReason: null,
            nextSuggestedStep: null,
            failureFingerprint: null,
            defaultExpanded: false,
        },
    }
}

function riskThreadTitle(risk: PrototypeRisk) {
    return riskPresentation(risk).title
}

function riskThreadId(risk: PrototypeRisk) {
    return risk.id.startsWith('risk:') ? risk.id : `risk:${risk.id}`
}

function createStatusThread(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal): ThreadSeed {
    const strategy = snapshot.strategies.find((item) => item.goalId === goal.id)
    const goalView = goalPresentation(goal, snapshot.checkpoint.id)
    const lifecycle: ThreadLifecycleState = goal.status === 'intake' ? 'waiting' : 'in-progress'
    const refs = statusRefs(snapshot, goal)
    const firstMessage: OperatorFirstMessage = {
        currentStatus: `${goalDisplayLabel(goal)}现在在${labelGoalStatus(goal.status)}，置信 ${goal.confidence}%。`,
        background: strategy?.thesis ?? goalView.summary,
        whyNow: goal.needsApproval
            ? '相关审批或风险已经进入收件箱，从这里先看全局判断最省事。'
            : '这条线程负责持续告诉你系统现在在做什么。',
        suggestedAction: goal.needsApproval
            ? '真正要拍板的事已经单独进收件箱。'
            : '想问我为什么这么排，直接回我。',
        freeformInvite: '也可以直接叫我改路线或改优先级。',
    }
    const briefing = createStatusBriefing(snapshot, goal, refs, goalView)

    return {
        id: `status:${goal.id}`,
        kind: 'status',
        goalId: goal.id,
        title: statusThreadTitle(goal),
        preview: goalView.headline,
        updatedAt: formatMoment(goal.lastWorkedAt),
        lifecycle,
        priority: 'low',
        tone: 'default',
        passive: true,
        refs,
        firstMessage,
        quickActions: [],
        statusLabel: lifecycleLabel(lifecycle),
        briefing,
        introMessage: createThreadMessage({
            id: createMessageId('intro', `status:${goal.id}`),
            threadId: `status:${goal.id}`,
            role: 'agent',
            body: renderFirstMessage(firstMessage),
            createdAt: formatMoment(goal.lastWorkedAt),
        }),
        detailSections: buildDetailSections({
            background: firstMessage.background,
            impactLines: [firstMessage.whyNow, firstMessage.suggestedAction],
            planBody: goalView.summary,
            refs,
        }),
    }
}

function createDirectionThread(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal): ThreadSeed {
    const strategy = snapshot.strategies.find((item) => item.goalId === goal.id)
    const lifecycle: ThreadLifecycleState = goal.needsApproval || goal.status === 'at-risk' || goal.status === 'blocked'
        ? 'pending'
        : 'resolved'
    const refs = directionRefs(snapshot, goal)
    const firstMessage: OperatorFirstMessage = {
        currentStatus: `${goalDisplayLabel(goal)}现在的路线是「${labelDirection(goal.direction)}」，优先级是「${labelPriority(goal.priority)}」。`,
        background: strategy?.reason ?? '系统已经形成一条当前路线，但仍保留手动改排空间。',
        whyNow: lifecycle === 'pending'
            ? '当前目标的状态或信心发生了变化，路线和优先级都可能要重新拍板。'
            : '这条方向线程已经稳定，但你仍然可以随时改路线或调优先级。',
        suggestedAction: lifecycle === 'pending'
            ? '认同就先不动；不认同就直接改。'
            : '现在不用强制干预，但你随时可以改。',
        freeformInvite: '不想点按钮的话，直接告诉我要怎么改。',
        changeDirectionEffect: '系统会按新的路线和优先级重排执行流、风险语气和后续摘要。',
    }
    const briefing = createDirectionBriefing(snapshot, goal, refs, firstMessage)

    return {
        id: `direction:${goal.id}`,
        kind: 'direction',
        goalId: goal.id,
        title: directionThreadTitle(goal),
        preview: strategy?.thesis ?? goal.headline,
        updatedAt: formatMoment(goal.lastWorkedAt),
        lifecycle,
        priority: lifecycle === 'pending' ? 'high' : 'medium',
        tone: lifecycle === 'pending' ? 'accent' : 'default',
        passive: false,
        refs,
        firstMessage,
        quickActions: [
            {
                id: `direction:${goal.id}:tighten`,
                label: '收紧范围',
                tone: 'primary',
                operation: { type: 'direction-set', goalId: goal.id, direction: 'tighten-scope' },
            },
            {
                id: `direction:${goal.id}:maintain`,
                label: '保持路线',
                tone: 'secondary',
                operation: { type: 'direction-set', goalId: goal.id, direction: 'maintain' },
            },
            {
                id: `direction:${goal.id}:accelerate`,
                label: '加速推进',
                tone: 'secondary',
                operation: { type: 'direction-set', goalId: goal.id, direction: 'accelerate' },
            },
            {
                id: `priority:${goal.id}:highest`,
                label: '提到最高',
                tone: 'secondary',
                operation: { type: 'priority-set', goalId: goal.id, priority: 'highest' },
            },
            {
                id: `priority:${goal.id}:medium`,
                label: '往后放一档',
                tone: 'secondary',
                operation: { type: 'priority-set', goalId: goal.id, priority: 'medium' },
            },
        ],
        statusLabel: lifecycleLabel(lifecycle),
        briefing,
        introMessage: createThreadMessage({
            id: createMessageId('intro', `direction:${goal.id}`),
            threadId: `direction:${goal.id}`,
            role: 'agent',
            body: renderFirstMessage(firstMessage),
            createdAt: formatMoment(goal.lastWorkedAt),
        }),
        detailSections: buildDetailSections({
            background: firstMessage.background,
            impactLines: [firstMessage.whyNow, firstMessage.changeDirectionEffect, firstMessage.suggestedAction],
            planBody: strategy?.reason ?? goal.summary,
            refs,
        }),
    }
}

function createApprovalThread(snapshot: PrototypeScenarioSnapshot, item: PrototypeApprovalItem): ThreadSeed {
    const view = approvalPresentation(item)
    const context = approvalContextPresentation(item)
    const lifecycle: ThreadLifecycleState = item.state === 'pending'
        ? 'pending'
        : item.state === 'deferred'
            ? 'silent'
            : 'resolved'
    const refs = approvalRefs(snapshot, item)
    const baseFirstMessage: OperatorFirstMessage = {
        currentStatus: approvalDecisionPrompt(item),
        background: context.background,
        whyNow: '这条审批已经到明确的判断边界；继续自动推进会跨过你的经营决策。',
        suggestedAction: `系统建议：${view.summary}`,
        freeformInvite: '如果这几个按钮都不对，直接回我你希望系统怎么改。',
        confirmEffect: context.approveEffect,
        deferEffect: context.deferEffect,
    }
    const briefing = createApprovalBriefing(snapshot, item, baseFirstMessage, context, refs)
    const firstMessage: OperatorFirstMessage = {
        currentStatus: item.liveContext
            ? (briefing.decisionQuestion ?? briefing.summaryRows.whatHappened)
            : baseFirstMessage.currentStatus,
        background: briefing.summaryRows.whyEscalated,
        whyNow: briefing.summaryRows.currentImpact,
        suggestedAction: briefing.summaryRows.recommendedAction,
        freeformInvite: baseFirstMessage.freeformInvite,
        confirmEffect: briefing.primaryAction?.helper ?? context.approveEffect,
        deferEffect: briefing.secondaryAction?.helper ?? context.deferEffect,
    }

    const quickActions: QuickActionSpec[] = [
        {
            id: `approval:${item.id}:approve`,
            label: briefing.primaryAction?.label ?? approvalApproveLabel(item),
            tone: 'primary',
            operation: { type: 'approval-approve', approvalId: item.id },
        },
        {
            id: `approval:${item.id}:defer`,
            label: briefing.secondaryAction?.label ?? approvalDeferLabel(item),
            tone: 'secondary',
            operation: { type: 'approval-defer', approvalId: item.id },
        },
    ]

    const guideLabel = approvalGuideLabel(item, context.guideLabel)

    if (!item.liveContext && guideLabel && context.guideDirection) {
        quickActions.push({
            id: `approval:${item.id}:guide`,
            label: guideLabel,
            tone: 'secondary',
            operation: { type: 'approval-guide', approvalId: item.id, goalId: item.goalId, direction: context.guideDirection },
        })
    }

    return {
        id: `approval:${item.id}`,
        kind: 'approval',
        goalId: item.goalId,
        title: liveApprovalTitle(item, briefing),
        preview: briefing.summaryRows.whatHappened,
        updatedAt: formatMoment(item.requestedAt),
        lifecycle,
        priority: item.kind === 'branch-promotion' ? 'critical' : 'high',
        tone: lifecycle === 'pending' ? 'accent' : 'default',
        passive: false,
        refs,
        firstMessage,
        quickActions,
        statusLabel: lifecycleLabel(lifecycle),
        briefing,
        introMessage: createThreadMessage({
            id: createMessageId('intro', `approval:${item.id}`),
            threadId: `approval:${item.id}`,
            role: 'agent',
            body: renderApprovalFirstMessage(firstMessage),
            createdAt: formatMoment(item.requestedAt),
        }),
        detailSections: buildDetailSections({
            background: firstMessage.background,
            impactLines: [
                firstMessage.whyNow,
                firstMessage.suggestedAction,
                firstMessage.confirmEffect,
                firstMessage.deferEffect,
            ],
            planBody: briefing.rawEvidence.summary ?? item.summary,
            refs,
        }),
    }
}

function createRiskThread(snapshot: PrototypeScenarioSnapshot, risk: PrototypeRisk): ThreadSeed {
    const view = riskPresentation(risk)
    const context = riskContextPresentation(risk)
    const lifecycle: ThreadLifecycleState = risk.state === 'open'
        ? 'pending'
        : risk.state === 'deferred'
            ? 'silent'
            : 'resolved'
    const refs = riskRefs(snapshot, risk)
    const firstMessage: OperatorFirstMessage = {
        currentStatus: `现在要先处理这条风险：${view.title}（${labelRiskSeverity(risk.severity)}风险）。`,
        background: context.background,
        whyNow: '这条风险会直接改变接下来是继续静默跑，还是先收紧路线。',
        suggestedAction: context.systemDecision,
        freeformInvite: '不想点按钮的话，直接告诉我要怎么处理。',
        continueSilentlyEffect: context.continueEffect,
        deferEffect: context.deferEffect,
        changeDirectionEffect: '系统会立刻把路线收紧到更保守的执行姿态。',
    }
    const briefing = createRiskBriefing(snapshot, risk, refs, view, context, firstMessage)

    return {
        id: riskThreadId(risk),
        kind: 'risk',
        goalId: risk.goalId,
        title: riskThreadTitle(risk),
        preview: view.signal,
        updatedAt: formatMoment(snapshot.checkpoint.stamp),
        lifecycle,
        priority: risk.severity === 'high' ? 'critical' : risk.severity === 'medium' ? 'high' : 'medium',
        tone: lifecycle === 'pending' ? 'warning' : 'default',
        passive: false,
        refs,
        firstMessage,
        quickActions: [
            {
                id: `risk:${risk.id}:guide`,
                label: context.guideLabel,
                tone: 'primary',
                operation: { type: 'risk-guide', riskId: risk.id, goalId: risk.goalId, direction: context.guideDirection },
            },
            {
                id: `risk:${risk.id}:ack`,
                label: '已知，继续跑',
                tone: 'secondary',
                operation: { type: 'risk-acknowledge', riskId: risk.id },
            },
            {
                id: `risk:${risk.id}:defer`,
                label: '稍后提醒',
                tone: 'secondary',
                operation: { type: 'risk-defer', riskId: risk.id },
            },
        ],
        statusLabel: lifecycleLabel(lifecycle),
        briefing,
        introMessage: createThreadMessage({
            id: createMessageId('intro', riskThreadId(risk)),
            threadId: riskThreadId(risk),
            role: 'agent',
            body: renderFirstMessage(firstMessage),
            createdAt: formatMoment(snapshot.checkpoint.stamp),
        }),
        detailSections: buildDetailSections({
            background: firstMessage.background,
            impactLines: [
                firstMessage.whyNow,
                firstMessage.continueSilentlyEffect,
                firstMessage.deferEffect,
                firstMessage.changeDirectionEffect,
            ],
            planBody: risk.summary,
            refs,
        }),
    }
}

export function buildOperatorThreadSeeds(snapshot: PrototypeScenarioSnapshot): ThreadSeed[] {
    const seeds: ThreadSeed[] = []

    for (const goal of snapshot.goals) {
        seeds.push(createStatusThread(snapshot, goal))
        seeds.push(createDirectionThread(snapshot, goal))
    }

    for (const item of collectApprovalItems(snapshot)) {
        seeds.push(createApprovalThread(snapshot, item))
    }

    for (const risk of snapshot.risks) {
        seeds.push(createRiskThread(snapshot, risk))
    }

    return seeds.sort((left, right) => {
        const lifecycleDiff = lifecycleRank(left.lifecycle) - lifecycleRank(right.lifecycle)
        if (lifecycleDiff !== 0) {
            return lifecycleDiff
        }
        const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority)
        if (priorityDiff !== 0) {
            return priorityDiff
        }
        if (left.passive !== right.passive) {
            return left.passive ? 1 : -1
        }
        return left.title.localeCompare(right.title, 'zh-Hans')
    })
}

function shouldMarkUnread(
    seed: ThreadSeed,
    previous: OperatorThread | undefined,
    activeThreadId: string | null,
    decisionTopic: DecisionTopic | null,
) {
    if (seed.id === activeThreadId) {
        return false
    }
    if (
        decisionTopic
        && decisionTopic.kind === 'approval'
        && decisionTopic.lifecycle === 'pending'
        && previous
        && (previous.lifecycle === 'resolved' || previous.lifecycle === 'silent' || previous.unread === false)
    ) {
        return true
    }
    if (!previous) {
        return lifecycleRank(seed.lifecycle) < lifecycleRank('resolved')
    }
    if (threadMeaningfulSignature(seed) !== threadMeaningfulSignature(previous)) {
        return true
    }
    if ((previous.lifecycle === 'resolved' || previous.lifecycle === 'silent') && lifecycleRank(seed.lifecycle) < lifecycleRank('resolved')) {
        return true
    }
    return previous.unread
}

export function selectDefaultActiveThreadId(threads: OperatorThread[], currentThreadId: string | null) {
    const current = currentThreadId ? threads.find((thread) => thread.id === currentThreadId) : null
    if (current && current.lifecycle !== 'silent') {
        return current.id
    }

    const preferred = threads.find((thread) => !thread.passive && lifecycleRank(thread.lifecycle) < lifecycleRank('silent'))
    if (preferred) {
        return preferred.id
    }

    return threads[0]?.id ?? null
}

export function syncOperatorThreadBundle(params: {
    snapshot: PrototypeScenarioSnapshot
    previousState: ExistingThreadState
    decisionTopics?: Record<string, DecisionTopic>
    persistedMessagesByThread?: Record<string, OperatorMessage[]>
}): { bundle: { threadsById: Record<string, OperatorThread>; messagesByThread: Record<string, OperatorMessage[]> }; activeThreadId: string | null } {
    const seeds = buildOperatorThreadSeeds(params.snapshot).map((seed) => (
        overlayDecisionTopic(seed, params.decisionTopics?.[seed.id] ?? null)
    ))
    const nextThreadsById: Record<string, OperatorThread> = {}
    const nextMessagesByThread: Record<string, OperatorMessage[]> = {}

    for (const seed of seeds) {
        const previousThread = params.previousState.threadsById[seed.id]
        const persistedMessages = params.persistedMessagesByThread?.[seed.id] ?? null
        const previousMessages = persistedMessages ?? params.previousState.messagesByThread[seed.id] ?? []
        const unread = shouldMarkUnread(
            seed,
            previousThread,
            params.previousState.activeThreadId,
            params.decisionTopics?.[seed.id] ?? null,
        )
        const introMessage = seed.introMessage
        const restMessages = previousMessages.filter((message) => message.id !== introMessage.id)

        nextThreadsById[seed.id] = {
            ...seed,
            unread,
        }
        nextMessagesByThread[seed.id] = [introMessage, ...restMessages]
    }

    const orderedThreads = Object.values(nextThreadsById)
    const activeThreadId = selectDefaultActiveThreadId(orderedThreads, params.previousState.activeThreadId)

    return {
        bundle: {
            threadsById: nextThreadsById,
            messagesByThread: nextMessagesByThread,
        },
        activeThreadId,
    }
}
