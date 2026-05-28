import { describe, expect, it } from 'bun:test'
import type { StoredProject } from '../store'
import { getProjectDefaultTaskRuntimeSettings } from './projectTaskDefaults'

function createProject(overrides: Partial<StoredProject> = {}): StoredProject {
    const now = Date.now()
    return {
        id: 'project-1',
        namespace: 'default',
        machineId: 'machine-1',
        name: 'Project',
        description: null,
        defaultWorkspaceId: null,
        defaultAgentFlavor: null,
        defaultPermissionMode: null,
        defaultModel: null,
        defaultModelMode: null,
        defaultSessionType: null,
        worktreeTargetBranch: null,
        worktreeAutoCommitMode: null,
        worktreeCleanupAfterMerge: false,
        agentOutputLanguage: 'system',
        autoRunEnabled: false,
        maxRunningSessions: 1,
        automationLaneLimits: null,
        automationBackstopPolicy: null,
        improvementsEnabled: false,
        improvementsMaxPendingTasks: 5,
        automationReadinessStatus: 'unknown',
        automationReadinessSummary: null,
        automationReadinessCheckedAt: null,
        lastImprovementsAt: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        ...overrides
    }
}

describe('project task defaults', () => {
    it('uses a Claude-compatible autonomous fallback when no project mode is configured', () => {
        const project = createProject({
            defaultAgentFlavor: 'claude',
            defaultPermissionMode: null
        })

        expect(getProjectDefaultTaskRuntimeSettings(project, { autonomous: true }).permissionMode).toBe('acceptEdits')
    })

    it('keeps project-configured Claude bypassPermissions for autonomous tasks', () => {
        const project = createProject({
            defaultAgentFlavor: 'claude',
            defaultPermissionMode: 'bypassPermissions'
        })

        expect(getProjectDefaultTaskRuntimeSettings(project, { autonomous: true }).permissionMode).toBe('bypassPermissions')
    })

    it('coerces legacy Codex-style Claude project modes to bypassPermissions for autonomous tasks', () => {
        const project = createProject({
            defaultAgentFlavor: 'claude',
            defaultPermissionMode: 'yolo'
        })

        expect(getProjectDefaultTaskRuntimeSettings(project, { autonomous: true }).permissionMode).toBe('bypassPermissions')
    })
})
