import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react'
import {
    applyGoalOverrides,
    applyRiskOverrides,
    getPrototypeSnapshot,
    prototypeCheckpoints
} from './scenario'
import { syncOperatorThreadBundle } from './threads'
import {
    approvalContextPresentation,
    riskContextPresentation
} from './presenter'
import type {
    PrototypeActionDispatcher,
    PrototypeApprovalBatch,
    PrototypeApprovalItem,
    PrototypeApprovalState,
    OperatorMessage,
    OperatorThread,
    PrototypeClock,
    PrototypeDataSource,
    PrototypeDirectionPosture,
    PrototypeGoal,
    PrototypeGoalDetail,
    PrototypeGoalPriority,
    PrototypePhase,
    PrototypePortfolioView,
    PrototypeRisk,
    PrototypeRiskState,
    PrototypeScenarioSnapshot,
    PrototypeStrategySnapshot,
    PrototypeStream,
    PrototypeStreamDetail,
    PrototypeTimeWindow,
    PrototypeCheckpointId
} from './types'

type PrototypeReaction = {
    title: string
    summary: string
}

type PrototypeUiState = {
    attachedProgramId: string | null
    checkpoint: PrototypeCheckpointId
    window: PrototypeTimeWindow
    autoplay: boolean
    approvalStates: Record<string, PrototypeApprovalState | undefined>
    riskStates: Record<string, PrototypeRiskState | undefined>
    goalPriorities: Record<string, PrototypeGoalPriority | undefined>
    goalDirections: Record<string, PrototypeDirectionPosture | undefined>
    goalGuidance: Record<string, string | undefined>
    threadsById: Record<string, OperatorThread>
    messagesByThread: Record<string, OperatorMessage[]>
    activeThreadId: string | null
    lastReaction: PrototypeReaction | null
}

type PrototypeAction =
    | { type: 'attach-demo-program' }
    | { type: 'set-active-thread'; id: string }
    | { type: 'approve-batch-item'; id: string }
    | { type: 'defer-batch-item'; id: string }
    | { type: 'guide-approval'; id: string; goalId: string; direction: PrototypeDirectionPosture }
    | { type: 'submit-approval-guidance'; id: string; goalId: string; text: string }
    | { type: 'acknowledge-risk'; id: string }
    | { type: 'defer-risk'; id: string }
    | { type: 'guide-risk'; id: string; goalId: string; direction: PrototypeDirectionPosture }
    | { type: 'submit-risk-guidance'; id: string; goalId: string; text: string }
    | { type: 'send-thread-reply'; threadId: string; text: string }
    | { type: 'set-checkpoint'; id: PrototypeCheckpointId }
    | { type: 'next-checkpoint' }
    | { type: 'previous-checkpoint' }
    | { type: 'set-window'; window: PrototypeTimeWindow }
    | { type: 'set-autoplay'; enabled: boolean }
    | { type: 'set-goal-priority'; goalId: string; priority: PrototypeGoalPriority }
    | { type: 'set-goal-direction'; goalId: string; direction: PrototypeDirectionPosture }

type PrototypeStoreValue = {
    state: PrototypeUiState
    dataSource: PrototypeDataSource
    actions: PrototypeActionDispatcher
    clock: PrototypeClock
    threads: OperatorThread[]
    activeThread: OperatorThread | null
}

const STORAGE_KEY = 'hopi:omc-prototype:v1'

const PrototypeStoreContext = createContext<PrototypeStoreValue | null>(null)

function nextCheckpoint(current: PrototypeCheckpointId): PrototypeCheckpointId {
    const index = prototypeCheckpoints.findIndex((checkpoint) => checkpoint.id === current)
    return prototypeCheckpoints[(index + 1) % prototypeCheckpoints.length]?.id ?? prototypeCheckpoints[0]!.id
}

function previousCheckpoint(current: PrototypeCheckpointId): PrototypeCheckpointId {
    const index = prototypeCheckpoints.findIndex((checkpoint) => checkpoint.id === current)
    return prototypeCheckpoints[(index - 1 + prototypeCheckpoints.length) % prototypeCheckpoints.length]?.id ?? prototypeCheckpoints[0]!.id
}

function migrateLegacyMessages(rawMessages: unknown): Record<string, OperatorMessage[]> {
    if (!Array.isArray(rawMessages)) {
        return {}
    }

    return rawMessages.reduce<Record<string, OperatorMessage[]>>((acc, entry, index) => {
        if (!entry || typeof entry !== 'object') {
            return acc
        }

        const candidate = entry as {
            id?: string
            role?: OperatorMessage['role']
            body?: string
            threadId?: string
            createdAt?: string
        }
        const threadId = candidate.threadId ?? `legacy-${index}`
        const message: OperatorMessage = {
            id: candidate.id ?? `legacy-message-${index}`,
            role: candidate.role ?? 'agent',
            body: candidate.body ?? '',
            threadId,
            createdAt: candidate.createdAt ?? '历史消息',
            status: 'read',
        }

        acc[threadId] = [...(acc[threadId] ?? []), message]
        return acc
    }, {})
}

function syncThreadState(state: PrototypeUiState): PrototypeUiState {
    const snapshot = buildDerivedSnapshot(state)
    const { bundle, activeThreadId } = syncOperatorThreadBundle({
        snapshot,
        previousState: {
            threadsById: state.threadsById,
            messagesByThread: state.messagesByThread,
            activeThreadId: state.activeThreadId,
        },
    })

    return {
        ...state,
        threadsById: bundle.threadsById,
        messagesByThread: bundle.messagesByThread,
        activeThreadId,
    }
}

function buildInitialState(): PrototypeUiState {
    if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Partial<PrototypeUiState>
                return syncThreadState({
                    attachedProgramId: parsed.attachedProgramId ?? null,
                    checkpoint: parsed.checkpoint ?? 'intake',
                    window: parsed.window ?? 'today',
                    autoplay: parsed.autoplay ?? false,
                    approvalStates: parsed.approvalStates ?? {},
                    riskStates: parsed.riskStates ?? {},
                    goalPriorities: parsed.goalPriorities ?? {},
                    goalDirections: parsed.goalDirections ?? {},
                    goalGuidance: parsed.goalGuidance ?? {},
                    threadsById: parsed.threadsById ?? {},
                    messagesByThread: parsed.messagesByThread ?? migrateLegacyMessages((parsed as { chatMessages?: unknown }).chatMessages),
                    activeThreadId: parsed.activeThreadId ?? null,
                    lastReaction: parsed.lastReaction ?? null,
                })
            } catch {
            }
        }
    }

    return syncThreadState({
        attachedProgramId: null,
        checkpoint: 'intake',
        window: 'today',
        autoplay: false,
        approvalStates: {},
        riskStates: {},
        goalPriorities: {},
        goalDirections: {},
        goalGuidance: {},
        threadsById: {},
        messagesByThread: {},
        activeThreadId: null,
        lastReaction: null,
    })
}

function labelDirection(direction: PrototypeDirectionPosture): string {
    switch (direction) {
        case 'maintain':
            return '保持路线'
        case 'tighten-scope':
            return '收紧范围'
        case 'accelerate':
            return '加速推进'
    }
}

function labelPriority(priority: PrototypeGoalPriority): string {
    switch (priority) {
        case 'highest':
            return '最高'
        case 'high':
            return '高'
        case 'medium':
            return '中'
    }
}

function titleForGoal(goalId: string): string {
    switch (goalId) {
        case 'goal-portfolio-foundation':
            return '把持仓导入跑稳'
        case 'goal-weekly-brief':
            return '做出每周投资简报'
        default:
            return '当前目标'
    }
}

function reactionForApproval(id: string, state: PrototypeApprovalState): PrototypeReaction {
    switch (id) {
        case 'approval-branch-ingest':
            return state === 'approved'
                ? {
                    title: '已批准导入放行',
                    summary: '导入分支已离开待批队列，系统会把火力转到放行后加固。'
                }
                : {
                    title: '已延后导入放行',
                    summary: '今天不再为这条放行继续打扰，系统会先守住分支稳定。'
                }
        case 'approval-direction-weekly-brief':
        case 'approval-direction-brief-replan':
        case 'approval-scope-brief':
            return state === 'approved'
                ? {
                    title: '已确认周报收紧路线',
                    summary: '周报改走更窄的可信路径，系统会继续低打扰推进。'
                }
                : {
                    title: '已延后周报路线决定',
                    summary: '周报会暂时停在观察态，等下一批次再决定是否继续推进。'
                }
        default:
            return state === 'approved'
                ? {
                    title: '已处理审批',
                    summary: '系统会按你的决定更新下一步动作。'
                }
                : {
                    title: '已延后审批',
                    summary: '系统会暂时收起这条决定，避免继续打扰。'
                }
    }
}

function reactionForRisk(id: string, state: PrototypeRiskState): PrototypeReaction {
    const isDeferred = state === 'deferred'

    switch (id) {
        case 'risk-holdings-proof-slip':
        case 'risk-post-promo-creep':
            return isDeferred
                ? {
                    title: '已延后导入风险提醒',
                    summary: '这条风险暂时退出首页，系统会继续静默观察。'
                }
                : {
                    title: '已记录导入风险',
                    summary: '系统会继续跑，但不再把这条风险当成当下打扰项。'
                }
        case 'risk-brief-noise':
        case 'risk-brief-expansion-trigger':
        case 'risk-brief-drift':
        case 'risk-brief-premature':
            return isDeferred
                ? {
                    title: '已延后周报风险提醒',
                    summary: '这条风险先从首页撤下，周报继续按当前姿态推进。'
                }
                : {
                    title: '已记录周报风险',
                    summary: '系统会按当前范围继续推进，不再重复提醒同一件事。'
                }
        default:
            return isDeferred
                ? {
                    title: '已延后风险提醒',
                    summary: '这条风险已从当前视图撤下。'
                }
                : {
                    title: '已记录风险',
                    summary: '系统会继续推进，但不再重复提醒。'
                }
    }
}

function reactionForDirection(goalId: string, direction: PrototypeDirectionPosture): PrototypeReaction {
    return {
        title: `${titleForGoal(goalId)}已切到${labelDirection(direction)}`,
        summary: direction === 'tighten-scope'
            ? '系统会优先收窄工作面，压低风险和打扰。'
            : direction === 'accelerate'
                ? '系统会把更多火力压到当前目标上，同时接受更高波动。'
                : '系统恢复到原路线，继续按当前经营节奏推进。'
    }
}

function reactionForPriority(goalId: string, priority: PrototypeGoalPriority): PrototypeReaction {
    return {
        title: `${titleForGoal(goalId)}优先级已调到${labelPriority(priority)}`,
        summary: priority === 'highest'
            ? '首页主线和执行流排序都会把它放到最前。'
            : priority === 'medium'
                ? '它会让出主火力，首页顺序和执行流顺位会一起后移。'
                : '它会保持在中间火力位，不再占用第一顺位。'
    }
}

function summarizeGuidance(text: string): string {
    return text.trim().replace(/\s+/g, ' ').slice(0, 42)
}

function maybeInferDirectionFromGuidance(text: string): PrototypeDirectionPosture | null {
    if (/(收紧|缩小|聚焦|先不要|暂停|保守|延后|先守住)/.test(text)) {
        return 'tighten-scope'
    }
    if (/(加速|尽快|马上|优先完成|并行|快点|推进更快)/.test(text)) {
        return 'accelerate'
    }
    if (/(保持|照旧|原路线|继续当前|按现在)/.test(text)) {
        return 'maintain'
    }
    return null
}

function createChatMessage(
    role: OperatorMessage['role'],
    body: string,
    threadId: string
): OperatorMessage {
    return {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        body,
        threadId,
        createdAt: new Date().toISOString(),
        status: role === 'user' ? 'sent' : 'read',
    }
}

function appendChatMessages(
    current: Record<string, OperatorMessage[]>,
    threadId: string,
    ...messages: OperatorMessage[]
): Record<string, OperatorMessage[]> {
    return {
        ...current,
        [threadId]: [...(current[threadId] ?? []), ...messages].slice(-32),
    }
}

function inferDirectionFromGuidance(text: string): PrototypeDirectionPosture {
    if (/(收紧|缩小|聚焦|先不要|暂停|保守|延后|先守住)/.test(text)) {
        return 'tighten-scope'
    }
    if (/(加速|尽快|马上|优先完成|并行|快点|推进更快)/.test(text)) {
        return 'accelerate'
    }
    return 'maintain'
}

function findApprovalItem(state: PrototypeUiState, id: string): PrototypeApprovalItem | null {
    const snapshot = buildDerivedSnapshot(state)
    const batches = Object.values(snapshot.approvalBatches)
    for (const batch of batches) {
        const item = batch.items.find((entry) => entry.id === id)
        if (item) {
            return item
        }
    }
    return null
}

function findRiskItem(state: PrototypeUiState, id: string): PrototypeRisk | null {
    const snapshot = buildDerivedSnapshot(state)
    return snapshot.risks.find((risk) => risk.id === id) ?? null
}

function findThread(state: PrototypeUiState, threadId: string): OperatorThread | null {
    return state.threadsById[threadId] ?? null
}

function appendConversation(
    state: PrototypeUiState,
    threadId: string,
    userBody: string | null,
    agentBody: string
): Record<string, OperatorMessage[]> {
    const nextMessages: OperatorMessage[] = []
    if (userBody) {
        nextMessages.push(createChatMessage('user', userBody, threadId))
    }
    nextMessages.push(createChatMessage('agent', agentBody, threadId))
    return appendChatMessages(state.messagesByThread, threadId, ...nextMessages)
}

function markThreadRead(threadsById: Record<string, OperatorThread>, threadId: string) {
    const thread = threadsById[threadId]
    if (!thread) {
        return threadsById
    }
    return {
        ...threadsById,
        [threadId]: {
            ...thread,
            unread: false,
        },
    }
}

function approvalActionLabel(kind: PrototypeApprovalItem['kind']): string {
    switch (kind) {
        case 'branch-promotion':
            return '批准放行'
        case 'direction-change':
            return '接受方向调整'
        case 'scope-change':
            return '确认范围调整'
    }
}

function reducer(state: PrototypeUiState, action: PrototypeAction): PrototypeUiState {
    switch (action.type) {
        case 'attach-demo-program':
            return syncThreadState({
                ...state,
                attachedProgramId: 'personal-quant',
                threadsById: {},
                messagesByThread: {},
                activeThreadId: null,
                lastReaction: null,
            })
        case 'set-active-thread':
            return {
                ...state,
                activeThreadId: action.id,
                threadsById: markThreadRead(state.threadsById, action.id),
            }
        case 'approve-batch-item': {
            const item = findApprovalItem(state, action.id)
            const reaction = reactionForApproval(action.id, 'approved')
            return syncThreadState({
                ...state,
                approvalStates: {
                    ...state.approvalStates,
                    [action.id]: 'approved'
                },
                messagesByThread: item
                    ? appendConversation(
                        state,
                        `approval:${action.id}`,
                        `${approvalActionLabel(item.kind)}：${item.title}`,
                        reaction.summary
                    )
                    : state.messagesByThread,
                activeThreadId: `approval:${action.id}`,
                lastReaction: reaction
            })
        }
        case 'defer-batch-item': {
            const item = findApprovalItem(state, action.id)
            const reaction = reactionForApproval(action.id, 'deferred')
            return syncThreadState({
                ...state,
                approvalStates: {
                    ...state.approvalStates,
                    [action.id]: 'deferred'
                },
                messagesByThread: item
                    ? appendConversation(
                        state,
                        `approval:${action.id}`,
                        `稍后处理：${item.title}`,
                        reaction.summary
                    )
                    : state.messagesByThread,
                activeThreadId: `approval:${action.id}`,
                lastReaction: reaction
            })
        }
        case 'guide-approval': {
            const item = findApprovalItem(state, action.id)
            return syncThreadState({
                ...state,
                approvalStates: {
                    ...state.approvalStates,
                    [action.id]: 'deferred'
                },
                goalDirections: {
                    ...state.goalDirections,
                    [action.goalId]: action.direction
                },
                messagesByThread: appendConversation(
                    state,
                    `approval:${action.id}`,
                    item ? `请按「${labelDirection(action.direction)}」处理：${item.title}` : `请改走${labelDirection(action.direction)}`,
                    '收到，我会按这个方向改排后续动作，并把这条确认先从消息流里收起。'
                ),
                activeThreadId: `approval:${action.id}`,
                lastReaction: {
                    title: `${titleForGoal(action.goalId)}已改走${labelDirection(action.direction)}`,
                    summary: '系统会按你的指导重排这条待批事项后面的动作，不再只是等你确认。'
                }
            })
        }
        case 'submit-approval-guidance': {
            const direction = inferDirectionFromGuidance(action.text)

            return syncThreadState({
                ...state,
                approvalStates: {
                    ...state.approvalStates,
                    [action.id]: 'guided'
                },
                goalDirections: {
                    ...state.goalDirections,
                    [action.goalId]: direction
                },
                goalGuidance: {
                    ...state.goalGuidance,
                    [action.goalId]: action.text.trim()
                },
                messagesByThread: appendConversation(
                    state,
                    `approval:${action.id}`,
                    action.text.trim(),
                    `收到，我会按“${summarizeGuidance(action.text)}”去处理这条待批事项，并重排 ${titleForGoal(action.goalId)} 的下一步。`
                ),
                activeThreadId: `approval:${action.id}`,
                lastReaction: {
                    title: `已记录你的指导`,
                    summary: `“${summarizeGuidance(action.text)}”会作为 ${titleForGoal(action.goalId)} 的当前执行要求。`
                }
            })
        }
        case 'acknowledge-risk': {
            const risk = findRiskItem(state, action.id)
            const reaction = reactionForRisk(action.id, 'acknowledged')
            return syncThreadState({
                ...state,
                riskStates: {
                    ...state.riskStates,
                    [action.id]: 'acknowledged'
                },
                messagesByThread: risk
                    ? appendConversation(
                        state,
                        `risk:${action.id}`,
                        `已知，继续跑：${risk.title}`,
                        reaction.summary
                    )
                    : state.messagesByThread,
                activeThreadId: `risk:${action.id}`,
                lastReaction: reaction
            })
        }
        case 'defer-risk': {
            const risk = findRiskItem(state, action.id)
            const reaction = reactionForRisk(action.id, 'deferred')
            return syncThreadState({
                ...state,
                riskStates: {
                    ...state.riskStates,
                    [action.id]: 'deferred'
                },
                messagesByThread: risk
                    ? appendConversation(
                        state,
                        `risk:${action.id}`,
                        `延后显示：${risk.title}`,
                        reaction.summary
                    )
                    : state.messagesByThread,
                activeThreadId: `risk:${action.id}`,
                lastReaction: reaction
            })
        }
        case 'guide-risk': {
            const risk = findRiskItem(state, action.id)
            return syncThreadState({
                ...state,
                riskStates: {
                    ...state.riskStates,
                    [action.id]: 'acknowledged'
                },
                goalDirections: {
                    ...state.goalDirections,
                    [action.goalId]: action.direction
                },
                messagesByThread: appendConversation(
                    state,
                    `risk:${action.id}`,
                    risk ? `请按「${labelDirection(action.direction)}」处理风险：${risk.title}` : `请改走${labelDirection(action.direction)}`,
                    '收到，我会按这个方向继续跑，并把这条风险从当前打扰位降下去。'
                ),
                activeThreadId: `risk:${action.id}`,
                lastReaction: {
                    title: `${titleForGoal(action.goalId)}已改走${labelDirection(action.direction)}`,
                    summary: '系统会按这个方向消化当前风险，并同步重排后续执行。'
                }
            })
        }
        case 'submit-risk-guidance': {
            const direction = inferDirectionFromGuidance(action.text)

            return syncThreadState({
                ...state,
                riskStates: {
                    ...state.riskStates,
                    [action.id]: 'guided'
                },
                goalDirections: {
                    ...state.goalDirections,
                    [action.goalId]: direction
                },
                goalGuidance: {
                    ...state.goalGuidance,
                    [action.goalId]: action.text.trim()
                },
                messagesByThread: appendConversation(
                    state,
                    `risk:${action.id}`,
                    action.text.trim(),
                    `收到，我会按“${summarizeGuidance(action.text)}”消化这条风险，并同步改排 ${titleForGoal(action.goalId)} 的后续动作。`
                ),
                activeThreadId: `risk:${action.id}`,
                lastReaction: {
                    title: `已记录你的指导`,
                    summary: `“${summarizeGuidance(action.text)}”会成为 ${titleForGoal(action.goalId)} 处理这条风险的当前要求。`
                }
            })
        }
        case 'send-thread-reply': {
            const text = action.text.trim()
            if (!text) {
                return state
            }

            const thread = findThread(state, action.threadId)
            if (!thread) {
                return state
            }

            const goalId = thread.goalId
            const isQuestion = looksLikeQuestion(text)
            const nextDirection = maybeInferDirectionFromGuidance(text)
            const nextPriority = inferPriorityFromGuidance(text)
            const shouldGuideGoal = Boolean(goalId && !isQuestion)
            const reaction = shouldGuideGoal
                ? {
                    title: '已记录你的要求',
                    summary: `我会按“${summarizeGuidance(text)}”继续推进 ${titleForGoal(goalId!)}。`
                }
                : null

            const approvalId = thread.kind === 'approval' ? thread.id.replace(/^approval:/, '') : null
            const riskId = thread.kind === 'risk' ? thread.id.replace(/^risk:/, '') : null

            return syncThreadState({
                ...state,
                approvalStates: approvalId && !isQuestion ? {
                    ...state.approvalStates,
                    [approvalId]: 'guided',
                } : state.approvalStates,
                riskStates: riskId && !isQuestion ? {
                    ...state.riskStates,
                    [riskId]: 'guided',
                } : state.riskStates,
                goalDirections: shouldGuideGoal && nextDirection ? {
                    ...state.goalDirections,
                    [goalId!]: nextDirection
                } : state.goalDirections,
                goalPriorities: shouldGuideGoal && nextPriority ? {
                    ...state.goalPriorities,
                    [goalId!]: nextPriority
                } : state.goalPriorities,
                goalGuidance: shouldGuideGoal ? {
                    ...state.goalGuidance,
                    [goalId!]: text
                } : state.goalGuidance,
                messagesByThread: appendConversation(
                    state,
                    action.threadId,
                    text,
                    buildAgentChatReply(state, thread, text, state.checkpoint)
                ),
                activeThreadId: action.threadId,
                lastReaction: reaction
            })
        }
        case 'set-checkpoint':
            return syncThreadState({
                ...state,
                checkpoint: action.id,
                lastReaction: null
            })
        case 'next-checkpoint':
            return syncThreadState({
                ...state,
                checkpoint: nextCheckpoint(state.checkpoint),
                lastReaction: null
            })
        case 'previous-checkpoint':
            return syncThreadState({
                ...state,
                checkpoint: previousCheckpoint(state.checkpoint),
                lastReaction: null
            })
        case 'set-window':
            return syncThreadState({
                ...state,
                window: action.window,
                lastReaction: null
            })
        case 'set-autoplay':
            return syncThreadState({
                ...state,
                autoplay: action.enabled,
                lastReaction: null
            })
        case 'set-goal-priority': {
            const snapshot = getPrototypeSnapshot(state.checkpoint)
            const goal = snapshot.goals.find((item) => item.id === action.goalId)
            if (!goal) {
                return state
            }

            return syncThreadState({
                ...state,
                goalPriorities: {
                    ...state.goalPriorities,
                    [action.goalId]: action.priority
                },
                lastReaction: reactionForPriority(action.goalId, action.priority)
            })
        }
        case 'set-goal-direction': {
            const snapshot = getPrototypeSnapshot(state.checkpoint)
            const goal = snapshot.goals.find((item) => item.id === action.goalId)
            if (!goal) {
                return state
            }

            return syncThreadState({
                ...state,
                goalDirections: {
                    ...state.goalDirections,
                    [action.goalId]: action.direction
                },
                lastReaction: reactionForDirection(action.goalId, action.direction)
            })
        }
    }
}

function inferPriorityFromGuidance(text: string): PrototypeGoalPriority | null {
    if (/(最高|第一优先|最优先)/.test(text)) {
        return 'highest'
    }
    if (/(降低优先|往后放|没那么急|中优先)/.test(text)) {
        return 'medium'
    }
    if (/(保持高优先|高优先)/.test(text)) {
        return 'high'
    }
    return null
}

function looksLikeQuestion(text: string): boolean {
    return /[?？]|为什么|怎么|能不能|是否|现在|背景|上下文|详情|展开|说说/.test(text)
}

function buildAgentChatReply(
    state: PrototypeUiState,
    thread: OperatorThread,
    text: string,
    checkpoint: PrototypeCheckpointId
): string {
    const goalName = thread.goalId ? titleForGoal(thread.goalId) : '当前主线'
    const approvalId = thread.kind === 'approval' ? thread.id.slice('approval:'.length) : null
    const riskId = thread.kind === 'risk' ? thread.id.slice('risk:'.length) : null
    const approval = approvalId ? findApprovalItem(state, approvalId) : null
    const risk = riskId ? findRiskItem(state, riskId) : null

    if (looksLikeQuestion(text)) {
        if (approval) {
            const context = approvalContextPresentation(approval)
            if (/背景|上下文|来龙去脉/.test(text)) {
                return `这条待批的背景是：${context.background}。我现在把它提上来，不是因为代码做不下去，而是因为这里已经到了要你拍板“直接确认，还是改方向”的节点。`
            }
            if (/为什么|建议|判断/.test(text)) {
                return `我的建议是：${context.systemDecision}。如果你认同，就直接点确认；如果你不认同，也不用选按钮，直接告诉我你想怎么改就行。`
            }
            return `这条待批本质上是在确认「${approval.title}」该怎么处理。你可以直接批，也可以告诉我“先别放行”“收紧范围”之类的要求，我会按你的话重排后续动作。`
        }

        if (risk) {
            const context = riskContextPresentation(risk)
            if (/背景|上下文|来龙去脉/.test(text)) {
                return `这条风险的背景是：${context.background}。它现在被提上来，是因为如果不先对齐处理方式，后面系统可能会沿着你不想要的路线继续跑。`
            }
            if (/为什么|建议|判断/.test(text)) {
                return `我现在的判断是：${context.systemDecision}。如果你接受，我就按这个方向处理；如果你想换一种方式，也可以直接告诉我。`
            }
            return `这条风险不是单纯提醒，而是在问你“后面要更保守，还是继续当前节奏”。你可以直接说你的偏好，我会按你的指令改排。`
        }

        if (thread.kind === 'direction') {
            return `这条线程负责路线和优先级。现在的路线是「${thread.refs.find((ref) => ref.kind === 'impact')?.label ?? '当前路线'}」。你可以直接说“收紧范围”“提到最高”之类的要求，我会把后续执行流一起重排。`
        }

        if (thread.kind === 'status') {
            return checkpoint === 'approval'
                ? `现在已经到日终批次，我会把真正需要你拍板的线程放在收件箱前面。这条状态线程主要回答“系统为什么这样排”和“现在已经做到哪”。`
                : `这条状态线程不会要求你频繁点按钮，它主要用来解释当前主线、背景和下一步。如果你想改路线，也可以直接在这里说。`
        }

        if (/风险/.test(text)) {
            return `这件事里我最在意的是风险会不会让 ${goalName} 偏离当前路线。你如果愿意，我可以继续把风险背景和我准备怎么处理说得更细。`
        }
        if (/待批|审批|放行/.test(text)) {
            return `这类事项本质上是在问你：是按系统当前判断继续，还是改方向。你也可以直接在这里告诉我“先别放行”或“收紧范围”，我会按你的话重排后续动作。`
        }
        return checkpoint === 'approval'
            ? `当前已经进入日终批次，我会优先把真正需要你拍板的东西放进消息流，其余动作继续静默推进。`
            : `我会先把当前状态、背景和需要你拍板的地方放在消息流里。你也可以直接告诉我下一步偏好，我会按你的要求改路线。`
    }

    if (approval) {
        return `收到，我会把这条要求应用到「${approval.title}」这条待批上，并据此重排 ${goalName} 的后续动作。`
    }

    if (risk) {
        return `收到，我会按这条要求处理「${risk.title}」这条风险，并同步改排 ${goalName} 后面的动作。`
    }

    if (thread.kind === 'direction') {
        return `收到，我会把这条要求挂到「${goalName}」的路线线程上，并据此重排优先级、执行流顺位和相关风险语气。`
    }

    return `收到，我会把这条要求挂到「${goalName}」上，并据此重排后续动作。`
}

function cloneSnapshot(snapshot: PrototypeScenarioSnapshot): PrototypeScenarioSnapshot {
    return {
        ...snapshot,
        goals: snapshot.goals.map((goal) => ({ ...goal })),
        strategies: snapshot.strategies.map((strategy) => ({ ...strategy })),
        streams: snapshot.streams.map((stream) => ({ ...stream })),
        digests: {
            today: { ...snapshot.digests.today },
            yesterday: { ...snapshot.digests.yesterday },
            last24h: { ...snapshot.digests.last24h }
        },
        approvalBatches: {
            today: {
                ...snapshot.approvalBatches.today,
                items: snapshot.approvalBatches.today.items.map((item) => ({ ...item }))
            },
            yesterday: {
                ...snapshot.approvalBatches.yesterday,
                items: snapshot.approvalBatches.yesterday.items.map((item) => ({ ...item }))
            },
            last24h: {
                ...snapshot.approvalBatches.last24h,
                items: snapshot.approvalBatches.last24h.items.map((item) => ({ ...item }))
            }
        },
        risks: snapshot.risks.map((risk) => ({ ...risk })),
        phases: snapshot.phases.map((phase) => ({ ...phase })),
        planCards: snapshot.planCards.map((card) => ({ ...card }))
    }
}

function patchGoal(
    snapshot: PrototypeScenarioSnapshot,
    goalId: string,
    updater: (goal: PrototypeGoal) => PrototypeGoal
) {
    snapshot.goals = snapshot.goals.map((goal) => goal.id === goalId ? updater(goal) : goal)
}

function patchStrategy(
    snapshot: PrototypeScenarioSnapshot,
    goalId: string,
    updater: (strategy: PrototypeStrategySnapshot) => PrototypeStrategySnapshot
) {
    snapshot.strategies = snapshot.strategies.map((strategy) => strategy.goalId === goalId ? updater(strategy) : strategy)
}

function patchStream(
    snapshot: PrototypeScenarioSnapshot,
    streamId: string,
    updater: (stream: PrototypeStream) => PrototypeStream
) {
    snapshot.streams = snapshot.streams.map((stream) => stream.id === streamId ? updater(stream) : stream)
}

function patchRisk(
    snapshot: PrototypeScenarioSnapshot,
    riskId: string,
    updater: (risk: PrototypeRisk) => PrototypeRisk
) {
    snapshot.risks = snapshot.risks.map((risk) => risk.id === riskId ? updater(risk) : risk)
}

function patchPhase(
    snapshot: PrototypeScenarioSnapshot,
    phaseId: string,
    updater: (phase: PrototypePhase) => PrototypePhase
) {
    snapshot.phases = snapshot.phases.map((phase) => phase.id === phaseId ? updater(phase) : phase)
}

function patchPlanCard(
    snapshot: PrototypeScenarioSnapshot,
    cardId: string,
    updater: (card: PrototypeScenarioSnapshot['planCards'][number]) => PrototypeScenarioSnapshot['planCards'][number]
) {
    snapshot.planCards = snapshot.planCards.map((card) => card.id === cardId ? updater(card) : card)
}

function patchBatchItems(
    snapshot: PrototypeScenarioSnapshot,
    updater: (item: PrototypeApprovalItem) => PrototypeApprovalItem
) {
    snapshot.approvalBatches = {
        today: {
            ...snapshot.approvalBatches.today,
            items: snapshot.approvalBatches.today.items.map(updater)
        },
        yesterday: {
            ...snapshot.approvalBatches.yesterday,
            items: snapshot.approvalBatches.yesterday.items.map(updater)
        },
        last24h: {
            ...snapshot.approvalBatches.last24h,
            items: snapshot.approvalBatches.last24h.items.map(updater)
        }
    }
}

function priorityWeight(priority: PrototypeGoalPriority): number {
    switch (priority) {
        case 'highest':
            return 0
        case 'high':
            return 1
        case 'medium':
            return 2
    }
}

function streamStatusWeight(status: PrototypeStream['status']): number {
    switch (status) {
        case 'ready-for-approval':
            return 0
        case 'running':
            return 1
        case 'blocked':
            return 2
        case 'watching':
            return 3
        case 'mapping':
            return 4
    }
}

function applyDirectionAndPriorityEffects(snapshot: PrototypeScenarioSnapshot) {
    for (const goal of snapshot.goals) {
        if (goal.priority === 'highest') {
            goal.headline = `${goal.headline} 当前它占用第一顺位火力。`
        } else if (goal.priority === 'medium') {
            goal.headline = `${goal.headline} 当前它让出主火力，系统会更克制地推进。`
        }

        if (goal.id === 'goal-portfolio-foundation') {
            if (goal.direction === 'tighten-scope') {
                goal.confidence = Math.min(96, goal.confidence + 6)
                goal.progressLabel = '收紧到单一导入证明链'
                goal.headline = '系统主动收窄到最短导入链，先稳住可信结果。'
                patchStrategy(snapshot, goal.id, (strategy) => ({
                    ...strategy,
                    thesis: '只守住单一导入证明链，先把可验证结果做厚。',
                    reason: '路线已收紧；系统优先减少扩面和解释成本。'
                }))
                patchStream(snapshot, 'stream-ingest-contracts', (stream) => ({
                    ...stream,
                    status: stream.status === 'mapping' ? 'running' : stream.status,
                    progress: Math.max(stream.progress, 48),
                    latestMove: '系统把工作面收窄到单一券商导入证明链。'
                }))
                patchStream(snapshot, 'stream-holdings-normalization', (stream) => ({
                    ...stream,
                    status: stream.status === 'running' ? 'watching' : stream.status,
                    latestMove: '归一化先退回守门位，不再与导入并行扩面。',
                    dependencyLabel: '等导入证明完全站稳后再继续'
                }))
            } else if (goal.direction === 'accelerate') {
                goal.confidence = Math.max(20, goal.confidence - 8)
                if (goal.status !== 'ready-for-approval') {
                    goal.status = 'at-risk'
                }
                goal.progressLabel = '并行推进导入与归一化'
                goal.headline = '系统把更多火力压到导入主线，同时接受更高波动。'
                patchStrategy(snapshot, goal.id, (strategy) => ({
                    ...strategy,
                    thesis: '并行压进导入契约和归一化，尽快把可交付结果推到前台。',
                    reason: '路线已加速；系统接受更高波动来换取更快的结果密度。'
                }))
                patchStream(snapshot, 'stream-ingest-contracts', (stream) => ({
                    ...stream,
                    status: 'running',
                    progress: Math.min(100, stream.progress + 8),
                    latestMove: '系统把导入链推进提速，优先换取更快的验证结果。'
                }))
                patchStream(snapshot, 'stream-holdings-normalization', (stream) => ({
                    ...stream,
                    status: 'running',
                    progress: Math.min(100, stream.progress + 10),
                    latestMove: '归一化不再等上游完全站稳，开始并行推进。',
                    dependencyLabel: '接受并行推进带来的额外波动'
                }))
                patchRisk(snapshot, 'risk-normalization-creep', (risk) => ({
                    ...risk,
                    severity: 'high',
                    signal: '加速路线让归一化更容易膨胀成架构活。'
                }))
                patchRisk(snapshot, 'risk-holdings-proof-slip', (risk) => ({
                    ...risk,
                    severity: 'high',
                    signal: '加速路线提高了最后一轮验证失手的概率。'
                }))
            }
        }

        if (goal.id === 'goal-weekly-brief') {
            if (goal.direction === 'tighten-scope') {
                goal.confidence = Math.min(90, goal.confidence + 10)
                if (goal.status !== 'ready-for-approval') {
                    goal.status = 'on-track'
                }
                goal.needsApproval = false
                goal.progressLabel = '先做漂移与新鲜度，异常叙事后放'
                goal.headline = '系统把周报收紧到可信范围，继续低打扰推进。'
                patchStrategy(snapshot, goal.id, (strategy) => ({
                    ...strategy,
                    thesis: '先交付更窄但可信的周报，再把异常叙事留到未来触发器。',
                    reason: '路线已收紧；系统优先守住信任感，而不是追求栏目完整。'
                }))
                patchStream(snapshot, 'stream-weekly-brief-outline', (stream) => ({
                    ...stream,
                    status: stream.status === 'blocked' ? 'running' : 'running',
                    progress: Math.min(100, Math.max(stream.progress, 54)),
                    latestMove: '周报被收紧到漂移与新鲜度，继续低打扰推进。',
                    dependencyLabel: null
                }))
                patchRisk(snapshot, 'risk-brief-drift', (risk) => ({
                    ...risk,
                    severity: 'low',
                    signal: '收紧路线后，这条风险已明显下降。'
                }))
                patchRisk(snapshot, 'risk-brief-noise', (risk) => ({
                    ...risk,
                    severity: 'medium',
                    signal: '异常叙事已退出 v1，噪声风险下降。'
                }))
            } else if (goal.direction === 'accelerate') {
                goal.confidence = Math.max(18, goal.confidence - 10)
                goal.status = 'at-risk'
                goal.needsApproval = true
                goal.progressLabel = '试图并行拉起完整周报'
                goal.headline = '系统试图加速周报，但噪声和范围都开始抬头。'
                patchStrategy(snapshot, goal.id, (strategy) => ({
                    ...strategy,
                    thesis: '把周报更快推到前台，但接受异常叙事尚未完全站稳。',
                    reason: '路线已加速；系统在速度和可信度之间选择更激进的一侧。'
                }))
                patchStream(snapshot, 'stream-weekly-brief-outline', (stream) => ({
                    ...stream,
                    status: 'blocked',
                    progress: Math.min(100, stream.progress + 4),
                    latestMove: '加速后噪声重新抬头，周报再次需要方向确认。',
                    dependencyLabel: '需要重新确认周报是否继续追求完整叙事'
                }))
                patchRisk(snapshot, 'risk-brief-drift', (risk) => ({
                    ...risk,
                    severity: 'medium',
                    signal: '加速路线让周报重新接近过度设计。'
                }))
                patchRisk(snapshot, 'risk-brief-noise', (risk) => ({
                    ...risk,
                    severity: 'high',
                    signal: '加速后，异常噪声再次高到不适合对外表达。'
                }))
            }
        }
    }
}

function applyGoalGuidanceEffects(
    snapshot: PrototypeScenarioSnapshot,
    goalGuidance: Record<string, string | undefined>
) {
    for (const [goalId, text] of Object.entries(goalGuidance)) {
        if (!text?.trim()) {
            continue
        }

        const guidance = summarizeGuidance(text)

        patchGoal(snapshot, goalId, (goal) => ({
            ...goal,
            headline: `按你的指导推进：${guidance}`,
            progressLabel: '已收到你的自定义要求'
        }))

        patchStrategy(snapshot, goalId, (strategy) => ({
            ...strategy,
            reason: `系统已收到你的指导：“${guidance}”，后续动作会按这个要求收敛。`
        }))

        const goalStreams = snapshot.streams.filter((stream) => stream.goalId === goalId)
        if (goalStreams[0]) {
            patchStream(snapshot, goalStreams[0].id, (stream) => ({
                ...stream,
                latestMove: `按你的指导继续推进：${guidance}`
            }))
        }
    }
}

function applyApprovalConsequences(
    snapshot: PrototypeScenarioSnapshot,
    approvalStates: Record<string, PrototypeApprovalState | undefined>
) {
    if (approvalStates['approval-branch-ingest'] === 'approved') {
        patchGoal(snapshot, 'goal-portfolio-foundation', (goal) => ({
            ...goal,
            status: 'on-track',
            needsApproval: false,
            confidence: Math.min(99, goal.confidence + 8),
            headline: '导入分支已放行，系统开始转入放行后加固。',
            progressLabel: '放行后继续加固'
        }))
        patchStream(snapshot, 'stream-ingest-contracts', (stream) => ({
            ...stream,
            status: 'running',
            progress: 100,
            latestMove: '分支已放行，主线转向合并后加固。'
        }))
        patchStream(snapshot, 'stream-holdings-normalization', (stream) => ({
            ...stream,
            status: 'running',
            progress: Math.min(100, Math.max(stream.progress, 88)),
            latestMove: '放行后，系统继续补强验证守门。',
            dependencyLabel: '已进入放行后加固阶段'
        }))
        patchPhase(snapshot, 'phase-ingest-3', (phase) => ({
            ...phase,
            status: 'Done',
            summary: '分支放行完成，系统已切到加固。'
        }))
        patchPlanCard(snapshot, 'plan-approval-1', (card) => ({
            ...card,
            column: 'Done',
            signal: '已放行，系统继续推进加固。',
            badges: card.badges.filter((badge) => badge !== 'batch-item').concat('done')
        }))
        patchPlanCard(snapshot, 'plan-execution-3', (card) => ({
            ...card,
            column: 'Done',
            signal: '已批准进入主审核队列。'
        }))
    } else if (approvalStates['approval-branch-ingest'] === 'deferred') {
        patchGoal(snapshot, 'goal-portfolio-foundation', (goal) => ({
            ...goal,
            needsApproval: false,
            headline: '放行已延后，系统今天先守住分支稳定，不再继续打扰。',
            progressLabel: '放到下一批再看'
        }))
        patchStream(snapshot, 'stream-ingest-contracts', (stream) => ({
            ...stream,
            status: 'watching',
            latestMove: '分支放行已延后到下一批。'
        }))
        patchPlanCard(snapshot, 'plan-approval-1', (card) => ({
            ...card,
            column: 'Planning',
            signal: '已延后到下一批处理。'
        }))
        patchPlanCard(snapshot, 'plan-execution-3', (card) => ({
            ...card,
            column: 'Planning',
            signal: '已延后，不再占用今天的审批火力。'
        }))
    } else if (approvalStates['approval-branch-ingest'] === 'guided') {
        patchGoal(snapshot, 'goal-portfolio-foundation', (goal) => ({
            ...goal,
            needsApproval: false,
            headline: '导入放行已转成你的自定义要求，系统开始按新要求重排下一步。',
            progressLabel: '按你的要求继续处理导入放行'
        }))
    }

    const briefApproved =
        approvalStates['approval-scope-brief'] === 'approved' ||
        approvalStates['approval-direction-brief-replan'] === 'approved' ||
        approvalStates['approval-direction-weekly-brief'] === 'approved'

    const briefDeferred =
        approvalStates['approval-scope-brief'] === 'deferred' ||
        approvalStates['approval-direction-brief-replan'] === 'deferred' ||
        approvalStates['approval-direction-weekly-brief'] === 'deferred'

    if (briefApproved) {
        patchGoal(snapshot, 'goal-weekly-brief', (goal) => ({
            ...goal,
            status: 'on-track',
            direction: 'tighten-scope',
            needsApproval: false,
            confidence: Math.min(88, goal.confidence + 10),
            headline: '周报已按更窄的可信路线继续推进。',
            progressLabel: '收紧后恢复稳定'
        }))
        patchStream(snapshot, 'stream-weekly-brief-outline', (stream) => ({
            ...stream,
            status: 'running',
            progress: Math.min(100, Math.max(stream.progress, 60)),
            latestMove: '周报按漂移与新鲜度路线继续推进。',
            dependencyLabel: null
        }))
        patchRisk(snapshot, 'risk-brief-noise', (risk) => ({
            ...risk,
            state: 'acknowledged',
            severity: 'medium'
        }))
        patchRisk(snapshot, 'risk-brief-drift', (risk) => ({
            ...risk,
            state: 'acknowledged',
            severity: 'low'
        }))
        patchPhase(snapshot, 'phase-brief-2', (phase) => ({
            ...phase,
            status: 'Done',
            summary: '收紧范围已被接受。'
        }))
        patchPhase(snapshot, 'phase-brief-3', (phase) => ({
            ...phase,
            status: 'Running',
            summary: '按精简路线继续低打扰推进。'
        }))
        patchPlanCard(snapshot, 'plan-approval-3', (card) => ({
            ...card,
            column: 'Done',
            signal: '范围调整已确认。'
        }))
        patchPlanCard(snapshot, 'plan-approval-4', (card) => ({
            ...card,
            column: 'Running',
            signal: '范围确认后已恢复执行。'
        }))
        patchPlanCard(snapshot, 'plan-execution-4', (card) => ({
            ...card,
            column: 'Done',
            signal: '方向调整已接受。'
        }))
        patchPlanCard(snapshot, 'plan-execution-5', (card) => ({
            ...card,
            column: 'Running',
            signal: '范围确认后已恢复执行。'
        }))
    } else if (briefDeferred) {
        patchGoal(snapshot, 'goal-weekly-brief', (goal) => ({
            ...goal,
            status: 'blocked',
            needsApproval: false,
            headline: '周报路线已被延后，系统暂时把它放回观察位。',
            progressLabel: '延后到下一批再决定'
        }))
        patchStream(snapshot, 'stream-weekly-brief-outline', (stream) => ({
            ...stream,
            status: 'watching',
            latestMove: '周报路线决定已被延后到下一批。',
            dependencyLabel: '等下一批次再决定是否继续推进'
        }))
        patchPlanCard(snapshot, 'plan-approval-3', (card) => ({
            ...card,
            column: 'Planning',
            signal: '已延后到下一批。'
        }))
        patchPlanCard(snapshot, 'plan-approval-4', (card) => ({
            ...card,
            column: 'Planning',
            signal: '范围尚未确认，暂不继续执行。'
        }))
        patchPlanCard(snapshot, 'plan-execution-4', (card) => ({
            ...card,
            column: 'Review',
            signal: '已延后，不再继续打扰。'
        }))
        patchPlanCard(snapshot, 'plan-execution-5', (card) => ({
            ...card,
            column: 'Planning',
            signal: '等待下一批方向决定。'
        }))
    } else if (
        approvalStates['approval-scope-brief'] === 'guided' ||
        approvalStates['approval-direction-brief-replan'] === 'guided' ||
        approvalStates['approval-direction-weekly-brief'] === 'guided'
    ) {
        patchGoal(snapshot, 'goal-weekly-brief', (goal) => ({
            ...goal,
            needsApproval: false,
            headline: '周报方向已转成你的自定义要求，系统按新要求继续重排。',
            progressLabel: '按你的要求继续调整周报'
        }))
    }
}

function applyRiskConsequences(
    snapshot: PrototypeScenarioSnapshot,
    riskStates: Record<string, PrototypeRiskState | undefined>
) {
    const riskIds = Object.keys(riskStates)

    for (const riskId of riskIds) {
        const state = riskStates[riskId]
        if (!state || state === 'open') {
            continue
        }

        if (riskId === 'risk-holdings-proof-slip' || riskId === 'risk-post-promo-creep') {
            patchGoal(snapshot, 'goal-portfolio-foundation', (goal) => ({
                ...goal,
                confidence: Math.min(99, goal.confidence + 4),
                headline: '导入风险已记账，系统继续按当前节奏推进。',
                progressLabel: '风险已记账，继续静默推进'
            }))
            patchStream(snapshot, 'stream-holdings-normalization', (stream) => ({
                ...stream,
                status: stream.status === 'blocked' ? 'watching' : stream.status,
                latestMove: '相关风险已被记账，系统继续推进当前证明链。'
            }))
        }

        if (
            riskId === 'risk-brief-noise' ||
            riskId === 'risk-brief-expansion-trigger' ||
            riskId === 'risk-brief-drift' ||
            riskId === 'risk-brief-premature'
        ) {
            const hasPendingBriefApproval = Object.values(snapshot.approvalBatches).some((batch) => (
                batch.items.some((item) => (
                    item.state === 'pending' &&
                    item.goalId === 'goal-weekly-brief'
                ))
            ))

            patchGoal(snapshot, 'goal-weekly-brief', (goal) => ({
                ...goal,
                confidence: Math.min(90, goal.confidence + 6),
                status: hasPendingBriefApproval ? goal.status : 'on-track',
                headline: '周报风险已记账，系统继续按当前范围静默推进。',
                progressLabel: hasPendingBriefApproval ? goal.progressLabel : '风险已记账，继续推进'
            }))
            patchStream(snapshot, 'stream-weekly-brief-outline', (stream) => ({
                ...stream,
                status: hasPendingBriefApproval ? stream.status : stream.status === 'blocked' ? 'watching' : stream.status,
                latestMove: '周报风险已被记账，系统会继续按当前范围推进。'
            }))
        }
    }
}

function sortScenario(snapshot: PrototypeScenarioSnapshot) {
    snapshot.goals.sort((left, right) => {
        const priority = priorityWeight(left.priority) - priorityWeight(right.priority)
        if (priority !== 0) {
            return priority
        }

        if (left.needsApproval !== right.needsApproval) {
            return left.needsApproval ? -1 : 1
        }

        return right.confidence - left.confidence
    })

    const goalIndex = new Map(snapshot.goals.map((goal, index) => [goal.id, index]))

    snapshot.streams.sort((left, right) => {
        const goalOrder = (goalIndex.get(left.goalId) ?? 0) - (goalIndex.get(right.goalId) ?? 0)
        if (goalOrder !== 0) {
            return goalOrder
        }

        const statusOrder = streamStatusWeight(left.status) - streamStatusWeight(right.status)
        if (statusOrder !== 0) {
            return statusOrder
        }

        return right.progress - left.progress
    })
}

function buildDerivedSnapshot(state: PrototypeUiState): PrototypeScenarioSnapshot {
    const snapshot = cloneSnapshot(getPrototypeSnapshot(state.checkpoint))

    snapshot.goals = applyGoalOverrides(snapshot.goals, {
        priorities: state.goalPriorities,
        directions: state.goalDirections
    })
    snapshot.risks = applyRiskOverrides(snapshot.risks, state.riskStates)
    patchBatchItems(snapshot, (item) => ({
        ...item,
        state: state.approvalStates[item.id] ?? item.state
    }))

    applyDirectionAndPriorityEffects(snapshot)
    applyApprovalConsequences(snapshot, state.approvalStates)
    applyRiskConsequences(snapshot, state.riskStates)
    applyGoalGuidanceEffects(snapshot, state.goalGuidance)
    sortScenario(snapshot)

    return snapshot
}

function createDataSource(state: PrototypeUiState): PrototypeDataSource {
    const snapshot = buildDerivedSnapshot(state)

    const getBatch = (window: PrototypeTimeWindow): PrototypeApprovalBatch => snapshot.approvalBatches[window]

    return {
        getPortfolio(window): PrototypePortfolioView {
            return {
                checkpoint: snapshot.checkpoint,
                checkpoints: prototypeCheckpoints,
                program: snapshot.program,
                goals: snapshot.goals,
                strategies: snapshot.strategies,
                streams: snapshot.streams,
                digest: snapshot.digests[window],
                approvalBatch: getBatch(window),
                risks: snapshot.risks
            }
        },
        getGoal(goalId, window): PrototypeGoalDetail | null {
            const goal = snapshot.goals.find((item) => item.id === goalId)
            const strategy = snapshot.strategies.find((item) => item.goalId === goalId)
            if (!goal || !strategy) {
                return null
            }

            return {
                goal,
                strategy,
                streams: snapshot.streams.filter((item) => item.goalId === goalId),
                risks: snapshot.risks.filter((item) => item.goalId === goalId),
                digest: snapshot.digests[window]
            }
        },
        getDigest(window) {
            return snapshot.digests[window]
        },
        getApprovalBatch(window) {
            return getBatch(window)
        },
        getExecutionDrilldown(input): PrototypeStreamDetail | null {
            const goal = snapshot.goals.find((item) => item.id === input.goalId)
            const strategy = snapshot.strategies.find((item) => item.goalId === input.goalId)
            const stream = snapshot.streams.find((item) => item.id === input.streamId && item.goalId === input.goalId)
            if (!goal || !strategy || !stream) {
                return null
            }

            return {
                goal,
                strategy,
                stream,
                phases: snapshot.phases.filter((phase) => phase.streamId === stream.id),
                planCards: snapshot.planCards.filter((card) => card.streamId === stream.id)
            }
        }
    }
}

export function PrototypeStoreProvider(props: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(reducer, undefined, buildInitialState)

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }, [state])

    useEffect(() => {
        if (!state.autoplay) {
            return
        }

        const timer = window.setInterval(() => {
            dispatch({ type: 'next-checkpoint' })
        }, 4_500)

        return () => window.clearInterval(timer)
    }, [state.autoplay])

    const dataSource = useMemo(() => createDataSource(state), [state])

    const actions = useMemo<PrototypeActionDispatcher>(() => ({
        attachDemoProgram() {
            dispatch({ type: 'attach-demo-program' })
        },
        setActiveThread(id) {
            dispatch({ type: 'set-active-thread', id })
        },
        performQuickAction(threadId, actionId) {
            const thread = state.threadsById[threadId]
            const quickAction = thread?.quickActions.find((item) => item.id === actionId)
            if (!quickAction) {
                return
            }

            switch (quickAction.operation.type) {
                case 'approval-approve':
                    dispatch({ type: 'approve-batch-item', id: quickAction.operation.approvalId })
                    return
                case 'approval-defer':
                    dispatch({ type: 'defer-batch-item', id: quickAction.operation.approvalId })
                    return
                case 'approval-guide':
                    dispatch({
                        type: 'guide-approval',
                        id: quickAction.operation.approvalId,
                        goalId: quickAction.operation.goalId,
                        direction: quickAction.operation.direction,
                    })
                    return
                case 'risk-acknowledge':
                    dispatch({ type: 'acknowledge-risk', id: quickAction.operation.riskId })
                    return
                case 'risk-defer':
                    dispatch({ type: 'defer-risk', id: quickAction.operation.riskId })
                    return
                case 'risk-guide':
                    dispatch({
                        type: 'guide-risk',
                        id: quickAction.operation.riskId,
                        goalId: quickAction.operation.goalId,
                        direction: quickAction.operation.direction,
                    })
                    return
                case 'direction-set':
                    dispatch({
                        type: 'set-goal-direction',
                        goalId: quickAction.operation.goalId,
                        direction: quickAction.operation.direction,
                    })
                    return
                case 'priority-set':
                    dispatch({
                        type: 'set-goal-priority',
                        goalId: quickAction.operation.goalId,
                        priority: quickAction.operation.priority,
                    })
                    return
            }
        },
        sendThreadReply(threadId, text) {
            dispatch({ type: 'send-thread-reply', threadId, text })
        },
        approveBatchItem(id) {
            dispatch({ type: 'approve-batch-item', id })
        },
        deferBatchItem(id) {
            dispatch({ type: 'defer-batch-item', id })
        },
        guideApproval(id, goalId, direction) {
            dispatch({ type: 'guide-approval', id, goalId, direction })
        },
        submitApprovalGuidance(id, goalId, text) {
            dispatch({ type: 'submit-approval-guidance', id, goalId, text })
        },
        acknowledgeRisk(id) {
            dispatch({ type: 'acknowledge-risk', id })
        },
        deferRisk(id) {
            dispatch({ type: 'defer-risk', id })
        },
        guideRisk(id, goalId, direction) {
            dispatch({ type: 'guide-risk', id, goalId, direction })
        },
        submitRiskGuidance(id, goalId, text) {
            dispatch({ type: 'submit-risk-guidance', id, goalId, text })
        },
        setClockCheckpoint(id) {
            dispatch({ type: 'set-checkpoint', id })
        },
        nextCheckpoint() {
            dispatch({ type: 'next-checkpoint' })
        },
        previousCheckpoint() {
            dispatch({ type: 'previous-checkpoint' })
        },
        setTimeWindow(window) {
            dispatch({ type: 'set-window', window })
        },
        setAutoplay(enabled) {
            dispatch({ type: 'set-autoplay', enabled })
        },
        setGoalPriority(goalId, priority) {
            dispatch({ type: 'set-goal-priority', goalId, priority })
        },
        setGoalDirection(goalId, direction) {
            dispatch({ type: 'set-goal-direction', goalId, direction })
        },
        sendChatMessage(goalId, threadId, text) {
            void goalId
            dispatch({ type: 'send-thread-reply', threadId, text })
        }
    }), [state.threadsById])

    const value = useMemo<PrototypeStoreValue>(() => ({
        state,
        dataSource,
        actions,
        clock: {
            checkpoint: state.checkpoint,
            autoplay: state.autoplay,
            window: state.window
        },
        threads: Object.values(state.threadsById),
        activeThread: state.activeThreadId ? state.threadsById[state.activeThreadId] ?? null : null,
    }), [actions, dataSource, state])

    return (
        <PrototypeStoreContext.Provider value={value}>
            {props.children}
        </PrototypeStoreContext.Provider>
    )
}

export function usePrototypeStore(): PrototypeStoreValue {
    const value = useContext(PrototypeStoreContext)
    if (!value) {
        throw new Error('PrototypeStoreProvider is missing')
    }
    return value
}
