import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { PRODUCT_ENV } from '@hopi/protocol/brand';

const COMMON_UNIX_GIT_PATHS = [
    '/usr/bin/git',
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
    '/bin/git'
];

function isExecutableFile(candidatePath: string): boolean {
    try {
        const stat = statSync(candidatePath);
        if (!stat.isFile()) {
            return false;
        }

        if (process.platform === 'win32') {
            return true;
        }

        accessSync(candidatePath, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function getPathExtensions(env: NodeJS.ProcessEnv): string[] {
    if (process.platform !== 'win32') {
        return [''];
    }

    const raw = env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
    const parts = raw
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    return parts.length > 0 ? parts : ['.EXE'];
}

function resolveExplicitExecutable(candidate: string, env: NodeJS.ProcessEnv): string | null {
    const trimmed = candidate.trim();
    if (!trimmed) {
        return null;
    }

    const hasPathSeparator = trimmed.includes('/') || trimmed.includes('\\');
    if (!isAbsolute(trimmed) && !hasPathSeparator) {
        return null;
    }

    if (isExecutableFile(trimmed)) {
        return trimmed;
    }

    if (process.platform === 'win32') {
        for (const extension of getPathExtensions(env)) {
            const suffixed = trimmed.toLowerCase().endsWith(extension.toLowerCase())
                ? trimmed
                : `${trimmed}${extension}`;
            if (isExecutableFile(suffixed)) {
                return suffixed;
            }
        }
    }

    return null;
}

export function findExecutableOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
    const trimmed = command.trim();
    if (!trimmed) {
        return null;
    }

    const explicit = resolveExplicitExecutable(trimmed, env);
    if (explicit) {
        return explicit;
    }

    const pathValue = env.PATH ?? process.env.PATH ?? '';
    const pathParts = pathValue
        .split(delimiter)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const extensions = getPathExtensions(env);
    const hasKnownExtension = extensions.some((extension) => extension && trimmed.toLowerCase().endsWith(extension.toLowerCase()));

    for (const part of pathParts) {
        const baseCandidate = join(part, trimmed);
        const candidates = process.platform === 'win32' && !hasKnownExtension
            ? extensions.map((extension) => `${baseCandidate}${extension}`)
            : [baseCandidate];

        for (const candidatePath of candidates) {
            if (isExecutableFile(candidatePath)) {
                return candidatePath;
            }
        }
    }

    return null;
}

export function resolveGitExecutable(env: NodeJS.ProcessEnv = process.env): string {
    const explicit = env[PRODUCT_ENV.GIT_PATH]?.trim();
    if (explicit) {
        const resolvedExplicit = resolveExplicitExecutable(explicit, env);
        if (resolvedExplicit) {
            return resolvedExplicit;
        }
        throw new Error(`Git CLI not found at ${explicit}. Install Git or set ${PRODUCT_ENV.GIT_PATH} to a valid executable path.`)
    }

    const fromPath = findExecutableOnPath('git', env);
    if (fromPath) {
        return fromPath;
    }

    if (process.platform !== 'win32') {
        const commonPath = COMMON_UNIX_GIT_PATHS.find((candidatePath) => existsSync(candidatePath) && isExecutableFile(candidatePath));
        if (commonPath) {
            return commonPath;
        }
    }

    throw new Error(`Git CLI not found on PATH. Install Git or set ${PRODUCT_ENV.GIT_PATH}.`)
}
