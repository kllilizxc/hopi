import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maybeWrapSpawnSpecForStrictWorkspaceWrites } from './strictWorkspaceWrites';

describe('strictWorkspaceWrites', () => {
    it('returns original spec when disabled', () => {
        const spec = {
            workspaceRoot: '/tmp',
            command: 'echo',
            args: ['hi'],
            cwd: '/tmp',
            env: { PATH: process.env.PATH }
        };

        const wrapped = maybeWrapSpawnSpecForStrictWorkspaceWrites(spec);
        expect(wrapped).toBe(spec);
    });

    it('wraps child process when enabled', () => {
        const workspace = mkdtempSync(join(tmpdir(), 'hapi-workspace-'));
        const binDir = mkdtempSync(join(tmpdir(), 'hapi-bin-'));

        if (process.platform !== 'linux' && process.platform !== 'darwin') {
            expect(() => maybeWrapSpawnSpecForStrictWorkspaceWrites({
                workspaceRoot: workspace,
                command: 'echo',
                args: ['hi'],
                cwd: workspace,
                env: {
                    ...process.env,
                    HAPI_STRICT_WORKSPACE_WRITES: '1',
                    PATH: `${binDir}:${process.env.PATH ?? ''}`
                }
            })).toThrow(/not supported/i);
            return;
        }

        const toolName = process.platform === 'linux'
            ? 'bwrap'
            : process.platform === 'darwin'
                ? 'sandbox-exec'
                : 'bwrap';

        writeFileSync(join(binDir, toolName), '');

        const env: NodeJS.ProcessEnv = {
            ...process.env,
            HAPI_STRICT_WORKSPACE_WRITES: '1',
            PATH: `${binDir}:${process.env.PATH ?? ''}`
        };

        const wrapped = maybeWrapSpawnSpecForStrictWorkspaceWrites({
            workspaceRoot: workspace,
            command: 'echo',
            args: ['hi'],
            cwd: workspace,
            env
        });

        const sandboxRoot = join(workspace, '.hapi', 'sandbox');
        expect(wrapped.env.HOME).toBe(join(sandboxRoot, 'home'));
        expect(wrapped.env.HAPI_HOME).toBe(join(sandboxRoot, 'hapi-home'));
        expect(wrapped.env.CODEX_HOME).toBe(join(sandboxRoot, 'codex-home'));

        if (process.platform === 'darwin') {
            expect(wrapped.command).toBe(join(binDir, 'sandbox-exec'));
            expect(wrapped.args[0]).toBe('-f');
            expect(wrapped.args).toContain('echo');
            expect(wrapped.args).toContain('hi');
            return;
        }

        if (process.platform === 'linux') {
            expect(wrapped.command).toBe(join(binDir, 'bwrap'));
            const separatorIndex = wrapped.args.indexOf('--');
            expect(separatorIndex).toBeGreaterThan(-1);
            expect(wrapped.args.slice(separatorIndex + 1)).toEqual(['echo', 'hi']);
            return;
        }
    });
});
