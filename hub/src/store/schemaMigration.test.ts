import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const createdPaths: string[] = []

function createLegacyV5DbMissingWorktreeColumns(path: string): void {
    const db = new Database(path, { create: true, readwrite: true, strict: true })
    db.exec('PRAGMA user_version = 5')
    db.exec(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            tag TEXT,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            agent_state TEXT,
            agent_state_version INTEGER DEFAULT 1,
            todos TEXT,
            todos_updated_at INTEGER,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );

        CREATE TABLE machines (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            runner_state TEXT,
            runner_state_version INTEGER DEFAULT 1,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );

        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            local_id TEXT
        );

        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            UNIQUE(platform, platform_user_id)
        );

        CREATE TABLE push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(namespace, endpoint)
        );

        CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            default_workspace_id TEXT,
            default_agent_flavor TEXT,
            default_permission_mode TEXT,
            default_model_mode TEXT,
            auto_run_enabled INTEGER NOT NULL DEFAULT 0,
            max_running_sessions INTEGER NOT NULL DEFAULT 5,
            improvements_enabled INTEGER NOT NULL DEFAULT 0,
            improvements_max_generated_new INTEGER NOT NULL DEFAULT 5,
            last_improvements_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            archived_at INTEGER
        );

        CREATE TABLE workspaces (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            label TEXT,
            path TEXT NOT NULL,
            sort INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL,
            priority TEXT,
            sort_key REAL,
            active_session_id TEXT,
            workspace_id TEXT,
            attachments TEXT,
            source TEXT,
            source_task_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER,
            archived_at INTEGER
        );
    `)
    const now = Date.now()
    db.prepare(
        'INSERT INTO projects (id, namespace, machine_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('p1', 'default', 'm1', 'Project', now, now)
    db.prepare(
        'INSERT INTO tasks (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('t1', 'p1', 'Task', 'new', now, now)
    db.close()
}

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (!path) continue
        if (existsSync(path)) {
            try {
                rmSync(path)
            } catch {
            }
        }
    }
})

describe('Store schema migration safety', () => {
    it('adds missing worktree columns even when user_version is already 5', () => {
        const path = join(tmpdir(), `hopi-schema-migration-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)
        createLegacyV5DbMissingWorktreeColumns(path)

        const store = new Store(path)
        const updated = store.projects.updateProject('p1', 'default', {
            defaultWorkspaceId: 'w1',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main',
            worktreeAutoCommitMode: 'per_conversation',
            worktreeCleanupAfterMerge: true
        })

        expect(updated?.defaultWorkspaceId).toBe('w1')
        expect(updated?.defaultSessionType).toBe('worktree')
        expect(updated?.worktreeTargetBranch).toBe('main')
        expect(updated?.worktreeAutoCommitMode).toBe('per_conversation')
        expect(updated?.worktreeCleanupAfterMerge).toBe(true)

        const updatedTask = store.tasks.updateTaskByNamespace('t1', 'default', {
            worktreeMergedAt: Date.now(),
            worktreeMergeCommit: 'abc123',
            agentFlavor: 'codex',
            subTasks: [{ id: 'st1', content: 'subtask', status: 'pending', priority: 'medium' }],
            subTasksUpdatedAt: Date.now(),
            permissionMode: 'plan',
            mergeRuntime: {
                status: 'queued',
                sessionId: 'session-migrated',
                updatedAt: Date.now(),
                latestNote: 'queueing merge'
            }
        })
        expect(updatedTask?.worktreeMergedAt).toBeTypeOf('number')
        expect(updatedTask?.worktreeMergeCommit).toBe('abc123')
        expect(updatedTask?.agentFlavor).toBe('codex')
        expect(updatedTask?.subTasks).toEqual([{ id: 'st1', content: 'subtask', status: 'pending', priority: 'medium' }])
        expect(updatedTask?.subTasksUpdatedAt).toBeTypeOf('number')
        expect(updatedTask?.permissionMode).toBe('plan')
        expect(updatedTask?.mergeRuntime).toMatchObject({
            status: 'queued',
            sessionId: 'session-migrated',
            latestNote: 'queueing merge'
        })

        const taskColumns = ((store as unknown as { db: Database }).db.prepare('PRAGMA table_info(tasks)').all() as Array<{
            name: string
        }>).map((column) => column.name)
        expect(taskColumns).toContain('merge_runtime')

            ; (store as unknown as { db: Database }).db.close()
    })
})
