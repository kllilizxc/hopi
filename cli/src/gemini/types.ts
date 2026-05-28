import type { GeminiPermissionMode } from '@hopi/protocol/types';

export type PermissionMode = GeminiPermissionMode;

export interface GeminiMode {
    permissionMode: PermissionMode;
    model?: string;
}
