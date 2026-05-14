import { DEFAULT_AGENT_FLAVOR, DEFAULT_TASK_MODEL } from '@hopi/protocol'
import type { Store, StoredSession } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildOperatorConsoleMessageRestrictions } from '../operatorConsole'
import { ASSISTANT_KICKOFF_LOCAL_ID_PREFIX } from './constants'
import {
    buildProjectAssistantBriefingPrompt,
    buildProjectAssistantSystemPrompt
} from './context'
import { emitAssistantSessionUpdated } from './events'
import {
    getAssistantMetadata,
    mergeAssistantSessionMetadata,
    toSummary
} from './metadata'
import { getGoal, getProject, getProjectWorkspace } from './projectStore'
import {
    applyOperatorConsoleSessionConfig,
    getAssistantAgent,
    hasAgentResumeMetadata
} from './operatorPolicy'
import type {
    AssistantMetadata,
    ProjectAssistantSessionList
} from './types'

export function listProjectAssistantSessions(options: {
    store: Store
    namespace: string
    projectId: string
    goalId?: string | null
}): ProjectAssistantSessionList {
    const sessions = options.store.sessions.getSessionsByNamespace(options.namespace)
        .flatMap((session) => {
            const metadata = getAssistantMetadata(session)
            if (!metadata || metadata.projectId !== options.projectId) {
                return []
            }
            if (metadata.assistantKind === 'normal' && !hasAgentResumeMetadata(metadata)) {
                return []
            }
            if (options.goalId && metadata.goalId !== options.goalId) {
                return []
            }
            return [toSummary(session, metadata)]
        })
        .sort((a, b) => {
            if (a.pending !== b.pending) return a.pending ? -1 : 1
            return b.updatedAt - a.updatedAt
        })

    return {
        sessions,
        pendingCount: sessions.filter((session) => session.pending).length
    }
}

export function updateAssistantSessionMetadata(options: {
    store: Store
    engine?: SyncEngine | null
    namespace: string
    sessionId: string
    projectId: string
    build: (current: unknown) => AssistantMetadata
}): StoredSession {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
        if (!current) {
            throw new Error('Assistant session not found')
        }
        const result = options.store.sessions.updateSessionMetadata(
            current.id,
            options.build(current.metadata),
            current.metadataVersion,
            options.namespace,
            { touchUpdatedAt: false }
        )
        if (result.result === 'success') {
            const updated = options.store.sessions.getSessionByNamespace(current.id, options.namespace) ?? current
            emitAssistantSessionUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: options.projectId,
                session: updated
            })
            return updated
        }
        if (result.result === 'error') {
            break
        }
    }
    throw new Error('Failed to update assistant session metadata')
}

export async function ensureProjectAssistantSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    goalId?: string | null
    kind: 'normal'
}): Promise<{ session: StoredSession }> {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = options.goalId
        ? getGoal(options.store, options.goalId, options.namespace, project.id)
        : null
    const agent = getAssistantAgent(project)
    const model = project.defaultModel ?? (agent === DEFAULT_AGENT_FLAVOR ? DEFAULT_TASK_MODEL : undefined)
    const spawn = await options.engine.spawnSession(
        project.machineId,
        workspace.path,
        agent,
        model ?? undefined,
        false,
        'simple',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
            projectId: project.id,
            goalId: goal?.id ?? null,
            taskId: null
        }
    )
    if (spawn.type !== 'success') {
        throw new Error(spawn.message)
    }

    const active = await options.engine.waitForSessionActive(spawn.sessionId, 20_000)
    if (!active) {
        throw new Error('Assistant session did not become active')
    }

    const session = updateAssistantSessionMetadata({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        sessionId: spawn.sessionId,
        projectId: project.id,
        build: (current) => mergeAssistantSessionMetadata({
            current,
            project,
            workspace,
            goal,
            kind: options.kind,
            name: goal ? `Project Assistant: ${goal.title}` : 'Project Assistant',
            agent
        })
    })
    await applyOperatorConsoleSessionConfig({
        engine: options.engine,
        sessionId: session.id,
        agent
    })

    const existingMessages = options.store.messages.getMessages(session.id, 1)
    if (existingMessages.length === 0) {
        await options.engine.sendMessage(session.id, {
            text: buildProjectAssistantBriefingPrompt({
                store: options.store,
                namespace: options.namespace,
                projectId: project.id,
                goalId: goal?.id ?? null
            }),
            localId: `${ASSISTANT_KICKOFF_LOCAL_ID_PREFIX}${project.id}:${goal?.id ?? 'project'}:${Date.now()}`,
            sentFrom: 'webapp',
            ...buildOperatorConsoleMessageRestrictions(),
            appendSystemPrompt: buildProjectAssistantSystemPrompt()
        })
    }

    return { session }
}
