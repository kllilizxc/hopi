/**
 * Low-level ripgrep wrapper - just arguments in, string out
 */

import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { platform } from 'os';
import { runtimePath } from '@/projectPath';
import { withBunRuntimeEnv } from '@/utils/bunRuntime';
import { maybeWrapSpawnSpecForStrictWorkspaceWrites } from '@/sandbox/strictWorkspaceWrites';

export interface RipgrepResult {
    exitCode: number
    stdout: string
    stderr: string
}

export interface RipgrepOptions {
    cwd?: string
}

function getBinaryPath(): string {
    const platformName = platform();
    const binaryName = platformName === 'win32' ? 'rg.exe' : 'rg';
    return resolve(join(runtimePath(), 'tools', 'unpacked', binaryName));
}

export function run(args: string[], options?: RipgrepOptions): Promise<RipgrepResult> {
    const binaryPath = getBinaryPath();
    const cwd = options?.cwd ?? process.cwd();
    const env = withBunRuntimeEnv();
    const wrapped = maybeWrapSpawnSpecForStrictWorkspaceWrites({
        workspaceRoot: cwd,
        command: binaryPath,
        args,
        cwd,
        env
    });
    return new Promise((resolve, reject) => {
        const child = spawn(wrapped.command, wrapped.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: wrapped.cwd,
            env: wrapped.env,
            shell: wrapped.shell
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({
                exitCode: code || 0,
                stdout,
                stderr
            });
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}
