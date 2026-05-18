export const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const
export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number]

export const CODEX_PERMISSION_MODES = ['default', 'read-only', 'safe-yolo', 'yolo'] as const
export type CodexPermissionMode = typeof CODEX_PERMISSION_MODES[number]

export const GEMINI_PERMISSION_MODES = ['default', 'read-only', 'safe-yolo', 'yolo'] as const
export type GeminiPermissionMode = typeof GEMINI_PERMISSION_MODES[number]

export const OPENCODE_PERMISSION_MODES = ['default', 'yolo'] as const
export type OpencodePermissionMode = typeof OPENCODE_PERMISSION_MODES[number]

export const PERMISSION_MODES = [
    'default',
    'acceptEdits',
    'bypassPermissions',
    'plan',
    'read-only',
    'safe-yolo',
    'yolo'
] as const
export type PermissionMode = typeof PERMISSION_MODES[number]

export const MODEL_MODES = ['default', 'sonnet', 'opus', 'claude-opus-4-7', 'opus[1m]'] as const
export type ModelMode = typeof MODEL_MODES[number]

export type AgentFlavor = 'claude' | 'codex' | 'gemini' | 'opencode'

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
    default: 'Default',
    acceptEdits: 'Accept Edits',
    plan: 'Plan Mode',
    bypassPermissions: 'Bypass Permissions',
    'read-only': 'Read Only',
    'safe-yolo': 'Safe Yolo',
    yolo: 'Yolo'
}

export type PermissionModeTone = 'neutral' | 'info' | 'warning' | 'danger'

export const PERMISSION_MODE_TONES: Record<PermissionMode, PermissionModeTone> = {
    default: 'neutral',
    acceptEdits: 'warning',
    plan: 'info',
    bypassPermissions: 'danger',
    'read-only': 'warning',
    'safe-yolo': 'warning',
    yolo: 'danger'
}

export type PermissionModeOption = {
    mode: PermissionMode
    label: string
    tone: PermissionModeTone
}

export const MODEL_MODE_LABELS: Record<ModelMode, string> = {
    default: 'Default',
    sonnet: 'Sonnet',
    opus: 'Opus',
    'claude-opus-4-7': 'Opus 4.7',
    'opus[1m]': 'Opus (1M context)'
}

export function getPermissionModeLabel(mode: PermissionMode): string {
    return PERMISSION_MODE_LABELS[mode]
}

export function getPermissionModeTone(mode: PermissionMode): PermissionModeTone {
    return PERMISSION_MODE_TONES[mode]
}

export function getPermissionModesForFlavor(flavor?: string | null): readonly PermissionMode[] {
    if (flavor === 'codex') {
        return CODEX_PERMISSION_MODES
    }
    if (flavor === 'gemini') {
        return GEMINI_PERMISSION_MODES
    }
    if (flavor === 'opencode') {
        return OPENCODE_PERMISSION_MODES
    }
    return CLAUDE_PERMISSION_MODES
}

export function getPermissionModeOptionsForFlavor(flavor?: string | null): PermissionModeOption[] {
    return getPermissionModesForFlavor(flavor).map((mode) => ({
        mode,
        label: getPermissionModeLabel(mode),
        tone: getPermissionModeTone(mode)
    }))
}

export function isPermissionModeAllowedForFlavor(mode: PermissionMode, flavor?: string | null): boolean {
    return getPermissionModesForFlavor(flavor).includes(mode)
}

export function normalizePermissionModeForFlavor(
    mode: PermissionMode | null | undefined,
    flavor?: string | null
): PermissionMode | null {
    if (!mode) {
        return null
    }
    return isPermissionModeAllowedForFlavor(mode, flavor) ? mode : null
}

export function coercePermissionModeForFlavor(
    mode: PermissionMode | null | undefined,
    flavor?: string | null
): PermissionMode | null {
    const normalized = normalizePermissionModeForFlavor(mode, flavor)
    if (normalized) {
        return normalized
    }
    if (!mode) {
        return null
    }

    if (flavor === 'codex' || flavor === 'gemini') {
        if (mode === 'acceptEdits') return 'safe-yolo'
        if (mode === 'bypassPermissions') return 'yolo'
        if (mode === 'plan') return 'read-only'
        return null
    }

    if (flavor === 'opencode') {
        if (mode === 'bypassPermissions' || mode === 'safe-yolo' || mode === 'yolo') return 'yolo'
        if (mode === 'acceptEdits' || mode === 'plan' || mode === 'read-only') return 'default'
        return null
    }

    if (mode === 'read-only') return 'plan'
    if (mode === 'safe-yolo' || mode === 'yolo') return 'bypassPermissions'
    return null
}

export function resolvePermissionModeForFlavor(
    flavor?: string | null,
    preferredMode?: PermissionMode | null,
    fallbackMode?: PermissionMode | null
): PermissionMode {
    return coercePermissionModeForFlavor(preferredMode, flavor)
        ?? coercePermissionModeForFlavor(fallbackMode, flavor)
        ?? (getPermissionModesForFlavor(flavor)[0] as PermissionMode | undefined)
        ?? 'default'
}

export function resolveAutonomousPermissionModeForFlavor(
    flavor?: string | null,
    preferredMode?: PermissionMode | null
): PermissionMode | null {
    return coercePermissionModeForFlavor(preferredMode, flavor)
        ?? normalizePermissionModeForFlavor('safe-yolo', flavor)
        ?? normalizePermissionModeForFlavor('acceptEdits', flavor)
        ?? normalizePermissionModeForFlavor('yolo', flavor)
        ?? normalizePermissionModeForFlavor('default', flavor)
}

export function getModelModesForFlavor(flavor?: string | null): readonly ModelMode[] {
    if (flavor === 'codex' || flavor === 'gemini' || flavor === 'opencode') {
        return []
    }
    return MODEL_MODES
}

export function isModelModeAllowedForFlavor(mode: ModelMode, flavor?: string | null): boolean {
    return getModelModesForFlavor(flavor).includes(mode)
}
