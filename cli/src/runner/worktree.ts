import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { PRODUCT_SLUG } from '@hopi/protocol/brand';
import { resolveGitExecutable } from '@/utils/resolveGitExecutable';

const execFileAsync = promisify(execFile);

export type WorktreeInfo = {
  basePath: string;
  worktreePath: string;
  branch: string;
  name: string;
  createdAt: number;
  baseCommit?: string;
};

type WorktreeResult =
  | { ok: true; info: WorktreeInfo }
  | { ok: false; error: string };

export type RemoveWorktreeResult =
  | { ok: true }
  | { ok: false; error: string };

const MAX_ATTEMPTS = 5;

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const gitCommand = resolveGitExecutable(process.env);
    const result = await execFileAsync(gitCommand, args, { cwd });
    return {
      stdout: result.stdout ? result.stdout.toString() : '',
      stderr: result.stderr ? result.stderr.toString() : ''
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const stderr = execError.stderr ? execError.stderr.toString() : '';
    const stdout = execError.stdout ? execError.stdout.toString() : '';
    const message = stderr.trim() || stdout.trim() || execError.message || 'Git command failed';
    throw new Error(message);
  }
}

async function resolveRepoRoot(basePath: string): Promise<string> {
  const result = await runGit(['rev-parse', '--show-toplevel'], basePath);
  const root = result.stdout.trim();
  if (!root) {
    throw new Error('Unable to resolve Git repository root.');
  }
  return root;
}

export async function resolveGitRepoRoot(basePath: string): Promise<string> {
  return await resolveRepoRoot(basePath);
}

async function resolveHeadCommit(repoRoot: string): Promise<string | undefined> {
    try {
        const result = await runGit(['rev-parse', '--verify', 'HEAD'], repoRoot);
        const commit = result.stdout.trim();
        if (/^[0-9a-f]{40}$/i.test(commit)) {
      return commit;
    }
  } catch {
  }
  return undefined;
}

async function resolveRefCommit(repoRoot: string, ref?: string): Promise<string | undefined> {
  if (!ref) {
    return await resolveHeadCommit(repoRoot);
  }

  try {
    const result = await runGit(['rev-parse', '--verify', ref], repoRoot);
    const commit = result.stdout.trim();
    if (/^[0-9a-f]{40}$/i.test(commit)) {
      return commit;
    }
  } catch {
  }
  return undefined;
}

function toSlug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned;
}

function formatDatePrefix(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}${day}`;
}

function normalizeNameHint(nameHint?: string): string | null {
  if (!nameHint) {
    return null;
  }
  const trimmed = nameHint.trim();
  if (!trimmed) {
    return null;
  }
  const slug = toSlug(trimmed);
  return slug ? slug : null;
}

function makeDefaultBaseName(): string {
  const suffix = randomBytes(2).toString('hex');
  return `${formatDatePrefix()}-${suffix}`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await runGit(['show-ref', '--verify', `refs/heads/${branch}`], repoRoot);
    return true;
  } catch {
    return false;
  }
}

export async function createWorktree(options: {
  basePath: string;
  nameHint?: string;
  worktreeRootDir?: string;
  baseBranch?: string;
}): Promise<WorktreeResult> {
  const { basePath, nameHint, worktreeRootDir } = options;
  const baseBranch = options.baseBranch?.trim() || undefined;
  let repoRoot: string;
  let baseCommit: string | undefined;

  try {
    repoRoot = await resolveRepoRoot(basePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Path is not a Git repository: ${message}`
    };
  }

  if (baseBranch && !(await branchExists(repoRoot, baseBranch))) {
    return {
      ok: false,
      error: `Failed to create worktree: target branch '${baseBranch}' not found in repository`
    };
  }

  baseCommit = await resolveRefCommit(repoRoot, baseBranch);

  const repoParent = dirname(repoRoot);
  const repoName = basename(repoRoot);
  const repoWorktreesRoot = worktreeRootDir?.trim()
    ? worktreeRootDir.trim()
    : join(repoParent, `${repoName}-worktrees`);
  await mkdir(repoWorktreesRoot, { recursive: true });

  const baseName = normalizeNameHint(nameHint) ?? makeDefaultBaseName();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const name = attempt === 0 ? baseName : `${baseName}-${randomBytes(2).toString('hex')}`;
    const branch = `${PRODUCT_SLUG}-${name}`;
    const worktreePath = join(repoWorktreesRoot, name);

    if (await pathExists(worktreePath)) {
      continue;
    }

    if (await branchExists(repoRoot, branch)) {
      continue;
    }

    try {
      const addArgs = ['worktree', 'add', '-b', branch, worktreePath];
      if (baseBranch) {
        addArgs.push(baseBranch);
      }
      await runGit(addArgs, repoRoot);
      return {
        ok: true,
        info: {
          basePath: repoRoot,
          worktreePath,
          branch,
          name,
          createdAt: Date.now(),
          baseCommit
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `Failed to create worktree: ${message}`
      };
    }
  }

  return {
    ok: false,
    error: 'Failed to create worktree after multiple attempts. Try again.'
  };
}

export async function removeWorktree(options: {
  repoRoot: string;
  worktreePath: string;
}): Promise<RemoveWorktreeResult> {
  try {
    await runGit(['worktree', 'remove', '--force', options.worktreePath], options.repoRoot);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
