import { isPermissionModeAllowedForFlavor } from '@hopi/protocol'
import type { PermissionMode } from '@hopi/protocol/types'

export const OPERATOR_CONSOLE_CAPABILITY_PROFILE = 'operator_console' as const

export const OPERATOR_CONSOLE_DISALLOWED_TOOLS = [
    'Bash',
    'Write',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
    'Task'
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isOperatorConsoleMetadata(metadata: unknown): boolean {
    if (!isRecord(metadata)) {
        return false
    }
    if (metadata.capabilityProfile === OPERATOR_CONSOLE_CAPABILITY_PROFILE) {
        return true
    }
    return metadata.hopiAssistant === true
        && (metadata.assistantKind === 'normal' || metadata.assistantKind === 'intervention')
}

export function getOperatorConsolePermissionMode(flavor?: string | null): PermissionMode | null {
    const mode: PermissionMode = 'read-only'
    return isPermissionModeAllowedForFlavor(mode, flavor) ? mode : null
}

export function buildOperatorConsoleMessageRestrictions(): {
    disallowedTools: string[]
} {
    return {
        disallowedTools: [...OPERATOR_CONSOLE_DISALLOWED_TOOLS]
    }
}
