export function isCodexFamilyFlavor(flavor?: string | null): boolean {
    return flavor === 'codex' || flavor === 'gemini' || flavor === 'opencode'
}

export function isClaudeFlavor(flavor?: string | null): boolean {
    return flavor === 'claude'
}

export function isKnownFlavor(flavor?: string | null): boolean {
    return isClaudeFlavor(flavor) || isCodexFamilyFlavor(flavor)
}

export function getAgentFlavorLabel(flavor?: string | null): string {
    switch (flavor) {
        case 'claude':
            return 'Claude'
        case 'codex':
            return 'Codex'
        case 'gemini':
            return 'Gemini'
        case 'opencode':
            return 'OpenCode'
        default:
            return 'Unknown'
    }
}
