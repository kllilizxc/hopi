import { DEFAULT_AGENT_FLAVOR, coercePermissionModeForFlavor, resolveAutonomousPermissionModeForFlavor } from '@hopi/protocol'
import type { StoredProject } from '../store'

export function getProjectDefaultTaskRuntimeSettings(project: StoredProject, options?: { autonomous?: boolean }): {
    agentFlavor: null
    permissionMode: string | null
    model: null
    modelMode: null
} {
    const flavor = project.defaultAgentFlavor ?? DEFAULT_AGENT_FLAVOR
    const permissionMode = coercePermissionModeForFlavor(project.defaultPermissionMode, flavor)
        ?? (options?.autonomous ? resolveAutonomousPermissionModeForFlavor(flavor) : null)
    return {
        agentFlavor: null,
        permissionMode,
        model: null,
        modelMode: null
    }
}
