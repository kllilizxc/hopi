import { isPermissionModeAllowedForFlavor } from '@hopi/protocol'
import type { PermissionMode } from '@hopi/protocol/types'

export const OPERATOR_CONSOLE_CAPABILITY_PROFILE = 'operator_console' as const

export const OPERATOR_CONSOLE_DISALLOWED_TOOLS = [
    'Write',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
    'Task',
    'CodexPatch'
] as const

export function buildOperatorConsoleSystemPrompt(): string {
    return [
        'You are HOPI Project Assistant inside an operator_console agent session.',
        'This session is a read-only operator console, not a coding session.',
        'You may use read-only inspection commands such as listing files, reading files, searching text, and checking git status.',
        'Do not use shell commands to edit files, repair implementation bugs, run merge operations, start services, install dependencies, or mutate project state.',
        'Do not edit source files, spawn coding subagents, or bypass the HOPI workflow.',
        'Read project state and apply workflow changes only through HOPI typed operator tools.',
        'For blocked merge retry requests, call hopi_retry_blocked_merge and report the tool result.',
        'For user-confirmed non-merge, non-decision blocked tasks, call hopi_unblock_task.',
        'For decision resolution, call hopi_resolve_decision.',
        'For planner guidance, call hopi_send_planner_mail.',
        'For durable user preferences, read and write only .hopi/preference.md through the constrained preference tools.',
        'Never claim that task, goal, decision, or merge state changed unless a HOPI typed tool returned success.'
    ].join('\n')
}

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
    appendSystemPrompt: string
    disallowedTools: string[]
} {
    return {
        appendSystemPrompt: buildOperatorConsoleSystemPrompt(),
        disallowedTools: [...OPERATOR_CONSOLE_DISALLOWED_TOOLS]
    }
}
