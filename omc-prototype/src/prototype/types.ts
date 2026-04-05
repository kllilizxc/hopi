export type PrototypeTimeWindow = 'today' | 'yesterday' | 'last24h'

export type PrototypeCheckpointId = 'intake' | 'strategy' | 'execution' | 'approval'

export type PrototypeGoalStatus = 'intake' | 'on-track' | 'at-risk' | 'blocked' | 'ready-for-approval'

export type PrototypeStreamStatus = 'mapping' | 'running' | 'watching' | 'blocked' | 'ready-for-approval'

export type PrototypeRiskSeverity = 'low' | 'medium' | 'high'

export type PrototypeRiskState = 'open' | 'acknowledged' | 'deferred' | 'guided'

export type PrototypeApprovalState = 'pending' | 'approved' | 'deferred' | 'guided'

export type PrototypePlanColumn = 'Planning' | 'Running' | 'Review' | 'Done'

export type PrototypeGoalPriority = 'highest' | 'high' | 'medium'

export type PrototypeDirectionPosture = 'maintain' | 'tighten-scope' | 'accelerate'

export type ThreadLifecycleState = 'pending' | 'in-progress' | 'waiting' | 'silent' | 'resolved'

export type OperatorThreadKind = 'status' | 'approval' | 'risk' | 'direction'

export type OperatorThreadTone = 'default' | 'accent' | 'warning'

export type ThreadPriority = 'critical' | 'high' | 'medium' | 'low'

export type ThreadContextRefKind = 'goal' | 'stream' | 'phase' | 'plan' | 'impact'

export type ThreadContextRef = {
    kind: ThreadContextRefKind
    id: string
    label: string
}

export type QuickActionOperation =
    | { type: 'approval-approve'; approvalId: string }
    | { type: 'approval-defer'; approvalId: string }
    | { type: 'approval-guide'; approvalId: string; goalId: string; direction: PrototypeDirectionPosture }
    | { type: 'risk-acknowledge'; riskId: string }
    | { type: 'risk-defer'; riskId: string }
    | { type: 'risk-guide'; riskId: string; goalId: string; direction: PrototypeDirectionPosture }
    | { type: 'direction-set'; goalId: string; direction: PrototypeDirectionPosture }
    | { type: 'priority-set'; goalId: string; priority: PrototypeGoalPriority }

export type QuickActionSpec = {
    id: string
    label: string
    tone: 'primary' | 'secondary'
    operation: QuickActionOperation
}

export type OperatorFirstMessage = {
    currentStatus: string
    background: string
    whyNow: string
    suggestedAction: string
    freeformInvite: string
    confirmEffect?: string
    deferEffect?: string
    continueSilentlyEffect?: string
    changeDirectionEffect?: string
}

export type OperatorMessage = {
    id: string
    threadId: string
    role: 'agent' | 'user' | 'system'
    body: string
    createdAt: string
    status?: 'sent' | 'read' | 'failed' | 'acted'
}

export type PrototypeChatMessage = OperatorMessage

export type OperatorThread = {
    id: string
    kind: OperatorThreadKind
    goalId: string | null
    title: string
    preview: string
    updatedAt: string
    lifecycle: ThreadLifecycleState
    priority: ThreadPriority
    tone: OperatorThreadTone
    unread: boolean
    passive: boolean
    refs: ThreadContextRef[]
    firstMessage: OperatorFirstMessage
    quickActions: QuickActionSpec[]
    statusLabel: string
}

export type OperatorThreadBundle = {
    threads: OperatorThread[]
    messagesByThread: Record<string, OperatorMessage[]>
}

export type PrototypeProgram = {
    id: string
    name: string
    repoRoot: string
    primaryBranch: string
    summary: string
}

export type PrototypeCheckpoint = {
    id: PrototypeCheckpointId
    label: string
    stamp: string
    synopsis: string
}

export type PrototypeGoal = {
    id: string
    programId: string
    title: string
    summary: string
    successSignal: string
    status: PrototypeGoalStatus
    confidence: number
    priority: PrototypeGoalPriority
    direction: PrototypeDirectionPosture
    headline: string
    progressLabel: string
    needsApproval: boolean
    lastWorkedAt: string
}

export type PrototypeStrategySnapshot = {
    goalId: string
    thesis: string
    reason: string
    changedAt: string
    confidenceDelta: string
    focusAreas: string[]
    todayMoves: string[]
    nextQuestions: string[]
}

export type PrototypeStream = {
    id: string
    goalId: string
    title: string
    summary: string
    status: PrototypeStreamStatus
    progress: number
    whyNow: string
    latestMove: string
    dependencyLabel: string | null
    phaseIds: string[]
}

export type PrototypeDigest = {
    window: PrototypeTimeWindow
    headline: string
    summary: string
    highlights: string[]
    decisions: string[]
    watchlist: string[]
}

export type PrototypeApprovalItem = {
    id: string
    goalId: string
    title: string
    kind: 'branch-promotion' | 'direction-change' | 'scope-change'
    summary: string
    branchName: string | null
    requestedAt: string
    state: PrototypeApprovalState
}

export type PrototypeApprovalBatch = {
    id: string
    window: PrototypeTimeWindow
    title: string
    summary: string
    items: PrototypeApprovalItem[]
}

export type PrototypeRisk = {
    id: string
    goalId: string
    title: string
    severity: PrototypeRiskSeverity
    state: PrototypeRiskState
    summary: string
    signal: string
    owner: string
}

export type PrototypePhase = {
    id: string
    goalId: string
    streamId: string
    title: string
    status: 'Planned' | 'Running' | 'Review' | 'Done'
    summary: string
}

export type PrototypePlanCard = {
    id: string
    goalId: string
    streamId: string
    phaseId: string
    title: string
    column: PrototypePlanColumn
    summary: string
    signal: string
    updatedAt: string
    badges: string[]
}

export type PrototypeScenarioSnapshot = {
    checkpoint: PrototypeCheckpoint
    program: PrototypeProgram
    goals: PrototypeGoal[]
    strategies: PrototypeStrategySnapshot[]
    streams: PrototypeStream[]
    digests: Record<PrototypeTimeWindow, PrototypeDigest>
    approvalBatches: Record<PrototypeTimeWindow, PrototypeApprovalBatch>
    risks: PrototypeRisk[]
    phases: PrototypePhase[]
    planCards: PrototypePlanCard[]
}

export type PrototypeGoalDetail = {
    goal: PrototypeGoal
    strategy: PrototypeStrategySnapshot
    streams: PrototypeStream[]
    risks: PrototypeRisk[]
    digest: PrototypeDigest
}

export type PrototypeStreamDetail = {
    goal: PrototypeGoal
    strategy: PrototypeStrategySnapshot
    stream: PrototypeStream
    phases: PrototypePhase[]
    planCards: PrototypePlanCard[]
}

export type PrototypePortfolioView = {
    checkpoint: PrototypeCheckpoint
    checkpoints: PrototypeCheckpoint[]
    program: PrototypeProgram
    goals: PrototypeGoal[]
    strategies: PrototypeStrategySnapshot[]
    streams: PrototypeStream[]
    digest: PrototypeDigest
    approvalBatch: PrototypeApprovalBatch
    risks: PrototypeRisk[]
}

export interface PrototypeDataSource {
    getPortfolio(window: PrototypeTimeWindow): PrototypePortfolioView
    getGoal(goalId: string, window: PrototypeTimeWindow): PrototypeGoalDetail | null
    getDigest(window: PrototypeTimeWindow): PrototypeDigest
    getApprovalBatch(window: PrototypeTimeWindow): PrototypeApprovalBatch
    getExecutionDrilldown(input: { goalId: string; streamId: string }): PrototypeStreamDetail | null
}

export interface PrototypeActionDispatcher {
    attachDemoProgram(): void
    setActiveThread(id: string): void
    performQuickAction(threadId: string, actionId: string): void
    sendThreadReply(threadId: string, text: string): void
    approveBatchItem(id: string): void
    deferBatchItem(id: string): void
    guideApproval(id: string, goalId: string, direction: PrototypeDirectionPosture): void
    submitApprovalGuidance(id: string, goalId: string, text: string): void
    acknowledgeRisk(id: string): void
    deferRisk(id: string): void
    guideRisk(id: string, goalId: string, direction: PrototypeDirectionPosture): void
    submitRiskGuidance(id: string, goalId: string, text: string): void
    sendChatMessage(goalId: string | null, threadId: string, text: string): void
    setClockCheckpoint(id: PrototypeCheckpointId): void
    nextCheckpoint(): void
    previousCheckpoint(): void
    setTimeWindow(window: PrototypeTimeWindow): void
    setAutoplay(enabled: boolean): void
    setGoalPriority(goalId: string, priority: PrototypeGoalPriority): void
    setGoalDirection(goalId: string, direction: PrototypeDirectionPosture): void
}

export type PrototypeClock = {
    checkpoint: PrototypeCheckpointId
    autoplay: boolean
    window: PrototypeTimeWindow
}
