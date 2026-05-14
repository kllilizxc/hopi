import { DEFAULT_AGENT_FLAVOR } from '@hopi/protocol'
import type { StoredProject } from '../../store'
import type { SyncEngine } from '../syncEngine'
import {
    getOperatorConsolePermissionMode
} from '../operatorConsole'
import type { AssistantAgentFlavor, AssistantMetadata } from './types'

export function getAssistantAgent(project: StoredProject): AssistantAgentFlavor {
    const flavor = project.defaultAgentFlavor
    if (flavor === 'claude' || flavor === 'codex' || flavor === 'gemini' || flavor === 'opencode') {
        return flavor
    }
    return DEFAULT_AGENT_FLAVOR === 'opencode' ? 'claude' : DEFAULT_AGENT_FLAVOR
}

export async function applyOperatorConsoleSessionConfig(options: {
    engine: SyncEngine
    sessionId: string
    agent: AssistantAgentFlavor
}): Promise<void> {
    const permissionMode = getOperatorConsolePermissionMode(options.agent)
    if (!permissionMode) {
        return
    }
    await options.engine.applySessionConfig(options.sessionId, { permissionMode })
}

export function hasAgentResumeMetadata(metadata: AssistantMetadata): boolean {
    const record = metadata as unknown as Record<string, unknown>
    return typeof record.claudeSessionId === 'string'
        || typeof record.codexSessionId === 'string'
        || typeof record.geminiSessionId === 'string'
        || typeof record.opencodeSessionId === 'string'
        || record.startedFromRunner === true
        || metadata.host !== 'hopi'
}
