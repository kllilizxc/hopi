import type { ReasoningEffort } from '../appServerTypes';

type ParsedCodexModel = {
    model: string;
    effort?: ReasoningEffort;
};

const EFFORT_SUFFIX_MAP: Record<string, ReasoningEffort> = {
    auto: 'auto',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'high'
};

export function resolveCodexModelSpec(model?: string | null): ParsedCodexModel | null {
    if (typeof model !== 'string') {
        return null;
    }

    const trimmed = model.trim();
    if (!trimmed) {
        return null;
    }

    const tokens = trimmed.split(/\s+/);
    if (tokens.length <= 1) {
        return { model: trimmed };
    }

    const suffix = tokens[tokens.length - 1]!.toLowerCase();
    const effort = EFFORT_SUFFIX_MAP[suffix];
    if (!effort) {
        return { model: trimmed };
    }

    const baseModel = tokens.slice(0, -1).join(' ').trim();
    if (!baseModel) {
        return { model: trimmed };
    }

    return { model: baseModel, effort };
}
