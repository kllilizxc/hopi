import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const APPLIED_ENV_KEY = 'HAPI_STRICT_WORKSPACE_WRITES_APPLIED';

export type StrictWorkspaceWritesSpawnSpec = {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell?: boolean | string;
};

export function isStrictWorkspaceWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = env.HAPI_STRICT_WORKSPACE_WRITES;
    if (!raw) {
        return false;
    }
    return TRUE_VALUES.has(raw.trim().toLowerCase());
}

function isStrictWorkspaceWritesAlreadyApplied(env: NodeJS.ProcessEnv): boolean {
    const raw = env[APPLIED_ENV_KEY];
    if (!raw) {
        return false;
    }
    return TRUE_VALUES.has(raw.trim().toLowerCase());
}

function resolveAbsolutePath(value: string): string {
    if (!value) {
        return process.cwd();
    }
    return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function resolveWorkspaceRoot(workspaceRoot: string): string {
    const absolute = resolveAbsolutePath(workspaceRoot);
    try {
        return realpathSync(absolute);
    } catch {
        return absolute;
    }
}

function isPathInside(parent: string, candidate: string): boolean {
    if (!parent || !candidate) {
        return false;
    }
    const normalizedParent = parent.endsWith(sep) ? parent : parent + sep;
    return candidate === parent || candidate.startsWith(normalizedParent);
}

function ensureDir(path: string): void {
    if (!path) {
        return;
    }
    mkdirSync(path, { recursive: true });
}

function findExecutableOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
    const pathValue = env.PATH ?? process.env.PATH ?? '';
    if (!pathValue) {
        return null;
    }
    const delimiter = process.platform === 'win32' ? ';' : ':';
    for (const entry of pathValue.split(delimiter)) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const candidate = join(trimmed, name);
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function escapeSeatbeltString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildSandboxPaths(workspaceRoot: string): {
    sandboxRoot: string;
    homeDir: string;
    tmpDir: string;
    cacheDir: string;
    configDir: string;
    stateDir: string;
    hapiHomeDir: string;
    codexHomeDir: string;
    seatbeltProfilePath: string;
} {
    const sandboxRoot = join(workspaceRoot, '.hapi', 'sandbox');
    const homeDir = join(sandboxRoot, 'home');
    const tmpDir = join(sandboxRoot, 'tmp');
    const cacheDir = join(sandboxRoot, 'cache');
    const configDir = join(sandboxRoot, 'config');
    const stateDir = join(sandboxRoot, 'state');
    const hapiHomeDir = join(sandboxRoot, 'hapi-home');
    const codexHomeDir = join(sandboxRoot, 'codex-home');
    const seatbeltProfilePath = join(sandboxRoot, 'deny-write-outside.sb');
    return {
        sandboxRoot,
        homeDir,
        tmpDir,
        cacheDir,
        configDir,
        stateDir,
        hapiHomeDir,
        codexHomeDir,
        seatbeltProfilePath
    };
}

function copyCodexAuthIfPresent(options: {
    sourceDir: string;
    destDir: string;
}): void {
    const authPath = join(options.sourceDir, 'auth.json');
    if (!existsSync(authPath)) {
        return;
    }
    ensureDir(options.destDir);
    copyFileSync(authPath, join(options.destDir, 'auth.json'));
}

function prepareSandboxEnv(options: {
    workspaceRoot: string;
    baseEnv: NodeJS.ProcessEnv;
    sandboxHome: string;
    sandboxTmp: string;
    sandboxCache: string;
    sandboxConfig: string;
    sandboxState: string;
    sandboxHapiHome: string;
    sandboxCodexHome: string;
}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...options.baseEnv };

    // Keep a handle on the *real* home before overriding HOME, so we can copy
    // existing Codex auth into the sandbox if needed.
    const originalHome = options.baseEnv.HOME || homedir();

    env.HOME = options.sandboxHome;
    env.TMPDIR = options.sandboxTmp;
    env.XDG_CACHE_HOME = options.sandboxCache;
    env.XDG_CONFIG_HOME = options.sandboxConfig;
    env.XDG_STATE_HOME = options.sandboxState;

    // Ensure HAPI-based processes (hub/web dev, etc.) have a writable home dir
    // that doesn't touch the user's real ~/.hapi.
    env.HAPI_HOME = options.sandboxHapiHome;

    // Ensure Codex has a writable CODEX_HOME inside the workspace, but preserve
    // any existing auth.json (runner token injection or prior login).
    const existingCodexHome = options.baseEnv.CODEX_HOME;
    ensureDir(options.sandboxCodexHome);
    if (existingCodexHome && !isPathInside(options.workspaceRoot, resolveAbsolutePath(existingCodexHome))) {
        try {
            copyCodexAuthIfPresent({ sourceDir: existingCodexHome, destDir: options.sandboxCodexHome });
        } catch {
            // Ignore copy errors; Codex may be using a different auth mechanism.
        }
    } else {
        // Common default location when CODEX_HOME isn't set.
        try {
            copyCodexAuthIfPresent({ sourceDir: join(originalHome, '.codex'), destDir: options.sandboxCodexHome });
        } catch {
            // Ignore copy errors; best-effort only.
        }
    }
    env.CODEX_HOME = options.sandboxCodexHome;

    // Sentinel so nested spawns inside an already sandboxed process don't try to
    // apply sandbox-exec/bwrap again (which can fail on some platforms).
    env[APPLIED_ENV_KEY] = '1';

    return env;
}

function ensureSeatbeltProfile(options: {
    workspaceRoot: string;
    profilePath: string;
}): void {
    const workspace = escapeSeatbeltString(options.workspaceRoot);
    // NOTE: We allow default operations and then deny file writes, re-allowing
    // writes only within the workspace (and a few safe device nodes).
    const profile = [
        '(version 1)',
        '(allow default)',
        '(deny file-write*)',
        '(allow file-write* (literal "/dev/null"))',
        '(allow file-write* (literal "/dev/tty"))',
        `(allow file-write* (subpath "${workspace}"))`,
        ''
    ].join('\n');
    writeFileSync(options.profilePath, profile, 'utf8');
}

export function maybeWrapSpawnSpecForStrictWorkspaceWrites(spec: StrictWorkspaceWritesSpawnSpec & { workspaceRoot: string }): StrictWorkspaceWritesSpawnSpec {
    if (!isStrictWorkspaceWritesEnabled(spec.env)) {
        return spec;
    }

    if (isStrictWorkspaceWritesAlreadyApplied(spec.env)) {
        return spec;
    }

    const workspaceRoot = resolveWorkspaceRoot(spec.workspaceRoot);
    const cwd = resolveAbsolutePath(spec.cwd);

    const paths = buildSandboxPaths(workspaceRoot);
    ensureDir(paths.sandboxRoot);
    ensureDir(paths.homeDir);
    ensureDir(paths.tmpDir);
    ensureDir(paths.cacheDir);
    ensureDir(paths.configDir);
    ensureDir(paths.stateDir);
    ensureDir(paths.hapiHomeDir);
    ensureDir(paths.codexHomeDir);

    const env = prepareSandboxEnv({
        workspaceRoot,
        baseEnv: spec.env,
        sandboxHome: paths.homeDir,
        sandboxTmp: paths.tmpDir,
        sandboxCache: paths.cacheDir,
        sandboxConfig: paths.configDir,
        sandboxState: paths.stateDir,
        sandboxHapiHome: paths.hapiHomeDir,
        sandboxCodexHome: paths.codexHomeDir
    });

    if (process.platform === 'darwin') {
        const sandboxExecPath = findExecutableOnPath('sandbox-exec', env) ?? '/usr/bin/sandbox-exec';
        if (!existsSync(sandboxExecPath)) {
            throw new Error('HAPI_STRICT_WORKSPACE_WRITES is enabled, but sandbox-exec was not found on PATH.');
        }

        ensureSeatbeltProfile({ workspaceRoot, profilePath: paths.seatbeltProfilePath });

        return {
            command: sandboxExecPath,
            args: ['-f', paths.seatbeltProfilePath, spec.command, ...spec.args],
            cwd,
            env,
            shell: false
        };
    }

    if (process.platform === 'linux') {
        const resolvedBwrapPath = findExecutableOnPath('bwrap', env);
        const bwrapPath = resolvedBwrapPath ?? 'bwrap';
        if (!resolvedBwrapPath && bwrapPath === 'bwrap') {
            // Keep error message stable even if PATH probing can't resolve the full path.
            throw new Error('HAPI_STRICT_WORKSPACE_WRITES is enabled, but bubblewrap (bwrap) was not found on PATH.');
        }

        const args: string[] = [
            '--die-with-parent',
            '--ro-bind', '/', '/',
            '--bind', workspaceRoot, workspaceRoot,
            '--bind', paths.tmpDir, '/tmp',
            '--dev', '/dev',
            '--proc', '/proc',
            '--chdir', cwd,
            '--setenv', 'HOME', paths.homeDir,
            '--setenv', 'TMPDIR', '/tmp',
            '--setenv', 'XDG_CACHE_HOME', paths.cacheDir,
            '--setenv', 'XDG_CONFIG_HOME', paths.configDir,
            '--setenv', 'XDG_STATE_HOME', paths.stateDir,
            '--setenv', 'HAPI_HOME', paths.hapiHomeDir,
            '--setenv', 'CODEX_HOME', paths.codexHomeDir,
            '--', spec.command, ...spec.args
        ];

        return {
            command: bwrapPath,
            args,
            cwd,
            env,
            shell: false
        };
    }

    throw new Error(`HAPI_STRICT_WORKSPACE_WRITES is enabled, but platform ${process.platform} is not supported.`);
}
