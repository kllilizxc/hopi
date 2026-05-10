import { Database } from 'bun:sqlite'
import { buildUniqueGoalKey, normalizeGoalKey } from '@hopi/protocol'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { OmcRuntimeStore } from '../sync/omc/runtimeStore'
import { GoalDecisionTopicStore } from './goalDecisionTopicStore'
import { GoalStore } from './goalStore'
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
    OmcCoordinationAgentStateRow,
    OmcDecisionTopicRow,
    OmcDecisionTopicTurnRow,
    OmcDirectiveLedgerEntryRow,
    OmcEvidenceRow,
    OmcMailboxMessageRow,
    OmcPlanningRunRow,
    OmcPlanRuntimeRow,
    OmcProgramRow,
    OmcWorkAttemptRow,
    OmcWorkOrderRow,
    StoredGoal,
    StoredGoalDecisionTopic,
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
export { GoalDecisionTopicStore } from './goalDecisionTopicStore'
export { GoalStore } from './goalStore'
export { MachineStore } from './machineStore'
export { MessageStore } from './messageStore'
export { OmcRuntimeStore }
export { PushStore } from './pushStore'
export { ProjectStore } from './projectStore'
export { SessionStore } from './sessionStore'
export { TaskStore } from './taskStore'
export { UserStore } from './userStore'
export { WorkspaceStore } from './workspaceStore'

const SCHEMA_VERSION: number = 26
const REQUIRED_TABLES = [
    'sessions',
    'machines',
    'messages',
    'users',
    'push_subscriptions',
    'projects',
    'workspaces',
    'tasks',
    'goals',
    'goal_decision_topics',
    'omc_programs',
    'omc_planning_runs',
    'omc_plan_runtimes',
    'omc_attempts',
    'omc_evidence',
    'omc_topics',
    'omc_topic_turns',
    'omc_mailbox_messages',
    'omc_work_orders',
    'omc_work_attempts',
    'omc_coordination_agents',
    'omc_directive_ledger',
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
    readonly goals: GoalStore
    readonly goalDecisionTopics: GoalDecisionTopicStore
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
        this.goals = new GoalStore(this.db)
        this.goalDecisionTopics = new GoalDecisionTopicStore(this.db)
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

        if (currentVersion === 17 && SCHEMA_VERSION === 18) {
            this.migrateFromV17ToV18()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 18 && SCHEMA_VERSION === 19) {
            this.migrateFromV18ToV19()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 19 && SCHEMA_VERSION === 20) {
            this.migrateFromV19ToV20()
            this.ensureLatestSchemaColumns()
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
                agent_output_language TEXT NOT NULL DEFAULT 'system',
                auto_run_enabled INTEGER NOT NULL DEFAULT 0,
                max_running_sessions INTEGER NOT NULL DEFAULT 5,
                automation_lane_limits TEXT,
                automation_backstop_policy TEXT,
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

            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                goal_key TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'planning',
                success_criteria TEXT,
                autopilot_enabled INTEGER NOT NULL DEFAULT 0,
                automation_paused_at INTEGER,
                deploy_requires_approval INTEGER NOT NULL DEFAULT 1,
                current_focus TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                archived_at INTEGER,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_goals_project_namespace ON goals(project_id, namespace);
            CREATE INDEX IF NOT EXISTS idx_goals_project_status ON goals(project_id, status, archived_at);

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                goal_id TEXT,
                goal_todo_ref TEXT,
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
                contract TEXT,
                handoff TEXT,
                evidence TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                finished_at INTEGER,
                archived_at INTEGER,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_archived ON tasks(project_id, archived_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_sort ON tasks(project_id, status, sort_key);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_source_status ON tasks(project_id, source, status);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_goal ON tasks(project_id, goal_id, archived_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_goal_status ON tasks(project_id, goal_id, status);

            CREATE TABLE IF NOT EXISTS goal_decision_topics (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                goal_id TEXT NOT NULL,
                task_id TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'waiting',
                blocking INTEGER NOT NULL DEFAULT 1,
                resolution TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_goal_topics_goal_status ON goal_decision_topics(goal_id, status);

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

            CREATE TABLE IF NOT EXISTS omc_topics (
                id TEXT NOT NULL,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                goal_id TEXT,
                plan_key TEXT,
                work_order_id TEXT,
                lifecycle TEXT NOT NULL,
                unread INTEGER NOT NULL DEFAULT 1,
                bridge_session_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, id),
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_topics_program ON omc_topics(program_id, namespace, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_topics_bridge_session ON omc_topics(namespace, bridge_session_id);

            CREATE TABLE IF NOT EXISTS omc_topic_turns (
                id TEXT PRIMARY KEY,
                topic_id TEXT NOT NULL,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                author TEXT NOT NULL,
                kind TEXT NOT NULL,
                body TEXT NOT NULL,
                session_id TEXT,
                session_message_id TEXT,
                reply_state TEXT NOT NULL DEFAULT 'none',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (namespace, topic_id) REFERENCES omc_topics(namespace, id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_topic_turns_topic ON omc_topic_turns(namespace, topic_id, created_at ASC);

            CREATE TABLE IF NOT EXISTS omc_mailbox_messages (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                from_agent TEXT NOT NULL,
                to_agent TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                priority TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                read_at INTEGER,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_mailbox_recipient ON omc_mailbox_messages(program_id, namespace, to_agent, read_at, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_mailbox_thread ON omc_mailbox_messages(program_id, namespace, thread_id, created_at ASC);

            CREATE TABLE IF NOT EXISTS omc_work_orders (
                id TEXT NOT NULL,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                goal_id TEXT,
                plan_key TEXT,
                title TEXT NOT NULL,
                owner TEXT,
                status TEXT NOT NULL,
                current_attempt_id TEXT,
                reviewer_verdict TEXT,
                blocked_reason TEXT,
                latest_accepted_attempt_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, id),
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_work_orders_program ON omc_work_orders(program_id, namespace, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_work_orders_plan ON omc_work_orders(program_id, namespace, plan_key);

            CREATE TABLE IF NOT EXISTS omc_work_attempts (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                work_order_id TEXT NOT NULL,
                role TEXT NOT NULL,
                session_id TEXT,
                status TEXT NOT NULL,
                summary TEXT,
                source_mailbox_message_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (namespace, work_order_id) REFERENCES omc_work_orders(namespace, id) ON DELETE CASCADE,
                FOREIGN KEY (source_mailbox_message_id) REFERENCES omc_mailbox_messages(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_work_attempts_order ON omc_work_attempts(program_id, namespace, work_order_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_work_attempts_session ON omc_work_attempts(namespace, session_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS omc_coordination_agents (
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                role TEXT NOT NULL,
                busy INTEGER NOT NULL DEFAULT 0,
                current_work_order_id TEXT,
                active_session_id TEXT,
                model TEXT,
                mode TEXT,
                last_heartbeat INTEGER NOT NULL,
                PRIMARY KEY (namespace, program_id, role),
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (namespace, current_work_order_id) REFERENCES omc_work_orders(namespace, id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_coordination_agents_program ON omc_coordination_agents(program_id, namespace);

            CREATE TABLE IF NOT EXISTS omc_directive_ledger (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                scope_type TEXT NOT NULL,
                scope_id TEXT NOT NULL,
                source_topic_id TEXT,
                key TEXT NOT NULL,
                summary TEXT NOT NULL,
                raw_text TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (namespace, source_topic_id) REFERENCES omc_topics(namespace, id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_directive_ledger_scope ON omc_directive_ledger(program_id, namespace, scope_type, scope_id, updated_at DESC);
        `)
        this.ensureGoalKeyColumnAndIndex()
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
        if (SCHEMA_VERSION >= 18) {
            this.migrateFromV17ToV18()
        }
        if (SCHEMA_VERSION >= 19) {
            this.migrateFromV18ToV19()
        }
        if (SCHEMA_VERSION >= 20) {
            this.migrateFromV19ToV20()
        }
        if (SCHEMA_VERSION >= 21) {
            this.migrateFromV20ToV21()
        }
        if (SCHEMA_VERSION >= 22) {
            this.migrateFromV21ToV22()
        }
        if (SCHEMA_VERSION >= 23) {
            this.migrateFromV22ToV23()
        }
        if (SCHEMA_VERSION >= 24) {
            this.migrateFromV23ToV24()
        }
        if (SCHEMA_VERSION >= 25) {
            this.migrateFromV24ToV25()
        }
        if (SCHEMA_VERSION >= 26) {
            this.migrateFromV25ToV26()
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

    private migrateFromV17ToV18(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS omc_topics (
                id TEXT NOT NULL,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                goal_id TEXT,
                plan_key TEXT,
                work_order_id TEXT,
                lifecycle TEXT NOT NULL,
                unread INTEGER NOT NULL DEFAULT 1,
                bridge_session_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, id),
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_topics_program ON omc_topics(program_id, namespace, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_topics_bridge_session ON omc_topics(namespace, bridge_session_id);

            CREATE TABLE IF NOT EXISTS omc_topic_turns (
                id TEXT PRIMARY KEY,
                topic_id TEXT NOT NULL,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                author TEXT NOT NULL,
                kind TEXT NOT NULL,
                body TEXT NOT NULL,
                session_id TEXT,
                session_message_id TEXT,
                reply_state TEXT NOT NULL DEFAULT 'none',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (namespace, topic_id) REFERENCES omc_topics(namespace, id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_topic_turns_topic ON omc_topic_turns(namespace, topic_id, created_at ASC);
        `)
    }

    private migrateFromV18ToV19(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS omc_mailbox_messages (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                from_agent TEXT NOT NULL,
                to_agent TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                priority TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                read_at INTEGER,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_mailbox_recipient ON omc_mailbox_messages(program_id, namespace, to_agent, read_at, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_mailbox_thread ON omc_mailbox_messages(program_id, namespace, thread_id, created_at ASC);

            CREATE TABLE IF NOT EXISTS omc_work_orders (
                id TEXT NOT NULL,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                goal_id TEXT,
                plan_key TEXT,
                title TEXT NOT NULL,
                owner TEXT,
                status TEXT NOT NULL,
                current_attempt_id TEXT,
                reviewer_verdict TEXT,
                blocked_reason TEXT,
                latest_accepted_attempt_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, id),
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_omc_work_orders_program ON omc_work_orders(program_id, namespace, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_work_orders_plan ON omc_work_orders(program_id, namespace, plan_key);

            CREATE TABLE IF NOT EXISTS omc_work_attempts (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                work_order_id TEXT NOT NULL,
                role TEXT NOT NULL,
                session_id TEXT,
                status TEXT NOT NULL,
                summary TEXT,
                source_mailbox_message_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (namespace, work_order_id) REFERENCES omc_work_orders(namespace, id) ON DELETE CASCADE,
                FOREIGN KEY (source_mailbox_message_id) REFERENCES omc_mailbox_messages(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_work_attempts_order ON omc_work_attempts(program_id, namespace, work_order_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_omc_work_attempts_session ON omc_work_attempts(namespace, session_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS omc_coordination_agents (
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                role TEXT NOT NULL,
                busy INTEGER NOT NULL DEFAULT 0,
                current_work_order_id TEXT,
                active_session_id TEXT,
                model TEXT,
                mode TEXT,
                last_heartbeat INTEGER NOT NULL,
                PRIMARY KEY (namespace, program_id, role),
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (namespace, current_work_order_id) REFERENCES omc_work_orders(namespace, id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_coordination_agents_program ON omc_coordination_agents(program_id, namespace);

            CREATE TABLE IF NOT EXISTS omc_directive_ledger (
                id TEXT PRIMARY KEY,
                program_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                scope_type TEXT NOT NULL,
                scope_id TEXT NOT NULL,
                source_topic_id TEXT,
                key TEXT NOT NULL,
                summary TEXT NOT NULL,
                raw_text TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (program_id) REFERENCES omc_programs(id) ON DELETE CASCADE,
                FOREIGN KEY (namespace, source_topic_id) REFERENCES omc_topics(namespace, id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_omc_directive_ledger_scope ON omc_directive_ledger(program_id, namespace, scope_type, scope_id, updated_at DESC);
        `)
    }

    private migrateFromV19ToV20(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS goals (
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
            CREATE INDEX IF NOT EXISTS idx_goals_project_namespace ON goals(project_id, namespace);
            CREATE INDEX IF NOT EXISTS idx_goals_project_status ON goals(project_id, status, archived_at);
        `)

        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v19 to v20 migration.')
        }
        if (!taskColumns.has('goal_id')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL')
        }
        if (!taskColumns.has('contract')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN contract TEXT')
        }
        if (!taskColumns.has('handoff')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN handoff TEXT')
        }
        if (!taskColumns.has('evidence')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN evidence TEXT')
        }

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_tasks_project_goal ON tasks(project_id, goal_id, archived_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_project_goal_status ON tasks(project_id, goal_id, status);

            CREATE TABLE IF NOT EXISTS goal_decision_topics (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                goal_id TEXT NOT NULL,
                task_id TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'waiting',
                blocking INTEGER NOT NULL DEFAULT 1,
                resolution TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_goal_topics_goal_status ON goal_decision_topics(goal_id, status);
        `)
    }

    private migrateFromV20ToV21(): void {
        const projectColumns = this.getColumnNames('projects')
        if (projectColumns.size === 0) {
            throw new Error('SQLite schema missing projects table for v20 to v21 migration.')
        }
        if (!projectColumns.has('automation_lane_limits')) {
            this.db.exec('ALTER TABLE projects ADD COLUMN automation_lane_limits TEXT')
        }
    }

    private migrateFromV21ToV22(): void {
        const projectColumns = this.getColumnNames('projects')
        if (projectColumns.size === 0) {
            throw new Error('SQLite schema missing projects table for v21 to v22 migration.')
        }
        if (!projectColumns.has('agent_output_language')) {
            this.db.exec("ALTER TABLE projects ADD COLUMN agent_output_language TEXT NOT NULL DEFAULT 'system'")
        }
    }

    private migrateFromV22ToV23(): void {
        this.ensureGoalKeyColumnAndIndex()
    }

    private migrateFromV23ToV24(): void {
        const goalColumns = this.getColumnNames('goals')
        if (goalColumns.size === 0) {
            throw new Error('SQLite schema missing goals table for v23 to v24 migration.')
        }
        if (!goalColumns.has('automation_paused_at')) {
            this.db.exec('ALTER TABLE goals ADD COLUMN automation_paused_at INTEGER')
        }
    }

    private migrateFromV24ToV25(): void {
        const taskColumns = this.getColumnNames('tasks')
        if (taskColumns.size === 0) {
            throw new Error('SQLite schema missing tasks table for v24 to v25 migration.')
        }
        if (!taskColumns.has('goal_todo_ref')) {
            this.db.exec('ALTER TABLE tasks ADD COLUMN goal_todo_ref TEXT')
        }
    }

    private migrateFromV25ToV26(): void {
        const projectColumns = this.getColumnNames('projects')
        if (projectColumns.size === 0) {
            throw new Error('SQLite schema missing projects table for v25 to v26 migration.')
        }
        if (!projectColumns.has('automation_backstop_policy')) {
            this.db.exec('ALTER TABLE projects ADD COLUMN automation_backstop_policy TEXT')
        }
    }

    private ensureGoalKeyColumnAndIndex(): void {
        const goalColumns = this.getColumnNames('goals')
        if (goalColumns.size === 0) {
            throw new Error('SQLite schema missing goals table for v22 to v23 migration.')
        }

        if (!goalColumns.has('goal_key')) {
            this.db.exec("ALTER TABLE goals ADD COLUMN goal_key TEXT NOT NULL DEFAULT ''")
        }

        const rows = this.db.prepare(`
            SELECT id, project_id, namespace, title, goal_key
            FROM goals
            ORDER BY project_id ASC, namespace ASC, created_at ASC
        `).all() as Array<{
            id: string
            project_id: string
            namespace: string
            title: string
            goal_key: string | null
        }>

        const usedByProjectNamespace = new Map<string, Set<string>>()
        const update = this.db.prepare('UPDATE goals SET goal_key = ? WHERE id = ? AND namespace = ?')

        for (const row of rows) {
            const bucketKey = `${row.project_id}:${row.namespace}`
            const used = usedByProjectNamespace.get(bucketKey) ?? new Set<string>()
            usedByProjectNamespace.set(bucketKey, used)

            const normalizedExisting = row.goal_key ? normalizeGoalKey(row.goal_key) : ''
            const goalKey = normalizedExisting && !used.has(normalizedExisting)
                ? normalizedExisting
                : buildUniqueGoalKey(row.title, (candidate) => used.has(candidate))
            used.add(goalKey)
            update.run(goalKey, row.id, row.namespace)
        }

        this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_project_namespace_goal_key ON goals(project_id, namespace, goal_key)')
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
