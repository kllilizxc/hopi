import { describe, expect, it } from 'vitest';

describe('opencode operator prompt context', () => {
    it('includes per-message append system prompt before the user message', async () => {
        const module = await import('./opencodeRemoteLauncher');
        const buildOpencodePromptText = (module as {
            buildOpencodePromptText?: (options: {
                message: string;
                appendSystemPrompt?: string;
                includeTitleInstruction?: boolean;
            }) => string;
        }).buildOpencodePromptText;

        expect(buildOpencodePromptText?.({
            message: '重试',
            appendSystemPrompt: 'Project Assistant activation context:\nTask: task-123',
            includeTitleInstruction: false
        })).toBe([
            'Project Assistant activation context:',
            'Task: task-123',
            '',
            'User message:',
            '重试'
        ].join('\n'));
    });

    it('separates queued turns by append system prompt', async () => {
        const module = await import('./runOpencode');
        const hashOpencodeMode = (module as {
            hashOpencodeMode?: (mode: {
                permissionMode: string;
                appendSystemPrompt?: string;
            }) => string;
        }).hashOpencodeMode;

        expect(hashOpencodeMode?.({
            permissionMode: 'read-only',
            appendSystemPrompt: 'context A'
        })).not.toBe(hashOpencodeMode?.({
            permissionMode: 'read-only',
            appendSystemPrompt: 'context B'
        }));
    });
});
