import type { GeminiPermissionMode } from '@hopi/protocol/types';

export type PermissionMode = GeminiPermissionMode;

export interface GeminiMode {
    permissionMode: PermissionMode;
    model?: string;
    appendSystemPrompt?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
}
