import { MessageQueue2 } from '@/utils/MessageQueue2';
import { logger } from '@/ui/logger';
import { runLocalRemoteSession } from '@/agent/loopBase';
import { CodexSession } from './session';
import { codexLocalLauncher } from './codexLocalLauncher';
import { codexRemoteLauncher } from './codexRemoteLauncher';
import { ApiClient, ApiSessionClient } from '@/lib';
import type { CodexCliOverrides } from './utils/codexCliOverrides';
import type { CodexPermissionMode } from '@hopi/protocol/types';
import type { CollaborationMode } from './appServerTypes';
import { buildOperatorMcpServerConfig } from '@/operator/consoleTools';

export type PermissionMode = CodexPermissionMode;

export interface EnhancedMode {
    permissionMode: PermissionMode;
    model?: string;
    collaborationMode?: CollaborationMode['mode'];
    appendSystemPrompt?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
}

interface LoopOptions {
    path: string;
    startingMode?: 'local' | 'remote';
    startedBy?: 'runner' | 'terminal';
    onModeChange: (mode: 'local' | 'remote') => void;
    messageQueue: MessageQueue2<EnhancedMode>;
    session: ApiSessionClient;
    api: ApiClient;
    codexArgs?: string[];
    codexCliOverrides?: CodexCliOverrides;
    permissionMode?: PermissionMode;
    resumeSessionId?: string;
    onSessionReady?: (session: CodexSession) => void;
}

export async function loop(opts: LoopOptions): Promise<void> {
    const logPath = logger.getLogPath();
    const startedBy = opts.startedBy ?? 'terminal';
    const startingMode = opts.startingMode ?? 'local';
    const mcpServers = buildOperatorMcpServerConfig(opts.session);
    const session = new CodexSession({
        api: opts.api,
        client: opts.session,
        path: opts.path,
        sessionId: opts.resumeSessionId ?? null,
        logPath,
        messageQueue: opts.messageQueue,
        onModeChange: opts.onModeChange,
        mode: startingMode,
        startedBy,
        startingMode,
        codexArgs: opts.codexArgs,
        codexCliOverrides: opts.codexCliOverrides,
        mcpServers,
        permissionMode: opts.permissionMode ?? 'default'
    });

    await runLocalRemoteSession({
        session,
        startingMode: opts.startingMode,
        logTag: 'codex-loop',
        runLocal: codexLocalLauncher,
        runRemote: codexRemoteLauncher,
        onSessionReady: opts.onSessionReady
    });
}
