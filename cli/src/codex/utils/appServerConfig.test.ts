import { describe, expect, it } from 'vitest';
import { buildThreadStartParams, buildTurnStartParams } from './appServerConfig';
import { PRODUCT_SLUG } from '@hopi/protocol/brand';

describe('appServerConfig', () => {
    const mcpServers = { [PRODUCT_SLUG]: { command: 'node', args: ['mcp'] } };

    it('applies CLI overrides when permission mode is default', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'default' },
            cwd: '/tmp/worktree',
            mcpServers,
            cliOverrides: { sandbox: 'danger-full-access', approvalPolicy: 'never' }
        });

        expect(params.sandbox).toBe('danger-full-access');
        expect(params.approvalPolicy).toBe('never');
        expect(params.cwd).toBe('/tmp/worktree');
        expect(params.baseInstructions).toBeTruthy();
        expect(params.developerInstructions).toBeTruthy();
        expect(params.config).toEqual({
            [`mcp_servers.${PRODUCT_SLUG}`]: {
                command: 'node',
                args: ['mcp']
            },
            developer_instructions: params.developerInstructions
        });
    });

    it('ignores CLI overrides when permission mode is not default', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'yolo' },
            mcpServers,
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'never' }
        });

        expect(params.sandbox).toBe('danger-full-access');
        expect(params.approvalPolicy).toBe('on-failure');
    });

    it('concatenates custom developer instructions after base instructions', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'default' },
            mcpServers,
            developerInstructions: 'Only respond in Chinese.'
        });

        expect(params.baseInstructions).toBeTruthy();
        expect(params.developerInstructions).toBe(`${params.baseInstructions}\n\nOnly respond in Chinese.`);
        expect(params.config).toEqual({
            [`mcp_servers.${PRODUCT_SLUG}`]: {
                command: 'node',
                args: ['mcp']
            },
            developer_instructions: params.developerInstructions
        });
    });

    it('builds turn params with mode defaults', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            cwd: '/tmp/worktree',
            mode: { permissionMode: 'read-only', model: 'o3' }
        });

        expect(params.threadId).toBe('thread-1');
        expect(params.cwd).toBe('/tmp/worktree');
        expect(params.input).toEqual([{ type: 'text', text: 'hello' }]);
        expect(params.approvalPolicy).toBe('never');
        expect(params.sandboxPolicy).toEqual({ type: 'readOnly' });
        expect(params.model).toBe('o3');
    });

    it('forces approval checks when operator console disallows Codex tools', () => {
        const thread = buildThreadStartParams({
            mode: {
                permissionMode: 'read-only',
                disallowedTools: ['CodexPatch'],
                appendSystemPrompt: 'operator console instructions'
            },
            mcpServers
        });
        const turn = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'retry',
            mode: {
                permissionMode: 'read-only',
                disallowedTools: ['CodexPatch']
            }
        });

        expect(thread.approvalPolicy).toBe('on-request');
        expect(thread.sandbox).toBe('read-only');
        expect(thread.developerInstructions).toContain('operator console instructions');
        expect(turn.approvalPolicy).toBe('on-request');
        expect(turn.sandboxPolicy).toEqual({ type: 'readOnly' });
    });

    it('puts collaboration mode in turn params with model settings', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default', model: 'o3', collaborationMode: 'plan' }
        });

        expect(params.collaborationMode).toEqual({ mode: 'plan', settings: { model: 'o3' } });
        expect(params.model).toBeUndefined();
    });

    it('applies CLI overrides for turns when permission mode is default', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default' },
            cliOverrides: { sandbox: 'danger-full-access', approvalPolicy: 'never' }
        });

        expect(params.approvalPolicy).toBe('never');
        expect(params.sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
    });

    it('ignores CLI overrides for turns when permission mode is not default', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'safe-yolo' },
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'never' }
        });

        expect(params.approvalPolicy).toBe('on-failure');
        expect(params.sandboxPolicy).toEqual({ type: 'workspaceWrite' });
    });

    it('prefers turn overrides', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default' },
            overrides: { approvalPolicy: 'on-request', model: 'gpt-5' }
        });

        expect(params.approvalPolicy).toBe('on-request');
        expect(params.model).toBe('gpt-5');
    });

    it('strips xhigh from model and maps to effort for turn params', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default', model: 'gpt-5.3-codex-spark xhigh' }
        });

        expect(params.model).toBe('gpt-5.3-codex-spark');
        expect(params.effort).toBe('high');
    });

    it('trims model suffix in collaboration mode settings', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default', model: 'gpt-5.3-codex-spark xhigh', collaborationMode: 'plan' }
        });

        expect(params.collaborationMode).toEqual({
            mode: 'plan',
            settings: { model: 'gpt-5.3-codex-spark' }
        });
        expect(params.model).toBeUndefined();
    });

    it('strips xhigh from model for thread params', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'default', model: 'gpt-5.3-codex-spark xhigh' },
            mcpServers: {}
        });

        expect(params.model).toBe('gpt-5.3-codex-spark');
    });
});
