/**
 * Cross-platform HOPI CLI spawning utility
 *
 * ## Background
 *
 * HOPI CLI runs in two modes:
 * 1. **Compiled binary**: A single executable built with `bun build --compile`
 * 2. **Development mode**: Running TypeScript directly via `bun`
 *
 * ## Execution Modes
 *
 * **Compiled Binary (Production):**
 * - The executable is self-contained and runs directly
 * - `process.execPath` points to the compiled binary itself
 * - No additional entrypoint needed - just pass args to `process.execPath`
 *
 * **Development Mode:**
 * - Running via `bun src/index.ts`
 * - Spawn child processes using the same runtime with `src/index.ts` entrypoint
 *
 * ## Cross-Platform Support
 *
 * This utility handles spawning HOPI CLI subprocesses (for runner processes)
 * in a cross-platform way, detecting the current runtime mode and using
 * the appropriate command and arguments.
 */

import { spawn, SpawnOptions, type ChildProcess } from 'child_process';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBunCompiled, projectPath } from '@/projectPath';
import { logger } from '@/ui/logger';
import { existsSync } from 'node:fs';
import { PRODUCT_CLI_WORKING_DIRECTORY_ENV } from '@/utils/workingDirectory';
import { maybeWrapSpawnSpecForStrictWorkspaceWrites } from '@/sandbox/strictWorkspaceWrites';

/**
 * Resolve the TypeScript entrypoint for development mode.
 */
function resolveEntrypoint(projectRoot: string): string {
  const srcEntrypoint = join(projectRoot, 'src', 'index.ts');
  if (existsSync(srcEntrypoint)) {
    return srcEntrypoint;
  }

  throw new Error('No CLI entrypoint found (expected src/index.ts)');
}

export interface HappyCliCommand {
  command: string;
  args: string[];
}

function normalizeCwd(cwd: string | URL | undefined): string | null {
  if (!cwd) {
    return null;
  }

  if (cwd instanceof URL) {
    return fileURLToPath(cwd);
  }

  return isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
}

export function getHappyCliCommand(args: string[]): HappyCliCommand {
  // Compiled binary mode: just use the executable directly
  if (isBunCompiled()) {
    return {
      command: process.execPath,
      args
    };
  }

  // Development mode: spawn with TypeScript entrypoint
  const projectRoot = projectPath();
  const entrypoint = resolveEntrypoint(projectRoot);
  const isBunRuntime = Boolean((process.versions as Record<string, string | undefined>).bun);

  if (isBunRuntime) {
    // Bun can run TypeScript directly
    return {
      command: process.execPath,
      args: [entrypoint, ...args]
    };
  }

  // Node.js fallback: preserve execArgv (for compatibility)
  return {
    command: process.execPath,
    args: [...process.execArgv, entrypoint, ...args]
  };
}

export function spawnHappyCLI(args: string[], options: SpawnOptions = {}): ChildProcess {

  let directory: string | URL | undefined;
  if ('cwd' in options) {
    directory = options.cwd
  } else {
    directory = process.cwd()
  }
  // Note: We're executing the current runtime with the calculated entrypoint path below,
  // bypassing the 'hopi' wrapper that would normally be found in the shell's PATH.
  // However, we log it as 'hopi' here because other engineers are typically looking
  // for when "hopi" was started and don't care about the underlying node process
  // details and flags we use to achieve the same result.
  const fullCommand = `hopi ${args.join(' ')}`;
  logger.debug(`[SPAWN HOPI CLI] Spawning: ${fullCommand} in ${directory}`);
  
  const { command: spawnCommand, args: spawnArgs } = getHappyCliCommand(args);
  const spawnOptions: SpawnOptions = { ...options };
  const normalizedTargetCwd = normalizeCwd(options.cwd) ?? process.cwd();

  // Sanity check that the entrypoint path exists
  if (!isBunCompiled()) {
    const entrypoint = spawnArgs.find((arg) => arg.endsWith('index.ts'));
    if (entrypoint && !existsSync(entrypoint)) {
      const errorMessage = `Entrypoint ${entrypoint} does not exist`;
      logger.debug(`[SPAWN HOPI CLI] ${errorMessage}`);
      throw new Error(errorMessage);
    }

    // In Bun dev mode, aliases like @/* are resolved from the process cwd.
    // Keep spawn cwd at CLI project root so aliases resolve, and pass through the
    // intended session cwd for the child process to apply at runtime.
    const isBunRuntime = Boolean((process.versions as Record<string, string | undefined>).bun);
    const targetCwd = normalizeCwd(options.cwd);
    if (isBunRuntime && targetCwd) {
      const projectRoot = projectPath();
      if (targetCwd !== projectRoot) {
        spawnOptions.cwd = projectRoot;
        spawnOptions.env = {
          ...process.env,
          ...(options.env || {}),
          [PRODUCT_CLI_WORKING_DIRECTORY_ENV]: targetCwd
        };
      }
    }
  }

  // Apply strict workspace write sandboxing when enabled (macOS: sandbox-exec, Linux: bwrap).
  // We treat the *target* cwd (not necessarily spawnOptions.cwd) as the workspace root.
  const wrapped = maybeWrapSpawnSpecForStrictWorkspaceWrites({
    workspaceRoot: normalizedTargetCwd,
    command: spawnCommand,
    args: spawnArgs,
    cwd: (normalizeCwd(spawnOptions.cwd) ?? process.cwd()),
    env: (spawnOptions.env ?? process.env) as NodeJS.ProcessEnv,
    shell: spawnOptions.shell
  });

  return spawn(wrapped.command, wrapped.args, {
    ...spawnOptions,
    cwd: wrapped.cwd,
    env: wrapped.env,
    shell: wrapped.shell ?? spawnOptions.shell
  });
}
