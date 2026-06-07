import type { AgentState } from '@/api/types';
import { logger } from '@/ui/logger';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { AgentRegistry } from '@/agent/AgentRegistry';
import { convertAgentMessage } from '@/agent/messageConverter';
import { PermissionAdapter } from '@/agent/permissionAdapter';
import type { AgentBackend, PromptContent } from '@/agent/types';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { bootstrapSession } from '@/agent/sessionFactory';
import { buildPromptContentFromFormattedMessage, formatMessageWithAttachments } from '@/utils/attachmentFormatter';
import { resolveCliWorkingDirectory } from '@/utils/workingDirectory';

function isAssistantTextCodexMessage(message: unknown): boolean {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const record = message as { type?: unknown; message?: unknown };
    if (record.type !== 'message') {
        return false;
    }

    return typeof record.message === 'string' && record.message.trim().length > 0;
}

function emitReadyIfIdle(props: {
    queueSize: () => number;
    shouldExit: boolean;
    thinking: boolean;
    sendReady: () => void;
}): void {
    if (props.shouldExit) return;
    if (props.thinking) return;
    if (props.queueSize() > 0) return;
    props.sendReady();
}

export async function runAgentSession(opts: {
    agentType: string;
    startedBy?: 'runner' | 'terminal';
}): Promise<void> {
    const workingDirectory = resolveCliWorkingDirectory();
    const initialState: AgentState = {
        controlledByUser: false
    };
    const { session } = await bootstrapSession({
        flavor: opts.agentType,
        startedBy: opts.startedBy ?? 'terminal',
        workingDirectory,
        agentState: initialState
    });

    session.updateAgentState((currentState) => ({
        ...currentState,
        controlledByUser: false
    }));

    const messageQueue = new MessageQueue2<Record<string, never>>(() => hashObject({}));

    session.onUserMessage((message) => {
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);
        messageQueue.push(formattedText, {}, message.localKey ?? null);
    });

    const backend: AgentBackend = AgentRegistry.create(opts.agentType);
    await backend.initialize();

    const permissionAdapter = new PermissionAdapter(session, backend);

    const agentSessionId = await backend.newSession({
        cwd: workingDirectory,
        mcpServers: []
    });

    let thinking = false;
    let shouldExit = false;
    let waitAbortController: AbortController | null = null;
    let activeTurnLocalKey: string | null = null;
    let activeTurnHasAssistantReply = false;

    session.keepAlive(thinking, 'remote');
    const keepAliveInterval = setInterval(() => {
        // Periodic keep-alive: best-effort. Thinking transitions use non-volatile emits.
        session.keepAlive(thinking, 'remote', undefined, { volatile: true });
    }, 2000);

    const sendReady = () => {
        session.sendSessionEvent({
            type: 'ready',
            forLocalKey: activeTurnLocalKey ?? undefined,
            hasAssistantReply: activeTurnHasAssistantReply
        });
    };

    const handleAbort = async () => {
        logger.debug('[ACP] Abort requested');
        await backend.cancelPrompt(agentSessionId);
        await permissionAdapter.cancelAll('User aborted');
        thinking = false;
        session.keepAlive(thinking, 'remote');
        activeTurnHasAssistantReply = false;
        sendReady();
        if (waitAbortController) {
            waitAbortController.abort();
        }
    };

    session.rpcHandlerManager.registerHandler('abort', async () => {
        await handleAbort();
    });

    const handleKillSession = async () => {
        if (shouldExit) return;
        shouldExit = true;
        await permissionAdapter.cancelAll('Session killed');
        if (waitAbortController) {
            waitAbortController.abort();
        }
    };

    registerKillSessionHandler(session.rpcHandlerManager, handleKillSession);

    try {
        while (!shouldExit) {
            waitAbortController = new AbortController();
            const batch = await messageQueue.waitForMessagesAndGetAsString(waitAbortController.signal);
            waitAbortController = null;
            if (!batch) {
                if (shouldExit) {
                    break;
                }
                continue;
            }

            activeTurnLocalKey = batch.localKey ?? null;
            activeTurnHasAssistantReply = false;

            const promptContent: PromptContent[] = buildPromptContentFromFormattedMessage(batch.message);

            thinking = true;
            session.keepAlive(thinking, 'remote');

            try {
                await backend.prompt(agentSessionId, promptContent, (message) => {
                    const converted = convertAgentMessage(message);
                    if (converted) {
                        if (isAssistantTextCodexMessage(converted)) {
                            activeTurnHasAssistantReply = true;
                        }
                        session.sendCodexMessage(converted);
                    }
                });
            } catch (error) {
                logger.warn('[ACP] Prompt failed', error);
                session.sendSessionEvent({
                    type: 'message',
                    message: 'Agent prompt failed. Check logs for details.'
                });
            } finally {
                thinking = false;
                session.keepAlive(thinking, 'remote');
                await permissionAdapter.cancelAll('Prompt finished');
                emitReadyIfIdle({
                    queueSize: () => messageQueue.size(),
                    shouldExit,
                    thinking,
                    sendReady
                });
            }
        }
    } finally {
        clearInterval(keepAliveInterval);
        await permissionAdapter.cancelAll('Session ended');
        session.sendSessionDeath();
        await session.flush();
        session.close();
        await backend.disconnect();
    }
}
