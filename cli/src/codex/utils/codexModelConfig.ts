import type { ReasoningEffort } from '../appServerTypes';
import { parseEffortFromModel, stripEffortFromModel } from '@hopi/protocol';

type ParsedCodexModel = {
    model: string;
    effort?: ReasoningEffort;
};

export function resolveCodexModelSpec(model?: string | null): ParsedCodexModel | null {
    const cleaned = stripEffortFromModel(model);
    if (!cleaned) return null;

    const effort = parseEffortFromModel(model) as ReasoningEffort | undefined;
    return effort
        ? { model: cleaned, effort }
        : { model: cleaned };
}
