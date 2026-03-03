import { spawn, type ChildProcess } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

const PREVIEW_LOG_LIMIT = 400;
const READY_MARKER = /::hapi-preview-url::(\S+)/i;
const URL_PATTERN = /(https?:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}[^\s]*)/i;

type PreviewStatus = 'idle' | 'starting' | 'ready' | 'error' | 'stopped';

type ResolvedCommand = {
  command: string;
  cwd: string;
};

export type PreviewStartOptions = {
  taskId: string;
  sessionId: string;
  rootPath: string;
  mode: 'local' | 'worktree';
  basePort?: number;
};

export type PreviewStopOptions = {
  taskId?: string;
};

export type PreviewState = {
  active: boolean;
  status: PreviewStatus;
  taskId?: string;
  sessionId?: string;
  mode?: 'local' | 'worktree';
  rootPath?: string;
  runPath?: string;
  command?: string;
  port?: number;
  url?: string;
  pid?: number;
  startedAt?: number;
  updatedAt: number;
  error?: string;
  logTail: string[];
};

function buildIdleState(): PreviewState {
  return {
    active: false,
    status: 'idle',
    updatedAt: Date.now(),
    logTail: []
  };
}

function withTimestamp(line: string): string {
  return `[${new Date().toISOString()}] ${line}`;
}

function normalizeLine(raw: string): string {
  return raw.replace(/\r/g, '').trim();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isDirectory()) {
    throw new Error(`Path is not a directory: ${path}`);
  }
}

async function readPackageScripts(path: string): Promise<Record<string, string> | null> {
  const packageJsonPath = join(path, 'package.json');
  if (!await fileExists(packageJsonPath)) {
    return null;
  }

  try {
    const content = await readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
    if (!parsed || typeof parsed !== 'object' || !parsed.scripts || typeof parsed.scripts !== 'object') {
      return null;
    }
    return parsed.scripts;
  } catch (error) {
    throw new Error(`Failed to parse package.json at ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function choosePackageManager(path: string): Promise<'bun' | 'pnpm' | 'yarn' | 'npm'> {
  if (await fileExists(join(path, 'bun.lockb')) || await fileExists(join(path, 'bun.lock'))) {
    return 'bun';
  }
  if (await fileExists(join(path, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (await fileExists(join(path, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

function commandForPackageScript(pm: 'bun' | 'pnpm' | 'yarn' | 'npm', script: string): string {
  if (pm === 'yarn') {
    return `yarn ${script}`;
  }
  return `${pm} run ${script}`;
}

async function pickPreviewCommand(rootPath: string): Promise<ResolvedCommand> {
  const scriptPath = join(rootPath, '.hapi', 'preview.sh');
  if (await fileExists(scriptPath)) {
    return {
      command: 'bash .hapi/preview.sh',
      cwd: rootPath
    };
  }

  const candidates = [
    rootPath,
    join(rootPath, 'web'),
    join(rootPath, 'app'),
    join(rootPath, 'frontend'),
    join(rootPath, 'client')
  ];

  for (const dir of candidates) {
    const scripts = await readPackageScripts(dir);
    if (!scripts) {
      continue;
    }

    const selected = scripts.preview
      ? 'preview'
      : scripts.dev
        ? 'dev'
        : scripts.start
          ? 'start'
          : null;

    if (!selected) {
      continue;
    }

    const pm = await choosePackageManager(dir);
    return {
      command: commandForPackageScript(pm, selected),
      cwd: dir
    };
  }

  throw new Error('No preview command found. Create .hapi/preview.sh or add package.json script preview/dev/start');
}

async function findFreePort(basePort: number): Promise<number> {
  let port = Number.isFinite(basePort) ? Math.trunc(basePort) : 5173;
  if (port < 1 || port > 65535) {
    port = 5173;
  }

  for (let attempts = 0; attempts < 200; attempts += 1) {
    const candidate = port + attempts;
    if (candidate > 65535) {
      break;
    }

    const isFree = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(candidate, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });

    if (isFree) {
      return candidate;
    }
  }

  throw new Error('No free port available for preview');
}

function parseUrlPort(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.port) {
      return undefined;
    }
    const value = Number.parseInt(parsed.port, 10);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function waitForExit(process: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;

    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };

    process.once('exit', finish);

    const timer = setTimeout(() => {
      finish();
    }, timeoutMs);

    timer.unref();
  });
}

export class PreviewManager {
  private state: PreviewState = buildIdleState();
  private process: ChildProcess | null = null;
  private runId = 0;
  private stopRequestedRunId: number | null = null;

  getState(): PreviewState {
    return {
      ...this.state,
      logTail: [...this.state.logTail]
    };
  }

  async start(options: PreviewStartOptions): Promise<PreviewState> {
    await this.stop();

    await ensureDirectory(options.rootPath);

    const selected = await pickPreviewCommand(options.rootPath);
    const port = await findFreePort(options.basePort ?? 5173);
    const defaultUrl = `http://127.0.0.1:${port}`;
    const runId = this.runId + 1;
    this.runId = runId;
    this.stopRequestedRunId = null;

    const now = Date.now();
    this.state = {
      active: true,
      status: 'starting',
      taskId: options.taskId,
      sessionId: options.sessionId,
      mode: options.mode,
      rootPath: options.rootPath,
      runPath: selected.cwd,
      command: selected.command,
      port,
      url: defaultUrl,
      startedAt: now,
      updatedAt: now,
      logTail: []
    };

    const child = spawn(selected.command, {
      cwd: selected.cwd,
      shell: true,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        HAPI_PREVIEW_PORT: String(port),
        HAPI_PREVIEW_ROOT: options.rootPath,
        HAPI_PREVIEW_MODE: options.mode
      }
    });

    this.process = child;
    this.state.pid = child.pid;

    this.pushLog(`Starting preview: ${selected.command}`);
    this.pushLog(`Root: ${options.rootPath}`);
    if (selected.cwd !== options.rootPath) {
      this.pushLog(`Run dir: ${selected.cwd}`);
    }
    this.pushLog(`Default URL: ${defaultUrl}`);

    const attachOutput = (stream: NodeJS.ReadableStream | null | undefined, source: 'stdout' | 'stderr') => {
      if (!stream) {
        return;
      }

      let pending = '';
      stream.on('data', (chunk: Buffer | string) => {
        pending += chunk.toString();
        while (true) {
          const newlineIndex = pending.indexOf('\n');
          if (newlineIndex < 0) {
            break;
          }
          const line = normalizeLine(pending.slice(0, newlineIndex));
          pending = pending.slice(newlineIndex + 1);
          if (!line) {
            continue;
          }
          this.handleOutputLine(runId, line, source);
        }
      });

      stream.on('end', () => {
        const line = normalizeLine(pending);
        if (line) {
          this.handleOutputLine(runId, line, source);
        }
      });
    };

    attachOutput(child.stdout, 'stdout');
    attachOutput(child.stderr, 'stderr');

    child.on('error', (error) => {
      if (runId !== this.runId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.pushLog(`Process error: ${message}`);
      this.state = {
        ...this.state,
        active: false,
        status: 'error',
        error: message,
        updatedAt: Date.now()
      };
      this.process = null;
    });

    child.on('exit', (code, signal) => {
      if (runId !== this.runId) {
        return;
      }

      const stoppedByRequest = this.stopRequestedRunId === runId;
      const hasError = typeof code === 'number' && code !== 0;
      const status: PreviewStatus = stoppedByRequest
        ? 'stopped'
        : hasError
          ? 'error'
          : 'stopped';

      let message: string | undefined;
      if (signal) {
        message = `Preview process exited by signal ${signal}`;
      } else if (typeof code === 'number') {
        message = `Preview process exited with code ${code}`;
      } else {
        message = 'Preview process exited';
      }

      this.pushLog(message);
      this.state = {
        ...this.state,
        active: false,
        status,
        error: status === 'error' ? message : undefined,
        updatedAt: Date.now()
      };
      this.process = null;
    });

    return this.getState();
  }

  async stop(options?: PreviewStopOptions): Promise<PreviewState> {
    if (options?.taskId && this.state.taskId && options.taskId !== this.state.taskId) {
      return this.getState();
    }

    const processToStop = this.process;
    const runId = this.runId;
    if (!processToStop) {
      if (this.state.status === 'starting' || this.state.status === 'ready') {
        this.state = {
          ...this.state,
          active: false,
          status: 'stopped',
          updatedAt: Date.now()
        };
      }
      return this.getState();
    }

    this.stopRequestedRunId = runId;

    try {
      processToStop.kill('SIGTERM');
    } catch {
      // Ignore kill errors; process may have already exited.
    }

    await waitForExit(processToStop, 3_000);

    if (processToStop.exitCode === null && processToStop.signalCode === null) {
      try {
        processToStop.kill('SIGKILL');
      } catch {
        // Ignore kill errors; process may have already exited.
      }
      await waitForExit(processToStop, 1_000);
    }

    if (runId === this.runId) {
      this.process = null;
      this.state = {
        ...this.state,
        active: false,
        status: 'stopped',
        updatedAt: Date.now()
      };
    }

    return this.getState();
  }

  private handleOutputLine(runId: number, line: string, source: 'stdout' | 'stderr'): void {
    if (runId !== this.runId) {
      return;
    }

    this.pushLog(`${source}: ${line}`);

    const markerMatch = line.match(READY_MARKER);
    if (markerMatch && markerMatch[1]) {
      const url = markerMatch[1].trim();
      this.updateReadyState(url);
      return;
    }

    const urlMatch = line.match(URL_PATTERN);
    if (urlMatch && urlMatch[1] && this.state.status === 'starting') {
      const url = urlMatch[1].trim();
      this.updateReadyState(url);
    }
  }

  private updateReadyState(url: string): void {
    const port = parseUrlPort(url);
    this.state = {
      ...this.state,
      status: 'ready',
      url,
      port: port ?? this.state.port,
      error: undefined,
      updatedAt: Date.now()
    };
  }

  private pushLog(line: string): void {
    if (!line) {
      return;
    }

    this.state.logTail.push(withTimestamp(line));
    if (this.state.logTail.length > PREVIEW_LOG_LIMIT) {
      this.state.logTail.splice(0, this.state.logTail.length - PREVIEW_LOG_LIMIT);
    }
    this.state.updatedAt = Date.now();

    logger.debug(`[PREVIEW] ${line}`);
  }
}
