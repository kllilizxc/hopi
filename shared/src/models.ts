import { MODEL_MODES, type AgentFlavor, type ModelMode } from './modes'

export type ModelPresetOption = {
    value: string
    label: string
}

export const MODEL_PRESET_OPTIONS: Record<AgentFlavor, readonly ModelPresetOption[]> = {
    claude: [
        { value: 'auto', label: 'Auto' },
        { value: 'opus', label: 'Opus' },
        { value: 'opus[1m]', label: 'Opus (1M context)' },
        { value: 'sonnet', label: 'Sonnet' },
    ],
    codex: [
        { value: 'auto', label: 'Auto' },
        { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
        { value: 'gpt-5.2', label: 'GPT-5.2' },
        { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
        { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    ],
    gemini: [
        { value: 'auto', label: 'Auto' },
        { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    opencode: [],
}

const KNOWN_MODEL_VALUES = new Set(
    Object.values(MODEL_PRESET_OPTIONS)
        .flatMap((options) => options)
        .map((option) => option.value)
        .filter((value) => value !== 'auto')
)

export function getModelOptionsForFlavor(flavor?: string | null): readonly ModelPresetOption[] {
    if (flavor === 'codex') {
        return MODEL_PRESET_OPTIONS.codex
    }
    if (flavor === 'gemini') {
        return MODEL_PRESET_OPTIONS.gemini
    }
    if (flavor === 'opencode') {
        return MODEL_PRESET_OPTIONS.opencode
    }
    return MODEL_PRESET_OPTIONS.claude
}

export function normalizeModelName(model?: string | null): string | null {
    if (typeof model !== 'string') {
        return null
    }
    const normalized = model.trim()
    if (!normalized || normalized === 'auto') {
        return null
    }
    return normalized
}

export function resolveStoredModel(model?: string | null, legacyModelMode?: string | null): string | null {
    return normalizeModelName(model)
        ?? (typeof legacyModelMode === 'string' && legacyModelMode !== 'default' ? legacyModelMode : null)
}

export function resolveClaudeModelMode(model?: string | null): ModelMode | null {
    const normalized = normalizeModelName(model)
    if (!normalized) {
        return null
    }
    return MODEL_MODES.includes(normalized as ModelMode) && normalized !== 'default'
        ? normalized as ModelMode
        : null
}

export function isKnownModelPreset(model?: string | null): boolean {
    const normalized = normalizeModelName(model)
    return normalized ? KNOWN_MODEL_VALUES.has(normalized) : false
}

export function isModelPresetAllowedForFlavor(model?: string | null, flavor?: string | null): boolean {
    const normalized = normalizeModelName(model)
    if (!normalized) {
        return true
    }
    return getModelOptionsForFlavor(flavor).some((option) => option.value === normalized)
}

export function shouldResetModelForFlavor(model?: string | null, flavor?: string | null): boolean {
    const normalized = normalizeModelName(model)
    if (!normalized) {
        return false
    }
    return isKnownModelPreset(normalized) && !isModelPresetAllowedForFlavor(normalized, flavor)
}

export function getModelLabel(model?: string | null, flavor?: string | null): string | null {
    const normalized = normalizeModelName(model)
    if (!normalized) {
        return null
    }
    return getModelOptionsForFlavor(flavor).find((option) => option.value === normalized)?.label ?? normalized
}
