/**
 * Low-level difftastic wrapper - just arguments in, string out
 */

import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { platform, arch } from 'os';
import { runtimePath } from '@/projectPath';
import { maybeWrapSpawnSpecForStrictWorkspaceWrites } from '@/sandbox/strictWorkspaceWrites';

export interface DifftasticResult {
    exitCode: number
    stdout: string
    stderr: string
}

export interface DifftasticOptions {
    cwd?: string
}

/**
 * Get the platform-specific binary path
 */
function getBinaryPath(): string {
    const platformName = platform();
    const binaryName = platformName === 'win32' ? 'difft.exe' : 'difft';
    return resolve(join(runtimePath(), 'tools', 'unpacked', binaryName));
}

/**
 * Run difftastic with the given arguments
 * @param args - Array of command line arguments to pass to difftastic
 * @param options - Options for difftastic execution
 * @returns Promise with exit code, stdout and stderr
 */
export function run(args: string[], options?: DifftasticOptions): Promise<DifftasticResult> {
    const binaryPath = getBinaryPath();
    const cwd = options?.cwd ?? process.cwd();
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        // Force color output when needed
        FORCE_COLOR: '1'
    };
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
