import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer, createConnection } from 'node:net';
import { resolve } from 'node:path';
import type { PreviewService, ReadyCheck } from '@hopi/protocol/actions';
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH, PRODUCT_ENV } from '@hopi/protocol/brand';
import { logger } from '@/ui/logger';
import { maybeWrapSpawnSpecForStrictWorkspaceWrites } from '@/sandbox/strictWorkspaceWrites';
import { loadLocalActionContract } from './actionContract';

const PREVIEW_LOG_LIMIT = 400;
const URL_PATTERN = /(https?:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}[^\s]*)/i;

type PreviewStatus = 'idle' | 'starting' | 'ready' | 'error' | 'stopped';
type PreviewServiceStatus = 'starting' | 'ready' | 'error' | 'stopped';

type PreparedPreviewService = {
  service: PreviewService;
  cwd: string;
  env: Record<string, string | undefined>;
  command: string;
  ready: ReadyCheck;
  allocatedPort?: number;
};

type PendingStdoutWaiter = {
  marker: string;
  resolve: (result?: { url?: string; port?: number }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
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

export type PreviewServiceState = {
  id: string;
  status: PreviewServiceStatus;
  cwd: string;
  command: string;
  readyType: ReadyCheck['type'];
  expose?: 'none' | 'primary';
  port?: number;
  url?: string;
  pid?: number;
  startedAt?: number;
  updatedAt: number;
  error?: string;
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
  services?: PreviewServiceState[];
};

function buildIdleState(): PreviewState {
  return {
    active: false,
    status: 'idle',
    updatedAt: Date.now(),
    logTail: [],
    services: []
  };
}

function withTimestamp(line: string): string {
  return `[${new Date().toISOString()}] ${line}`;
}

function normalizeLine(raw: string): string {
  return raw.replace(/\r/g, '').trim();
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toEnvKey(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'SERVICE';
}

function interpolateTemplate(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$([A-Z0-9_]+)/gi, (_full, key: string) => env[key] ?? `$${key}`);
}

function interpolateCommand(tokens: string[], env: Record<string, string | undefined>): string {
  return tokens
    .map((token) => quoteForShell(interpolateTemplate(token, env)))
    .join(' ');
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

function buildServiceState(prepared: PreparedPreviewService): PreviewServiceState {
  return {
    id: prepared.service.id,
    status: 'starting',
    cwd: prepared.cwd,
    command: prepared.command,
    readyType: prepared.ready.type,
    expose: prepared.service.expose,
    port: prepared.allocatedPort,
    updatedAt: Date.now()
  };
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

async function findFreePort(basePort: number, reserved: Set<number>): Promise<number> {
  let port = Number.isFinite(basePort) ? Math.trunc(basePort) : 5173;
  if (port < 1 || port > 65535) {
    port = 5173;
  }

  for (let attempts = 0; attempts < 200; attempts += 1) {
    const candidate = port + attempts;
    if (candidate > 65535 || reserved.has(candidate)) {
      continue;
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
      reserved.add(candidate);
      return candidate;
    }
  }

  throw new Error('No free port available for preview stack');
}

async function waitForExit(process: ChildProcess, timeoutMs: number): Promise<void> {
  return await new Promise((resolve) => {
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
  private processes = new Map<string, ChildProcess>();
  private serviceReadyWaiters = new Map<string, PendingStdoutWaiter>();
  private runId = 0;
  private stopRequestedRunId: number | null = null;

  getState(): PreviewState {
    return {
      ...this.state,
      logTail: [...this.state.logTail],
      services: Array.isArray(this.state.services) ? this.state.services.map((service) => ({ ...service })) : []
    };
  }

  async start(options: PreviewStartOptions): Promise<PreviewState> {
    await this.stop();

    await ensureDirectory(options.rootPath);

    const contract = await loadLocalActionContract(options.rootPath);
    if (contract.kind === 'missing') {
      throw new Error(`No preview contract found. Create ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH} with preview.services.`);
    }
    if (contract.kind === 'invalid') {
      throw new Error(`Invalid ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}: ${contract.error}`);
    }

    const reservedPorts = new Set<number>();
    const basePort = options.basePort ?? 5173;
    const preparedServices: PreparedPreviewService[] = [];

    for (const service of contract.contract.preview.services) {
      const cwd = !service.cwd || service.cwd.trim() === '.'
        ? options.rootPath
        : resolve(options.rootPath, service.cwd);
      if (!await fileExists(cwd)) {
        throw new Error(`Preview service "${service.id}" cwd does not exist: ${cwd}`);
      }

      const env: Record<string, string | undefined> = {
        ...process.env,
        ...service.env,
        [PRODUCT_ENV.PREVIEW_ROOT]: options.rootPath,
        [PRODUCT_ENV.PREVIEW_MODE]: options.mode
      };

      const allocatedPort = await this.allocateServicePort(service, basePort, reservedPorts);
      if (allocatedPort) {
        env.PORT = String(allocatedPort);
        env.HOST = '127.0.0.1';
        env[PRODUCT_ENV.PREVIEW_PORT] = String(allocatedPort);
        env[`HOPI_PORT_${toEnvKey(service.id)}`] = String(allocatedPort);
      }

      const command = interpolateCommand(service.run, env);
      const ready = this.resolveReadyCheck(service.ready, env);

      preparedServices.push({
        service,
        cwd,
        env,
        command,
        ready,
        allocatedPort
      });
    }

    const primary = preparedServices.find((service) => service.service.expose === 'primary') ?? preparedServices[0];
    const now = Date.now();
    const runId = this.runId + 1;
    this.runId = runId;
    this.stopRequestedRunId = null;
    this.processes.clear();
    this.serviceReadyWaiters.clear();

    this.state = {
      active: true,
      status: 'starting',
      taskId: options.taskId,
      sessionId: options.sessionId,
      mode: options.mode,
      rootPath: options.rootPath,
      runPath: primary?.cwd ?? options.rootPath,
      command: primary?.command,
      port: primary?.allocatedPort,
      startedAt: now,
      updatedAt: now,
      logTail: [],
      services: preparedServices.map((service) => buildServiceState(service))
    };

    this.pushLog(`Starting preview stack from ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`);
    this.pushLog(`Root: ${options.rootPath}`);
    void this.startPreparedServices(runId, preparedServices);

    return this.getState();
  }

  async stop(options?: PreviewStopOptions): Promise<PreviewState> {
    if (options?.taskId && this.state.taskId && options.taskId !== this.state.taskId) {
      return this.getState();
    }

    const runId = this.runId;
    this.stopRequestedRunId = runId;

    for (const waiter of this.serviceReadyWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Preview stopped before service became ready'));
    }
    this.serviceReadyWaiters.clear();

    const processes = [...this.processes.values()];
    if (processes.length === 0) {
      if (this.state.status === 'starting' || this.state.status === 'ready' || this.state.status === 'error') {
        this.state = {
          ...this.state,
          active: false,
          status: 'stopped',
          updatedAt: Date.now(),
          services: (this.state.services ?? []).map((service) => ({
            ...service,
            status: service.status === 'error' ? 'error' : 'stopped',
            updatedAt: Date.now()
          }))
        };
      }
      return this.getState();
    }

    for (const processToStop of processes) {
      try {
        processToStop.kill('SIGTERM');
      } catch {
      }
    }

    await Promise.all(processes.map((processToStop) => waitForExit(processToStop, 3_000)));

    for (const processToStop of processes) {
      if (processToStop.exitCode === null && processToStop.signalCode === null) {
        try {
          processToStop.kill('SIGKILL');
        } catch {
        }
      }
    }

    this.processes.clear();

    if (runId === this.runId) {
      const now = Date.now();
      this.state = {
        ...this.state,
        active: false,
        status: 'stopped',
        updatedAt: now,
        services: (this.state.services ?? []).map((service) => ({
          ...service,
          status: service.status === 'error' ? 'error' : 'stopped',
          updatedAt: now
        }))
      };
    }

    return this.getState();
  }

  private async allocateServicePort(service: PreviewService, basePort: number, reserved: Set<number>): Promise<number | undefined> {
    if (service.ready.type === 'http' || service.ready.type === 'tcp') {
      const explicitPort = service.ready.type === 'http'
        ? parseUrlPort(service.ready.url)
        : typeof service.ready.port === 'number'
          ? service.ready.port
          : undefined;

      if (explicitPort) {
        reserved.add(explicitPort);
        return explicitPort;
      }

      return await findFreePort(basePort + reserved.size, reserved);
    }

    return undefined;
  }

  private resolveReadyCheck(ready: ReadyCheck, env: Record<string, string | undefined>): ReadyCheck {
    if (ready.type === 'http') {
      return {
        ...ready,
        url: interpolateTemplate(ready.url, env)
      };
    }
    if (ready.type === 'tcp') {
      return {
        ...ready,
        host: interpolateTemplate(ready.host, env),
        port: typeof ready.port === 'string'
          ? interpolateTemplate(ready.port, env)
          : ready.port
      };
    }
    if (ready.type === 'stdout_marker') {
      return {
        ...ready,
        marker: interpolateTemplate(ready.marker, env)
      };
    }
    return ready;
  }

  private async startPreparedServices(runId: number, preparedServices: PreparedPreviewService[]): Promise<void> {
    const readyIds = new Set<string>();

    for (const prepared of preparedServices) {
      if (!this.isCurrentRun(runId)) {
        return;
      }

      const unmetDependency = (prepared.service.dependsOn ?? []).find((dependency) => !readyIds.has(dependency));
      if (unmetDependency) {
        await this.failRun(runId, `Preview service "${prepared.service.id}" depends on "${unmetDependency}" before it is ready`, prepared.service.id);
        return;
      }

      try {
        await this.spawnAndAwaitService(runId, prepared);
      } catch (error) {
        if (this.stopRequestedRunId === runId) {
          return;
        }
        await this.failRun(
          runId,
          error instanceof Error ? error.message : String(error),
          prepared.service.id
        );
        return;
      }

      readyIds.add(prepared.service.id);
    }

    if (!this.isCurrentRun(runId) || this.stopRequestedRunId === runId) {
      return;
    }

    const primary = (this.state.services ?? []).find((service) => service.expose === 'primary')
      ?? this.state.services?.[0];
    const now = Date.now();
    this.state = {
      ...this.state,
      active: true,
      status: 'ready',
      url: primary?.url ?? this.state.url,
      port: primary?.port ?? this.state.port,
      pid: primary?.pid ?? this.state.pid,
      error: undefined,
      updatedAt: now
    };
    this.pushLog(`Preview stack ready${this.state.url ? ` at ${this.state.url}` : ''}`);
  }

  private async spawnAndAwaitService(runId: number, prepared: PreparedPreviewService): Promise<void> {
    const child = this.spawnServiceProcess(runId, prepared);
    this.processes.set(prepared.service.id, child);

    this.updateServiceState(prepared.service.id, {
      pid: child.pid,
      startedAt: Date.now(),
      updatedAt: Date.now()
    });

    const readyResult = await this.waitForServiceReady(runId, prepared, child);
    if (!this.isCurrentRun(runId)) {
      return;
    }

    const now = Date.now();
    this.updateServiceState(prepared.service.id, {
      status: 'ready',
      url: readyResult.url,
      port: readyResult.port ?? prepared.allocatedPort,
      error: undefined,
      updatedAt: now
    });

    if (prepared.service.expose === 'primary' || !(this.state.url)) {
      this.state = {
        ...this.state,
        url: readyResult.url ?? this.state.url,
        port: readyResult.port ?? prepared.allocatedPort ?? this.state.port,
        pid: child.pid,
        updatedAt: now
      };
    }

    this.pushLog(`Service ${prepared.service.id} ready${readyResult.url ? ` at ${readyResult.url}` : ''}`);
  }

  private spawnServiceProcess(runId: number, prepared: PreparedPreviewService): ChildProcess {
    const baseSpec = process.platform === 'win32'
      ? {
        command: prepared.command,
        args: [] as string[],
        cwd: prepared.cwd,
        env: prepared.env,
        shell: true
      }
      : {
        command: '/bin/sh',
        args: ['-c', prepared.command],
        cwd: prepared.cwd,
        env: prepared.env,
        shell: false
      };

    const wrapped = maybeWrapSpawnSpecForStrictWorkspaceWrites({
      workspaceRoot: this.state.rootPath ?? prepared.cwd,
      ...baseSpec
    });

    const child = spawn(wrapped.command, wrapped.args, {
      cwd: wrapped.cwd,
      shell: wrapped.shell,
      env: wrapped.env
    });

    this.pushLog(`Starting service ${prepared.service.id}: ${prepared.command}`);
    if (prepared.cwd !== (this.state.rootPath ?? prepared.cwd)) {
      this.pushLog(`Service ${prepared.service.id} run dir: ${prepared.cwd}`);
    }
    if (prepared.allocatedPort) {
      this.pushLog(`Service ${prepared.service.id} port: ${prepared.allocatedPort}`);
    }

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
          this.handleOutputLine(runId, prepared.service.id, line, source);
        }
      });

      stream.on('end', () => {
        const line = normalizeLine(pending);
        if (line) {
          this.handleOutputLine(runId, prepared.service.id, line, source);
        }
      });
    };

    attachOutput(child.stdout, 'stdout');
    attachOutput(child.stderr, 'stderr');

    child.on('error', (error) => {
      if (!this.isCurrentRun(runId)) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.pushLog(`Service ${prepared.service.id} process error: ${message}`);
      this.updateServiceState(prepared.service.id, {
        status: 'error',
        error: message,
        updatedAt: Date.now()
      });
      this.rejectStdoutWaiter(prepared.service.id, new Error(message));
    });

    child.on('exit', (code, signal) => {
      if (!this.isCurrentRun(runId)) {
        return;
      }

      const stoppedByRequest = this.stopRequestedRunId === runId;
      const message = signal
        ? `Service ${prepared.service.id} exited by signal ${signal}`
        : typeof code === 'number'
          ? `Service ${prepared.service.id} exited with code ${code}`
          : `Service ${prepared.service.id} exited`;

      this.pushLog(message);
      this.processes.delete(prepared.service.id);
      this.rejectStdoutWaiter(prepared.service.id, new Error(message));

      const serviceState = this.getServiceState(prepared.service.id);
      const nextStatus: PreviewServiceStatus = stoppedByRequest
        ? 'stopped'
        : (serviceState?.status === 'ready' && code === 0)
          ? 'stopped'
          : 'error';

      this.updateServiceState(prepared.service.id, {
        status: nextStatus,
        error: nextStatus === 'error' ? message : undefined,
        updatedAt: Date.now()
      });

      if (!stoppedByRequest && this.state.status !== 'error') {
        void this.failRun(runId, message, prepared.service.id);
      }
    });

    return child;
  }

  private async waitForServiceReady(runId: number, prepared: PreparedPreviewService, child: ChildProcess): Promise<{ url?: string; port?: number }> {
    if (prepared.ready.type === 'process_alive') {
      const timeoutMs = Math.min((prepared.ready.timeoutSec ?? 1) * 1000, 500);
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (!this.isCurrentRun(runId)) {
          throw new Error(`Preview run canceled while waiting for service "${prepared.service.id}"`);
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Service "${prepared.service.id}" exited before process_alive readiness`);
        }
        await sleep(100);
      }
      return { port: prepared.allocatedPort };
    }

    if (prepared.ready.type === 'stdout_marker') {
      const ready = prepared.ready;
      return await new Promise<{ url?: string; port?: number }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.serviceReadyWaiters.delete(prepared.service.id);
          reject(new Error(`Timed out waiting for stdout marker for service "${prepared.service.id}"`));
        }, (ready.timeoutSec ?? 60) * 1000);
        timeout.unref();

        this.serviceReadyWaiters.set(prepared.service.id, {
          marker: ready.marker,
          resolve: (result) => {
            clearTimeout(timeout);
            this.serviceReadyWaiters.delete(prepared.service.id);
            resolve(result ?? { port: prepared.allocatedPort });
          },
          reject: (error) => {
            clearTimeout(timeout);
            this.serviceReadyWaiters.delete(prepared.service.id);
            reject(error);
          },
          timeout
        });
      });
    }

    if (prepared.ready.type === 'http') {
      const deadline = Date.now() + ((prepared.ready.timeoutSec ?? 60) * 1000);
      while (Date.now() < deadline) {
        if (!this.isCurrentRun(runId)) {
          throw new Error(`Preview run canceled while waiting for service "${prepared.service.id}"`);
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Service "${prepared.service.id}" exited before HTTP readiness`);
        }
        try {
          const response = await fetch(prepared.ready.url);
          if (response.status === (prepared.ready.expectStatus ?? 200)) {
            return {
              url: prepared.ready.url,
              port: parseUrlPort(prepared.ready.url)
            };
          }
        } catch {
        }
        await sleep(250);
      }
      throw new Error(`Timed out waiting for HTTP readiness for service "${prepared.service.id}" at ${prepared.ready.url}`);
    }

    const host = prepared.ready.host;
    const port = typeof prepared.ready.port === 'number'
      ? prepared.ready.port
      : Number.parseInt(prepared.ready.port, 10);

    if (!Number.isFinite(port)) {
      throw new Error(`Invalid TCP readiness port for service "${prepared.service.id}"`);
    }

    const deadline = Date.now() + ((prepared.ready.timeoutSec ?? 60) * 1000);
    while (Date.now() < deadline) {
      if (!this.isCurrentRun(runId)) {
        throw new Error(`Preview run canceled while waiting for service "${prepared.service.id}"`);
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Service "${prepared.service.id}" exited before TCP readiness`);
      }

      const connected = await new Promise<boolean>((resolveConnection) => {
        const socket = createConnection({ host, port });
        socket.once('connect', () => {
          socket.destroy();
          resolveConnection(true);
        });
        socket.once('error', () => {
          socket.destroy();
          resolveConnection(false);
        });
      });

      if (connected) {
        return { port };
      }
      await sleep(250);
    }

    throw new Error(`Timed out waiting for TCP readiness for service "${prepared.service.id}" at ${host}:${port}`);
  }

  private async failRun(runId: number, error: string, serviceId?: string): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    this.pushLog(`Preview stack failed${serviceId ? ` at ${serviceId}` : ''}: ${error}`);

    const now = Date.now();
    this.state = {
      ...this.state,
      active: false,
      status: 'error',
      error,
      updatedAt: now
    };

    if (serviceId) {
      this.updateServiceState(serviceId, {
        status: 'error',
        error,
        updatedAt: now
      });
    }

    const processes = [...this.processes.values()];
    for (const processToStop of processes) {
      try {
        processToStop.kill('SIGTERM');
      } catch {
      }
    }
  }

  private handleOutputLine(runId: number, serviceId: string, line: string, source: 'stdout' | 'stderr'): void {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    this.pushLog(`${serviceId} ${source}: ${line}`);

    const waiter = this.serviceReadyWaiters.get(serviceId);
    if (waiter && line.includes(waiter.marker)) {
      const url = line.match(URL_PATTERN)?.[1]?.trim();
      waiter.resolve({
        url,
        port: url ? parseUrlPort(url) : undefined
      });
    }
  }

  private getServiceState(serviceId: string): PreviewServiceState | undefined {
    return this.state.services?.find((service) => service.id === serviceId);
  }

  private updateServiceState(serviceId: string, patch: Partial<PreviewServiceState>): void {
    if (!Array.isArray(this.state.services)) {
      return;
    }

    this.state = {
      ...this.state,
      services: this.state.services.map((service) => {
        if (service.id !== serviceId) {
          return service;
        }
        return {
          ...service,
          ...patch
        };
      }),
      updatedAt: Date.now()
    };
  }

  private rejectStdoutWaiter(serviceId: string, error: Error): void {
    const waiter = this.serviceReadyWaiters.get(serviceId);
    if (!waiter) {
      return;
    }
    clearTimeout(waiter.timeout);
    this.serviceReadyWaiters.delete(serviceId);
    waiter.reject(error);
  }

  private isCurrentRun(runId: number): boolean {
    return runId === this.runId;
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
