import { coercePermissionModeForFlavor, getPermissionModeLabel, getPermissionModeOptionsForFlavor, getPermissionModeTone } from '@hopi/protocol'
import type { PermissionModeTone } from '@hopi/protocol'
import type { AgentFlavor, PermissionMode } from '@/types/api'

const TASK_PLAN_MODE_FLAVORS: ReadonlySet<AgentFlavor> = new Set(['codex'])

export type TaskPermissionModeOption = {
    mode: PermissionMode
    label: string
    tone: PermissionModeTone
}

export function getTaskPermissionModeOptionsForFlavor(flavor?: AgentFlavor | null): TaskPermissionModeOption[] {
    const baseOptions = getPermissionModeOptionsForFlavor(flavor).map((option) => ({
        ...option,
        mode: option.mode as PermissionMode
    }))

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
    const coercedMode = coercePermissionModeForFlavor(preferredMode, flavor)
    if (coercedMode && options.some((option) => option.mode === coercedMode)) {
        return coercedMode
    }
    return (options[0]?.mode as PermissionMode | undefined) ?? 'default'
}
