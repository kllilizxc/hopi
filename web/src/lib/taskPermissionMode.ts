import { getPermissionModeLabel, getPermissionModeOptionsForFlavor, getPermissionModeTone } from '@hapi/protocol'
import type { AgentFlavor, PermissionMode } from '@/types/api'

const TASK_PLAN_MODE_FLAVORS: ReadonlySet<AgentFlavor> = new Set(['codex'])

export function getTaskPermissionModeOptionsForFlavor(flavor?: AgentFlavor | null) {
    const baseOptions = getPermissionModeOptionsForFlavor(flavor)

    if (!flavor || !TASK_PLAN_MODE_FLAVORS.has(flavor) || baseOptions.some((option) => option.mode === 'plan')) {
        return baseOptions
    }

    return [
        ...baseOptions,
        {
            mode: 'plan',
            label: getPermissionModeLabel('plan'),
            tone: getPermissionModeTone('plan')
        }
    ]
}

export function resolveTaskPermissionModeForFlavor(
    flavor: AgentFlavor,
    preferredMode: PermissionMode | null | undefined
): PermissionMode {
    const options = getTaskPermissionModeOptionsForFlavor(flavor)
    if (preferredMode && options.some((option) => option.mode === preferredMode)) {
        return preferredMode
    }
    return (options[0]?.mode as PermissionMode | undefined) ?? 'default'
}
