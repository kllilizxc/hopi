import { describe, expect, it } from 'vitest';
import { buildCodexStartConfig } from './codexStartConfig';
import { codexSystemPrompt } from './systemPrompt';
import { PRODUCT_SLUG } from '@hopi/protocol/brand';

describe('buildCodexStartConfig', () => {
    const mcpServers = { [PRODUCT_SLUG]: { command: 'node', args: ['mcp'] } };

    it('applies CLI overrides when permission mode is default', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default' },
            first: true,
            cwd: '/tmp/worktree',
            mcpServers,
            cliOverrides: { sandbox: 'danger-full-access', approvalPolicy: 'never' }
        });

        expect(config.cwd).toBe('/tmp/worktree');
        expect(config.sandbox).toBe('danger-full-access');
        expect(config['approval-policy']).toBe('never');
        expect(config.config).toEqual({
            mcp_servers: mcpServers
        });
    });

    it('ignores CLI overrides when permission mode is not default', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'yolo' },
            first: false,
            mcpServers,
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'never' }
        });

        expect(config.sandbox).toBe('danger-full-access');
        expect(config['approval-policy']).toBe('on-failure');
    });

    it('passes model when provided', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default', model: 'o3' },
            first: false,
            mcpServers
        });

        expect(config.model).toBe('o3');
    });

    it('strips xhigh from model when building start config', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default', model: 'gpt-5.3-codex-spark xhigh' },
            first: false,
            mcpServers
        });

        expect(config.model).toBe('gpt-5.3-codex-spark');
    });
});
