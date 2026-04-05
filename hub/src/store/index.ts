import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { OmcRuntimeStore } from '../sync/omc/runtimeStore'
import { MachineStore } from './machineStore'
import { MessageStore } from './messageStore'
import { PushStore } from './pushStore'
import { ProjectStore } from './projectStore'
import { SessionStore } from './sessionStore'
import { TaskStore } from './taskStore'
import { UserStore } from './userStore'
import { WorkspaceStore } from './workspaceStore'

export type {
    OmcAttemptRow,
    OmcEvidenceRow,
    OmcPlanningRunRow,
    OmcPlanRuntimeRow,
    OmcProgramRow,
    StoredMachine,
    StoredMessage,
    StoredProject,
    StoredPushSubscription,
    StoredSession,
    StoredTask,
    StoredUser,
    StoredWorkspace,
    VersionedUpdateResult
} from './types'
export { MachineStore } from './machineStore'
export { MessageStore } from './messageStore'
export { OmcRuntimeStore }
export { PushStore } from './pushStore'
export { ProjectStore } from './projectStore'
export { SessionStore } from './sessionStore'
export { TaskStore } from './taskStore'
export { UserStore } from './userStore'
export { WorkspaceStore } from './workspaceStore'

const SCHEMA_VERSION: number = 17
const REQUIRED_TABLES = [
    'sessions',
    'machines',
    'messages',
    'users',
    'push_subscriptions',
    'projects',
    'workspaces',
    'tasks',
    'omc_programs',
    'omc_planning_runs',
    'omc_plan_runtimes',
    'omc_attempts',
    'omc_evidence'
] as const

export class Store {
    private db: Database
    private readonly dbPath: string

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly messages: MessageStore
    readonly projects: ProjectStore
    readonly workspaces: WorkspaceStore
    readonly tasks: TaskStore
    readonly omcRuntime: OmcRuntimeStore
    readonly users: UserStore
    readonly push: PushStore

    constructor(dbPath: string) {
        this.dbPath = dbPath
        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            const dir = dirname(dbPath)
            mkdirSync(dir, { recursive: true, mode: 0o700 })
            try {
                chmodSync(dir, 0o700)
            } catch {
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch {
                }
            }
        }

        this.db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()

        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
                try {
                    chmodSync(path, 0o600)
                } catch {
                }
            }
        }

        this.sessions = new SessionStore(this.db)
        this.machines = new MachineStore(this.db)
        this.messages = new MessageStore(this.db)
        this.projects = new ProjectStore(this.db)
        this.workspaces = new WorkspaceStore(this.db)
        this.tasks = new TaskStore(this.db)
        this.omcRuntime = new OmcRuntimeStore(this.db)
        this.users = new UserStore(this.db)
        this.push = new PushStore(this.db)
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                this.migrateLegacySchemaIfNeeded()
                this.createSchema()
                // Existing tables may predate PRAGMA user_version and miss newer columns.
                this.ensureLatestSchemaColumns()
                this.setUserVersion(SCHEMA_VERSION)
                return
            }

            this.createSchema()
            this.ensureLatestSchemaColumns()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 1 && SCHEMA_VERSION === 2) {
            this.migrateFromV1ToV2()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 2 && SCHEMA_VERSION === 3) {
            this.migrateFromV2ToV3()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION === 4) {
            this.migrateFromV3ToV4()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 5) {
            this.migrateFromV4ToV5()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 6) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION === 7) {
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 7 && SCHEMA_VERSION === 8) {
            this.migrateFromV7ToV8()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION === 8) {
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 7) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 8) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION === 5) {
            this.migrateFromV3ToV4()
            this.migrateFromV4ToV5()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 6) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION === 6) {
            this.migrateFromV3ToV4()
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 2 && SCHEMA_VERSION === 5) {
            this.migrateFromV2ToV3()
            this.migrateFromV3ToV4()
            this.migrateFromV4ToV5()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 2 && SCHEMA_VERSION === 6) {
            this.migrateFromV2ToV3()
            this.migrateFromV3ToV4()
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 1 && SCHEMA_VERSION === 5) {
            this.migrateFromV1ToV2()
            this.migrateFromV2ToV3()
            this.migrateFromV3ToV4()
            this.migrateFromV4ToV5()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 1 && SCHEMA_VERSION === 6) {
            this.migrateFromV1ToV2()
            this.migrateFromV2ToV3()
            this.migrateFromV3ToV4()
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion > 0 && currentVersion < SCHEMA_VERSION) {
            if (currentVersion < 2) {
                this.migrateFromV1ToV2()
            }
            if (currentVersion < 3) {
                this.migrateFromV2ToV3()
            }
            if (currentVersion < 4) {
                this.migrateFromV3ToV4()
            }
            this.ensureLatestSchemaColumns()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion)
        }

        // Be defensive for installs that were force-versioned without all columns present.
        this.ensureLatestSchemaColumns()
        this.assertRequiredTablesPresent()
    }

    private createSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
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
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);

            CREATE TABLE IF NOT EXISTS machines (
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
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                local_id TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(namespace, endpoint)
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);

            CREATE TABLE IF NOT EXISTS projects (
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
            CREATE INDEX IF NOT EXISTS idx_projects_namespace ON projects(namespace);
            CREATE INDEX IF NOT EXISTS idx_projects_namespace_archived ON projects(namespace, archived_at);
            CREATE INDEX IF NOT EXISTS idx_projects_machine ON projects(machine_id);

            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                label TEXT,
                path TEXT NOT NULL,
                sort INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_project_path ON workspaces(project_id, path);
            CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);

            CREATE TABLE IF NOT EXISTS tasks (
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
                init_runtime TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                finished_at INTEGER,
                archived_at INTEGER,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_archived ON tasks(project_id, archived_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_sort ON tasks(project_id, status, sort_key);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_source_status ON tasks(project_id, source, status);

            CREATE TABLE IF NOT EXISTS omc_programs (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT,
                name TEXT NOT NULL,
                repo_root TEXT NOT NULL,
                planning_root TEXT NOT NULL,
                primary_branch TEXT,
                target_branch TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_programs_namespace ON omc_programs(namespace);

            CREATE TABLE IF NOT EXISTS omc_planning_runs (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                brief_json TEXT NOT NULL,
                session_id TEXT,
                summary TEXT,
                error TEXT,
                generated_plan_paths_json TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_planning_runs_program ON omc_planning_runs(program_id, namespace, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_planning_runs_session ON omc_planning_runs(session_id, namespace, created_at DESC);

            CREATE TABLE IF NOT EXISTS omc_plan_runtimes (
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                plan_key TEXT NOT NULL,
                plan_path TEXT NOT NULL,
                phase_key TEXT NOT NULL,
                phase_label TEXT NOT NULL,
                column_name TEXT NOT NULL,
                loop_status TEXT NOT NULL,
                current_loop_run_id TEXT,
                current_worktree_path TEXT,
                current_branch TEXT,
                target_branch TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
                last_failure_fingerprint TEXT,
                review_required INTEGER NOT NULL DEFAULT 0,
                review_approved_at INTEGER,
                merge_status TEXT NOT NULL DEFAULT 'idle',
                merge_blocked_reason TEXT,
                last_merge_attempt_at INTEGER,
                merge_approved_at INTEGER,
                done_at INTEGER,
                latest_evidence_summary TEXT,
                last_attempt_at INTEGER,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, program_id, plan_key),
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_plan_runtimes_program ON omc_plan_runtimes(program_id, namespace, phase_key, plan_key);

            CREATE TABLE IF NOT EXISTS omc_attempts (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                plan_key TEXT NOT NULL,
                plan_path TEXT NOT NULL,
                loop_run_id TEXT,
                session_id TEXT,
                attempt_number INTEGER NOT NULL,
                status TEXT NOT NULL,
                summary TEXT,
                failure_fingerprint TEXT,
                termination_reason TEXT,
                changed_files_json TEXT NOT NULL DEFAULT '[]',
                checks_json TEXT NOT NULL DEFAULT '[]',
                next_suggested_step TEXT,
                context_pack_json TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_attempts_plan ON omc_attempts(program_id, namespace, plan_key, created_at DESC);

            CREATE TABLE IF NOT EXISTS omc_evidence (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                plan_key TEXT NOT NULL,
                attempt_id TEXT,
                kind TEXT NOT NULL,
                label TEXT NOT NULL,
                status TEXT NOT NULL,
                summary TEXT NOT NULL,
                payload_json TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (attempt_id) REFERENCES omc_attempts(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_evidence_plan ON omc_evidence(program_id, namespace, plan_key, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_evidence_attempt ON omc_evidence(attempt_id, namespace, created_at ASC);
        `)
    }

    private migrateLegacySchemaIfNeeded(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            return
        }

        const hasDaemon = columns.has('daemon_state') || columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') || columns.has('runner_state_version')

        if (hasDaemon && hasRunner) {
            throw new Error('SQLite schema has both daemon_state and runner_state columns in machines; manual cleanup required.')
        }

        if (hasDaemon && !hasRunner) {
            this.migrateFromV1ToV2()
        }
    }

    private migrateFromV1ToV2(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            throw new Error('SQLite schema missing machines table for v1 to v2 migration.')
        }

        const hasDaemon = columns.has('daemon_state') && columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') && columns.has('runner_state_version')

        if (hasRunner && !hasDaemon) {
            return
        }

        if (!hasDaemon) {
            throw new Error('SQLite schema missing daemon_state columns for v1 to v2 migration.')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state TO runner_state')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state_version TO runner_state_version')
            this.db.exec('COMMIT')
            return
        } catch (error) {
            this.db.exec('ROLLBACK')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE machines_new (
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
            `)
            this.db.exec(`
                INSERT INTO machines_new (
                    id, namespace, created_at, updated_at,
                    metadata, metadata_version,
                    runner_state, runner_state_version,
                    active, active_at, seq
                )
                SELECT id, namespace, created_at, updated_at,
                       metadata, metadata_version,
                       daemon_state, daemon_state_version,
                       active, active_at, seq
                FROM machines;
            `)
            this.db.exec('DROP TABLE machines')
            this.db.exec('ALTER TABLE machines_new RENAME TO machines')
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace)')
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v1->v2 failed: ${message}`)
        }
    }

    private migrateFromV2ToV3(): void {
        return
    }

    private migrateFromV3ToV4(): void {
        this.createSchema()
    }

    private ensureLatestSchemaColumns(): void {
        if (SCHEMA_VERSION >= 5) {
            this.migrateFromV4ToV5()
        }
        if (SCHEMA_VERSION >= 6) {
            this.migrateFromV5ToV6()
        }
        if (SCHEMA_VERSION >= 7) {
            this.migrateFromV6ToV7()
        }
        if (SCHEMA_VERSION >= 8) {
            this.migrateFromV7ToV8()
        }
        if (SCHEMA_VERSION >= 9) {
            this.migrateFromV8ToV9()
        }
        if (SCHEMA_VERSION >= 10) {
            this.migrateFromV9ToV10()
        }
        if (SCHEMA_VERSION >= 11) {
            this.migrateFromV10ToV11()
        }
        if (SCHEMA_VERSION >= 12) {
            this.migrateFromV11ToV12()
        }
        if (SCHEMA_VERSION >= 13) {
            this.migrateFromV12ToV13()
        }
        if (SCHEMA_VERSION >= 14) {
            this.migrateFromV13ToV14()
        }
        if (SCHEMA_VERSION >= 15) {
            this.migrateFromV14ToV15()
        }
        if (SCHEMA_VERSION >= 16) {
            this.migrateFromV15ToV16()
        }
        if (SCHEMA_VERSION >= 17) {
            this.migrateFromV16ToV17()
        }
    }

    private migrateFromV4ToV5(): void {
        const columns = this.getColumnNames('projects')
        if (columns.size === 0) {
            throw new Error('SQLite schema missing projects table for v4 to v5 migration.')
        }

        if (!columns.has('default_session_type')) {
            this.db.exec("ALTER TABLE projects ADD COLUMN default_session_type TEXT NOT NULL DEFAULT 'simple'")
        }
        if (!columns.has('worktree_target_branch')) {
            this.db.exec('ALTER TABLE projects ADD COLUMN worktree_target_branch TEXT')
        }
        if (!columns.has('worktree_auto_commit_mode')) {
            this.db.exec("ALTER TABLE projects ADD COLUMN worktree_auto_commit_mode TEXT NOT NULL DEFAULT 'off'")
        }
        if (!columns.has('worktree_cleanup_after_merge')) {
            this.db.exec('ALTER TABLE projects ADD COLUMN worktree_cleanup_after_merge INTEGER NOT NULL DEFAULT 0')
        }

        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v4 to v5 migration.')
        }
        if (!taskColumns.has('worktree_merged_at')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN worktree_merged_at INTEGER')
        }
        if (!taskColumns.has('worktree_merge_commit')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN worktree_merge_commit TEXT')
        }
        if (!taskColumns.has('agent_flavor')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN agent_flavor TEXT')
        }
        if (!taskColumns.has('permission_mode')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN permission_mode TEXT')
        }
    }

    private migrateFromV5ToV6(): void {
        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v5 to v6 migration.')
        }
        if (!taskColumns.has('sub_tasks')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN sub_tasks TEXT')
        }
        if (!taskColumns.has('sub_tasks_updated_at')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN sub_tasks_updated_at INTEGER')
        }
    }

    private migrateFromV6ToV7(): void {
        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v6 to v7 migration.')
        }
        if (!taskColumns.has('model_mode')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN model_mode TEXT')
        }
    }

    private migrateFromV7ToV8(): void {
        const projectColumns = this.getColumnNames('projects')
        if (projectColumns.size === 0) {
            throw new Error('SQLite schema missing projects table for v7 to v8 migration.')
        }
        const hasPendingLimitColumn = projectColumns.has('improvements_max_pending_tasks')
        const hasLegacyGeneratedColumn = projectColumns.has('improvements_max_generated_new')
        if (!hasPendingLimitColumn) {
            this.db.exec('ALTER TABLE projects ADD COLUMN improvements_max_pending_tasks INTEGER NOT NULL DEFAULT 5')
        }
        if (hasLegacyGeneratedColumn) {
            this.db.exec('UPDATE projects SET improvements_max_pending_tasks = COALESCE(improvements_max_generated_new, improvements_max_pending_tasks)')
        }
        if (!projectColumns.has('workflow_profile')) {
            this.db.exec('ALTER TABLE projects ADD COLUMN workflow_profile TEXT')
        }

        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v7 to v8 migration.')
        }
        if (!taskColumns.has('merged_diff_snapshot')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN merged_diff_snapshot TEXT')
        }
        if (!taskColumns.has('workflow_profile')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN workflow_profile TEXT')
        }
        this.db.exec(`
            UPDATE tasks
            SET workflow_profile = COALESCE(
                NULLIF(TRIM(workflow_profile), ''),
                (SELECT workflow_profile FROM projects WHERE projects.id = tasks.project_id),
                'default'
            )
            WHERE workflow_profile IS NULL OR TRIM(workflow_profile) = ''
        `)
        if (!taskColumns.has('workflow_phase')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN workflow_phase TEXT')
        }
        this.db.exec("UPDATE tasks SET status = 'planned' WHERE status = 'new'")
    }

    private migrateFromV8ToV9(): void {
        const projectColumns = this.getColumnNames('projects')
        if (projectColumns.size === 0) {
            throw new Error('SQLite schema missing projects table for v8 to v9 migration.')
        }
        if (!projectColumns.has('default_model')) {
            this.db.exec('ALTER TABLE projects ADD COLUMN default_model TEXT')
        }
        this.db.exec('UPDATE projects SET default_model = COALESCE(default_model, default_model_mode) WHERE default_model IS NULL AND default_model_mode IS NOT NULL')

        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v8 to v9 migration.')
        }
        if (!taskColumns.has('model')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN model TEXT')
        }
        if (!taskColumns.has('merge_runtime')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN merge_runtime TEXT')
        }
        this.db.exec('UPDATE tasks SET model = COALESCE(model, model_mode) WHERE model IS NULL AND model_mode IS NOT NULL')
    }

    private migrateFromV9ToV10(): void {
        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v9 to v10 migration.')
        }
        if (!taskColumns.has('preview_runtime')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN preview_runtime TEXT')
        }
    }

    private migrateFromV10ToV11(): void {
        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v10 to v11 migration.')
        }
        if (!taskColumns.has('init_runtime')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN init_runtime TEXT')
        }
    }

    private migrateFromV11ToV12(): void {
        const projectColumns = this.getColumnNames('projects')
        if (projectColumns.size === 0) {
            throw new Error('SQLite schema missing projects table for v11 to v12 migration.')
        }
        if (!projectColumns.has('automation_readiness_status')) {
            this.db.exec("ALTER TABLE projects ADD COLUMN automation_readiness_status TEXT NOT NULL DEFAULT 'unknown'")
        }
        if (!projectColumns.has('automation_readiness_summary')) {
            this.db.exec('ALTER TABLE projects ADD COLUMN automation_readiness_summary TEXT')
        }
        if (!projectColumns.has('automation_readiness_checked_at')) {
            this.db.exec('ALTER TABLE projects ADD COLUMN automation_readiness_checked_at INTEGER')
        }
    }

    private migrateFromV12ToV13(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS omc_programs (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT,
                name TEXT NOT NULL,
                repo_root TEXT NOT NULL,
                planning_root TEXT NOT NULL,
                primary_branch TEXT,
                target_branch TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_programs_namespace ON omc_programs(namespace);

            CREATE TABLE IF NOT EXISTS omc_plan_runtimes (
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                plan_key TEXT NOT NULL,
                plan_path TEXT NOT NULL,
                phase_key TEXT NOT NULL,
                phase_label TEXT NOT NULL,
                column_name TEXT NOT NULL,
                loop_status TEXT NOT NULL,
                current_loop_run_id TEXT,
                current_worktree_path TEXT,
                current_branch TEXT,
                target_branch TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
                last_failure_fingerprint TEXT,
                review_required INTEGER NOT NULL DEFAULT 0,
                review_approved_at INTEGER,
                merge_status TEXT NOT NULL DEFAULT 'idle',
                merge_blocked_reason TEXT,
                last_merge_attempt_at INTEGER,
                merge_approved_at INTEGER,
                done_at INTEGER,
                latest_evidence_summary TEXT,
                last_attempt_at INTEGER,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, program_id, plan_key),
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_plan_runtimes_program ON omc_plan_runtimes(program_id, namespace, phase_key, plan_key);

            CREATE TABLE IF NOT EXISTS omc_attempts (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                plan_key TEXT NOT NULL,
                plan_path TEXT NOT NULL,
                loop_run_id TEXT,
                session_id TEXT,
                attempt_number INTEGER NOT NULL,
                status TEXT NOT NULL,
                summary TEXT,
                failure_fingerprint TEXT,
                termination_reason TEXT,
                changed_files_json TEXT NOT NULL DEFAULT '[]',
                checks_json TEXT NOT NULL DEFAULT '[]',
                next_suggested_step TEXT,
                context_pack_json TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_attempts_plan ON omc_attempts(program_id, namespace, plan_key, created_at DESC);

            CREATE TABLE IF NOT EXISTS omc_evidence (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                plan_key TEXT NOT NULL,
                attempt_id TEXT,
                kind TEXT NOT NULL,
                label TEXT NOT NULL,
                status TEXT NOT NULL,
                summary TEXT NOT NULL,
                payload_json TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (attempt_id) REFERENCES omc_attempts(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_evidence_plan ON omc_evidence(program_id, namespace, plan_key, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_evidence_attempt ON omc_evidence(attempt_id, namespace, created_at ASC);
        `)
    }

    private migrateFromV13ToV14(): void {
        const omcAttemptColumns = this.getColumnNames('omc_attempts')
        if (omcAttemptColumns.size === 0) {
            throw new Error('SQLite schema missing omc_attempts table for v13 to v14 migration.')
        }
        if (!omcAttemptColumns.has('session_id')) {
            this.db.exec('ALTER TABLE omc_attempts ADD COLUMN session_id TEXT')
        }
        if (!omcAttemptColumns.has('context_pack_json')) {
            this.db.exec('ALTER TABLE omc_attempts ADD COLUMN context_pack_json TEXT')
        }
    }

    private migrateFromV14ToV15(): void {
        const omcAttemptColumns = this.getColumnNames('omc_attempts')
        if (omcAttemptColumns.size === 0) {
            throw new Error('SQLite schema missing omc_attempts table for v14 to v15 migration.')
        }
        if (!omcAttemptColumns.has('termination_reason')) {
            this.db.exec('ALTER TABLE omc_attempts ADD COLUMN termination_reason TEXT')
        }
    }

    private migrateFromV15ToV16(): void {
        const omcPlanRuntimeColumns = this.getColumnNames('omc_plan_runtimes')
        if (omcPlanRuntimeColumns.size === 0) {
            throw new Error('SQLite schema missing omc_plan_runtimes table for v15 to v16 migration.')
        }
        if (!omcPlanRuntimeColumns.has('review_approved_at')) {
            this.db.exec('ALTER TABLE omc_plan_runtimes ADD COLUMN review_approved_at INTEGER')
        }
        if (!omcPlanRuntimeColumns.has('merge_status')) {
            this.db.exec("ALTER TABLE omc_plan_runtimes ADD COLUMN merge_status TEXT NOT NULL DEFAULT 'idle'")
        }
        if (!omcPlanRuntimeColumns.has('merge_blocked_reason')) {
            this.db.exec('ALTER TABLE omc_plan_runtimes ADD COLUMN merge_blocked_reason TEXT')
        }
        if (!omcPlanRuntimeColumns.has('last_merge_attempt_at')) {
            this.db.exec('ALTER TABLE omc_plan_runtimes ADD COLUMN last_merge_attempt_at INTEGER')
        }
    }

    private migrateFromV16ToV17(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS omc_planning_runs (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                brief_json TEXT NOT NULL,
                session_id TEXT,
                summary TEXT,
                error TEXT,
                generated_plan_paths_json TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_planning_runs_program ON omc_planning_runs(program_id, namespace, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_planning_runs_session ON omc_planning_runs(session_id, namespace, created_at DESC);
        `)
    }

    private getMachineColumnNames(): Set<string> {
        return this.getColumnNames('machines')
    }

    private getColumnNames(tableName: string): Set<string> {
        const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getUserVersion(): number {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number): void {
        this.db.exec(`PRAGMA user_version = ${version}`)
    }

    private hasAnyUserTables(): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).get() as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private assertRequiredTablesPresent(): void {
        const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
        const rows = this.db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REQUIRED_TABLES) as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        const missing = REQUIRED_TABLES.filter((table) => !existing.has(table))

        if (missing.length > 0) {
            throw new Error(
                `SQLite schema is missing required tables (${missing.join(', ')}). ` +
                'Back up and rebuild the database, or run an offline migration to the expected schema version.'
            )
        }
    }

    private buildSchemaMismatchError(currentVersion: number): Error {
        const location = (this.dbPath === ':memory:' || this.dbPath.startsWith('file::memory:'))
            ? 'in-memory database'
            : this.dbPath
        return new Error(
            `SQLite schema version mismatch for ${location}. ` +
            `Expected ${SCHEMA_VERSION}, found ${currentVersion}. ` +
            'This build does not run compatibility migrations. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }
}
