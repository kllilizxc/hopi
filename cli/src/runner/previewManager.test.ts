import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreviewManager } from './previewManager';

const cleanupDirs = new Set<string>();

async function createTempProjectDir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanupDirs.add(root);
  await mkdir(join(root, '.hopi'), { recursive: true });
  return root;
}

async function waitForPreviewStatus(manager: PreviewManager, predicate: (status: ReturnType<PreviewManager['getState']>) => boolean, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = manager.getState();
    if (predicate(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for preview state. Last state: ${JSON.stringify(manager.getState())}`);
}

afterEach(async () => {
  for (const dir of cleanupDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  cleanupDirs.clear();
});

describe('PreviewManager', () => {
  it('starts preview stack from actions manifest and exposes primary service url', async () => {
    const root = await createTempProjectDir('hopi-preview-stack-');
    const manager = new PreviewManager();
    const nodePath = process.execPath;
    const webPort = 43120;
    const webUrl = `http://127.0.0.1:${webPort}/`;

    const dbScript = 'setInterval(() => {}, 1000);';
    const webScript = [
      `console.log("WEB_READY ${webUrl}");`,
      'setInterval(() => {}, 1000);'
    ].join(' ');

    await writeFile(join(root, '.hopi', 'actions.yaml'), [
      'version: 1',
      'setup:',
      `  steps:`,
      `    - id: noop`,
      `      type: run`,
      `      cwd: .`,
      `      run: ${JSON.stringify([nodePath, '-e', 'process.exit(0)'])}`,
      'preview:',
      '  services:',
      '    - id: db',
      '      type: run',
      '      cwd: .',
      `      run: ${JSON.stringify([nodePath, '-e', dbScript])}`,
      '      ready:',
      '        type: process_alive',
      '    - id: web',
      '      type: run',
      '      cwd: .',
      '      dependsOn: ["db"]',
      `      run: ${JSON.stringify([nodePath, '-e', webScript])}`,
      '      ready:',
      '        type: stdout_marker',
      '        marker: "WEB_READY"',
      '      expose: primary',
      'merge:',
      '  targetBranch: main',
      '  strategy: squash'
    ].join('\n'), 'utf8');

    try {
      const initial = await manager.start({
        taskId: 'task-1',
        sessionId: 'session-1',
        rootPath: root,
        mode: 'local'
      });

      expect(initial.status).toBe('starting');
      const ready = await waitForPreviewStatus(manager, (state) => state.status === 'ready');
      expect(ready.url).toBe(webUrl);
      expect(ready.services?.map((service) => service.id)).toEqual(['db', 'web']);
      expect(ready.services?.every((service) => service.status === 'ready')).toBe(true);
      expect(ready.services?.find((service) => service.id === 'web')?.url).toBe(ready.url);
    } finally {
      await manager.stop();
    }
  });

  it('fails immediately when actions manifest is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hopi-preview-missing-'));
    cleanupDirs.add(root);
    const manager = new PreviewManager();

    await expect(manager.start({
      taskId: 'task-1',
      sessionId: 'session-1',
      rootPath: root,
      mode: 'local'
    })).rejects.toThrow('No preview contract found');
  });
});
