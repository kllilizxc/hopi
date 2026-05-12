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

function createLegacyGoalDbWithoutGoalKey(path: string, userVersion = 22): void {
    const db = new Database(path, { create: true, readwrite: true, strict: true })
    db.exec(`PRAGMA user_version = ${userVersion}`)
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
            automation_lane_limits TEXT,
            automation_backstop_policy TEXT,
            agent_output_language TEXT NOT NULL DEFAULT 'system',
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

        CREATE TABLE goals (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'planning',
            success_criteria TEXT,
            autopilot_enabled INTEGER NOT NULL DEFAULT 0,
            deploy_requires_approval INTEGER NOT NULL DEFAULT 1,
            current_focus TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            archived_at INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
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
            goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
            contract TEXT,
            handoff TEXT,
            evidence TEXT,
            sub_tasks TEXT,
            sub_tasks_updated_at INTEGER,
            worktree_merged_at INTEGER,
            worktree_merge_commit TEXT,
            merged_diff_snapshot TEXT,
            merge_runtime TEXT,
            preview_runtime TEXT,
            init_runtime TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER,
            archived_at INTEGER
        );
    `)
    const now = Date.now()
    db.prepare(
        'INSERT INTO projects (id, namespace, machine_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('p-goal-key', 'default', 'm1', 'Project', now, now)
    db.prepare(
        'INSERT INTO goals (id, project_id, namespace, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('g1', 'p-goal-key', 'default', 'Portable Goal', 'active', now, now)
    db.prepare(
        'INSERT INTO goals (id, project_id, namespace, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('g2', 'p-goal-key', 'default', 'Portable Goal', 'planning', now + 1, now + 1)
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
        expect(userVersion.user_version).toBe(29)

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
        expect(userVersion.user_version).toBe(29)

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
        expect(taskColumns).toContain('goal_todo_ref')
        expect(taskColumns).toContain('contract')
        expect(taskColumns).toContain('handoff')
        expect(taskColumns).toContain('evidence')
        expect(taskColumns).toContain('init_runtime')
        const projectColumns = (db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map((column) => column.name)
        expect(projectColumns).toContain('automation_lane_limits')
        expect(projectColumns).toContain('automation_backstop_policy')
        expect(projectColumns).toContain('agent_output_language')
        const goalColumns = (db.prepare('PRAGMA table_info(goals)').all() as Array<{ name: string }>).map((column) => column.name)
        expect(goalColumns).toContain('automation_paused_at')

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
        expect(userVersion.user_version).toBe(29)

        const project = store.projects.createProject({
            id: 'goal-project',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Goal Project',
            agentOutputLanguage: 'zh-CN'
        })
        expect(project.agentOutputLanguage).toBe('zh-CN')
        const updatedProject = store.projects.updateProject(project.id, 'default', {
            agentOutputLanguage: 'en',
            automationBackstopPolicy: {
                maxHoursWithoutMilestone: 36,
                maxGeneratorTasksWithoutMilestone: 80,
                maxPlannerRefillsWithoutMilestone: 16
            }
        })
        expect(updatedProject?.agentOutputLanguage).toBe('en')
        expect(updatedProject?.automationBackstopPolicy).toEqual({
            maxHoursWithoutMilestone: 36,
            maxGeneratorTasksWithoutMilestone: 80,
            maxPlannerRefillsWithoutMilestone: 16
        })
        const goal = store.goals.createGoal({
            id: 'goal-1',
            projectId: project.id,
            namespace: 'default',
            title: 'Ship autopilot foundation'
        })
        expect(goal.goalKey).toBe('ship-autopilot-foundation')
        expect(store.goals.getGoalByGoalKeyAndNamespace(project.id, 'default', goal.goalKey)?.id).toBe(goal.id)
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
            goalTodoRef: 'Implement store layer',
            contract: 'Add SQLite goal persistence',
            handoff: 'Store APIs ready',
            evidence: 'Migration smoke test'
        })

        expect(topic.status).toBe('waiting')
        expect(topic.blocking).toBe(true)
        expect(task.goalId).toBe(goal.id)
        expect(task.goalTodoRef).toBe('Implement store layer')
        expect(task.contract).toBe('Add SQLite goal persistence')
        expect(task.handoff).toBe('Store APIs ready')
        expect(task.evidence).toBe('Migration smoke test')
        expect(store.tasks.listTasksByProject(project.id, { goalId: goal.id })).toHaveLength(1)
        expect(store.tasks.listTasksByProject(project.id)).toHaveLength(1)

        db.close()
    })

    it('adds goal_key to current goal tables and enforces per-project uniqueness', () => {
        const path = join(tmpdir(), `hopi-schema-goal-key-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)

        const store = new Store(path)
        const db = (store as unknown as { db: Database }).db
        const goalColumns = (db.prepare('PRAGMA table_info(goals)').all() as Array<{ name: string }>).map((column) => column.name)
        expect(goalColumns).toContain('goal_key')
        expect(goalColumns).toContain('automation_paused_at')

        const project = store.projects.createProject({
            id: 'goal-key-project',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Goal Key Project'
        })
        const first = store.goals.createGoal({
            id: 'goal-key-1',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'portable-goal',
            title: 'Portable Goal'
        })

        expect(first.goalKey).toBe('portable-goal')
        expect(store.goals.getGoalByGoalKeyAndNamespace(project.id, 'default', 'portable-goal')?.id).toBe(first.id)
        expect(() => store.goals.createGoal({
            id: 'goal-key-2',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'portable-goal',
            title: 'Duplicate Portable Goal'
        })).toThrow()

        db.close()
    })

    it('clears legacy generated task runtime defaults so project defaults can apply', () => {
        const path = join(tmpdir(), `hopi-schema-generated-task-defaults-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)

        const seedStore = new Store(path)
        const project = seedStore.projects.createProject({
            id: 'project-generated-defaults',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Generated Defaults'
        })
        seedStore.tasks.createTask({
            id: 'task-generated',
            projectId: project.id,
            title: 'Generated task',
            status: 'planned',
            source: 'manual',
            sourceTaskId: 'task-planner',
            agentFlavor: 'codex',
            permissionMode: 'safe-yolo',
            model: 'gpt-5.5',
            modelMode: null
        })
        seedStore.tasks.createTask({
            id: 'task-planner',
            projectId: project.id,
            title: 'Planner task',
            status: 'planned',
            source: 'planner',
            agentFlavor: 'codex',
            permissionMode: 'safe-yolo',
            model: 'gpt-5.5',
            modelMode: null
        })
        seedStore.tasks.createTask({
            id: 'task-manual',
            projectId: project.id,
            title: 'Manual task',
            status: 'planned',
            source: 'manual',
            agentFlavor: 'codex',
            permissionMode: 'safe-yolo',
            model: 'gpt-5.5',
            modelMode: null
        })
        const seedDb = (seedStore as unknown as { db: Database }).db
        seedDb.exec('PRAGMA user_version = 26')
        seedDb.close()

        const migratedStore = new Store(path)
        const generated = migratedStore.tasks.getTaskByNamespace('task-generated', 'default')
        expect(generated?.agentFlavor).toBeNull()
        expect(generated?.model).toBeNull()
        expect(generated?.modelMode).toBeNull()
        expect(generated?.permissionMode).toBe('safe-yolo')

        const planner = migratedStore.tasks.getTaskByNamespace('task-planner', 'default')
        expect(planner?.agentFlavor).toBeNull()
        expect(planner?.model).toBeNull()

        const manual = migratedStore.tasks.getTaskByNamespace('task-manual', 'default')
        expect(manual?.agentFlavor).toBe('codex')
        expect(manual?.model).toBe('gpt-5.5')

        const migratedDb = (migratedStore as unknown as { db: Database }).db
        const userVersion = migratedDb.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(userVersion.user_version).toBe(29)
        migratedDb.close()
    })

    it('moves merge-blocked tasks into blocked status during migration', () => {
        const path = join(tmpdir(), `hopi-schema-merge-blocked-status-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)

        const seedStore = new Store(path)
        const project = seedStore.projects.createProject({
            id: 'project-merge-blocked',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Merge Blocked'
        })
        seedStore.tasks.createTask({
            id: 'task-merge-blocked',
            projectId: project.id,
            title: 'Merge blocked task',
            status: 'in_review',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'session-merge',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 2,
                failureFingerprint: 'merge-conflict',
                latestNote: 'Auto-merge blocked: conflicts persisted.',
                blockedReason: 'conflicts persisted'
            }
        })
        seedStore.tasks.updateTaskByNamespace('task-merge-blocked', 'default', { finishedAt: Date.now() })
        seedStore.tasks.createTask({
            id: 'task-review',
            projectId: project.id,
            title: 'Review task',
            status: 'in_review',
            mergeRuntime: {
                status: 'running',
                sessionId: 'session-running',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: null,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Merge running.',
                blockedReason: null
            }
        })
        seedStore.tasks.createTask({
            id: 'task-preview-blocked',
            projectId: project.id,
            title: 'Preview blocked task',
            status: 'running',
            previewRuntime: {
                status: 'blocked',
                sessionId: 'session-preview',
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 20,
                completedAt: 30,
                retryCount: 1,
                failureFingerprint: 'preview-crash',
                latestNote: 'Preview blocked.',
                blockedReason: 'preview crashed'
            }
        })
        const quotaSession = seedStore.sessions.getOrCreateSession('quota-session', {
            path: '/tmp/quota',
            host: 'test',
            projectId: project.id,
            taskId: 'task-quota-blocked'
        }, null, 'default')
        seedStore.tasks.createTask({
            id: 'task-quota-blocked',
            projectId: project.id,
            title: 'Quota blocked task',
            status: 'blocked',
            activeSessionId: quotaSession.id
        })
        seedStore.messages.addMessage(quotaSession.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'error',
                    message: 'Task failed: Codex usage limit reached. Switch model or retry later.',
                    reason: 'task-failed'
                }
            }
        })
        seedStore.messages.addMessage(quotaSession.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'error',
                    message: 'Task failed. Check logs for details.',
                    reason: 'task-failed'
                }
            }
        })
        const seedDb = (seedStore as unknown as { db: Database }).db
        seedDb.exec('PRAGMA user_version = 27')
        seedDb.close()

        const migratedStore = new Store(path)
        const blocked = migratedStore.tasks.getTaskByNamespace('task-merge-blocked', 'default')
        expect(blocked?.status).toBe('blocked')
        expect(blocked?.finishedAt).toBeNull()
        expect(blocked?.blockedReason).toBe('conflicts persisted')
        expect(blocked?.blockedSource).toBe('merge')
        expect(blocked?.blockedSessionId).toBe('session-merge')
        expect(blocked?.blockedAt).toBeTypeOf('number')

        const review = migratedStore.tasks.getTaskByNamespace('task-review', 'default')
        expect(review?.status).toBe('in_review')

        const previewBlocked = migratedStore.tasks.getTaskByNamespace('task-preview-blocked', 'default')
        expect(previewBlocked?.status).toBe('blocked')
        expect(previewBlocked?.finishedAt).toBeNull()
        expect(previewBlocked?.blockedReason).toBe('preview crashed')
        expect(previewBlocked?.blockedSource).toBe('preview')
        expect(previewBlocked?.blockedSessionId).toBe('session-preview')
        expect(previewBlocked?.blockedAt).toBeTypeOf('number')

        const quotaBlocked = migratedStore.tasks.getTaskByNamespace('task-quota-blocked', 'default')
        expect(quotaBlocked?.blockedReason).toBe('Task failed: Codex usage limit reached. Switch model or retry later.')
        expect(quotaBlocked?.blockedSource).toBe('agent')
        expect(quotaBlocked?.blockedSessionId).toBe(quotaSession.id)

        const migratedDb = (migratedStore as unknown as { db: Database }).db
        const userVersion = migratedDb.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(userVersion.user_version).toBe(29)
        migratedDb.close()
    })

    it('backfills goal_key when an existing goal table predates portable keys', () => {
        const path = join(tmpdir(), `hopi-schema-existing-goal-key-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)
        createLegacyGoalDbWithoutGoalKey(path)

        const store = new Store(path)
        const db = (store as unknown as { db: Database }).db
        const goalColumns = (db.prepare('PRAGMA table_info(goals)').all() as Array<{ name: string }>).map((column) => column.name)
        expect(goalColumns).toContain('goal_key')

        const rows = db.prepare(`
            SELECT id, goal_key
            FROM goals
            ORDER BY created_at ASC
        `).all() as Array<{ id: string; goal_key: string }>
        expect(rows).toEqual([
            { id: 'g1', goal_key: 'portable-goal' },
            { id: 'g2', goal_key: 'portable-goal-2' }
        ])
        expect(store.goals.getGoalByGoalKeyAndNamespace('p-goal-key', 'default', 'portable-goal')?.id).toBe('g1')

        const userVersion = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(userVersion.user_version).toBe(29)

        db.close()
    })

    it('backfills goal_key before creating current indexes on unversioned legacy goal tables', () => {
        const path = join(tmpdir(), `hopi-schema-unversioned-goal-key-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
        createdPaths.push(path)
        createLegacyGoalDbWithoutGoalKey(path, 0)

        const store = new Store(path)
        const db = (store as unknown as { db: Database }).db
        const rows = db.prepare(`
            SELECT id, goal_key
            FROM goals
            ORDER BY created_at ASC
        `).all() as Array<{ id: string; goal_key: string }>

        expect(rows).toEqual([
            { id: 'g1', goal_key: 'portable-goal' },
            { id: 'g2', goal_key: 'portable-goal-2' }
        ])

        db.close()
    })
})
