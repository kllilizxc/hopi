import { DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE } from '@hopi/protocol'
import type { StoredProject } from '../store'

export function getProjectDefaultTaskRuntimeSettings(project: StoredProject, options?: { autonomous?: boolean }): {
    agentFlavor: null
    permissionMode: string | null
    model: null
    modelMode: null
} {
    return {
        agentFlavor: null,
        permissionMode: project.defaultPermissionMode ?? (options?.autonomous ? DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE : null),
        model: null,
        modelMode: null
    }
}
