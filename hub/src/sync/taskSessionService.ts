import { createHash } from 'node:crypto'
import {
    coercePermissionModeForFlavor,
    DEFAULT_AGENT_FLAVOR,
    DEFAULT_TASK_MODEL,
    isModelModeAllowedForFlavor,
    isPermissionModeAllowedForFlavor,
    normalizeModelName,
    resolveAutonomousPermissionModeForFlavor,
    resolveClaudeModelMode,
    resolveStoredModel
} from '@hopi/protocol'
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH } from '@hopi/protocol/brand'
import { AgentFlavorSchema, ModelModeSchema, PermissionModeSchema } from '@hopi/protocol/schemas'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import type { TaskSessionStartFailure, TaskSessionStartFailureCode, TaskSessionStartRetryAction } from '@hopi/protocol/task-session-start'
import type { HopiTaskRole, Session } from '@hopi/protocol/types'
import { z } from 'zod'
import type { Store, StoredMachine, StoredMessage, StoredProject, StoredTask, StoredWorkspace } from '../store'
import {
    buildRepeatedTaskActionFailureNote,
    buildTaskActionCommandReportLines,
    trimTaskActionOutput
} from '../utils/taskActionFlow'
import { buildTaskInitRuntime as buildSharedTaskInitRuntime } from '../utils/taskActionRuntime'
import type { SyncEngine } from './syncEngine'
import { loadProjectActionContractFromSession, parseProjectActionContract } from './actionContract'
import { buildAgentOutputLanguageSection, resolveAgentOutputLocale } from './agentOutputLanguage'
import { resolveSessionPreferredRootPath, resolveSessionRootPathCandidates, type SessionRootPathLike } from './sessionRootPaths'
import { setSessionTaskLink } from './sessionTaskLink'
import { runSetupWorkflow, type SetupWorkflowRunResult } from './setupWorkflowRunner'
import { getWorkflowStrategy } from './workflowStrategy'
import { upsertGoalTodoTaskState, type GoalTodoStatus } from './goals/goalTodo'
import { notifyProjectControllerTaskBlockedTransition } from './projectController'

function dataUrlToBase64(dataUrl: string): string {
    const comma = dataUrl.indexOf(',')
    return comma < 0 ? dataUrl : dataUrl.slice(comma + 1)
}

const KICKOFF_LOCAL_ID_PREFIX = 'auto:kickoff:'
const AUTO_WORKFLOW_LOCAL_ID_PREFIX = 'auto:workflow:'
const MESSAGE_HISTORY_PAGE_SIZE = 200
const CARRYOVER_MESSAGE_MAX_CHARS = 40_000
const CARRYOVER_HISTORY_MAX_CHARS = 200_000

function toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === 'string') return value
    try {
        const serialized = JSON.stringify(value)
        if (typeof serialized === 'string') return serialized
    } catch {
    }
    return String(value)
}

function formatErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        const normalized = normalizeText(error.message)
        if (normalized) {
            return normalized
        }
    }
    const message = normalizeText(stringifyUnknown(error))
    return message || fallback
}

function normalizeText(value: string): string {
    return value.replace(/\r\n/g, '\n').trim()
}

function trimCarryoverText(value: string, maxChars: number = CARRYOVER_MESSAGE_MAX_CHARS): string {
    if (value.length <= maxChars) {
        return value
    }

    const marker = '\n[... characters omitted to stay under restart context limit ...]\n'
    const available = Math.max(0, maxChars - marker.length)
    const headChars = Math.ceil(available / 2)
    const tailChars = Math.floor(available / 2)
    return `${value.slice(0, headChars)}${marker}${tailChars > 0 ? value.slice(value.length - tailChars) : ''}`
}

function normalizeCarryoverText(value: string): string | null {
    const normalized = normalizeText(value)
    return normalized ? trimCarryoverText(normalized) : null
}

function createTaskSessionStartFailure(options: {
    code: TaskSessionStartFailureCode
    message: string
    blockedReason?: string | null
    retryCount?: number
    retryAction?: TaskSessionStartRetryAction
    retryAvailable?: boolean
}): TaskSessionStartFailure {
    const message = normalizeText(options.message).slice(0, 280)
    const blockedReason = options.blockedReason === null
        ? null
        : normalizeText(options.blockedReason ?? '').slice(0, 280) || null
    const retryAvailable = options.retryAvailable ?? true

    return {
        code: options.code,
        message: message || blockedReason || 'Task session start failed',
        blockedReason,
        retry: {
            count: Math.max(0, options.retryCount ?? 0),
            action: retryAvailable ? (options.retryAction ?? 'retry_start') : 'none',
            available: retryAvailable
        }
    }
}

export function isMachineRunnerReady(
    machine: Pick<StoredMachine, 'active' | 'runnerState'> | null | undefined
): boolean {
    if (!machine) {
        return false
    }

    if (machine.active) {
        return true
    }

    const runnerState = machine.runnerState
    if (!runnerState || typeof runnerState !== 'object') {
        return false
    }

    const status = (runnerState as Record<string, unknown>).status
    return status === 'running'
}
function collectCodexPlanText(data: Record<string, unknown>): string | null {
    const explanation = typeof data.explanation === 'string' ? normalizeText(data.explanation) : ''
    const entries = Array.isArray(data.entries) ? data.entries : []
    const lines: string[] = []
    for (const entry of entries) {
        const item = toRecord(entry)
        if (!item) continue
        const content = typeof item.content === 'string'
            ? normalizeText(item.content)
            : typeof item.step === 'string'
                ? normalizeText(item.step)
                : typeof item.text === 'string'
                    ? normalizeText(item.text)
                    : ''
        if (!content) continue
        const rawStatus = typeof item.status === 'string' ? item.status.toLowerCase().replace(/[\s_-]/g, '') : ''
        const done = rawStatus === 'completed'
        lines.push(`- [${done ? 'x' : ' '}] ${content}`)
    }

    if (lines.length === 0) {
        return explanation || null
    }
    return explanation
        ? `${explanation}\n${lines.join('\n')}`
        : lines.join('\n')
}

function extractMessageText(content: unknown): string | null {
    if (typeof content === 'string') {
        return normalizeCarryoverText(content)
    }

    if (Array.isArray(content)) {
        const blocks = content
            .map((item) => extractMessageText(item))
            .filter((text): text is string => Boolean(text))
        if (blocks.length === 0) return null
        return trimCarryoverText(blocks.join('\n'))
    }

    const objectContent = toRecord(content)
    if (!objectContent) {
        return null
    }

    if (objectContent.type === 'event') {
        return null
    }

    if (objectContent.type === 'text' && typeof objectContent.text === 'string') {
        return normalizeCarryoverText(objectContent.text)
    }

    if (objectContent.type === 'output') {
        const data = toRecord(objectContent.data)
        if (!data || data.isMeta || data.isCompactSummary) {
            return null
        }

        if (data.type === 'summary' && typeof data.summary === 'string') {
            return normalizeCarryoverText(data.summary)
        }

        if (data.type === 'assistant' || data.type === 'user') {
            const message = toRecord(data.message)
            if (message) {
                return extractMessageText(message.content)
            }
        }
    }

    if (objectContent.type === 'codex') {
        const data = toRecord(objectContent.data)
        if (!data) {
            return null
        }

        if ((data.type === 'message' || data.type === 'reasoning') && typeof data.message === 'string') {
            return normalizeCarryoverText(data.message)
        }

        if (data.type === 'plan') {
            const planText = collectCodexPlanText(data)
            return planText ? trimCarryoverText(planText) : null
        }

        if (data.type === 'tool-call-result') {
            return extractMessageText(data.output)
        }
    }

    if (typeof objectContent.text === 'string') {
        const normalized = normalizeCarryoverText(objectContent.text)
        if (normalized) return normalized
    }

    if ('content' in objectContent) {
        const fromContent = extractMessageText(objectContent.content)
        if (fromContent) return fromContent
    }

    if ('message' in objectContent) {
        const fromMessage = extractMessageText(objectContent.message)
        if (fromMessage) return fromMessage
    }

    return normalizeCarryoverText(stringifyUnknown(content))
}

function getCarryoverMessages(store: Store, previousSessionId: string): StoredMessage[] {
    const pages: StoredMessage[][] = []
    let beforeSeq: number | undefined

    while (true) {
        const page = store.messages.getMessages(previousSessionId, MESSAGE_HISTORY_PAGE_SIZE, beforeSeq)
        if (page.length === 0) {
            break
        }

        pages.push(page)
        const oldestSeq = page[0]?.seq
        if (page.length < MESSAGE_HISTORY_PAGE_SIZE || typeof oldestSeq !== 'number' || oldestSeq <= 1) {
            break
        }
        beforeSeq = oldestSeq
    }

    const messages: StoredMessage[] = []
    for (let index = pages.length - 1; index >= 0; index -= 1) {
        messages.push(...pages[index])
    }
    return messages
}

function buildCarryoverHistorySection(store: Store, previousSessionId: string): string {
    const messages = getCarryoverMessages(store, previousSessionId)
    const entriesNewestFirst: string[] = []
    let remainingChars = CARRYOVER_HISTORY_MAX_CHARS
    let omittedOlderMessages = 0

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (message.localId?.startsWith(KICKOFF_LOCAL_ID_PREFIX) || message.localId?.startsWith(AUTO_WORKFLOW_LOCAL_ID_PREFIX)) {
            continue
        }

        const record = unwrapRoleWrappedRecordEnvelope(message.content)
        const role = record?.role
        const roleLabel = role === 'user'
            ? 'User'
            : role === 'assistant' || role === 'agent'
                ? 'Assistant'
                : 'Message'
        const sourceContent = record ? record.content : message.content
        const text = extractMessageText(sourceContent)
        if (!text) continue

        const entry = `${roleLabel}:\n${text}`
        const separatorChars = entriesNewestFirst.length > 0 ? 2 : 0
        if (entry.length + separatorChars > remainingChars) {
            omittedOlderMessages += 1
            continue
        }

        entriesNewestFirst.push(entry)
        remainingChars -= entry.length + separatorChars
    }

    if (entriesNewestFirst.length === 0) {
        return ''
    }

    const lines = entriesNewestFirst.reverse()
    if (omittedOlderMessages > 0) {
        lines.unshift(`[${omittedOlderMessages} older previous session message(s) omitted to keep restart context within the agent input limit.]`)
    }

    return `\n\nPrevious session messages:\n${lines.join('\n\n')}`
}

export type StartSessionOverrides = {
    workspaceId?: string
    agent?: z.infer<typeof AgentFlavorSchema>
    model?: string
    yolo?: boolean
    permissionMode?: z.infer<typeof PermissionModeSchema>
    modelMode?: z.infer<typeof ModelModeSchema>
}

export type StartSessionKickoffOptions =
    | { kind?: 'default' }
    | { kind: 'skip' }
    | {
        kind: 'custom'
        text: string
        localId?: string
        includeCarryoverHistory?: boolean
    }

type SessionConfigPatch = {
    permissionMode?: z.infer<typeof PermissionModeSchema>
    modelMode?: z.infer<typeof ModelModeSchema>
    collaborationMode?: string
}

const SESSION_CONFIG_APPLY_ATTEMPTS = 8
const SESSION_CONFIG_APPLY_RETRY_DELAY_MS = 250

function shouldRetrySessionConfigApply(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return message.startsWith('RPC handler not registered:') || message.startsWith('RPC socket disconnected:')
}

async function applySessionConfigWithRetry(options: {
    engine: SyncEngine
    sessionId: string
    patch: SessionConfigPatch
}): Promise<void> {
    for (let attempt = 1; attempt <= SESSION_CONFIG_APPLY_ATTEMPTS; attempt += 1) {
        try {
            await options.engine.applySessionConfig(options.sessionId, options.patch)
            return
        } catch (error) {
            if (!shouldRetrySessionConfigApply(error) || attempt >= SESSION_CONFIG_APPLY_ATTEMPTS) {
                return
            }
            await new Promise((resolve) => setTimeout(resolve, SESSION_CONFIG_APPLY_RETRY_DELAY_MS))
        }
    }
}

function resolveWorktreeWorkspacePaths(projectWorkspacePaths: string[], primaryPath: string): string[] | undefined {
    const normalizedPrimaryPath = primaryPath.trim()
    if (!normalizedPrimaryPath) {
        return undefined
    }

    const normalizedPaths = projectWorkspacePaths
        .map((path) => path.trim())
        .filter((path) => path.length > 0)

    if (normalizedPaths.length <= 1) {
        return undefined
    }

    const deduped = Array.from(new Set([normalizedPrimaryPath, ...normalizedPaths]))
    return deduped.length > 1 ? deduped : undefined
}

type TaskInitRuntimeStatus = NonNullable<StoredTask['initRuntime']>['status']

const AUTO_INIT_SETUP_LOCAL_ID_PREFIX = 'auto:init_setup:'
const SETUP_WORKFLOW_MANUAL_STEP = `Inspect the linked session tool output, fix \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` setup steps or workspace blockers, then retry task start.`
const BOOTSTRAP_SETUP_BYPASS_NOTE = `Bootstrap task skipped setup preflight so it can create or repair \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\`.`

function emitSessionMessageReceivedEvent(options: {
    engine: SyncEngine
    sessionId: string
    message: {
        id: string
        seq: number
        localId: string | null
        content: unknown
        createdAt: number
    }
}): void {
    const handler = options.engine.handleRealtimeEvent

    if (typeof handler !== 'function') {
        return
    }

    handler.call(options.engine, {
        type: 'message-received',
        sessionId: options.sessionId,
        message: options.message
    })
}

function appendAssistantTextMessage(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    text: string
    localId?: string
}): void {
    const message = options.store.messages.addMessage(options.sessionId, {
        role: 'assistant',
        content: {
            type: 'text',
            text: options.text
        },
        meta: {
            sentFrom: 'webapp'
        }
    }, options.localId)

    emitSessionMessageReceivedEvent({
        engine: options.engine,
        sessionId: options.sessionId,
        message: {
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt
        }
    })
}

function trimInitCommandOutput(output: string | undefined, maxChars: number): string | null {
    return trimTaskActionOutput(output, maxChars)
}

function buildInitCommandReportLines(options: {
    command: string
    summary: string
    stdout?: string
    stderr?: string
    maxChars: number
}): string[] {
    return buildTaskActionCommandReportLines(options)
}

function resolveWorkflowKickoff(options: {
    task: Pick<StoredTask, 'id' | 'title' | 'description' | 'status' | 'role' | 'source' | 'subTasks' | 'workflowProfile' | 'workflowPhase' | 'goalId' | 'goalTodoRef' | 'contract' | 'handoff' | 'evidence'>
    kickoff: StartSessionKickoffOptions
    agentOutputLocale?: string
}): StartSessionKickoffOptions {
    if (options.kickoff.kind === 'skip' || options.kickoff.kind === 'custom') {
        return options.kickoff
    }

    const workflowProfile = options.task.workflowProfile?.trim().toLowerCase()
    if (workflowProfile !== 'gsd') {
        return options.kickoff
    }

    const phase = options.task.workflowPhase?.trim().toLowerCase()
    let guidance: string | null = null
    if (phase === 'discuss') {
        guidance = 'Workflow mode: GSD discuss. Do not implement yet. Help clarify scope, constraints, unknowns, and what should be locked before planning.'
    } else if (phase === 'plan') {
        guidance = 'Workflow mode: GSD plan. Do not implement yet. Turn this task into a concrete execution plan with ordered steps, dependencies, risks, and missing information.'
    } else if (phase === 'verify') {
        guidance = 'Workflow mode: GSD verify. Focus on checking completeness, surfacing gaps, and deciding whether the task is done or should return to execution.'
    }

    if (!guidance) {
        return options.kickoff
    }

    return {
        kind: 'custom',
        text: `${buildTaskKickoffSummary(options.task, { agentOutputLocale: options.agentOutputLocale })}

${guidance}`,
        localId: `${AUTO_WORKFLOW_LOCAL_ID_PREFIX}${options.task.id}:${Date.now()}`,
        includeCarryoverHistory: true
    }
}

type GoalTaskRole = 'Planner' | 'Generator' | 'Evaluator' | 'Radar'

function coerceSessionPermissionModeForAgent(
    mode: z.infer<typeof PermissionModeSchema> | null | undefined,
    agent: z.infer<typeof AgentFlavorSchema>
): z.infer<typeof PermissionModeSchema> | null {
    if (agent === 'codex' && mode === 'plan') {
        return 'safe-yolo'
    }
    return coercePermissionModeForFlavor(mode, agent)
}

function getGoalTaskRole(task: Pick<StoredTask, 'goalId' | 'status' | 'role' | 'source'>): GoalTaskRole | null {
    const goalId = (task.goalId ?? '').trim()
    if (!goalId) {
        return null
    }

    const explicitRole = (task.role ?? '').trim().toLowerCase()
    if (explicitRole === 'planner') return 'Planner'
    if (explicitRole === 'radar') return 'Radar'
    if (explicitRole === 'evaluator') return 'Evaluator'
    if (explicitRole === 'generator') return 'Generator'

    const source = (task.source ?? '').trim().toLowerCase()
    const status = (task.status ?? '').trim().toLowerCase()
    if (status === 'review' || status === 'in_review') return 'Evaluator'
    if (source === 'planner') return 'Planner'
    if (source === 'radar') return 'Radar'
    if (source === 'evaluator') return 'Evaluator'
    return 'Generator'
}

function normalizeGoalTodoStatusForTask(status: string | null | undefined): GoalTodoStatus {
    switch ((status ?? '').trim().toLowerCase()) {
        case 'planning':
        case 'planned':
            return 'planning'
        case 'running':
        case 'in_progress':
            return 'running'
        case 'review':
        case 'in_review':
            return 'review'
        case 'blocked':
            return 'blocked'
        case 'done':
        case 'finished':
            return 'done'
        default:
            return 'planning'
    }
}

function defaultGoalTodoTagForStatus(status: GoalTodoStatus): string | null {
    switch (status) {
        case 'planning':
            return 'ready'
        case 'running':
            return 'promoted'
        case 'review':
            return 'in_review'
        case 'blocked':
            return 'unknown'
        case 'done':
            return 'accepted'
        case 'unknown':
            return null
    }
}

function getDefaultProjectWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    return project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function toHopiTaskRole(role: GoalTaskRole | null): HopiTaskRole | undefined {
    if (!role) {
        return undefined
    }
    return role.toLowerCase() as HopiTaskRole
}

function buildGoalActionPacketSection(role: GoalTaskRole): string {
    const exampleStatus = role === 'Generator' ? 'review' : 'done'
    const commonActions = role === 'Planner' || role === 'Radar'
        ? [
            '- create_goal_task: create a small ready task for this Goal; include a useful description and a markdown contract; when promoting an existing .hopi/docs/goals/<goalKey>/todo.yml item, set `todoRef` to that item ref.',
            '- update_goal: update Goal currentFocus/successCriteria or set active/blocked when durable; do not use paused/done/archived without explicit human instruction.',
            '- create_decision_topic: ask one blocking human question when needed; set `scope` to `goal` for a milestone checkpoint that should stop further promotion, or `task` with `taskId` for a task-local blocker.',
            '- update_current_task: record handoff/evidence and finish or block this role task.'
            ]
        : role === 'Evaluator'
            ? [
                '- update_current_task: accept by moving to done, or return to planning/blocked with concrete feedback.',
                '- create_decision_topic: ask for human approval or product clarification when needed; use explicit `scope`.'
            ]
            : [
                '- update_current_task: move completed work to review with handoff/evidence, or block with a concrete reason.',
                '- create_decision_topic: ask for human clarification when needed; use explicit `scope`.'
            ]

    return [
        '',
        'Final HOPI_ACTIONS packet:',
        '- HOPI applies this JSON after your turn; do not call separate HOPI state mutation tools.',
        '- If no HOPI state change is needed, omit the packet.',
        '- Canonical .hopi/docs/goals/<goalKey>/todo.yml shape is `version: 1`, `goal.goalKey`, and `items[]` with stable `ref`, `status`, `title`, optional `body`, and optional `dependencyTaskList`.',
        '- Todo item status values are candidate, planned, in_progress, in_review, merging, blocked, done. Use `candidate` for non-dispatched reservoir items; use `blocked` only as an explicit automation hold.',
        '- Task titles are user-visible text only. Do not prefix or include ids or yaml keys in `title`.',
        '- Put `HOPI_ACTIONS:` on its own line before the fenced JSON block. Do not put `HOPI_ACTIONS:` inside the fenced block.',
        ...commonActions,
        ...(role === 'Planner' || role === 'Radar'
            ? ['- create_goal_task shape: { "type": "create_goal_task", "todoRef": "existing-todo-ref-optional", "title": "...", "description": "2-5 lines of context and expected outcome.", "priority": "high|medium|low", "contract": "## Type\\nfeature|bugfix|refactor|test|content|infra|performance\\n\\n## Context\\n...\\n\\n## Involved Files / Areas\\n- Known files: ...\\n- Likely areas: ...\\n- Unknowns: ...\\n\\n## Scope\\n...\\n\\n## Acceptance\\n- ...\\n\\n## Suggested Checks\\n- ...\\n\\n## Non-goals / Constraints\\n- ..." }']
            : []),
        '- create_decision_topic shape: { "type": "create_decision_topic", "scope": "goal|task", "taskId": "required-for-task-scope", "title": "...", "body": "...", "blocking": true }',
        '- Finish with one fenced JSON block in this shape; add create_goal_task actions before update_current_task when needed:',
        'HOPI_ACTIONS:',
        '```json',
        '{',
        '  "actions": [',
        `    { "type": "update_current_task", "status": "${exampleStatus}", "handoff": "...", "evidence": "..." }`,
        '  ]',
        '}',
        '```'
    ].join('\n')
}

function buildGoalRoleSection(task: Pick<StoredTask, 'goalId' | 'status' | 'role' | 'source'>): string {
    const role = getGoalTaskRole(task)
    if (!role) {
        return ''
    }

    if (role === 'Planner') {
        return [
            '',
            '',
            'Role: Planner',
            '',
            'Context strategy:',
            '- Read .hopi/preference.md, .hopi/docs/index.md, .hopi/docs/goals/<goalKey>/goal.md, .hopi/docs/goals/<goalKey>/design.md, .hopi/docs/goals/<goalKey>/todo.yml, .hopi/docs/goals/<goalKey>/decisions.yml, .hopi/docs/goals/<goalKey>/events.jsonl, and the current Goal kanban snapshot.',
            '- Keep docs maintenance durable: update repo docs when strategy, decisions, design rationale, or todo state changes.',
            '- Update design.md before creating, splitting, replacing, reordering, or retiring substantial engineering tasks.',
            '- When promoting todo work into kanban, keep the matching .hopi/docs/goals/<goalKey>/todo.yml item on a canonical execution lane and preserve its stable `ref`; HOPI also attempts this from create_goal_task, but the doc is the source of truth.',
            '',
            'Task creation quality bar:',
            '- Create tasks that a Generator can execute without re-planning the whole Goal.',
            '- Classify each task as bugfix, feature, refactor, test, content, infra, or performance.',
            '- Use `description` for a concise human summary, not a copy of the title.',
            '- Use `contract` for the execution brief with Type, Context, Involved Files / Areas, Scope, Acceptance, Suggested Checks, and Non-goals / Constraints.',
            '- Include involved files for bugfix/refactor/test/content/infra tasks when verified; for feature tasks, include the scene/component/route/domain area at minimum.',
            '- If exact files are not verified, write likely areas and unknowns instead of inventing paths.',
            '- Keep contracts lightweight but specific: concrete behavior, boundaries, verification, and what not to change.',
            '',
            'Allowed transitions:',
            '- Create enough independent ready goal-scoped kanban tasks to fill available generator lane capacity, usually 2-3 when the lane is empty.',
            '- Create fewer tasks when candidates depend on each other, would edit the same files, or need a human decision.',
            '- Mark this Goal active or blocked, or update current focus when needed.',
            '- Do not mark the Goal paused, done, or archived; those are explicit human lifecycle actions.',
            '- Create one blocking human question when the Goal or task is unclear.',
            '- Record handoff/evidence and move this planning task to blocked or done.',
            buildGoalActionPacketSection(role)
        ].join('\n')
    }

    if (role === 'Evaluator') {
        return [
            '',
            '',
            'Role: Evaluator',
            '',
            'Context strategy:',
            '- Read the Task Contract, Generator Handoff, Evidence Packet, full diff, relevant docs, and affected files.',
            '- Judge acceptance with evidence; do not trust Generator self-assessment without checking.',
            '- When accepting linked todo work, update the matching .hopi/docs/goals/<goalKey>/todo.yml item to `status: done` and keep its stable `ref`; HOPI also attempts this from the stored task link, but the doc is the source of truth.',
            '',
            'Allowed transitions:',
            '- Record evidence and move accepted work to done; HOPI will request the existing worktree merge flow before closing accepted work.',
            '- Return incomplete work to planning or blocked with concrete feedback.',
            '- Create a DecisionTopic when human approval or product clarification is needed.',
            buildGoalActionPacketSection(role)
        ].join('\n')
    }

    if (role === 'Radar') {
        return [
            '',
            '',
            'Role: Radar',
            '',
            'Context strategy:',
            '- Read .hopi/docs/*, including goal design.md files, recent task outcomes, TODO/FIXME scan output, and code/documentation drift signals.',
            '- Keep findings curated; Radar is a maintenance signal, not a dumping ground.',
            '',
            'Allowed transitions:',
            '- Update .hopi/docs/goals/<goalKey>/todo.yml with durable candidate findings.',
            '- Create goal tasks only for small, verifiable, high-confidence maintenance tasks.',
            '- Record evidence and mark this Radar task done or blocked.',
            buildGoalActionPacketSection(role)
        ].join('\n')
    }

    return [
        '',
        '',
        'Role: Generator',
        '',
        'Context strategy:',
        '- Read the Task Contract, Goal doc, design.md, relevant decisions, linked files/search results, current git status, and latest Planner handoff.',
        '- Update durable behavior or architecture docs when lasting product knowledge changes; keep linked todo work promoted and do not mark it done before Evaluator acceptance.',
        '',
        'Allowed transitions:',
        '- Record handoff/evidence and move complete work to review.',
        '- Move unclear or impossible work to blocked.',
        '- Create a DecisionTopic when human clarification is required.',
        buildGoalActionPacketSection(role)
    ].join('\n')
}

function buildTaskKickoffSummary(
    task: Pick<StoredTask, 'id' | 'title' | 'description' | 'status' | 'role' | 'source' | 'subTasks' | 'goalId' | 'goalTodoRef' | 'contract' | 'handoff' | 'evidence'>,
    options?: { agentOutputLocale?: string }
): string {
    const taskId = (task.id ?? '').trim()
    const title = (task.title ?? '').trim()
    const description = (task.description ?? '').trim()
    const goalId = (task.goalId ?? '').trim()
    const goalTodoRef = (task.goalTodoRef ?? '').trim()
    const contract = (task.contract ?? '').trim()
    const handoff = (task.handoff ?? '').trim()
    const evidence = (task.evidence ?? '').trim()
    const subTasks = Array.isArray(task.subTasks)
        ? task.subTasks as Array<{ content?: unknown; status?: unknown }>
        : []
    const subTaskLines = subTasks
        .map((subTask) => {
            const content = typeof subTask.content === 'string' ? subTask.content.trim() : ''
            if (!content) {
                return null
            }
            const done = subTask.status === 'completed'
            return `- [${done ? 'x' : ' '}] ${content}`
        })
        .filter((line): line is string => Boolean(line))
    const subTasksSection = subTaskLines.length > 0
        ? `\n\nSubtasks:\n${subTaskLines.join('\n')}`
        : ''
    const goalSection = goalId
        ? `\n\nGoal ID: ${goalId}`
        : ''
    const taskIdentitySection = [
        taskId ? `Task ID: ${taskId}` : '',
        goalTodoRef ? `Goal Todo Ref: ${goalTodoRef}` : ''
    ].filter(Boolean).join('\n')
    const taskMetadataSection = taskIdentitySection
        ? `\n\n${taskIdentitySection}`
        : ''
    const roleSection = buildGoalRoleSection(task)
    const role = getGoalTaskRole(task)
    const contractSection = contract
        ? `\n\nTask Contract:\n${contract}`
        : ''
    const handoffSection = handoff
        ? role === 'Evaluator'
            ? `\n\nGenerator Handoff:\n${handoff}`
            : `\n\nLatest Handoff:\n${handoff}`
        : ''
    const evidenceSection = evidence
        ? `\n\nEvidence Packet:\n${evidence}`
        : role === 'Evaluator'
            ? '\n\nEvidence Packet:\n- None recorded yet.'
            : ''
    const contextSections = `${taskMetadataSection}${goalSection}${roleSection}${contractSection}${handoffSection}${evidenceSection}`

    const languageSection = options?.agentOutputLocale
        ? buildAgentOutputLanguageSection(options.agentOutputLocale)
        : ''

    if (title && description) {
        return `Task: ${title}\n\nDescription:\n${description}${subTasksSection}${contextSections}${languageSection}`
    }
    if (description) {
        return `${description}${subTasksSection}${contextSections}${languageSection}`
    }
    if (title) {
        return `Task: ${title}${subTasksSection}${contextSections}${languageSection}`
    }
    if (subTasksSection) {
        return `Task${subTasksSection}${contextSections}${languageSection}`
    }
    return `Task${contextSections}${languageSection}`
}

function buildRepeatedInitFailureNote(options: {
    blockedReason: string
    manualStep: string
}): string {
    return buildRepeatedTaskActionFailureNote(options)
}

function buildSetupWorkflowResultMessage(result: SetupWorkflowRunResult): string {
    const lines: string[] = []

    if (result.ok) {
        lines.push(`HOPI ran setup workflow from \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` before kickoff.`)
    } else {
        lines.push(`HOPI ran setup workflow from \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\`, but it failed before kickoff.`)
    }

    lines.push('')
    lines.push(`Manifest: ${result.manifestPath}`)
    lines.push(`Working directory: ${result.rootPath}`)

    for (const step of result.steps) {
        lines.push('')
        lines.push(`${step.status === 'succeeded' ? 'OK' : 'Failed'} step \`${step.id}\` (${step.type})`)
        lines.push(...buildInitCommandReportLines({
            command: step.command,
            summary: step.summary,
            stdout: step.stdout,
            stderr: step.stderr,
            maxChars: 4_000
        }))
    }

    if (!result.ok && result.steps.length === 0) {
        lines.push('')
        lines.push(`Failure: ${result.error}`)
    }

    return lines.join('\n')
}

function buildInvalidSetupContractMessage(options: {
    manifestPath: string
    error: string
}): string {
    return [
        `HOPI found \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\`, but the setup contract is invalid.`,
        '',
        `Manifest: ${options.manifestPath}`,
        `Error: ${options.error}`
    ].join('\n')
}

function buildMissingSetupContractMessage(options: {
    manifestPath: string
}): string {
    return [
        `HOPI could not find \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` for this task session.`,
        '',
        `Expected manifest: ${options.manifestPath}`
    ].join('\n')
}

function buildBootstrapSetupBypassMessage(): string {
    return [
        `HOPI skipped setup workflow preflight for this bootstrap task.`,
        '',
        `Reason: this task is responsible for creating or repairing \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\`.`,
        'Kickoff continues without requiring an existing contract.'
    ].join('\n')
}

function buildBootstrapStarterContractMessage(options: {
    manifestPath: string
    seeded: boolean
    inferred: boolean
}): string {
    if (options.seeded) {
        return [
            `HOPI created a starter \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` scaffold for this bootstrap task.`,
            '',
            `Manifest: ${options.manifestPath}`,
            options.inferred
                ? 'The scaffold was inferred from the repository structure; review and refine it before verifying automation.'
                : 'The scaffold is intentionally incomplete; update it before verifying automation.'
        ].join('\n')
    }

    return [
        `HOPI found an existing \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` for this bootstrap task.`,
        '',
        `Manifest: ${options.manifestPath}`,
        'Kickoff continues so the task can inspect and repair it if needed.'
    ].join('\n')
}

function isMissingSessionFileError(error: string | undefined): boolean {
    const normalized = (error ?? '').trim().toLowerCase()
    return normalized.includes('enoent') || normalized.includes('no such file')
}

function buildBootstrapStarterContract(targetBranch: string): string {
    return [
        '# HOPI bootstrap scaffold.',
        '# Replace empty sections with project-specific setup, preview, and merge rules before verifying automation.',
        'version: 1',
        'setup:',
        '  steps: []',
        'preview:',
        '  services: []',
        'merge:',
        `  targetBranch: ${JSON.stringify(targetBranch)}`,
        '  strategy: merge_commit',
        '  conflictResolution:',
        '    mode: ai',
        '    maxAttempts: 2'
    ].join('\n')
}

function isBootstrapPlaceholderContract(raw: string): boolean {
    const normalized = raw.replace(/\r\n/g, '\n')
    return normalized.includes('# HOPI bootstrap scaffold.')
        && normalized.includes('setup:\n  steps: []')
        && normalized.includes('preview:\n  services: []')
}

type BootstrapStarterContractInference = {
    content: string
    inferred: boolean
}

type PackageScriptMap = Record<string, string>

function decodeBase64Utf8(value: string | undefined): string | null {
    if (typeof value !== 'string' || value.length === 0) {
        return null
    }
    try {
        return Buffer.from(value, 'base64').toString('utf8')
    } catch {
        return null
    }
}

async function readOptionalSessionTextFile(options: {
    engine: SyncEngine
    sessionId: string
    rootPath: string
    relativePath: string
}): Promise<string | null> {
    const response = await options.engine.readSessionFile(options.sessionId, options.relativePath, options.rootPath)
    if (!response.success) {
        if (isMissingSessionFileError(response.error)) {
            return null
        }
        return null
    }
    return decodeBase64Utf8(response.content)
}

function tryParsePackageScripts(raw: string | null): PackageScriptMap | null {
    if (!raw) {
        return null
    }

    try {
        const parsed = JSON.parse(raw) as { scripts?: unknown }
        if (!parsed || typeof parsed !== 'object' || !parsed.scripts || typeof parsed.scripts !== 'object') {
            return {}
        }
        const scripts = Object.fromEntries(
            Object.entries(parsed.scripts as Record<string, unknown>)
                .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
        )
        return scripts
    } catch {
        return null
    }
}

function getPreferredPackageManager(lockfiles: {
    bunLock: boolean
    pnpmLock: boolean
    yarnLock: boolean
    npmLock: boolean
}): 'bun' | 'pnpm' | 'yarn' | 'npm' {
    if (lockfiles.bunLock) return 'bun'
    if (lockfiles.pnpmLock) return 'pnpm'
    if (lockfiles.yarnLock) return 'yarn'
    if (lockfiles.npmLock) return 'npm'
    return 'npm'
}

function getRunCommand(packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm', scriptName: string): string[] {
    if (packageManager === 'yarn') {
        return ['yarn', scriptName]
    }
    return [packageManager, 'run', scriptName]
}

function getInstallCommand(packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm'): string[] {
    if (packageManager === 'bun') return ['bun', 'install']
    if (packageManager === 'pnpm') return ['pnpm', 'install', '--frozen-lockfile']
    if (packageManager === 'yarn') return ['yarn', 'install', '--immutable']
    return ['npm', 'install']
}

function toYamlCommand(command: string[]): string {
    return `[${command.map((part) => JSON.stringify(part)).join(', ')}]`
}

function buildInferredBootstrapStarterContract(options: {
    targetBranch: string
    packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm'
    scripts: PackageScriptMap
}): string {
    const setupInstallCommand = toYamlCommand(getInstallCommand(options.packageManager))
    const devHub = options.scripts['dev:hub']
    const devWeb = options.scripts['dev:web']
    const dev = options.scripts.dev
    const start = options.scripts.start

    const lines: string[] = [
        '# HOPI bootstrap scaffold.',
        '# Review inferred commands and readiness checks before verifying automation.',
        'version: 1',
        'setup:',
        '  steps:',
        '    - id: install',
        '      type: run',
        '      cwd: "."',
        `      run: ${setupInstallCommand}`,
        'preview:',
        '  services: []',
        'merge:',
        `  targetBranch: ${JSON.stringify(options.targetBranch)}`,
        '  strategy: merge_commit',
        '  conflictResolution:',
        '    mode: ai',
        '    maxAttempts: 2'
    ]

    const insertIndex = lines.indexOf('  services: []')
    const previewLines = (() => {
        if (devHub && devWeb) {
            return [
                '  services:',
                '    - id: hub',
                '      type: run',
                '      cwd: "."',
                `      run: ${toYamlCommand(getRunCommand(options.packageManager, 'dev:hub'))}`,
                '      ready:',
                '        type: process_alive',
                '    - id: web',
                '      type: run',
                '      cwd: "."',
                `      run: ${toYamlCommand(getRunCommand(options.packageManager, 'dev:web'))}`,
                '      ready:',
                '        type: process_alive',
                '      expose: primary',
                '  success:',
                '    require: ["hub", "web"]'
            ]
        }

        const primaryScriptName = dev ? 'dev' : start ? 'start' : null
        if (primaryScriptName) {
            return [
                '  services:',
                '    - id: app',
                '      type: run',
                '      cwd: "."',
                `      run: ${toYamlCommand(getRunCommand(options.packageManager, primaryScriptName))}`,
                '      ready:',
                '        type: process_alive',
                '      expose: primary',
                '  success:',
                '    require: ["app"]'
            ]
        }

        return ['  services: []']
    })()

    lines.splice(insertIndex, 1, ...previewLines)
    return lines.join('\n')
}

async function inferBootstrapStarterContract(options: {
    engine: SyncEngine
    sessionId: string
    rootPath: string
    targetBranch: string
}): Promise<BootstrapStarterContractInference> {
    const [packageJsonRaw, bunLockRaw, pnpmLockRaw, yarnLockRaw, npmLockRaw] = await Promise.all([
        readOptionalSessionTextFile({
            engine: options.engine,
            sessionId: options.sessionId,
            rootPath: options.rootPath,
            relativePath: 'package.json'
        }),
        readOptionalSessionTextFile({
            engine: options.engine,
            sessionId: options.sessionId,
            rootPath: options.rootPath,
            relativePath: 'bun.lock'
        }),
        readOptionalSessionTextFile({
            engine: options.engine,
            sessionId: options.sessionId,
            rootPath: options.rootPath,
            relativePath: 'pnpm-lock.yaml'
        }),
        readOptionalSessionTextFile({
            engine: options.engine,
            sessionId: options.sessionId,
            rootPath: options.rootPath,
            relativePath: 'yarn.lock'
        }),
        readOptionalSessionTextFile({
            engine: options.engine,
            sessionId: options.sessionId,
            rootPath: options.rootPath,
            relativePath: 'package-lock.json'
        })
    ])

    const scripts = tryParsePackageScripts(packageJsonRaw)
    if (!scripts) {
        return {
            content: buildBootstrapStarterContract(options.targetBranch),
            inferred: false
        }
    }

    const packageManager = getPreferredPackageManager({
        bunLock: bunLockRaw !== null,
        pnpmLock: pnpmLockRaw !== null,
        yarnLock: yarnLockRaw !== null,
        npmLock: npmLockRaw !== null
    })

    const inferredContent = buildInferredBootstrapStarterContract({
        targetBranch: options.targetBranch,
        packageManager,
        scripts
    })

    return {
        content: inferredContent,
        inferred: !inferredContent.includes('  services: []')
    }
}

async function ensureBootstrapStarterContract(options: {
    engine: SyncEngine
    sessionId: string
    rootPath: string
    targetBranch: string
}): Promise<{
    ok: true
    seeded: boolean
    inferred: boolean
    manifestPath: string
} | {
    ok: false
    manifestPath: string
    error: string
}> {
    const normalizedRootPath = options.rootPath.replace(/\/+$/u, '')
    const manifestPath = `${normalizedRootPath}/${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`
    const existing = await options.engine.readSessionFile(
        options.sessionId,
        PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH,
        options.rootPath
    )

    if (existing.success && existing.content) {
        const raw = decodeBase64Utf8(existing.content)
        if (raw) {
            const parsedExisting = parseProjectActionContract({ manifestPath, raw })
            if (parsedExisting.kind === 'valid') {
                return {
                    ok: true,
                    seeded: false,
                    inferred: false,
                    manifestPath
                }
            }

            if (isBootstrapPlaceholderContract(raw)) {
                const inferredStarter = await inferBootstrapStarterContract({
                    engine: options.engine,
                    sessionId: options.sessionId,
                    rootPath: options.rootPath,
                    targetBranch: options.targetBranch
                })

                if (inferredStarter.inferred && inferredStarter.content.trim() !== raw.trim()) {
                    const overwriteContent = Buffer.from(inferredStarter.content, 'utf8').toString('base64')
                    const overwritten = await options.engine.writeSessionFile(options.sessionId, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH, {
                        cwd: options.rootPath,
                        content: overwriteContent,
                        createParents: true,
                        overwrite: true
                    })

                    if (!overwritten.success) {
                        return {
                            ok: false,
                            manifestPath,
                            error: overwritten.error ?? 'Failed to refresh starter actions manifest'
                        }
                    }

                    return {
                        ok: true,
                        seeded: true,
                        inferred: true,
                        manifestPath
                    }
                }
            }
        }

        return {
            ok: true,
            seeded: false,
            inferred: false,
            manifestPath
        }
    }

    if (!isMissingSessionFileError(existing.error)) {
        return {
            ok: false,
            manifestPath,
            error: existing.error ?? 'Failed to inspect actions manifest'
        }
    }

    const inferredStarter = await inferBootstrapStarterContract({
        engine: options.engine,
        sessionId: options.sessionId,
        rootPath: options.rootPath,
        targetBranch: options.targetBranch
    })
    const content = Buffer.from(inferredStarter.content, 'utf8').toString('base64')
    const created = await options.engine.writeSessionFile(options.sessionId, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH, {
        cwd: options.rootPath,
        content,
        createParents: true
    })

    if (!created.success) {
        return {
            ok: false,
            manifestPath,
            error: created.error ?? 'Failed to write starter actions manifest'
        }
    }

    return {
        ok: true,
        seeded: true,
        inferred: inferredStarter.inferred,
        manifestPath
    }
}

function buildBlockedInitFailure(options: {
    task: Pick<StoredTask, 'initRuntime'>
    code: TaskSessionStartFailureCode
    message: string
    blockedReason: string
    failureFingerprint: string
    manualStep: string
    retryAction: TaskSessionStartRetryAction
}): TaskSessionStartFailure {
    const repeated = options.task.initRuntime?.failureFingerprint === options.failureFingerprint

    return createTaskSessionStartFailure({
        code: options.code,
        message: repeated
            ? buildRepeatedInitFailureNote({
                blockedReason: options.blockedReason,
                manualStep: options.manualStep
            })
            : options.message,
        blockedReason: options.blockedReason,
        retryCount: options.task.initRuntime?.retryCount ?? 0,
        retryAction: options.retryAction,
        retryAvailable: true
    })
}

function buildTaskInitFailureFingerprint(options: {
    reason: string
    blockedReason: string
    initScriptCwd?: string
    initScript?: {
        error?: string | null
        stdout?: string
        stderr?: string
    } | null
}): string {
    const digest = createHash('sha1').update(JSON.stringify({
        reason: options.reason,
        blockedReason: options.blockedReason,
        initScriptCwd: options.initScriptCwd ?? null,
        initScript: options.initScript
            ? {
                error: options.initScript.error ?? null,
                stdout: trimInitCommandOutput(options.initScript.stdout, 512),
                stderr: trimInitCommandOutput(options.initScript.stderr, 512)
            }
            : null
    })).digest('hex').slice(0, 12)

    return `init:${digest}`
}

function buildTaskInitRuntime(options: {
    task: Pick<StoredTask, 'activeSessionId' | 'initRuntime'>
    status: TaskInitRuntimeStatus
    sessionId?: string | null
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    failure?: TaskSessionStartFailure | null
    startedAt?: number | null
    completedAt?: number | null
}): NonNullable<StoredTask['initRuntime']> {
    return buildSharedTaskInitRuntime({
        current: options.task.initRuntime,
        activeSessionId: options.task.activeSessionId,
        status: options.status,
        sessionId: options.sessionId,
        retryCount: options.retryCount,
        failureFingerprint: options.failureFingerprint,
        latestNote: options.latestNote,
        blockedReason: options.blockedReason,
        failure: options.failure,
        startedAt: options.startedAt,
        completedAt: options.completedAt
    })
}

function toSessionRootPathLike(session: { metadata?: unknown | null } | null | undefined): SessionRootPathLike | null {
    if (!session?.metadata || typeof session.metadata !== 'object') {
        return null
    }

    return { metadata: session.metadata as SessionRootPathLike['metadata'] }
}

function resolveGoalPreviousRootPath(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    previousSessionId: string | null
}): string | null {
    if (!options.previousSessionId) {
        return null
    }

    const engineWithLookup = options.engine as unknown as {
        getSessionByNamespace?: SyncEngine['getSessionByNamespace']
    }
    const runtimeSession = typeof engineWithLookup.getSessionByNamespace === 'function'
        ? engineWithLookup.getSessionByNamespace.call(options.engine, options.previousSessionId, options.namespace)
        : undefined
    const runtimePath = resolveSessionPreferredRootPath(toSessionRootPathLike(runtimeSession) ?? {})
    if (runtimePath) {
        return runtimePath
    }

    const storedSession = options.store.sessions.getSessionByNamespace(options.previousSessionId, options.namespace)
    return resolveSessionPreferredRootPath(toSessionRootPathLike(storedSession) ?? {})
}

function sessionHasPendingRequests(session: Pick<Session, 'agentState'> | null | undefined): boolean {
    const agentState = session?.agentState
    if (!agentState || typeof agentState !== 'object') {
        return false
    }
    const requests = (agentState as { requests?: unknown }).requests
    return Boolean(requests && typeof requests === 'object' && Object.keys(requests).length > 0)
}

export type StartTaskSessionResult =
    | {
        ok: true
        task: StoredTask
        sessionId: string
        initRecoveryAttempted?: boolean
        initRecoveryError?: TaskSessionStartFailure
    }
    | { ok: false; error: TaskSessionStartFailure }

async function continueTaskInLinkedSessionInternal(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
}): Promise<StartTaskSessionResult | null> {
    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'task_not_found',
                message: 'Task not found',
                retryAvailable: false
            })
        }
    }

    if ((task.status !== 'planning' && task.status !== 'planned') || !task.goalId || !task.activeSessionId) {
        return null
    }

    const linkedSession = options.engine.getSessionByNamespace(task.activeSessionId, options.namespace)
    if (!linkedSession || linkedSession.active === false || linkedSession.thinking || sessionHasPendingRequests(linkedSession)) {
        return null
    }

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'project_not_found',
                message: 'Project not found',
                retryAvailable: false
            })
        }
    }

    setSessionTaskLink({
        store: options.store,
        engine: options.engine,
        sessionId: linkedSession.id,
        namespace: options.namespace,
        projectId: project.id,
        taskId: task.id,
        name: task.title,
        hopiTaskRole: toHopiTaskRole(getGoalTaskRole(task))
    })

    const agentOutputLocale = resolveAgentOutputLocale({
        agentOutputLanguage: project.agentOutputLanguage,
        session: linkedSession
    })
    const kickoff = resolveWorkflowKickoff({
        task,
        kickoff: { kind: 'default' },
        agentOutputLocale
    })
    const kickoffText = (() => {
        if (kickoff.kind === 'skip') {
            return ''
        }
        if (kickoff.kind === 'custom') {
            return normalizeText(kickoff.text)
        }
        return buildTaskKickoffSummary(task, { agentOutputLocale })
    })()

    if (kickoffText) {
        await options.engine.sendMessage(linkedSession.id, {
            text: kickoffText,
            localId: kickoff.kind === 'custom' && kickoff.localId
                ? kickoff.localId
                : `auto:kickoff:${task.id}:${Date.now()}`,
            sentFrom: 'webapp'
        })
    }

    const strategy = getWorkflowStrategy(task)
    const workflowPatch = strategy.getTaskPatchForTransition('task_prompted', task) ?? { status: 'running' }
    const updatedTask = options.store.tasks.updateTaskByNamespace(task.id, options.namespace, {
        activeSessionId: linkedSession.id,
        status: workflowPatch.status ?? 'running',
        workflowPhase: workflowPatch.workflowPhase,
        initRuntime: buildTaskInitRuntime({
            task,
            status: 'succeeded',
            sessionId: linkedSession.id,
            retryCount: task.initRuntime?.retryCount,
            latestNote: 'Goal role continued in the linked session.'
        })
    })

    if (!updatedTask) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'task_not_found',
                message: 'Task not found',
                retryAvailable: false
            })
        }
    }

    if (updatedTask.goalId && updatedTask.goalTodoRef) {
        const goal = options.store.goals.getGoalByNamespace(updatedTask.goalId, options.namespace)
        if (goal && goal.projectId === project.id) {
            const goalStatus = normalizeGoalTodoStatusForTask(updatedTask.status)
            const defaultWorkspace = updatedTask.workspaceId
                ? options.store.workspaces.getWorkspace(updatedTask.workspaceId)
                : getDefaultProjectWorkspace(options.store, project)
            upsertGoalTodoTaskState({
                project,
                goal,
                defaultWorkspace,
                taskId: updatedTask.goalTodoRef,
                status: goalStatus,
                tag: defaultGoalTodoTagForStatus(goalStatus),
                title: updatedTask.title,
                body: updatedTask.description,
                blocked: null
            })
        }
    }

    options.engine.handleRealtimeEvent({
        type: 'task-updated',
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        namespace: options.namespace,
        data: {
            taskId: updatedTask.id,
            activeSessionId: updatedTask.activeSessionId,
            initRuntime: updatedTask.initRuntime
        }
    })

    return {
        ok: true,
        task: updatedTask,
        sessionId: linkedSession.id
    }
}

export async function continueTaskInLinkedSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
}): Promise<StartTaskSessionResult | null> {
    try {
        return await continueTaskInLinkedSessionInternal(options)
    } catch (error) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'unexpected_error',
                message: formatErrorMessage(error, 'Failed to continue linked task session')
            })
        }
    }
}


async function startSessionFromTaskInternal(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    overrides?: StartSessionOverrides
    kickoff?: StartSessionKickoffOptions
}): Promise<StartTaskSessionResult> {
    const overrides = options.overrides ?? {}
    const requestedKickoff: StartSessionKickoffOptions = options.kickoff ?? { kind: 'default' }

    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'task_not_found',
                message: 'Task not found',
                retryAvailable: false
            })
        }
    }
    const previousSessionId = task.activeSessionId

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'project_not_found',
                message: 'Project not found',
                retryAvailable: false
            })
        }
    }
    const projectWorkspaces = options.store.workspaces.listWorkspacesByProject(project.id)

    const resolvedWorkspaceId = overrides.workspaceId
        ?? task.workspaceId
        ?? project.defaultWorkspaceId

    if (!resolvedWorkspaceId) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'workspace_required',
                message: 'No workspace selected',
                retryAction: 'manual_fix_then_retry_start'
            })
        }
    }

    const workspace = options.store.workspaces.getWorkspace(resolvedWorkspaceId)
    if (!workspace || workspace.projectId !== project.id) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'workspace_not_found',
                message: 'Workspace not found',
                retryAvailable: false
            })
        }
    }

    const agent = overrides.agent
        ?? (task.agentFlavor as z.infer<typeof AgentFlavorSchema> | undefined)
        ?? (project.defaultAgentFlavor as z.infer<typeof AgentFlavorSchema> | undefined)
        ?? DEFAULT_AGENT_FLAVOR

    const overrideModel = normalizeModelName(overrides.model)
    const taskModel = resolveStoredModel(task.model, task.modelMode)
    const projectDefaultModel = resolveStoredModel(project.defaultModel, project.defaultModelMode)
    const model = overrideModel
        ?? taskModel
        ?? projectDefaultModel
        ?? (agent === DEFAULT_AGENT_FLAVOR ? DEFAULT_TASK_MODEL : undefined)

    const taskPermissionMode = coerceSessionPermissionModeForAgent(
        task.permissionMode as z.infer<typeof PermissionModeSchema> | null,
        agent
    )
    const projectPermissionMode = coerceSessionPermissionModeForAgent(
        project.defaultPermissionMode as z.infer<typeof PermissionModeSchema> | null,
        agent
    )
    let permissionMode = overrides.permissionMode
        ?? taskPermissionMode
        ?? projectPermissionMode
        ?? undefined

    const workflowProfile = (task.workflowProfile ?? '').trim().toLowerCase()
    const workflowPhase = (task.workflowPhase ?? '').trim().toLowerCase()
    const isGsdWorkflow = workflowProfile === 'gsd'
    const isGsdNonExecutionPhase = isGsdWorkflow && (workflowPhase === '' || workflowPhase === 'discuss' || workflowPhase === 'plan' || workflowPhase === 'verify')
    const isGoalPlanningRole = Boolean(task.goalId) && (task.source === 'planner' || task.source === 'radar')
    const isGoalReviewRole = Boolean(task.goalId) && (task.status === 'review' || task.status === 'in_review')
    const goalTaskRole = getGoalTaskRole(task)
    if (isGsdNonExecutionPhase) {
        // Workflow phases that should not trigger execution:
        // force session into an explicit planning / read-only posture regardless of stored task settings.
        permissionMode = agent === 'claude'
            ? 'plan'
            : agent === 'codex'
                ? 'safe-yolo'
            : agent === 'gemini'
                ? 'read-only'
                : 'default'
    } else if (isGoalPlanningRole) {
        permissionMode = resolveAutonomousPermissionModeForFlavor(agent, permissionMode) ?? undefined
    }
    if (agent === 'codex' && permissionMode === 'plan') {
        permissionMode = 'safe-yolo'
    }
    const modelMode = (() => {
        if (overrides.modelMode !== undefined) {
            return overrides.modelMode
        }
        if (overrideModel !== null) {
            return agent === 'claude' ? resolveClaudeModelMode(overrideModel) ?? undefined : undefined
        }
        if (agent !== 'claude') {
            return undefined
        }
        if (taskModel !== null) {
            return (task.modelMode as z.infer<typeof ModelModeSchema> | null)
                ?? resolveClaudeModelMode(taskModel)
                ?? undefined
        }
        if (projectDefaultModel !== null) {
            return (project.defaultModelMode as z.infer<typeof ModelModeSchema> | null)
                ?? resolveClaudeModelMode(projectDefaultModel)
                ?? undefined
        }
        return (task.modelMode as z.infer<typeof ModelModeSchema> | null)
            ?? (project.defaultModelMode as z.infer<typeof ModelModeSchema> | null)
            ?? undefined
    })()
    const inferredYolo = permissionMode === 'yolo' && isPermissionModeAllowedForFlavor(permissionMode, agent)
    const yolo = isGsdNonExecutionPhase ? false : overrides.yolo ?? inferredYolo

    const isGoalGeneratorContinuation = Boolean(task.goalId)
        && (task.status === 'planning' || task.status === 'planned')
        && task.source !== 'planner'
        && task.source !== 'radar'
        && Boolean(previousSessionId)
    const goalPreviousRootPath = isGoalReviewRole || isGoalGeneratorContinuation
        ? resolveGoalPreviousRootPath({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            previousSessionId
        })
        : null
    const spawnRootPath = isGoalPlanningRole
        ? workspace.path
        : goalPreviousRootPath ?? workspace.path
    const sessionType = isGoalPlanningRole || goalPreviousRootPath
        ? 'simple'
        : project.defaultSessionType === 'worktree'
            ? 'worktree'
            : 'simple'
    const worktreeName = sessionType === 'worktree'
        ? `task-${task.id.slice(0, 8)}-${task.title}`.slice(0, 80)
        : undefined
    const worktreeWorkspacePaths = sessionType === 'worktree'
        ? resolveWorktreeWorkspacePaths(projectWorkspaces.map((item) => item.path), workspace.path)
        : undefined

    const machine = options.engine.getMachineByNamespace(project.machineId, options.namespace)
    if (!machine) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'machine_not_found',
                message: 'Machine not found',
                retryAvailable: false
            })
        }
    }

    if (!isMachineRunnerReady(machine)) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'runner_offline',
                message: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
                retryAction: 'wait_then_retry_start'
            })
        }
    }

    const spawn = await options.engine.spawnSession(
        project.machineId,
        spawnRootPath,
        agent,
        model,
        yolo,
        sessionType,
        worktreeName,
        undefined,
        worktreeWorkspacePaths,
        sessionType === 'worktree' ? project.worktreeTargetBranch?.trim() || undefined : undefined
    )
    if (spawn.type !== 'success') {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'spawn_failed',
                message: spawn.message
            })
        }
    }

    const becameActive = await options.engine.waitForSessionActive(spawn.sessionId, 20_000)
    if (!becameActive) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'session_activation_timeout',
                message: 'Session failed to become active'
            })
        }
    }
    setSessionTaskLink({
        store: options.store,
        engine: options.engine,
        sessionId: spawn.sessionId,
        namespace: options.namespace,
        projectId: project.id,
        taskId: task.id,
        name: task.title,
        hopiTaskRole: toHopiTaskRole(goalTaskRole)
    })

    const sessionConfigPatch: SessionConfigPatch = {}
    if (permissionMode && isPermissionModeAllowedForFlavor(permissionMode, agent)) {
        sessionConfigPatch.permissionMode = permissionMode
    }
    if (Object.keys(sessionConfigPatch).length > 0) {
        await applySessionConfigWithRetry({
            engine: options.engine,
            sessionId: spawn.sessionId,
            patch: sessionConfigPatch
        })
    }
    if (modelMode && isModelModeAllowedForFlavor(modelMode, agent)) {
        await applySessionConfigWithRetry({
            engine: options.engine,
            sessionId: spawn.sessionId,
            patch: { modelMode }
        })
    }

    const engineWithSessionLookup = options.engine as unknown as {
        getSessionByNamespace?: (sessionId: string, namespace: string) => {
            metadata?: {
                path?: unknown
                worktree?: {
                    worktreePath?: unknown
                    basePath?: unknown
                } | null
            } | null
        } | undefined
    }
    const runtimeSession = typeof engineWithSessionLookup.getSessionByNamespace === 'function'
        ? engineWithSessionLookup.getSessionByNamespace.call(options.engine, spawn.sessionId, options.namespace)
        : undefined
    const agentOutputLocale = resolveAgentOutputLocale({
        agentOutputLanguage: project.agentOutputLanguage,
        session: runtimeSession
    })
    const kickoff = resolveWorkflowKickoff({ task, kickoff: requestedKickoff, agentOutputLocale })
    const initScriptCwdCandidates = resolveSessionRootPathCandidates({
        session: runtimeSession ?? {},
        workspacePath: workspace.path
    })

    const workflowStrategy = getWorkflowStrategy(task)
    const workflowPatch = isGoalReviewRole
        ? { status: 'review' as const }
        : workflowStrategy.getTaskPatchForTransition('session_started', task) ?? { status: 'running' }
    let runtimeTask = task

    const emitStartedTaskUpdate = (updatedTask: StoredTask): void => {
        options.engine.handleRealtimeEvent({
            type: 'task-updated',
            taskId: updatedTask.id,
            projectId: updatedTask.projectId,
            namespace: options.namespace,
            data: {
                taskId: updatedTask.id,
                activeSessionId: updatedTask.activeSessionId,
                initRuntime: updatedTask.initRuntime
            }
        })
    }

    const updateStartedTask = (patch?: {
        activeSessionId?: string | null
        status?: string
        workflowPhase?: string | null
        source?: string | null
        blockedReason?: string | null
        blockedSource?: string | null
        blockedSessionId?: string | null
        initRuntime?: StoredTask['initRuntime'] | null
    }): StoredTask | null => {
        const defaultActiveSessionId = isGoalReviewRole && previousSessionId
            ? previousSessionId
            : spawn.sessionId
        const previousTask = runtimeTask
        const updatedTask = options.store.tasks.updateTaskByNamespace(options.taskId, options.namespace, {
            activeSessionId: patch?.activeSessionId !== undefined ? patch.activeSessionId : defaultActiveSessionId,
            status: patch?.status ?? workflowPatch.status ?? 'running',
            workflowPhase: patch?.workflowPhase !== undefined ? patch.workflowPhase : workflowPatch.workflowPhase,
            source: patch?.source !== undefined
                ? patch.source
                : isGoalReviewRole
                    ? 'evaluator'
                    : task.source === 'improvements_scan'
                        ? 'manual'
                        : undefined,
            blockedReason: patch?.blockedReason,
            blockedSource: patch?.blockedSource,
            blockedSessionId: patch?.blockedSessionId,
            initRuntime: patch?.initRuntime
        })
        if (updatedTask) {
            runtimeTask = updatedTask
            if (updatedTask.goalId && updatedTask.goalTodoRef) {
                const goal = options.store.goals.getGoalByNamespace(updatedTask.goalId, options.namespace)
                if (goal && goal.projectId === project.id) {
                    const goalStatus = normalizeGoalTodoStatusForTask(updatedTask.status)
                    upsertGoalTodoTaskState({
                        project,
                        goal,
                        defaultWorkspace: workspace,
                        taskId: updatedTask.goalTodoRef,
                        status: goalStatus,
                        tag: defaultGoalTodoTagForStatus(goalStatus),
                        title: updatedTask.title,
                        body: updatedTask.description,
                        blocked: goalStatus === 'blocked'
                            ? {
                                kind: updatedTask.blockedSource ?? 'task_session_start',
                                summary: updatedTask.blockedReason,
                                updatedAt: Date.now()
                            }
                            : null
                    })
                }
            }
            notifyProjectControllerTaskBlockedTransition({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                previousTask,
                task: updatedTask
            })
        }
        return updatedTask
    }

    const applyBlockedInitState = (options: {
        failure: TaskSessionStartFailure
        failureFingerprint: string
    }): StoredTask | null => {
        return updateStartedTask({
            initRuntime: buildTaskInitRuntime({
                task: runtimeTask,
                status: 'blocked',
                sessionId: spawn.sessionId,
                failureFingerprint: options.failureFingerprint,
                failure: options.failure
            })
        })
    }

    let initRecoveryAttempted = false
    let initRecoveryError: TaskSessionStartFailure | undefined
    let updatedTask: StoredTask | null = null
    const blockTask = (options: {
        code: TaskSessionStartFailureCode
        message: string
        blockedReason: string
        manualStep: string
        failureFingerprint: string
        retryAction?: TaskSessionStartRetryAction
    }): StartTaskSessionResult => {
        const failure = buildBlockedInitFailure({
            task: runtimeTask,
            code: options.code,
            message: options.message,
            blockedReason: options.blockedReason,
            manualStep: options.manualStep,
            failureFingerprint: options.failureFingerprint,
            retryAction: options.retryAction ?? 'manual_fix_then_retry_start'
        })
        const blockedTask = applyBlockedInitState({
            failure,
            failureFingerprint: options.failureFingerprint
        })
        if (!blockedTask) {
            return {
                ok: false,
                error: createTaskSessionStartFailure({
                    code: 'task_not_found',
                    message: 'Task not found',
                    retryAvailable: false
                })
            }
        }
        emitStartedTaskUpdate(blockedTask)
        return {
            ok: true,
            task: blockedTask,
            sessionId: spawn.sessionId,
            initRecoveryAttempted,
            initRecoveryError
        }
    }

    const shouldBypassSetupContract = task.source === 'project_init'
    const shouldSkipSetupWorkflow = Boolean(task.goalId)

    if (shouldSkipSetupWorkflow) {
        updatedTask = updateStartedTask({
            initRuntime: buildTaskInitRuntime({
                task: runtimeTask,
                status: 'succeeded',
                sessionId: spawn.sessionId,
                retryCount: runtimeTask.initRuntime?.retryCount,
                latestNote: 'Goal role skipped setup workflow.'
            })
        })
    } else if (shouldBypassSetupContract) {
        const bootstrapManifest = await ensureBootstrapStarterContract({
            engine: options.engine,
            sessionId: spawn.sessionId,
            rootPath: initScriptCwdCandidates[0] ?? workspace.path,
            targetBranch: project.worktreeTargetBranch?.trim() || 'main'
        })

        if (!bootstrapManifest.ok) {
            appendAssistantTextMessage({
                store: options.store,
                engine: options.engine,
                sessionId: spawn.sessionId,
                localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:bootstrap-manifest-failed:${Date.now()}`,
                text: buildInvalidSetupContractMessage({
                    manifestPath: bootstrapManifest.manifestPath,
                    error: bootstrapManifest.error
                })
            })
            return blockTask({
                code: 'init_script_failed',
                message: `Bootstrap contract scaffold failed. ${SETUP_WORKFLOW_MANUAL_STEP}`,
                blockedReason: bootstrapManifest.error,
                manualStep: SETUP_WORKFLOW_MANUAL_STEP,
                failureFingerprint: buildTaskInitFailureFingerprint({
                    reason: 'bootstrap_contract_write_failed',
                    blockedReason: bootstrapManifest.error,
                    initScriptCwd: workspace.path
                })
            })
        }

        appendAssistantTextMessage({
            store: options.store,
            engine: options.engine,
            sessionId: spawn.sessionId,
            localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:bootstrap-bypass:${Date.now()}`,
            text: buildBootstrapSetupBypassMessage()
        })
        appendAssistantTextMessage({
            store: options.store,
            engine: options.engine,
            sessionId: spawn.sessionId,
            localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:bootstrap-manifest:${Date.now()}`,
            text: buildBootstrapStarterContractMessage({
                manifestPath: bootstrapManifest.manifestPath,
                seeded: bootstrapManifest.seeded,
                inferred: bootstrapManifest.inferred
            })
        })
        updatedTask = updateStartedTask({
            initRuntime: buildTaskInitRuntime({
                task: runtimeTask,
                status: 'succeeded',
                sessionId: spawn.sessionId,
                retryCount: runtimeTask.initRuntime?.retryCount,
                latestNote: bootstrapManifest.seeded
                    ? `${BOOTSTRAP_SETUP_BYPASS_NOTE} Starter scaffold written.`
                    : `${BOOTSTRAP_SETUP_BYPASS_NOTE} Existing manifest kept.`
            })
        })
    } else {
        const contractLoad = await loadProjectActionContractFromSession({
            engine: options.engine,
            sessionId: spawn.sessionId,
            rootPaths: initScriptCwdCandidates
        })

        const contractRootPath = contractLoad.rootPath ?? initScriptCwdCandidates[0] ?? workspace.path

        if (contractLoad.kind === 'invalid') {
            appendAssistantTextMessage({
                store: options.store,
                engine: options.engine,
                sessionId: spawn.sessionId,
                localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:contract-invalid:${Date.now()}`,
                text: buildInvalidSetupContractMessage({
                    manifestPath: contractLoad.manifestPath,
                    error: contractLoad.error
                })
            })
            return blockTask({
                code: 'init_script_failed',
                message: `Setup contract is invalid. ${SETUP_WORKFLOW_MANUAL_STEP}`,
                blockedReason: contractLoad.error,
                manualStep: SETUP_WORKFLOW_MANUAL_STEP,
                failureFingerprint: buildTaskInitFailureFingerprint({
                    reason: 'contract_invalid',
                    blockedReason: contractLoad.error,
                    initScriptCwd: contractRootPath
                })
            })
        }

        if (contractLoad.kind === 'missing') {
            appendAssistantTextMessage({
                store: options.store,
                engine: options.engine,
                sessionId: spawn.sessionId,
                localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:contract-missing:${Date.now()}`,
                text: buildMissingSetupContractMessage({
                    manifestPath: contractLoad.manifestPath
                })
            })
            return blockTask({
                code: 'init_script_failed',
                message: `Setup contract is missing. ${SETUP_WORKFLOW_MANUAL_STEP}`,
                blockedReason: `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`,
                manualStep: SETUP_WORKFLOW_MANUAL_STEP,
                failureFingerprint: buildTaskInitFailureFingerprint({
                    reason: 'contract_missing',
                    blockedReason: `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`,
                    initScriptCwd: contractRootPath
                })
            })
        }

        const setupResult = await runSetupWorkflow({
            engine: options.engine,
            sessionId: spawn.sessionId,
            rootPath: contractLoad.rootPath ?? contractRootPath,
            manifestPath: contractLoad.manifestPath,
            taskId: task.id,
            projectId: project.id,
            steps: contractLoad.contract.setup.steps
        })

        if (!setupResult.ok) {
            appendAssistantTextMessage({
                store: options.store,
                engine: options.engine,
                sessionId: spawn.sessionId,
                localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:setup-failed:${Date.now()}`,
                text: buildSetupWorkflowResultMessage(setupResult)
            })
            return blockTask({
                code: 'init_script_failed',
                message: `Setup workflow failed at step ${setupResult.stepId ?? '(unknown)'}. ${SETUP_WORKFLOW_MANUAL_STEP}`,
                blockedReason: setupResult.error,
                manualStep: SETUP_WORKFLOW_MANUAL_STEP,
                failureFingerprint: buildTaskInitFailureFingerprint({
                    reason: 'setup_workflow_failed',
                    blockedReason: setupResult.error,
                    initScriptCwd: setupResult.rootPath
                })
            })
        }

        updatedTask = updateStartedTask({
            initRuntime: buildTaskInitRuntime({
                task: runtimeTask,
                status: 'succeeded',
                sessionId: spawn.sessionId,
                retryCount: runtimeTask.initRuntime?.retryCount,
                latestNote: null
            })
        })
    }

    if (!updatedTask) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'task_not_found',
                message: 'Task not found',
                retryAvailable: false
            })
        }
    }

    emitStartedTaskUpdate(updatedTask)


    const shouldSendKickoffMessage = kickoff.kind !== 'skip'
    const uploadedAttachments: Array<{
        id: string
        filename: string
        mimeType: string
        size: number
        path: string
        previewUrl?: string
    }> = []

    if (shouldSendKickoffMessage) {
        const attachments = Array.isArray(updatedTask.attachments) ? updatedTask.attachments as Array<{
            id: string
            filename: string
            mimeType: string
            size: number
            dataUrl: string
            previewUrl?: string
        }> : []

        for (const attachment of attachments) {
            const base64 = dataUrlToBase64(attachment.dataUrl)
            try {
                const result = await options.engine.uploadFile(spawn.sessionId, attachment.filename, base64, attachment.mimeType)
                if (result && result.success && result.path) {
                    uploadedAttachments.push({
                        id: attachment.id,
                        filename: attachment.filename,
                        mimeType: attachment.mimeType,
                        size: attachment.size,
                        path: result.path,
                        previewUrl: attachment.previewUrl
                    })
                }
            } catch {
            }
        }

        const kickoffText = (() => {
            if (kickoff.kind === 'custom') {
                const baseKickoff = normalizeText(kickoff.text)
                if (!baseKickoff) {
                    return ''
                }
                if (!kickoff.includeCarryoverHistory || !previousSessionId || previousSessionId === spawn.sessionId) {
                    return baseKickoff
                }
                const historySection = buildCarryoverHistorySection(options.store, previousSessionId)
                return `${baseKickoff}${historySection}`
            }

            const baseKickoff = buildTaskKickoffSummary(updatedTask, { agentOutputLocale })

            if (!previousSessionId || previousSessionId === spawn.sessionId || updatedTask.goalId) {
                return baseKickoff
            }

            const historySection = buildCarryoverHistorySection(options.store, previousSessionId)
            return `${baseKickoff}${historySection}`
        })()

        if (kickoffText) {
            try {
                await options.engine.sendMessage(spawn.sessionId, {
                    text: kickoffText,
                    localId: kickoff.kind === 'custom' && kickoff.localId
                        ? kickoff.localId
                        : `auto:kickoff:${updatedTask.id}:${Date.now()}`,
                    attachments: uploadedAttachments,
                    sentFrom: 'webapp'
                })
            } catch {
            }
        }
    }

    return {
        ok: true,
        task: updatedTask,
        sessionId: spawn.sessionId,
        initRecoveryAttempted,
        initRecoveryError
    }
}

export async function startSessionFromTask(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    overrides?: StartSessionOverrides
    kickoff?: StartSessionKickoffOptions
}): Promise<StartTaskSessionResult> {
    try {
        return await startSessionFromTaskInternal(options)
    } catch (error) {
        return {
            ok: false,
            error: createTaskSessionStartFailure({
                code: 'unexpected_error',
                message: formatErrorMessage(error, 'Failed to start task session')
            })
        }
    }
}
