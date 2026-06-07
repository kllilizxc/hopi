import {
    GOAL_ASSISTANT_SYSTEM_PROMPT,
    GoalAssistantSessionProfileSchema,
    SessionProfileSchema,
    type GoalAssistantSessionProfile,
    type SessionProfile
} from '@hopi/protocol/goal-assistant'
import type { AgentFlavor, PermissionMode } from '@hopi/protocol/types'
import { getHappyCliCommand } from '@/utils/spawnHappyCLI'
import type { McpServerStdio } from '@/agent/types'

export const HOPI_SESSION_PROFILE_ENV = 'HOPI_SESSION_PROFILE_JSON'
const GOAL_ASSISTANT_MCP_SERVER_NAME = 'hopi_goal_assistant'

export type SessionProfileMcpConfig = Record<string, { command: string; args: string[] }>

function parseJsonProfile(raw: string | undefined): SessionProfile | null {
    if (!raw?.trim()) {
        return null
    }
    try {
        const parsed = JSON.parse(raw)
        const result = SessionProfileSchema.safeParse(parsed)
        return result.success ? result.data : null
    } catch {
        return null
    }
}

export function getSessionProfileFromEnv(): SessionProfile | null {
    return parseJsonProfile(process.env[HOPI_SESSION_PROFILE_ENV])
}

export function isGoalAssistantProfile(profile: SessionProfile | null | undefined): profile is GoalAssistantSessionProfile {
    return GoalAssistantSessionProfileSchema.safeParse(profile).success
}

export function getSessionProfileDeveloperPrompt(profile: SessionProfile | null | undefined): string | null {
    if (!isGoalAssistantProfile(profile)) {
        return null
    }
    return GOAL_ASSISTANT_SYSTEM_PROMPT
}

export function getSessionProfileStartingPermissionMode(
    profile: SessionProfile | null | undefined,
    flavor: AgentFlavor
): PermissionMode | null {
    if (!isGoalAssistantProfile(profile)) {
        return null
    }
    if (flavor === 'claude') {
        return 'plan'
    }
    if (flavor === 'codex' || flavor === 'gemini') {
        return 'read-only'
    }
    return 'default'
}

export function buildSessionProfileMcpServers(profile: SessionProfile | null | undefined): SessionProfileMcpConfig {
    if (!isGoalAssistantProfile(profile)) {
        return {}
    }
    const command = getHappyCliCommand([
        'goal-assistant-mcp',
        '--project-id',
        profile.projectId,
        '--goal-id',
        profile.goalId
    ])
    return {
        [GOAL_ASSISTANT_MCP_SERVER_NAME]: {
            command: command.command,
            args: command.args
        }
    }
}

export function buildSessionProfileAcpMcpServers(profile: SessionProfile | null | undefined): McpServerStdio[] {
    return Object.entries(buildSessionProfileMcpServers(profile)).map(([name, server]) => ({
        name,
        command: server.command,
        args: server.args,
        env: []
    }))
}

export function injectSessionProfileUserPrefix(profile: SessionProfile | null | undefined, text: string): string {
    const trimmed = text.trim()
    if (!isGoalAssistantProfile(profile)) {
        return text
    }
    if (!trimmed) {
        return text
    }
    return [
        GOAL_ASSISTANT_SYSTEM_PROMPT,
        '',
        trimmed
    ].join('\n')
}
