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

function createLegacyV9DbMissingPreviewRuntime(path: string): void {
    const db = new Database(path, { create: true, readwrite: true, strict: true })
    db.exec('PRAGMA user_version = 9')
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
            default_model TEXT,
            default_model_mode TEXT,
            default_session_type TEXT NOT NULL DEFAULT 'simple',
            worktree_target_branch TEXT,
            worktree_auto_commit_mode TEXT NOT NULL DEFAULT 'off',
            worktree_cleanup_after_merge INTEGER NOT NULL DEFAULT 0,
            auto_run_enabled INTEGER NOT NULL DEFAULT 0,
            max_running_sessions INTEGER NOT NULL DEFAULT 5,
            improvements_enabled INTEGER NOT NULL DEFAULT 0,
            improvements_max_pending_tasks INTEGER NOT NULL DEFAULT 5,
            workflow_profile TEXT,
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
            agent_flavor TEXT,
            permission_mode TEXT,
            model TEXT,
            model_mode TEXT,
            attachments TEXT,
            source TEXT,
            source_task_id TEXT,
            workflow_profile TEXT,
            workflow_phase TEXT,
            sub_tasks TEXT,
            sub_tasks_updated_at INTEGER,
            worktree_merged_at INTEGER,
            worktree_merge_commit TEXT,
            merged_diff_snapshot TEXT,
            merge_runtime TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER,
            archived_at INTEGER
        );
    `)
    const now = Date.now()
    db.prepare(
        'INSERT INTO projects (id, namespace, machine_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('p-preview', 'default', 'm1', 'Project', now, now)
    db.prepare(
        'INSERT INTO tasks (id, project_id, title, status, workflow_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('t-preview', 'p-preview', 'Task', 'planned', 'default', now, now)
    db.close()
}

function createLegacyV10DbMissingInitRuntime(path: string): void {
    const db = new Database(path, { create: true, readwrite: true, strict: true })
    db.exec('PRAGMA user_version = 10')
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
            default_model TEXT,
            default_model_mode TEXT,
            default_session_type TEXT NOT NULL DEFAULT 'simple',
            worktree_target_branch TEXT,
            worktree_auto_commit_mode TEXT NOT NULL DEFAULT 'off',
            worktree_cleanup_after_merge INTEGER NOT NULL DEFAULT 0,
            auto_run_enabled INTEGER NOT NULL DEFAULT 0,
            max_running_sessions INTEGER NOT NULL DEFAULT 5,
            improvements_enabled INTEGER NOT NULL DEFAULT 0,
            improvements_max_pending_tasks INTEGER NOT NULL DEFAULT 5,
            workflow_profile TEXT,
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
            agent_flavor TEXT,
            permission_mode TEXT,
            model TEXT,
            model_mode TEXT,
            attachments TEXT,
            source TEXT,
            source_task_id TEXT,
            workflow_profile TEXT,
            workflow_phase TEXT,
            sub_tasks TEXT,
            sub_tasks_updated_at INTEGER,
            worktree_merged_at INTEGER,
            worktree_merge_commit TEXT,
            merged_diff_snapshot TEXT,
            merge_runtime TEXT,
            preview_runtime TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER,
            archived_at INTEGER
        );
    `)
    const now = Date.now()
    db.prepare(
        'INSERT INTO projects (id, namespace, machine_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('p-init', 'default', 'm1', 'Project', now, now)
    db.prepare(
        'INSERT INTO tasks (id, project_id, title, status, workflow_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('t-init', 'p-init', 'Task', 'planned', 'default', now, now)
    db.close()
}

function createLegacyV19DbMissingGoalTables(path: string): void {
    const db = new Database(path, { create: true, readwrite: true, strict: true })
    db.exec('PRAGMA user_version = 19')
    db.exec(`
        CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            default_workspace_id TEXT,
            default_agent_flavor TEXT,
            default_permission_mode TEXT,
            default_model TEXT,
            default_model_mode TEXT,
            default_session_type TEXT NOT NULL DEFAULT 'simple',
            worktree_target_branch TEXT,
            worktree_auto_commit_mode TEXT NOT NULL DEFAULT 'off',
            worktree_cleanup_after_merge INTEGER NOT NULL DEFAULT 0,
            auto_run_enabled INTEGER NOT NULL DEFAULT 0,
            max_running_sessions INTEGER NOT NULL DEFAULT 5,
            improvements_enabled INTEGER NOT NULL DEFAULT 0,
            improvements_max_pending_tasks INTEGER NOT NULL DEFAULT 5,
            automation_readiness_status TEXT NOT NULL DEFAULT 'unknown',
            automation_readiness_summary TEXT,
            automation_readiness_checked_at INTEGER,
            workflow_profile TEXT,
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
            agent_flavor TEXT,
            permission_mode TEXT,
            model TEXT,
            model_mode TEXT,
            attachments TEXT,
            source TEXT,
            source_task_id TEXT,
            workflow_profile TEXT,
            workflow_phase TEXT,
            sub_tasks TEXT,
            sub_tasks_updated_at INTEGER,
            worktree_merged_at INTEGER,
            worktree_merge_commit TEXT,
            merged_diff_snapshot TEXT,
            merge_runtime TEXT,
            preview_runtime TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER,
            archived_at INTEGER
        );
    `)
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
        expect(taskColumns).toContain('preview_runtime')
        expect(taskColumns).toContain('init_runtime')

            ; (store as unknown as { db: Database }).db.close()
    })

    it('adds preview_runtime when migrating from schema version 9', () => {
        const path = join(tmpdir(), `hopi-schema-preview-migration-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)
        createLegacyV9DbMissingPreviewRuntime(path)

        const store = new Store(path)
        const updatedTask = store.tasks.updateTaskByNamespace('t-preview', 'default', {
            activeSessionId: 'session-preview',
            previewRuntime: {
                status: 'ready',
                updatedAt: Date.now(),
                latestNote: 'preview prepared'
            }
        })

        expect(updatedTask?.previewRuntime).toMatchObject({
            status: 'ready',
            sessionId: 'session-preview',
            latestNote: 'preview prepared'
        })

        const db = (store as unknown as { db: Database }).db
        const taskColumns = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((column) => column.name)
        expect(taskColumns).toContain('preview_runtime')
        expect(taskColumns).toContain('init_runtime')

        const userVersion = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(userVersion.user_version).toBe(20)

        db.close()
    })


    it('adds init_runtime when migrating from schema version 10', () => {
        const path = join(tmpdir(), `hopi-schema-init-migration-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)
        createLegacyV10DbMissingInitRuntime(path)

        const store = new Store(path)
        const updatedTask = store.tasks.updateTaskByNamespace('t-init', 'default', {
            activeSessionId: 'session-init',
            initRuntime: {
                status: 'waiting',
                updatedAt: Date.now(),
                latestNote: 'awaiting init repair'
            }
        })

        expect(updatedTask?.initRuntime).toMatchObject({
            status: 'waiting',
            sessionId: 'session-init',
            latestNote: 'awaiting init repair'
        })

        const db = (store as unknown as { db: Database }).db
        const taskColumns = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((column) => column.name)
        expect(taskColumns).toContain('init_runtime')

        const userVersion = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(userVersion.user_version).toBe(20)

        db.close()
    })

    it('migrates schema version 19 to goal tables and task goal columns', () => {
        const path = join(tmpdir(), `hopi-schema-goal-migration-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)
        createLegacyV19DbMissingGoalTables(path)

        const store = new Store(path)
        const db = (store as unknown as { db: Database }).db

        const tableNames = (db.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name IN ('goals', 'goal_decision_topics')
        `).all() as Array<{ name: string }>).map((row) => row.name)
        expect(tableNames).toContain('goals')
        expect(tableNames).toContain('goal_decision_topics')

        const taskColumns = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((column) => column.name)
        expect(taskColumns).toContain('goal_id')
        expect(taskColumns).toContain('contract')
        expect(taskColumns).toContain('handoff')
        expect(taskColumns).toContain('evidence')
        expect(taskColumns).toContain('init_runtime')

        const taskForeignKeys = db.prepare('PRAGMA foreign_key_list(tasks)').all() as Array<{
            table: string
            from: string
            to: string
            on_delete: string
        }>
        expect(taskForeignKeys).toContainEqual(expect.objectContaining({
            table: 'goals',
            from: 'goal_id',
            to: 'id',
            on_delete: 'SET NULL'
        }))

        const userVersion = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(userVersion.user_version).toBe(20)

        const project = store.projects.createProject({
            id: 'goal-project',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Goal Project'
        })
        const goal = store.goals.createGoal({
            id: 'goal-1',
            projectId: project.id,
            namespace: 'default',
            title: 'Ship autopilot foundation'
        })
        const topic = store.goalDecisionTopics.create({
            id: 'topic-1',
            projectId: project.id,
            goalId: goal.id,
            namespace: 'default',
            title: 'Pick rollout path',
            body: 'Decide how deployment approval should work.'
        })
        const task = store.tasks.createTask({
            id: 'task-1',
            projectId: project.id,
            title: 'Implement store layer',
            status: 'planned',
            goalId: goal.id,
            contract: 'Add SQLite goal persistence',
            handoff: 'Store APIs ready',
            evidence: 'Migration smoke test'
        })

        expect(topic.status).toBe('waiting')
        expect(topic.blocking).toBe(true)
        expect(task.goalId).toBe(goal.id)
        expect(task.contract).toBe('Add SQLite goal persistence')
        expect(task.handoff).toBe('Store APIs ready')
        expect(task.evidence).toBe('Migration smoke test')
        expect(store.tasks.listTasksByProject(project.id, { goalId: goal.id })).toHaveLength(1)
        expect(store.tasks.listTasksByProject(project.id)).toHaveLength(1)

        db.close()
    })
})
