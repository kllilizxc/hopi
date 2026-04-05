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
import type {
    OperatorFirstMessage,
    OperatorMessage,
    OperatorThread,
    QuickActionSpec,
    PrototypeApprovalItem,
    PrototypeCheckpointId,
    PrototypeGoal,
    PrototypePhase,
    PrototypePlanCard,
    PrototypeRisk,
    PrototypeScenarioSnapshot,
    PrototypeStream,
    ThreadContextRef,
    ThreadLifecycleState,
    ThreadPriority,
} from './types'

type ThreadSeed = Omit<OperatorThread, 'unread'> & {
    introMessage: OperatorMessage
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

function goalRef(goal: PrototypeGoal): ThreadContextRef {
    return {
        kind: 'goal',
        id: goal.id,
        label: goalTitle(goal.id),
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
    const refs: ThreadContextRef[] = []
    const goal = findGoal(snapshot, item.goalId)
    if (goal) {
        pushRef(refs, goalRef(goal))
    }

    const streamId = item.goalId === 'goal-portfolio-foundation'
        ? 'stream-ingest-contracts'
        : 'stream-weekly-brief-outline'
    const stream = findPrimaryStream(snapshot, item.goalId, streamId)
    const phase = findPrimaryPhase(snapshot, stream?.id ?? null)
    const plan = findPrimaryPlan(snapshot, stream?.id ?? null, phase?.id ?? null)
    pushRef(refs, stream ? streamRef(stream) : null)
    pushRef(refs, phase ? phaseRef(phase) : null)
    pushRef(refs, plan ? planRef(plan) : null)
    pushRef(refs, impactRef(`impact:${item.id}`, item.kind === 'branch-promotion' ? '影响主线放行' : '影响路线和范围'))
    return refs
}

function riskRefs(snapshot: PrototypeScenarioSnapshot, risk: PrototypeRisk): ThreadContextRef[] {
    const refs: ThreadContextRef[] = []
    const goal = findGoal(snapshot, risk.goalId)
    if (goal) {
        pushRef(refs, goalRef(goal))
    }

    const streamId = risk.goalId === 'goal-portfolio-foundation'
        ? risk.id === 'risk-scope-first-broker'
            ? 'stream-ingest-contracts'
            : 'stream-holdings-normalization'
        : 'stream-weekly-brief-outline'
    const stream = findPrimaryStream(snapshot, risk.goalId, streamId)
    const phase = findPrimaryPhase(snapshot, stream?.id ?? null)
    const plan = findPrimaryPlan(snapshot, stream?.id ?? null, phase?.id ?? null)
    pushRef(refs, stream ? streamRef(stream) : null)
    pushRef(refs, phase ? phaseRef(phase) : null)
    pushRef(refs, plan ? planRef(plan) : null)
    pushRef(refs, impactRef(`impact:${risk.id}`, '影响当前自动推进路线'))
    return refs
}

function statusRefs(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal): ThreadContextRef[] {
    const refs: ThreadContextRef[] = [goalRef(goal)]
    const stream = findPrimaryStream(snapshot, goal.id, null)
    const phase = findPrimaryPhase(snapshot, stream?.id ?? null)
    const plan = findPrimaryPlan(snapshot, stream?.id ?? null, phase?.id ?? null)
    pushRef(refs, stream ? streamRef(stream) : null)
    pushRef(refs, phase ? phaseRef(phase) : null)
    pushRef(refs, plan ? planRef(plan) : null)
    pushRef(refs, impactRef(`impact:${goal.id}:status`, goal.progressLabel))
    return refs
}

function directionRefs(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal): ThreadContextRef[] {
    const refs = statusRefs(snapshot, goal)
    pushRef(refs, impactRef(`impact:${goal.id}:direction`, `当前路线：${labelDirection(goal.direction)}`))
    return refs
}

function renderFirstMessage(firstMessage: OperatorFirstMessage) {
    const consequenceLines = [
        firstMessage.confirmEffect ? `- 确认后：${firstMessage.confirmEffect}` : null,
        firstMessage.deferEffect ? `- 稍后后：${firstMessage.deferEffect}` : null,
        firstMessage.continueSilentlyEffect ? `- 继续静默跑：${firstMessage.continueSilentlyEffect}` : null,
        firstMessage.changeDirectionEffect ? `- 改路线后：${firstMessage.changeDirectionEffect}` : null,
    ].filter(Boolean).join('\n')

    return [
        '### 现状',
        firstMessage.currentStatus,
        '',
        '### 背景',
        firstMessage.background,
        '',
        '### 为什么现在找你',
        firstMessage.whyNow,
        '',
        '### 建议动作',
        firstMessage.suggestedAction,
        consequenceLines ? `\n### 结果对比\n${consequenceLines}\n` : '',
        firstMessage.freeformInvite,
    ].filter(Boolean).join('\n')
}

function createStatusThread(snapshot: PrototypeScenarioSnapshot, goal: PrototypeGoal): ThreadSeed {
    const strategy = snapshot.strategies.find((item) => item.goalId === goal.id)
    const goalView = goalPresentation(goal, snapshot.checkpoint.id)
    const lifecycle: ThreadLifecycleState = goal.status === 'intake' ? 'waiting' : 'in-progress'
    const refs = statusRefs(snapshot, goal)
    const firstMessage: OperatorFirstMessage = {
        currentStatus: `${goalTitle(goal.id)}当前处于${labelGoalStatus(goal.status)}，置信 ${goal.confidence}%。`,
        background: strategy?.thesis ?? goalView.summary,
        whyNow: goal.needsApproval
            ? '虽然这是一条状态线程，但相关的审批或风险已经进入收件箱，你可以先从这里问我要全局判断。'
            : '这条线程负责持续告诉你系统现在在做什么，以及为什么这么排。',
        suggestedAction: goal.needsApproval
            ? '如果你只想看全局判断，可以先看这条；如果你要真正做决定，优先打开右边待处理线程。'
            : '当前不需要你立刻拍板；如果你想追问主线原因或要求我改排，也可以直接在这里说。',
        freeformInvite: '你可以直接问我：为什么这样排、下一步准备做什么，或者要求我改路线和优先级。',
    }

    return {
        id: `status:${goal.id}`,
        kind: 'status',
        goalId: goal.id,
        title: `${goalTitle(goal.id)} · 当前现状`,
        preview: goal.headline,
        updatedAt: formatMoment(goal.lastWorkedAt),
        lifecycle,
        priority: 'low',
        tone: 'default',
        passive: true,
        refs,
        firstMessage,
        quickActions: [],
        statusLabel: lifecycleLabel(lifecycle),
        introMessage: createThreadMessage({
            id: createMessageId('intro', `status:${goal.id}`),
            threadId: `status:${goal.id}`,
            role: 'agent',
            body: renderFirstMessage(firstMessage),
            createdAt: formatMoment(goal.lastWorkedAt),
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
        currentStatus: `${goalTitle(goal.id)}当前路线是「${labelDirection(goal.direction)}」，优先级是「${labelPriority(goal.priority)}」。`,
        background: strategy?.reason ?? '系统已经形成一条当前路线，但仍保留手动改排空间。',
        whyNow: lifecycle === 'pending'
            ? '当前目标的状态或信心发生了变化，路线和优先级都可能需要你重新拍板。'
            : '这条方向线程已经稳定，但你仍然可以随时改路线或调优先级。',
        suggestedAction: lifecycle === 'pending'
            ? '如果你认同当前路线，就保持不动；如果不认同，直接选一条更合适的方向。'
            : '当前不需要你强制干预；如果你想压快、收紧或让出火力，也可以直接说。',
        freeformInvite: '如果这些按钮不够，直接告诉我你想怎么改，比如“先收紧范围，别抢主线火力”。',
        changeDirectionEffect: '系统会按新的路线和优先级重排执行流、风险语气和后续摘要。',
    }

    return {
        id: `direction:${goal.id}`,
        kind: 'direction',
        goalId: goal.id,
        title: `${goalTitle(goal.id)} · 路线与优先级`,
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
        introMessage: createThreadMessage({
            id: createMessageId('intro', `direction:${goal.id}`),
            threadId: `direction:${goal.id}`,
            role: 'agent',
            body: renderFirstMessage(firstMessage),
            createdAt: formatMoment(goal.lastWorkedAt),
        }),
    }
}

function createApprovalThread(snapshot: PrototypeScenarioSnapshot, item: PrototypeApprovalItem): ThreadSeed {
    const view = approvalPresentation(item)
    const context = approvalContextPresentation(item)
    const goal = findGoal(snapshot, item.goalId)
    const lifecycle: ThreadLifecycleState = item.state === 'pending'
        ? 'pending'
        : item.state === 'deferred'
            ? 'silent'
            : 'resolved'
    const refs = approvalRefs(snapshot, item)
    const firstMessage: OperatorFirstMessage = {
        currentStatus: `当前待你确认：${view.title}。`,
        background: context.background,
        whyNow: '这条审批已经进入明确的判断边界；继续自动推进会跨过你的经营决策。 ',
        suggestedAction: context.systemDecision,
        freeformInvite: '如果你不想直接点按钮，也可以回复“先再加固一轮”或“别今天放行”。',
        confirmEffect: context.approveEffect,
        deferEffect: context.deferEffect,
    }

    const quickActions: QuickActionSpec[] = [
        {
            id: `approval:${item.id}:approve`,
            label: item.kind === 'branch-promotion' ? '确认放行' : '确认调整',
            tone: 'primary',
            operation: { type: 'approval-approve', approvalId: item.id },
        },
        {
            id: `approval:${item.id}:defer`,
            label: '稍后处理',
            tone: 'secondary',
            operation: { type: 'approval-defer', approvalId: item.id },
        },
    ]

    if (context.guideLabel && context.guideDirection) {
        quickActions.push({
            id: `approval:${item.id}:guide`,
            label: context.guideLabel,
            tone: 'secondary',
            operation: { type: 'approval-guide', approvalId: item.id, goalId: item.goalId, direction: context.guideDirection },
        })
    }

    return {
        id: `approval:${item.id}`,
        kind: 'approval',
        goalId: item.goalId,
        title: view.title,
        preview: item.summary,
        updatedAt: formatMoment(item.requestedAt),
        lifecycle,
        priority: item.kind === 'branch-promotion' ? 'critical' : 'high',
        tone: lifecycle === 'pending' ? 'accent' : 'default',
        passive: false,
        refs,
        firstMessage,
        quickActions,
        statusLabel: lifecycleLabel(lifecycle),
        introMessage: createThreadMessage({
            id: createMessageId('intro', `approval:${item.id}`),
            threadId: `approval:${item.id}`,
            role: 'agent',
            body: renderFirstMessage(firstMessage),
            createdAt: formatMoment(item.requestedAt),
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
        currentStatus: `当前风险：${view.title}（${labelRiskSeverity(risk.severity)}风险）。`,
        background: context.background,
        whyNow: '这条风险会直接改变系统接下来是继续静默跑，还是先收紧路线。 ',
        suggestedAction: context.systemDecision,
        freeformInvite: '如果这些按钮不够，你也可以直接说你想怎么处理这条风险。',
        continueSilentlyEffect: context.continueEffect,
        deferEffect: context.deferEffect,
        changeDirectionEffect: '系统会立刻把路线收紧到更保守的执行姿态。',
    }

    return {
        id: `risk:${risk.id}`,
        kind: 'risk',
        goalId: risk.goalId,
        title: view.title,
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
        introMessage: createThreadMessage({
            id: createMessageId('intro', `risk:${risk.id}`),
            threadId: `risk:${risk.id}`,
            role: 'agent',
            body: renderFirstMessage(firstMessage),
            createdAt: formatMoment(snapshot.checkpoint.stamp),
        }),
    }
}

export function buildOperatorThreadSeeds(snapshot: PrototypeScenarioSnapshot): ThreadSeed[] {
    const seeds: ThreadSeed[] = []

    for (const goal of snapshot.goals) {
        seeds.push(createStatusThread(snapshot, goal))
        seeds.push(createDirectionThread(snapshot, goal))
    }

    for (const batch of Object.values(snapshot.approvalBatches)) {
        for (const item of batch.items) {
            seeds.push(createApprovalThread(snapshot, item))
        }
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

function shouldMarkUnread(seed: ThreadSeed, previous: OperatorThread | undefined, activeThreadId: string | null) {
    if (seed.id === activeThreadId) {
        return false
    }
    if (!previous) {
        return lifecycleRank(seed.lifecycle) < lifecycleRank('resolved')
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
}): { bundle: { threadsById: Record<string, OperatorThread>; messagesByThread: Record<string, OperatorMessage[]> }; activeThreadId: string | null } {
    const seeds = buildOperatorThreadSeeds(params.snapshot)
    const nextThreadsById: Record<string, OperatorThread> = {}
    const nextMessagesByThread: Record<string, OperatorMessage[]> = {}

    for (const seed of seeds) {
        const previousThread = params.previousState.threadsById[seed.id]
        const previousMessages = params.previousState.messagesByThread[seed.id] ?? []
        const unread = shouldMarkUnread(seed, previousThread, params.previousState.activeThreadId)
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
