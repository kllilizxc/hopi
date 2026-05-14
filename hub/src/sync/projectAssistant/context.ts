import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import type { Store, StoredGoalDecisionTopic, StoredSession, StoredTask } from '../../store'
import {
    readGlobalPreferenceMarkdown,
    readGoalOperatorDocs
} from '../operator/operatorDocs'
import {
    ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX,
    ASSISTANT_KICKOFF_LOCAL_ID_PREFIX
} from './constants'
import type { AssistantMetadata } from './types'
import { extractMessageText, normalizeText } from './utils'
import { getGoal, getProject, getProjectWorkspace } from './projectStore'

export function formatCountByStatus(tasks: StoredTask[]): string {
    const counts = new Map<string, number>()
    for (const task of tasks) {
        counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
    }
    const lines = Array.from(counts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, count]) => `- ${status}: ${count}`)
    return lines.length > 0 ? lines.join('\n') : '- No tasks yet'
}

function formatTaskSnapshot(tasks: StoredTask[]): string {
    if (tasks.length === 0) {
        return '- No kanban tasks yet.'
    }
    return tasks.slice(0, 40).map((task) => [
        `- [${task.status}] ${task.title}`,
        task.priority ? ` priority=${task.priority}` : '',
        task.goalId ? ` goal=${task.goalId}` : '',
        task.dependsOnTaskIds.length > 0 ? ` dependsOn=[${task.dependsOnTaskIds.join(', ')}]` : '',
        task.activeSessionId ? ` session=${task.activeSessionId}` : '',
        task.blockedReason ? ` blocked="${task.blockedReason}"` : ''
    ].join('')).join('\n')
}

function formatDecisionTopics(topics: StoredGoalDecisionTopic[]): string {
    const waiting = topics.filter((topic) => topic.status === 'waiting')
    if (waiting.length === 0) {
        return '- No waiting decisions.'
    }
    return waiting.map((topic) => [
        `- ${topic.title} (${topic.id})`,
        topic.blocking ? ' blocking' : '',
        topic.taskId ? ` task=${topic.taskId}` : '',
        `: ${topic.body}`
    ].join('')).join('\n')
}

export function buildProjectAssistantSystemPrompt(): string {
    return [
        'You are HOPI Project Assistant inside an operator_console agent session.',
        'You help the user inspect project/goal workflow state and decide what operator guidance to provide.',
        'Workflow ownership stays with Planner, Generator, Evaluator, merge, and scheduler services.',
        'You are not a coding agent in this session: do not edit source files, spawn subagents, or repair implementation bugs yourself.',
        'You may use read-only inspection commands for file reading, text search, and status checks when they help answer the user.',
        'Do not use shell commands to mutate files, run merge operations, start services, install dependencies, or change workflow state.',
        'Do not directly claim that you changed kanban/task state unless HOPI exposes and confirms a typed action result.',
        'When you need HOPI to apply a narrow operator action, call the matching HOPI operator tool; never ask the hub to infer actions from plain text.',
        'Use hopi_unblock_task only when the user explicitly confirms a non-merge, non-decision blocked task is ready to retry.',
        'When the user expresses a durable project-wide preference, decide whether it belongs in .hopi/preference.md. If yes, read and write only that file through the constrained preference tool.',
        'When the user gives a decision, restate the exact decision and the goal/task it applies to before suggesting the narrow operator action.',
        'Keep replies concise and practical.'
    ].join('\n')
}

export function buildProjectAssistantBriefingPrompt(options: {
    store: Store
    namespace: string
    projectId: string
    goalId?: string | null
    includeReplyInstruction?: boolean
}): string {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = options.goalId
        ? getGoal(options.store, options.goalId, options.namespace, project.id)
        : null
    const tasks = options.store.tasks.listTasksByProjectAndNamespace(project.id, options.namespace, {
        includeArchived: false,
        goalId: goal?.id ?? null
    })
    const topics = goal
        ? options.store.goalDecisionTopics.listByGoalAndNamespace(goal.id, options.namespace)
        : []
    const operatorDocs = (() => {
        if (!goal) return null
        try {
            return readGoalOperatorDocs({
                workspacePath: workspace.path,
                goalKey: goal.goalKey
            })
        } catch {
            return null
        }
    })()
    const unreadMail = operatorDocs?.mail.mail
        .filter((mail) => mail.status === 'unread') ?? []
    const globalPreferences = readGlobalPreferenceMarkdown(workspace.path)

    return [
        'Start this Project Assistant conversation.',
        '',
        'Scope:',
        `- Project: ${project.name} (${project.id})`,
        goal ? `- Goal: ${goal.title} (${goal.id}, key=${goal.goalKey}, status=${goal.status})` : '- Goal: project-wide',
        `- Workspace: ${workspace.path}`,
        '',
        'Current kanban counts:',
        formatCountByStatus(tasks),
        '',
        'Current kanban tasks:',
        formatTaskSnapshot(tasks),
        '',
        'Waiting decisions:',
        formatDecisionTopics(topics),
        '',
        'Preference memory:',
        `- File: .hopi/preference.md`,
        globalPreferences ? globalPreferences : '- No global preferences recorded.',
        '',
        'Operator docs snapshot:',
        `- Unread planner mail: ${unreadMail.length}`,
        '',
        options.includeReplyInstruction === false
            ? 'Use this snapshot only as conversation context. Do not answer it directly.'
            : 'Reply with a brief greeting and ask what the user wants to inspect or decide next.'
    ].join('\n')
}

function formatVisibleConversationForActivation(store: Store, sessionId: string): string {
    const messages = store.messages.getMessages(sessionId, 20)
        .filter((message) => !message.localId?.startsWith(ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX))
        .filter((message) => !message.localId?.startsWith(ASSISTANT_KICKOFF_LOCAL_ID_PREFIX))
    if (messages.length === 0) {
        return '- No previous visible messages.'
    }
    return messages.map((message) => {
        const record = unwrapRoleWrappedRecordEnvelope(message.content)
        const role = typeof record?.role === 'string' ? record.role : 'message'
        const text = extractMessageText(message.content) ?? JSON.stringify(message.content)
        return `- ${role}: ${normalizeText(text).slice(0, 2000)}`
    }).join('\n')
}

export function buildProjectAssistantActivationPrompt(options: {
    store: Store
    namespace: string
    session: StoredSession
    metadata: AssistantMetadata
}): string {
    const briefing = buildProjectAssistantBriefingPrompt({
        store: options.store,
        namespace: options.namespace,
        projectId: options.metadata.projectId,
        goalId: options.metadata.goalId ?? null,
        includeReplyInstruction: false
    })
    const intervention = options.metadata.assistantKind === 'intervention'
        ? [
            'Intervention:',
            `- Kind: ${options.metadata.interventionKind ?? 'unknown'}`,
            `- Status: ${options.metadata.interventionStatus ?? 'unknown'}`,
            options.metadata.interventionKey ? `- Key: ${options.metadata.interventionKey}` : null,
            options.metadata.taskId ? `- Task: ${options.metadata.taskId}` : null
        ].filter(Boolean).join('\n')
        : 'Intervention: none'

    return [
        'Activate this existing Project Assistant conversation as a normal HOPI agent session.',
        '',
        briefing,
        '',
        intervention,
        '',
        'Existing visible conversation:',
        formatVisibleConversationForActivation(options.store, options.session.id),
        '',
        'Continue from this context. The next user message belongs to this same conversation.'
    ].join('\n')
}

export function buildProjectAssistantInitialUserSystemPrompt(options: {
    store: Store
    namespace: string
    session: StoredSession
    metadata: AssistantMetadata
}): string {
    return [
        buildProjectAssistantSystemPrompt(),
        '',
        'Project Assistant activation context:',
        buildProjectAssistantActivationPrompt(options),
        '',
        'Answer the user message directly. If the user asks what a visible intervention/message means, explain the latest visible assistant message and its practical next steps.'
    ].join('\n')
}
