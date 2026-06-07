import { afterEach, describe, expect, it } from 'vitest'
import { GOAL_ASSISTANT_SYSTEM_PROMPT } from '@hopi/protocol/goal-assistant'
import {
    HOPI_SESSION_PROFILE_ENV,
    buildSessionProfileAcpMcpServers,
    buildSessionProfileMcpServers,
    getSessionProfileDeveloperPrompt,
    getSessionProfileFromEnv,
    getSessionProfileStartingPermissionMode,
    injectSessionProfileUserPrefix
} from './sessionProfiles'

const GOAL_ASSISTANT_PROFILE = {
    kind: 'goal_assistant' as const,
    projectId: 'project-1',
    goalId: 'goal-1'
}

afterEach(() => {
    delete process.env[HOPI_SESSION_PROFILE_ENV]
})

describe('sessionProfiles', () => {
    it('parses goal assistant profiles from env', () => {
        process.env[HOPI_SESSION_PROFILE_ENV] = JSON.stringify(GOAL_ASSISTANT_PROFILE)

        expect(getSessionProfileFromEnv()).toEqual(GOAL_ASSISTANT_PROFILE)
    })

    it('builds goal assistant MCP server configs', () => {
        const config = buildSessionProfileMcpServers(GOAL_ASSISTANT_PROFILE)

        expect(Object.keys(config)).toEqual(['hopi_goal_assistant'])
        expect(config.hopi_goal_assistant.args).toContain('goal-assistant-mcp')
        expect(config.hopi_goal_assistant.args).toContain('--project-id')
        expect(config.hopi_goal_assistant.args).toContain('project-1')
        expect(config.hopi_goal_assistant.args).toContain('--goal-id')
        expect(config.hopi_goal_assistant.args).toContain('goal-1')
    })

    it('builds ACP MCP server configs for ACP-based agents', () => {
        const config = buildSessionProfileAcpMcpServers(GOAL_ASSISTANT_PROFILE)

        expect(config).toHaveLength(1)
        expect(config[0]).toMatchObject({
            name: 'hopi_goal_assistant'
        })
        expect(config[0]?.args).toContain('goal-assistant-mcp')
    })

    it('returns the goal assistant developer prompt and prefixes user input', () => {
        expect(getSessionProfileDeveloperPrompt(GOAL_ASSISTANT_PROFILE)).toBe(GOAL_ASSISTANT_SYSTEM_PROMPT)
        expect(injectSessionProfileUserPrefix(GOAL_ASSISTANT_PROFILE, 'Continue task 123')).toContain('Continue task 123')
        expect(injectSessionProfileUserPrefix(GOAL_ASSISTANT_PROFILE, 'Continue task 123')).toContain(GOAL_ASSISTANT_SYSTEM_PROMPT)
    })

    it('returns the goal assistant starting permission posture per flavor', () => {
        expect(getSessionProfileStartingPermissionMode(GOAL_ASSISTANT_PROFILE, 'codex')).toBe('read-only')
        expect(getSessionProfileStartingPermissionMode(GOAL_ASSISTANT_PROFILE, 'gemini')).toBe('read-only')
        expect(getSessionProfileStartingPermissionMode(GOAL_ASSISTANT_PROFILE, 'claude')).toBe('plan')
        expect(getSessionProfileStartingPermissionMode(GOAL_ASSISTANT_PROFILE, 'opencode')).toBe('default')
        expect(getSessionProfileStartingPermissionMode(null, 'codex')).toBeNull()
    })
})
