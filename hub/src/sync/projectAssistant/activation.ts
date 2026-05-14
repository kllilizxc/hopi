import { DEFAULT_AGENT_FLAVOR, DEFAULT_TASK_MODEL } from '@hopi/protocol'
import type { AttachmentMetadata } from '@hopi/protocol/types'
import type { Store, StoredSession } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildOperatorConsoleMessageRestrictions } from '../operatorConsole'
import { ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX } from './constants'
import {
    buildProjectAssistantActivationPrompt,
    buildProjectAssistantInitialUserSystemPrompt,
    buildProjectAssistantSystemPrompt
} from './context'
import { getAssistantMetadata } from './metadata'
import {
    applyOperatorConsoleSessionConfig,
    getAssistantAgent,
    hasAgentResumeMetadata
} from './operatorPolicy'
import { getProject, getProjectWorkspace } from './projectStore'

type ProjectAssistantInitialMessage = {
    text: string
    localId?: string | null
    attachments?: AttachmentMetadata[]
}

function combineSystemPrompts(...parts: Array<string | null | undefined>): string {
    return parts
        .filter((part): part is string => Boolean(part && part.trim()))
        .join('\n\n')
}

export async function activateProjectAssistantSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    sessionId: string
    initialMessage?: ProjectAssistantInitialMessage
}): Promise<{ session: StoredSession }> {
    const session = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
    if (!session) {
        throw new Error('Assistant session not found')
    }
    const metadata = getAssistantMetadata(session)
    if (!metadata || metadata.projectId !== options.projectId) {
        throw new Error('Assistant session not found')
    }

    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const agent = getAssistantAgent(project)
    let activatedSessionId = session.id
    let refreshed = session

    if (!session.active && !hasAgentResumeMetadata(metadata)) {
        if (!session.tag) {
            throw new Error('Assistant session cannot be activated')
        }
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
            session.tag,
            {
                projectId: project.id,
                goalId: metadata.goalId ?? null,
                taskId: metadata.taskId ?? null
            }
        )
        if (spawn.type !== 'success') {
            throw new Error(spawn.message)
        }
        activatedSessionId = spawn.sessionId
        const active = await options.engine.waitForSessionActive(activatedSessionId, 20_000)
        if (!active) {
            throw new Error('Assistant session did not become active')
        }
        if (activatedSessionId !== session.id) {
            try {
                await options.engine.mergeSessions(session.id, activatedSessionId, options.namespace)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to merge activated assistant session'
                throw new Error(message)
            }
        }
        await applyOperatorConsoleSessionConfig({
            engine: options.engine,
            sessionId: activatedSessionId,
            agent
        })
        refreshed = options.store.sessions.getSessionByNamespace(activatedSessionId, options.namespace) ?? session
    }

    const refreshedMetadata = getAssistantMetadata(refreshed) ?? metadata
    const restrictions = buildOperatorConsoleMessageRestrictions()
    if (options.initialMessage) {
        await options.engine.sendMessage(activatedSessionId, {
            text: options.initialMessage.text,
            localId: options.initialMessage.localId,
            attachments: options.initialMessage.attachments,
            sentFrom: 'webapp',
            ...restrictions,
            appendSystemPrompt: combineSystemPrompts(
                restrictions.appendSystemPrompt,
                buildProjectAssistantInitialUserSystemPrompt({
                    store: options.store,
                    namespace: options.namespace,
                    session: refreshed,
                    metadata: refreshedMetadata
                })
            )
        })
        return { session: options.store.sessions.getSessionByNamespace(activatedSessionId, options.namespace) ?? refreshed }
    }

    if (session.active || hasAgentResumeMetadata(metadata)) {
        return { session: refreshed }
    }

    const alreadyActivated = options.store.messages
        .getMessages(activatedSessionId, 50)
        .some((message) => message.localId?.startsWith(ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX))
    if (!alreadyActivated) {
        await options.engine.sendMessage(activatedSessionId, {
            text: buildProjectAssistantActivationPrompt({
                store: options.store,
                namespace: options.namespace,
                session: refreshed,
                metadata: refreshedMetadata
            }),
            localId: `${ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX}${activatedSessionId}:${Date.now()}`,
            sentFrom: 'webapp',
            ...restrictions,
            appendSystemPrompt: combineSystemPrompts(
                restrictions.appendSystemPrompt,
                buildProjectAssistantSystemPrompt()
            )
        })
    }

    return { session: options.store.sessions.getSessionByNamespace(activatedSessionId, options.namespace) ?? refreshed }
}
