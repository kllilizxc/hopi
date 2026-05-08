import type { Database } from 'bun:sqlite'
import {
    OmcAttemptSchema,
    OmcCoordinationAgentStateSchema,
    OmcDecisionTopicSchema,
    OmcDecisionTopicTurnSchema,
    OmcDirectiveLedgerEntrySchema,
    OmcEvidenceSchema,
    OmcGuidedPlanningBriefSchema,
    OmcGuidedPlanningRunSchema,
    OmcMailboxMessageSchema,
    OmcPlanRuntimeSchema,
    OmcProgramSchema,
    OmcWorkAttemptSchema,
    OmcWorkOrderSchema,
} from '@hopi/protocol/schemas'
import type {
    OmcAttempt,
    OmcAttemptCheck,
    OmcCoordinationAgentState,
    OmcContextPack,
    OmcDecisionTopic,
    OmcDecisionTopicTurn,
    OmcDirectiveLedgerEntry,
    OmcEvidence,
    OmcGuidedPlanningBrief,
    OmcGuidedPlanningRun,
    OmcMailboxMessage,
    OmcPlanRuntime,
    OmcProgram,
    OmcWorkAttempt,
    OmcWorkOrder,
} from '@hopi/protocol/types'
import type {
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
} from '../../store/types'

type DbOmcProgramRow = {
    id: string
    namespace: string
    machine_id: string | null
    name: string
    repo_root: string
    planning_root: string
    primary_branch: string | null
    target_branch: string | null
    created_at: number
    updated_at: number
}

type DbOmcPlanningRunRow = {
    id: string
    program_id: string
    namespace: string
    status: OmcPlanningRunRow['status']
    stage: OmcPlanningRunRow['stage']
    brief_json: string
    session_id: string | null
    summary: string | null
    error: string | null
    generated_plan_paths_json: string
    created_at: number
    updated_at: number
    completed_at: number | null
}

type DbOmcPlanRuntimeRow = {
    program_id: string
    namespace: string
    plan_key: string
    plan_path: string
    phase_key: string
    phase_label: string
    column_name: OmcPlanRuntimeRow['column']
    loop_status: OmcPlanRuntimeRow['loopStatus']
    current_loop_run_id: string | null
    current_worktree_path: string | null
    current_branch: string | null
    target_branch: string | null
    attempt_count: number
    consecutive_failure_count: number
    last_failure_fingerprint: string | null
    review_required: number
    review_approved_at: number | null
    merge_status: OmcPlanRuntimeRow['mergeStatus']
    merge_blocked_reason: string | null
    last_merge_attempt_at: number | null
    merge_approved_at: number | null
    done_at: number | null
    latest_evidence_summary: string | null
    last_attempt_at: number | null
    updated_at: number
}

type DbOmcAttemptRow = {
    id: string
    program_id: string
    namespace: string
    plan_key: string
    plan_path: string
    loop_run_id: string | null
    session_id: string | null
    attempt_number: number
    status: OmcAttemptRow['status']
    summary: string | null
    failure_fingerprint: string | null
    termination_reason: string | null
    changed_files_json: string
    checks_json: string
    next_suggested_step: string | null
    context_pack_json: string | null
    created_at: number
    updated_at: number
    completed_at: number | null
}

type DbOmcEvidenceRow = {
    id: string
    program_id: string
    namespace: string
    plan_key: string
    attempt_id: string | null
    kind: OmcEvidenceRow['kind']
    label: string
    status: OmcEvidenceRow['status']
    summary: string
    payload_json: string | null
    created_at: number
}

type DbOmcDecisionTopicRow = {
    id: string
    program_id: string
    namespace: string
    kind: OmcDecisionTopicRow['kind']
    title: string
    goal_id: string | null
    plan_key: string | null
    work_order_id: string | null
    lifecycle: OmcDecisionTopicRow['lifecycle']
    unread: number
    bridge_session_id: string | null
    created_at: number
    updated_at: number
}

type DbOmcDecisionTopicTurnRow = {
    id: string
    topic_id: string
    program_id: string
    namespace: string
    author: OmcDecisionTopicTurnRow['author']
    kind: OmcDecisionTopicTurnRow['kind']
    body: string
    session_id: string | null
    session_message_id: string | null
    reply_state: OmcDecisionTopicTurnRow['replyState']
    created_at: number
}

type DbOmcMailboxMessageRow = {
    id: string
    program_id: string
    namespace: string
    from_agent: OmcMailboxMessageRow['from']
    to_agent: OmcMailboxMessageRow['to']
    thread_id: OmcMailboxMessageRow['thread']
    kind: OmcMailboxMessageRow['kind']
    priority: OmcMailboxMessageRow['priority']
    body: string
    created_at: number
    read_at: number | null
}

type DbOmcWorkOrderRow = {
    id: string
    program_id: string
    namespace: string
    goal_id: string | null
    plan_key: string | null
    title: string
    owner: OmcWorkOrderRow['owner']
    status: OmcWorkOrderRow['status']
    current_attempt_id: string | null
    reviewer_verdict: OmcWorkOrderRow['reviewerVerdict']
    blocked_reason: string | null
    latest_accepted_attempt_id: string | null
    created_at: number
    updated_at: number
}

type DbOmcWorkAttemptRow = {
    id: string
    program_id: string
    namespace: string
    work_order_id: string
    role: OmcWorkAttemptRow['role']
    session_id: string | null
    status: OmcWorkAttemptRow['status']
    summary: string | null
    source_mailbox_message_id: string | null
    created_at: number
    updated_at: number
    completed_at: number | null
}

type DbOmcCoordinationAgentStateRow = {
    program_id: string
    namespace: string
    role: OmcCoordinationAgentStateRow['role']
    busy: number
    current_work_order_id: string | null
    active_session_id: string | null
    model: string | null
    mode: string | null
    last_heartbeat: number
}

type DbOmcDirectiveLedgerEntryRow = {
    id: string
    program_id: string
    namespace: string
    scope_type: OmcDirectiveLedgerEntryRow['scopeType']
    scope_id: string
    source_topic_id: string | null
    key: string
    summary: string
    raw_text: string | null
    created_at: number
    updated_at: number
}

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
    if (!value) {
        return fallback
    }

    try {
        return JSON.parse(value) as T
    } catch {
        return fallback
    }
}

function toProgram(row: DbOmcProgramRow): OmcProgram {
    return OmcProgramSchema.parse({
        id: row.id,
        namespace: row.namespace,
        machineId: row.machine_id,
        name: row.name,
        repoRoot: row.repo_root,
        planningRoot: row.planning_root,
        primaryBranch: row.primary_branch,
        targetBranch: row.target_branch,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    })
}

function toPlanningRun(row: DbOmcPlanningRunRow): OmcGuidedPlanningRun {
    return OmcGuidedPlanningRunSchema.parse({
        id: row.id,
        programId: row.program_id,
        status: row.status,
        stage: row.stage,
        brief: OmcGuidedPlanningBriefSchema.parse(parseJsonValue<Record<string, unknown>>(row.brief_json, {})),
        sessionId: row.session_id,
        summary: row.summary,
        error: row.error,
        generatedPlanPaths: parseJsonValue<string[]>(row.generated_plan_paths_json, []),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at
    })
}

function toPlanRuntime(row: DbOmcPlanRuntimeRow): OmcPlanRuntime {
    return OmcPlanRuntimeSchema.parse({
        programId: row.program_id,
        planKey: row.plan_key,
        planPath: row.plan_path,
        phaseKey: row.phase_key,
        phaseLabel: row.phase_label,
        column: row.column_name,
        loopStatus: row.loop_status,
        currentLoopRunId: row.current_loop_run_id,
        currentWorktreePath: row.current_worktree_path,
        currentBranch: row.current_branch,
        targetBranch: row.target_branch,
        attemptCount: row.attempt_count,
        consecutiveFailureCount: row.consecutive_failure_count,
        lastFailureFingerprint: row.last_failure_fingerprint,
        reviewRequired: Boolean(row.review_required),
        reviewApprovedAt: row.review_approved_at,
        mergeStatus: row.merge_status,
        mergeBlockedReason: row.merge_blocked_reason,
        lastMergeAttemptAt: row.last_merge_attempt_at,
        mergeApprovedAt: row.merge_approved_at,
        doneAt: row.done_at,
        latestEvidenceSummary: row.latest_evidence_summary,
        lastAttemptAt: row.last_attempt_at,
        updatedAt: row.updated_at
    })
}

function toAttempt(row: DbOmcAttemptRow): OmcAttempt {
    return OmcAttemptSchema.parse({
        id: row.id,
        programId: row.program_id,
        planKey: row.plan_key,
        planPath: row.plan_path,
        loopRunId: row.loop_run_id,
        sessionId: row.session_id,
        attemptNumber: row.attempt_number,
        status: row.status,
        summary: row.summary,
        failureFingerprint: row.failure_fingerprint,
        terminationReason: row.termination_reason,
        changedFiles: parseJsonValue<string[]>(row.changed_files_json, []),
        checks: parseJsonValue<OmcAttemptCheck[]>(row.checks_json, []),
        nextSuggestedStep: row.next_suggested_step,
        contextPack: parseJsonValue<OmcContextPack | null>(row.context_pack_json, null),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at
    })
}

function toEvidence(row: DbOmcEvidenceRow): OmcEvidence {
    return OmcEvidenceSchema.parse({
        id: row.id,
        programId: row.program_id,
        planKey: row.plan_key,
        attemptId: row.attempt_id,
        kind: row.kind,
        label: row.label,
        status: row.status,
        summary: row.summary,
        payload: parseJsonValue<Record<string, unknown> | null>(row.payload_json, null),
        createdAt: row.created_at
    })
}

function toDecisionTopic(row: DbOmcDecisionTopicRow): OmcDecisionTopic {
    return OmcDecisionTopicSchema.parse({
        id: row.id,
        programId: row.program_id,
        kind: row.kind,
        title: row.title,
        goalId: row.goal_id,
        planKey: row.plan_key,
        workOrderId: row.work_order_id,
        lifecycle: row.lifecycle,
        unread: Boolean(row.unread),
        bridgeSessionId: row.bridge_session_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    })
}

function toDecisionTopicTurn(row: DbOmcDecisionTopicTurnRow): OmcDecisionTopicTurn {
    return OmcDecisionTopicTurnSchema.parse({
        id: row.id,
        topicId: row.topic_id,
        programId: row.program_id,
        author: row.author,
        kind: row.kind,
        body: row.body,
        sessionId: row.session_id,
        sessionMessageId: row.session_message_id,
        replyState: row.reply_state,
        createdAt: row.created_at,
    })
}

function toMailboxMessage(row: DbOmcMailboxMessageRow): OmcMailboxMessage {
    return OmcMailboxMessageSchema.parse({
        id: row.id,
        programId: row.program_id,
        from: row.from_agent,
        to: row.to_agent,
        thread: row.thread_id,
        kind: row.kind,
        priority: row.priority,
        body: row.body,
        createdAt: row.created_at,
        readAt: row.read_at,
    })
}

function toWorkOrder(row: DbOmcWorkOrderRow): OmcWorkOrder {
    return OmcWorkOrderSchema.parse({
        id: row.id,
        programId: row.program_id,
        goalId: row.goal_id,
        planKey: row.plan_key,
        title: row.title,
        owner: row.owner,
        status: row.status,
        currentAttemptId: row.current_attempt_id,
        reviewerVerdict: row.reviewer_verdict,
        blockedReason: row.blocked_reason,
        latestAcceptedAttemptId: row.latest_accepted_attempt_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    })
}

function toWorkAttempt(row: DbOmcWorkAttemptRow): OmcWorkAttempt {
    return OmcWorkAttemptSchema.parse({
        id: row.id,
        programId: row.program_id,
        workOrderId: row.work_order_id,
        role: row.role,
        sessionId: row.session_id,
        status: row.status,
        summary: row.summary,
        sourceMailboxMessageId: row.source_mailbox_message_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
    })
}

function toCoordinationAgentState(row: DbOmcCoordinationAgentStateRow): OmcCoordinationAgentState {
    return OmcCoordinationAgentStateSchema.parse({
        programId: row.program_id,
        role: row.role,
        busy: Boolean(row.busy),
        currentWorkOrderId: row.current_work_order_id,
        activeSessionId: row.active_session_id,
        model: row.model,
        mode: row.mode,
        lastHeartbeat: row.last_heartbeat,
    })
}

function toDirectiveLedgerEntry(row: DbOmcDirectiveLedgerEntryRow): OmcDirectiveLedgerEntry {
    return OmcDirectiveLedgerEntrySchema.parse({
        id: row.id,
        programId: row.program_id,
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        sourceTopicId: row.source_topic_id,
        key: row.key,
        summary: row.summary,
        rawText: row.raw_text,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    })
}

export class OmcRuntimeStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    listPrograms(): OmcProgram[] {
        const rows = this.db.prepare(
            'SELECT * FROM omc_programs ORDER BY updated_at DESC'
        ).all() as DbOmcProgramRow[]

        return rows.map(toProgram)
    }

    listProgramsByNamespace(namespace: string): OmcProgram[] {
        const rows = this.db.prepare(
            'SELECT * FROM omc_programs WHERE namespace = ? ORDER BY updated_at DESC'
        ).all(namespace) as DbOmcProgramRow[]

        return rows.map(toProgram)
    }

    getProgramByNamespace(programId: string, namespace: string): OmcProgram | null {
        const row = this.db.prepare(
            'SELECT * FROM omc_programs WHERE id = ? AND namespace = ? LIMIT 1'
        ).get(programId, namespace) as DbOmcProgramRow | undefined

        return row ? toProgram(row) : null
    }

    upsertProgram(input: {
        id: string
        namespace: string
        machineId?: string | null
        name: string
        repoRoot: string
        planningRoot: string
        primaryBranch?: string | null
        targetBranch?: string | null
    }): OmcProgram {
        const now = Date.now()
        this.db.prepare(`
            INSERT INTO omc_programs (
                id, namespace, machine_id, name, repo_root, planning_root,
                primary_branch, target_branch, created_at, updated_at
            ) VALUES (
                @id, @namespace, @machine_id, @name, @repo_root, @planning_root,
                @primary_branch, @target_branch, @created_at, @updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
                namespace = excluded.namespace,
                machine_id = excluded.machine_id,
                name = excluded.name,
                repo_root = excluded.repo_root,
                planning_root = excluded.planning_root,
                primary_branch = excluded.primary_branch,
                target_branch = excluded.target_branch,
                updated_at = excluded.updated_at
        `).run({
            id: input.id,
            namespace: input.namespace,
            machine_id: input.machineId ?? null,
            name: input.name,
            repo_root: input.repoRoot,
            planning_root: input.planningRoot,
            primary_branch: input.primaryBranch ?? null,
            target_branch: input.targetBranch ?? null,
            created_at: now,
            updated_at: now
        })

        const stored = this.getProgramByNamespace(input.id, input.namespace)
        if (!stored) {
            throw new Error('Failed to upsert OMC program')
        }
        return stored
    }

    getPlanningRunByNamespace(runId: string, namespace: string): OmcGuidedPlanningRun | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_planning_runs
            WHERE id = ? AND namespace = ?
            LIMIT 1
        `).get(runId, namespace) as DbOmcPlanningRunRow | undefined

        return row ? toPlanningRun(row) : null
    }

    getLatestPlanningRun(programId: string, namespace: string): OmcGuidedPlanningRun | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_planning_runs
            WHERE program_id = ? AND namespace = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).get(programId, namespace) as DbOmcPlanningRunRow | undefined

        return row ? toPlanningRun(row) : null
    }

    getActivePlanningRun(programId: string, namespace: string): OmcGuidedPlanningRun | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_planning_runs
            WHERE program_id = ? AND namespace = ? AND status IN ('queued', 'running')
            ORDER BY created_at DESC
            LIMIT 1
        `).get(programId, namespace) as DbOmcPlanningRunRow | undefined

        return row ? toPlanningRun(row) : null
    }

    getRunningPlanningRunBySessionId(sessionId: string, namespace: string): OmcGuidedPlanningRun | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_planning_runs
            WHERE session_id = ? AND namespace = ? AND status IN ('queued', 'running')
            ORDER BY created_at DESC
            LIMIT 1
        `).get(sessionId, namespace) as DbOmcPlanningRunRow | undefined

        return row ? toPlanningRun(row) : null
    }

    listPlanningRuns(programId: string, namespace: string): OmcGuidedPlanningRun[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_planning_runs
            WHERE program_id = ? AND namespace = ?
            ORDER BY created_at DESC
        `).all(programId, namespace) as DbOmcPlanningRunRow[]

        return rows.map(toPlanningRun)
    }

    addPlanningRun(namespace: string, input: {
        id: string
        programId: string
        status: OmcGuidedPlanningRun['status']
        stage: OmcGuidedPlanningRun['stage']
        brief: OmcGuidedPlanningBrief
        sessionId?: string | null
        summary?: string | null
        error?: string | null
        generatedPlanPaths?: string[]
        completedAt?: number | null
    }): OmcGuidedPlanningRun {
        const now = Date.now()
        const next = OmcGuidedPlanningRunSchema.parse({
            id: input.id,
            programId: input.programId,
            status: input.status,
            stage: input.stage,
            brief: input.brief,
            sessionId: input.sessionId ?? null,
            summary: input.summary ?? null,
            error: input.error ?? null,
            generatedPlanPaths: input.generatedPlanPaths ?? [],
            createdAt: now,
            updatedAt: now,
            completedAt: input.completedAt ?? null
        })

        this.db.prepare(`
            INSERT INTO omc_planning_runs (
                id, program_id, namespace, status, stage, brief_json, session_id,
                summary, error, generated_plan_paths_json, created_at, updated_at, completed_at
            ) VALUES (
                @id, @program_id, @namespace, @status, @stage, @brief_json, @session_id,
                @summary, @error, @generated_plan_paths_json, @created_at, @updated_at, @completed_at
            )
        `).run({
            id: next.id,
            program_id: next.programId,
            namespace,
            status: next.status,
            stage: next.stage,
            brief_json: JSON.stringify(next.brief),
            session_id: next.sessionId ?? null,
            summary: next.summary ?? null,
            error: next.error ?? null,
            generated_plan_paths_json: JSON.stringify(next.generatedPlanPaths),
            created_at: next.createdAt,
            updated_at: next.updatedAt,
            completed_at: next.completedAt ?? null
        })

        const stored = this.getPlanningRunByNamespace(next.id, namespace)
        if (!stored) {
            throw new Error('Failed to insert OMC guided planning run')
        }
        return stored
    }

    updatePlanningRun(namespace: string, runId: string, patch: {
        status?: OmcGuidedPlanningRun['status']
        stage?: OmcGuidedPlanningRun['stage']
        brief?: OmcGuidedPlanningBrief
        sessionId?: string | null
        summary?: string | null
        error?: string | null
        generatedPlanPaths?: string[]
        completedAt?: number | null
    }): OmcGuidedPlanningRun | null {
        const current = this.getPlanningRunByNamespace(runId, namespace)
        if (!current) {
            return null
        }

        const next = OmcGuidedPlanningRunSchema.parse({
            ...current,
            status: patch.status ?? current.status,
            stage: patch.stage ?? current.stage,
            brief: patch.brief ?? current.brief,
            sessionId: patch.sessionId !== undefined ? patch.sessionId : current.sessionId,
            summary: patch.summary !== undefined ? patch.summary : current.summary,
            error: patch.error !== undefined ? patch.error : current.error,
            generatedPlanPaths: patch.generatedPlanPaths ?? current.generatedPlanPaths,
            updatedAt: Date.now(),
            completedAt: patch.completedAt !== undefined ? patch.completedAt : current.completedAt
        })

        this.db.prepare(`
            UPDATE omc_planning_runs
            SET status = @status,
                stage = @stage,
                brief_json = @brief_json,
                session_id = @session_id,
                summary = @summary,
                error = @error,
                generated_plan_paths_json = @generated_plan_paths_json,
                updated_at = @updated_at,
                completed_at = @completed_at
            WHERE id = @id AND namespace = @namespace
        `).run({
            id: runId,
            namespace,
            status: next.status,
            stage: next.stage,
            brief_json: JSON.stringify(next.brief),
            session_id: next.sessionId ?? null,
            summary: next.summary ?? null,
            error: next.error ?? null,
            generated_plan_paths_json: JSON.stringify(next.generatedPlanPaths),
            updated_at: next.updatedAt,
            completed_at: next.completedAt ?? null
        })

        return this.getPlanningRunByNamespace(runId, namespace)
    }

    listPlanRuntimes(programId: string, namespace: string): OmcPlanRuntime[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_plan_runtimes
            WHERE program_id = ? AND namespace = ?
            ORDER BY phase_key ASC, plan_key ASC
        `).all(programId, namespace) as DbOmcPlanRuntimeRow[]

        return rows.map(toPlanRuntime)
    }

    getPlanRuntime(programId: string, planKey: string, namespace: string): OmcPlanRuntime | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_plan_runtimes
            WHERE program_id = ? AND plan_key = ? AND namespace = ?
            LIMIT 1
        `).get(programId, planKey, namespace) as DbOmcPlanRuntimeRow | undefined

        return row ? toPlanRuntime(row) : null
    }

    upsertPlanRuntime(
        namespace: string,
        input: {
            programId: string
            planKey: string
            planPath: string
            phaseKey: string
            phaseLabel: string
            column?: OmcPlanRuntime['column']
            loopStatus?: OmcPlanRuntime['loopStatus']
            currentLoopRunId?: string | null
            currentWorktreePath?: string | null
            currentBranch?: string | null
            targetBranch?: string | null
            attemptCount?: number
            consecutiveFailureCount?: number
            lastFailureFingerprint?: string | null
            reviewRequired?: boolean
            reviewApprovedAt?: number | null
            mergeStatus?: OmcPlanRuntime['mergeStatus']
            mergeBlockedReason?: string | null
            lastMergeAttemptAt?: number | null
            mergeApprovedAt?: number | null
            doneAt?: number | null
            latestEvidenceSummary?: string | null
            lastAttemptAt?: number | null
            updatedAt?: number
        }
    ): OmcPlanRuntime {
        const current = this.getPlanRuntime(input.programId, input.planKey, namespace)
        const next: OmcPlanRuntime = OmcPlanRuntimeSchema.parse({
            programId: input.programId,
            planKey: input.planKey,
            planPath: input.planPath,
            phaseKey: input.phaseKey,
            phaseLabel: input.phaseLabel,
            column: input.column ?? current?.column ?? 'Planning',
            loopStatus: input.loopStatus ?? current?.loopStatus ?? 'idle',
            currentLoopRunId: input.currentLoopRunId !== undefined ? input.currentLoopRunId : current?.currentLoopRunId ?? null,
            currentWorktreePath: input.currentWorktreePath !== undefined ? input.currentWorktreePath : current?.currentWorktreePath ?? null,
            currentBranch: input.currentBranch !== undefined ? input.currentBranch : current?.currentBranch ?? null,
            targetBranch: input.targetBranch !== undefined ? input.targetBranch : current?.targetBranch ?? null,
            attemptCount: input.attemptCount ?? current?.attemptCount ?? 0,
            consecutiveFailureCount: input.consecutiveFailureCount ?? current?.consecutiveFailureCount ?? 0,
            lastFailureFingerprint: input.lastFailureFingerprint !== undefined ? input.lastFailureFingerprint : current?.lastFailureFingerprint ?? null,
            reviewRequired: input.reviewRequired ?? current?.reviewRequired ?? false,
            reviewApprovedAt: input.reviewApprovedAt !== undefined ? input.reviewApprovedAt : current?.reviewApprovedAt ?? null,
            mergeStatus: input.mergeStatus ?? current?.mergeStatus ?? 'idle',
            mergeBlockedReason: input.mergeBlockedReason !== undefined ? input.mergeBlockedReason : current?.mergeBlockedReason ?? null,
            lastMergeAttemptAt: input.lastMergeAttemptAt !== undefined ? input.lastMergeAttemptAt : current?.lastMergeAttemptAt ?? null,
            mergeApprovedAt: input.mergeApprovedAt !== undefined ? input.mergeApprovedAt : current?.mergeApprovedAt ?? null,
            doneAt: input.doneAt !== undefined ? input.doneAt : current?.doneAt ?? null,
            latestEvidenceSummary: input.latestEvidenceSummary !== undefined ? input.latestEvidenceSummary : current?.latestEvidenceSummary ?? null,
            lastAttemptAt: input.lastAttemptAt !== undefined ? input.lastAttemptAt : current?.lastAttemptAt ?? null,
            updatedAt: input.updatedAt ?? Date.now()
        })

        this.db.prepare(`
            INSERT INTO omc_plan_runtimes (
                program_id, namespace, plan_key, plan_path, phase_key, phase_label,
                column_name, loop_status, current_loop_run_id, current_worktree_path,
                current_branch, target_branch, attempt_count, consecutive_failure_count,
                last_failure_fingerprint, review_required, review_approved_at,
                merge_status, merge_blocked_reason, last_merge_attempt_at,
                merge_approved_at, done_at, latest_evidence_summary, last_attempt_at, updated_at
            ) VALUES (
                @program_id, @namespace, @plan_key, @plan_path, @phase_key, @phase_label,
                @column_name, @loop_status, @current_loop_run_id, @current_worktree_path,
                @current_branch, @target_branch, @attempt_count, @consecutive_failure_count,
                @last_failure_fingerprint, @review_required, @review_approved_at,
                @merge_status, @merge_blocked_reason, @last_merge_attempt_at,
                @merge_approved_at, @done_at, @latest_evidence_summary, @last_attempt_at, @updated_at
            )
            ON CONFLICT(namespace, program_id, plan_key) DO UPDATE SET
                plan_path = excluded.plan_path,
                phase_key = excluded.phase_key,
                phase_label = excluded.phase_label,
                column_name = excluded.column_name,
                loop_status = excluded.loop_status,
                current_loop_run_id = excluded.current_loop_run_id,
                current_worktree_path = excluded.current_worktree_path,
                current_branch = excluded.current_branch,
                target_branch = excluded.target_branch,
                attempt_count = excluded.attempt_count,
                consecutive_failure_count = excluded.consecutive_failure_count,
                last_failure_fingerprint = excluded.last_failure_fingerprint,
                review_required = excluded.review_required,
                review_approved_at = excluded.review_approved_at,
                merge_status = excluded.merge_status,
                merge_blocked_reason = excluded.merge_blocked_reason,
                last_merge_attempt_at = excluded.last_merge_attempt_at,
                merge_approved_at = excluded.merge_approved_at,
                done_at = excluded.done_at,
                latest_evidence_summary = excluded.latest_evidence_summary,
                last_attempt_at = excluded.last_attempt_at,
                updated_at = excluded.updated_at
        `).run({
            program_id: next.programId,
            namespace,
            plan_key: next.planKey,
            plan_path: next.planPath,
            phase_key: next.phaseKey,
            phase_label: next.phaseLabel,
            column_name: next.column,
            loop_status: next.loopStatus,
            current_loop_run_id: next.currentLoopRunId ?? null,
            current_worktree_path: next.currentWorktreePath ?? null,
            current_branch: next.currentBranch ?? null,
            target_branch: next.targetBranch ?? null,
            attempt_count: next.attemptCount,
            consecutive_failure_count: next.consecutiveFailureCount,
            last_failure_fingerprint: next.lastFailureFingerprint ?? null,
            review_required: next.reviewRequired ? 1 : 0,
            review_approved_at: next.reviewApprovedAt ?? null,
            merge_status: next.mergeStatus ?? 'idle',
            merge_blocked_reason: next.mergeBlockedReason ?? null,
            last_merge_attempt_at: next.lastMergeAttemptAt ?? null,
            merge_approved_at: next.mergeApprovedAt ?? null,
            done_at: next.doneAt ?? null,
            latest_evidence_summary: next.latestEvidenceSummary ?? null,
            last_attempt_at: next.lastAttemptAt ?? null,
            updated_at: next.updatedAt ?? Date.now()
        })

        const stored = this.getPlanRuntime(input.programId, input.planKey, namespace)
        if (!stored) {
            throw new Error('Failed to upsert OMC plan runtime')
        }
        return stored
    }

    addAttempt(namespace: string, input: {
        id: string
        programId: string
        planKey: string
        planPath: string
        loopRunId?: string | null
        sessionId?: string | null
        attemptNumber: number
        status: OmcAttempt['status']
        summary?: string | null
        failureFingerprint?: string | null
        terminationReason?: OmcAttempt['terminationReason']
        changedFiles?: string[]
        checks?: OmcAttemptCheck[]
        nextSuggestedStep?: string | null
        contextPack?: OmcContextPack | null
        completedAt?: number | null
    }): OmcAttempt {
        const now = Date.now()
        this.db.prepare(`
            INSERT INTO omc_attempts (
                id, program_id, namespace, plan_key, plan_path, loop_run_id,
                session_id, attempt_number, status, summary, failure_fingerprint,
                termination_reason, changed_files_json, checks_json, next_suggested_step, context_pack_json,
                created_at, updated_at, completed_at
            ) VALUES (
                @id, @program_id, @namespace, @plan_key, @plan_path, @loop_run_id,
                @session_id, @attempt_number, @status, @summary, @failure_fingerprint,
                @termination_reason,
                @changed_files_json, @checks_json, @next_suggested_step, @context_pack_json,
                @created_at, @updated_at, @completed_at
            )
        `).run({
            id: input.id,
            program_id: input.programId,
            namespace,
            plan_key: input.planKey,
            plan_path: input.planPath,
            loop_run_id: input.loopRunId ?? null,
            session_id: input.sessionId ?? null,
            attempt_number: input.attemptNumber,
            status: input.status,
            summary: input.summary ?? null,
            failure_fingerprint: input.failureFingerprint ?? null,
            termination_reason: input.terminationReason ?? null,
            changed_files_json: JSON.stringify(input.changedFiles ?? []),
            checks_json: JSON.stringify(input.checks ?? []),
            next_suggested_step: input.nextSuggestedStep ?? null,
            context_pack_json: input.contextPack ? JSON.stringify(input.contextPack) : null,
            created_at: now,
            updated_at: now,
            completed_at: input.completedAt ?? null
        })

        const stored = this.getAttemptByNamespace(input.id, namespace)
        if (!stored) {
            throw new Error('Failed to insert OMC attempt')
        }
        return stored
    }

    updateAttempt(namespace: string, attemptId: string, patch: {
        status?: OmcAttempt['status']
        summary?: string | null
        failureFingerprint?: string | null
        terminationReason?: OmcAttempt['terminationReason']
        changedFiles?: string[]
        checks?: OmcAttemptCheck[]
        nextSuggestedStep?: string | null
        contextPack?: OmcContextPack | null
        completedAt?: number | null
    }): OmcAttempt | null {
        const current = this.getAttemptByNamespace(attemptId, namespace)
        if (!current) {
            return null
        }

        const next = OmcAttemptSchema.parse({
            ...current,
            status: patch.status ?? current.status,
            summary: patch.summary !== undefined ? patch.summary : current.summary,
            failureFingerprint: patch.failureFingerprint !== undefined ? patch.failureFingerprint : current.failureFingerprint,
            terminationReason: patch.terminationReason !== undefined ? patch.terminationReason : current.terminationReason,
            changedFiles: patch.changedFiles ?? current.changedFiles,
            checks: patch.checks ?? current.checks,
            nextSuggestedStep: patch.nextSuggestedStep !== undefined ? patch.nextSuggestedStep : current.nextSuggestedStep,
            contextPack: patch.contextPack !== undefined ? patch.contextPack : current.contextPack,
            completedAt: patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
            updatedAt: Date.now()
        })

        this.db.prepare(`
            UPDATE omc_attempts
            SET status = @status,
                summary = @summary,
                failure_fingerprint = @failure_fingerprint,
                termination_reason = @termination_reason,
                changed_files_json = @changed_files_json,
                checks_json = @checks_json,
                next_suggested_step = @next_suggested_step,
                context_pack_json = @context_pack_json,
                updated_at = @updated_at,
                completed_at = @completed_at
            WHERE id = @id AND namespace = @namespace
        `).run({
            id: attemptId,
            namespace,
            status: next.status,
            summary: next.summary ?? null,
            failure_fingerprint: next.failureFingerprint ?? null,
            termination_reason: next.terminationReason ?? null,
            changed_files_json: JSON.stringify(next.changedFiles),
            checks_json: JSON.stringify(next.checks),
            next_suggested_step: next.nextSuggestedStep ?? null,
            context_pack_json: next.contextPack ? JSON.stringify(next.contextPack) : null,
            updated_at: next.updatedAt,
            completed_at: next.completedAt ?? null
        })

        return this.getAttemptByNamespace(attemptId, namespace)
    }

    getAttemptByNamespace(attemptId: string, namespace: string): OmcAttempt | null {
        const row = this.db.prepare(
            'SELECT * FROM omc_attempts WHERE id = ? AND namespace = ? LIMIT 1'
        ).get(attemptId, namespace) as DbOmcAttemptRow | undefined

        return row ? toAttempt(row) : null
    }

    listAttempts(programId: string, planKey: string, namespace: string): OmcAttempt[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_attempts
            WHERE program_id = ? AND plan_key = ? AND namespace = ?
            ORDER BY created_at DESC
        `).all(programId, planKey, namespace) as DbOmcAttemptRow[]

        return rows.map(toAttempt)
    }

    getRunningAttemptBySessionId(sessionId: string, namespace: string): OmcAttempt | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_attempts
            WHERE session_id = ? AND namespace = ? AND completed_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
        `).get(sessionId, namespace) as DbOmcAttemptRow | undefined

        return row ? toAttempt(row) : null
    }

    addEvidence(namespace: string, input: {
        id: string
        programId: string
        planKey: string
        attemptId?: string | null
        kind: OmcEvidence['kind']
        label: string
        status: OmcEvidence['status']
        summary: string
        payload?: Record<string, unknown> | null
    }): OmcEvidence {
        const now = Date.now()
        this.db.prepare(`
            INSERT INTO omc_evidence (
                id, program_id, namespace, plan_key, attempt_id,
                kind, label, status, summary, payload_json, created_at
            ) VALUES (
                @id, @program_id, @namespace, @plan_key, @attempt_id,
                @kind, @label, @status, @summary, @payload_json, @created_at
            )
        `).run({
            id: input.id,
            program_id: input.programId,
            namespace,
            plan_key: input.planKey,
            attempt_id: input.attemptId ?? null,
            kind: input.kind,
            label: input.label,
            status: input.status,
            summary: input.summary,
            payload_json: input.payload ? JSON.stringify(input.payload) : null,
            created_at: now
        })

        const stored = this.getEvidenceByNamespace(input.id, namespace)
        if (!stored) {
            throw new Error('Failed to insert OMC evidence')
        }
        return stored
    }

    getEvidenceByNamespace(evidenceId: string, namespace: string): OmcEvidence | null {
        const row = this.db.prepare(
            'SELECT * FROM omc_evidence WHERE id = ? AND namespace = ? LIMIT 1'
        ).get(evidenceId, namespace) as DbOmcEvidenceRow | undefined

        return row ? toEvidence(row) : null
    }

    listEvidenceForPlan(programId: string, planKey: string, namespace: string): OmcEvidence[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_evidence
            WHERE program_id = ? AND plan_key = ? AND namespace = ?
            ORDER BY created_at DESC
        `).all(programId, planKey, namespace) as DbOmcEvidenceRow[]

        return rows.map(toEvidence)
    }

    listEvidenceForAttempt(attemptId: string, namespace: string): OmcEvidence[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_evidence
            WHERE attempt_id = ? AND namespace = ?
            ORDER BY created_at ASC
        `).all(attemptId, namespace) as DbOmcEvidenceRow[]

        return rows.map(toEvidence)
    }

    getDecisionTopicByNamespace(topicId: string, namespace: string): OmcDecisionTopic | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_topics
            WHERE id = ? AND namespace = ?
            LIMIT 1
        `).get(topicId, namespace) as DbOmcDecisionTopicRow | undefined

        return row ? toDecisionTopic(row) : null
    }

    listDecisionTopics(programId: string, namespace: string): OmcDecisionTopic[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_topics
            WHERE program_id = ? AND namespace = ?
            ORDER BY updated_at DESC, id ASC
        `).all(programId, namespace) as DbOmcDecisionTopicRow[]

        return rows.map(toDecisionTopic)
    }

    listDecisionTopicsByBridgeSession(sessionId: string, namespace: string): OmcDecisionTopic[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_topics
            WHERE bridge_session_id = ? AND namespace = ?
            ORDER BY updated_at DESC, id ASC
        `).all(sessionId, namespace) as DbOmcDecisionTopicRow[]

        return rows.map(toDecisionTopic)
    }

    upsertDecisionTopic(namespace: string, input: {
        id: string
        programId: string
        kind: OmcDecisionTopic['kind']
        title: string
        goalId?: string | null
        planKey?: string | null
        workOrderId?: string | null
        lifecycle?: OmcDecisionTopic['lifecycle']
        unread?: boolean
        bridgeSessionId?: string | null
        createdAt?: number
        updatedAt?: number
    }): OmcDecisionTopic {
        const current = this.getDecisionTopicByNamespace(input.id, namespace)
        const now = Date.now()
        const next = OmcDecisionTopicSchema.parse({
            id: input.id,
            programId: input.programId,
            kind: input.kind,
            title: input.title,
            goalId: input.goalId !== undefined ? input.goalId : current?.goalId ?? null,
            planKey: input.planKey !== undefined ? input.planKey : current?.planKey ?? null,
            workOrderId: input.workOrderId !== undefined ? input.workOrderId : current?.workOrderId ?? null,
            lifecycle: input.lifecycle ?? current?.lifecycle ?? 'pending',
            unread: input.unread ?? current?.unread ?? true,
            bridgeSessionId: input.bridgeSessionId !== undefined ? input.bridgeSessionId : current?.bridgeSessionId ?? null,
            createdAt: current?.createdAt ?? input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        })

        this.db.prepare(`
            INSERT INTO omc_topics (
                id, program_id, namespace, kind, title, goal_id, plan_key, work_order_id,
                lifecycle, unread, bridge_session_id, created_at, updated_at
            ) VALUES (
                @id, @program_id, @namespace, @kind, @title, @goal_id, @plan_key, @work_order_id,
                @lifecycle, @unread, @bridge_session_id, @created_at, @updated_at
            )
            ON CONFLICT(namespace, id) DO UPDATE SET
                program_id = excluded.program_id,
                kind = excluded.kind,
                title = excluded.title,
                goal_id = excluded.goal_id,
                plan_key = excluded.plan_key,
                work_order_id = excluded.work_order_id,
                lifecycle = excluded.lifecycle,
                unread = excluded.unread,
                bridge_session_id = excluded.bridge_session_id,
                updated_at = excluded.updated_at
        `).run({
            id: next.id,
            program_id: next.programId,
            namespace,
            kind: next.kind,
            title: next.title,
            goal_id: next.goalId ?? null,
            plan_key: next.planKey ?? null,
            work_order_id: next.workOrderId ?? null,
            lifecycle: next.lifecycle,
            unread: next.unread ? 1 : 0,
            bridge_session_id: next.bridgeSessionId ?? null,
            created_at: next.createdAt,
            updated_at: next.updatedAt,
        })

        const stored = this.getDecisionTopicByNamespace(next.id, namespace)
        if (!stored) {
            throw new Error('Failed to upsert OMC decision topic')
        }
        return stored
    }

    updateDecisionTopic(namespace: string, topicId: string, patch: {
        title?: string
        goalId?: string | null
        planKey?: string | null
        workOrderId?: string | null
        lifecycle?: OmcDecisionTopic['lifecycle']
        unread?: boolean
        bridgeSessionId?: string | null
        updatedAt?: number
    }): OmcDecisionTopic | null {
        const current = this.getDecisionTopicByNamespace(topicId, namespace)
        if (!current) {
            return null
        }

        return this.upsertDecisionTopic(namespace, {
            id: current.id,
            programId: current.programId,
            kind: current.kind,
            title: patch.title ?? current.title,
            goalId: patch.goalId !== undefined ? patch.goalId : current.goalId,
            planKey: patch.planKey !== undefined ? patch.planKey : current.planKey,
            workOrderId: patch.workOrderId !== undefined ? patch.workOrderId : current.workOrderId,
            lifecycle: patch.lifecycle ?? current.lifecycle,
            unread: patch.unread ?? current.unread,
            bridgeSessionId: patch.bridgeSessionId !== undefined ? patch.bridgeSessionId : current.bridgeSessionId,
            createdAt: current.createdAt,
            updatedAt: patch.updatedAt,
        })
    }

    addDecisionTopicTurn(namespace: string, input: {
        id: string
        topicId: string
        programId: string
        author: OmcDecisionTopicTurn['author']
        kind: OmcDecisionTopicTurn['kind']
        body: string
        sessionId?: string | null
        sessionMessageId?: string | null
        replyState?: OmcDecisionTopicTurn['replyState']
        createdAt?: number
    }): OmcDecisionTopicTurn {
        const next = OmcDecisionTopicTurnSchema.parse({
            id: input.id,
            topicId: input.topicId,
            programId: input.programId,
            author: input.author,
            kind: input.kind,
            body: input.body,
            sessionId: input.sessionId ?? null,
            sessionMessageId: input.sessionMessageId ?? null,
            replyState: input.replyState ?? 'none',
            createdAt: input.createdAt ?? Date.now(),
        })

        this.db.prepare(`
            INSERT INTO omc_topic_turns (
                id, topic_id, program_id, namespace, author, kind, body,
                session_id, session_message_id, reply_state, created_at
            ) VALUES (
                @id, @topic_id, @program_id, @namespace, @author, @kind, @body,
                @session_id, @session_message_id, @reply_state, @created_at
            )
        `).run({
            id: next.id,
            topic_id: next.topicId,
            program_id: next.programId,
            namespace,
            author: next.author,
            kind: next.kind,
            body: next.body,
            session_id: next.sessionId ?? null,
            session_message_id: next.sessionMessageId ?? null,
            reply_state: next.replyState,
            created_at: next.createdAt,
        })

        const stored = this.getDecisionTopicTurnByNamespace(next.id, namespace)
        if (!stored) {
            throw new Error('Failed to insert OMC decision topic turn')
        }
        return stored
    }

    getDecisionTopicTurnByNamespace(turnId: string, namespace: string): OmcDecisionTopicTurn | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_topic_turns
            WHERE id = ? AND namespace = ?
            LIMIT 1
        `).get(turnId, namespace) as DbOmcDecisionTopicTurnRow | undefined

        return row ? toDecisionTopicTurn(row) : null
    }

    listDecisionTopicTurns(topicId: string, namespace: string): OmcDecisionTopicTurn[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_topic_turns
            WHERE topic_id = ? AND namespace = ?
            ORDER BY created_at ASC, id ASC
        `).all(topicId, namespace) as DbOmcDecisionTopicTurnRow[]

        return rows.map(toDecisionTopicTurn)
    }

    addMailboxMessage(namespace: string, input: {
        id: string
        programId: string
        from: string
        to: string
        thread: string
        kind: string
        priority: OmcMailboxMessage['priority']
        body: string
        createdAt?: number
        readAt?: number | null
    }): OmcMailboxMessage {
        const next = OmcMailboxMessageSchema.parse({
            id: input.id,
            programId: input.programId,
            from: input.from,
            to: input.to,
            thread: input.thread,
            kind: input.kind,
            priority: input.priority,
            body: input.body,
            createdAt: input.createdAt ?? Date.now(),
            readAt: input.readAt ?? null,
        })

        this.db.prepare(`
            INSERT INTO omc_mailbox_messages (
                id, program_id, namespace, from_agent, to_agent, thread_id,
                kind, priority, body, created_at, read_at
            ) VALUES (
                @id, @program_id, @namespace, @from_agent, @to_agent, @thread_id,
                @kind, @priority, @body, @created_at, @read_at
            )
        `).run({
            id: next.id,
            program_id: next.programId,
            namespace,
            from_agent: next.from,
            to_agent: next.to,
            thread_id: next.thread,
            kind: next.kind,
            priority: next.priority,
            body: next.body,
            created_at: next.createdAt,
            read_at: next.readAt ?? null,
        })

        const stored = this.getMailboxMessageByNamespace(next.id, namespace)
        if (!stored) {
            throw new Error('Failed to insert OMC mailbox message')
        }
        return stored
    }

    getMailboxMessageByNamespace(messageId: string, namespace: string): OmcMailboxMessage | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_mailbox_messages
            WHERE id = ? AND namespace = ?
            LIMIT 1
        `).get(messageId, namespace) as DbOmcMailboxMessageRow | undefined

        return row ? toMailboxMessage(row) : null
    }

    listMailboxMessagesByRecipient(
        programId: string,
        recipient: string,
        namespace: string,
        options?: { unreadOnly?: boolean }
    ): OmcMailboxMessage[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_mailbox_messages
            WHERE program_id = @program_id
              AND namespace = @namespace
              AND to_agent = @to_agent
              AND (@unread_only = 0 OR read_at IS NULL)
            ORDER BY
              CASE priority
                WHEN 'high' THEN 0
                WHEN 'normal' THEN 1
                ELSE 2
              END ASC,
              created_at ASC,
              id ASC
        `).all({
            program_id: programId,
            namespace,
            to_agent: recipient,
            unread_only: options?.unreadOnly ? 1 : 0,
        }) as DbOmcMailboxMessageRow[]

        return rows.map(toMailboxMessage)
    }

    listMailboxMessages(programId: string, namespace: string): OmcMailboxMessage[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_mailbox_messages
            WHERE program_id = ? AND namespace = ?
            ORDER BY created_at ASC, id ASC
        `).all(programId, namespace) as DbOmcMailboxMessageRow[]

        return rows.map(toMailboxMessage)
    }

    markMailboxMessageRead(namespace: string, messageId: string, readAt: number = Date.now()): OmcMailboxMessage | null {
        this.db.prepare(`
            UPDATE omc_mailbox_messages
            SET read_at = @read_at
            WHERE id = @id AND namespace = @namespace
        `).run({
            id: messageId,
            namespace,
            read_at: readAt,
        })

        return this.getMailboxMessageByNamespace(messageId, namespace)
    }

    getWorkOrderByNamespace(workOrderId: string, namespace: string): OmcWorkOrder | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_work_orders
            WHERE id = ? AND namespace = ?
            LIMIT 1
        `).get(workOrderId, namespace) as DbOmcWorkOrderRow | undefined

        return row ? toWorkOrder(row) : null
    }

    listWorkOrders(programId: string, namespace: string): OmcWorkOrder[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_work_orders
            WHERE program_id = ? AND namespace = ?
            ORDER BY updated_at DESC, id ASC
        `).all(programId, namespace) as DbOmcWorkOrderRow[]

        return rows.map(toWorkOrder)
    }

    upsertWorkOrder(namespace: string, input: {
        id: string
        programId: string
        goalId?: string | null
        planKey?: string | null
        title: string
        owner?: OmcWorkOrder['owner']
        status?: OmcWorkOrder['status']
        currentAttemptId?: string | null
        reviewerVerdict?: OmcWorkOrder['reviewerVerdict']
        blockedReason?: string | null
        latestAcceptedAttemptId?: string | null
        createdAt?: number
        updatedAt?: number
    }): OmcWorkOrder {
        const current = this.getWorkOrderByNamespace(input.id, namespace)
        const now = Date.now()
        const next = OmcWorkOrderSchema.parse({
            id: input.id,
            programId: input.programId,
            goalId: input.goalId !== undefined ? input.goalId : current?.goalId ?? null,
            planKey: input.planKey !== undefined ? input.planKey : current?.planKey ?? null,
            title: input.title,
            owner: input.owner !== undefined ? input.owner : current?.owner ?? null,
            status: input.status ?? current?.status ?? 'ready',
            currentAttemptId: input.currentAttemptId !== undefined ? input.currentAttemptId : current?.currentAttemptId ?? null,
            reviewerVerdict: input.reviewerVerdict !== undefined ? input.reviewerVerdict : current?.reviewerVerdict ?? null,
            blockedReason: input.blockedReason !== undefined ? input.blockedReason : current?.blockedReason ?? null,
            latestAcceptedAttemptId: input.latestAcceptedAttemptId !== undefined ? input.latestAcceptedAttemptId : current?.latestAcceptedAttemptId ?? null,
            createdAt: current?.createdAt ?? input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        })

        this.db.prepare(`
            INSERT INTO omc_work_orders (
                id, program_id, namespace, goal_id, plan_key, title, owner,
                status, current_attempt_id, reviewer_verdict, blocked_reason,
                latest_accepted_attempt_id, created_at, updated_at
            ) VALUES (
                @id, @program_id, @namespace, @goal_id, @plan_key, @title, @owner,
                @status, @current_attempt_id, @reviewer_verdict, @blocked_reason,
                @latest_accepted_attempt_id, @created_at, @updated_at
            )
            ON CONFLICT(namespace, id) DO UPDATE SET
                program_id = excluded.program_id,
                goal_id = excluded.goal_id,
                plan_key = excluded.plan_key,
                title = excluded.title,
                owner = excluded.owner,
                status = excluded.status,
                current_attempt_id = excluded.current_attempt_id,
                reviewer_verdict = excluded.reviewer_verdict,
                blocked_reason = excluded.blocked_reason,
                latest_accepted_attempt_id = excluded.latest_accepted_attempt_id,
                updated_at = excluded.updated_at
        `).run({
            id: next.id,
            program_id: next.programId,
            namespace,
            goal_id: next.goalId ?? null,
            plan_key: next.planKey ?? null,
            title: next.title,
            owner: next.owner ?? null,
            status: next.status,
            current_attempt_id: next.currentAttemptId ?? null,
            reviewer_verdict: next.reviewerVerdict ?? null,
            blocked_reason: next.blockedReason ?? null,
            latest_accepted_attempt_id: next.latestAcceptedAttemptId ?? null,
            created_at: next.createdAt,
            updated_at: next.updatedAt,
        })

        const stored = this.getWorkOrderByNamespace(next.id, namespace)
        if (!stored) {
            throw new Error('Failed to upsert OMC work order')
        }
        return stored
    }

    updateWorkOrder(namespace: string, workOrderId: string, patch: {
        goalId?: string | null
        planKey?: string | null
        title?: string
        owner?: OmcWorkOrder['owner']
        status?: OmcWorkOrder['status']
        currentAttemptId?: string | null
        reviewerVerdict?: OmcWorkOrder['reviewerVerdict']
        blockedReason?: string | null
        latestAcceptedAttemptId?: string | null
        updatedAt?: number
    }): OmcWorkOrder | null {
        const current = this.getWorkOrderByNamespace(workOrderId, namespace)
        if (!current) {
            return null
        }

        return this.upsertWorkOrder(namespace, {
            id: current.id,
            programId: current.programId,
            goalId: patch.goalId !== undefined ? patch.goalId : current.goalId,
            planKey: patch.planKey !== undefined ? patch.planKey : current.planKey,
            title: patch.title ?? current.title,
            owner: patch.owner !== undefined ? patch.owner : current.owner,
            status: patch.status ?? current.status,
            currentAttemptId: patch.currentAttemptId !== undefined ? patch.currentAttemptId : current.currentAttemptId,
            reviewerVerdict: patch.reviewerVerdict !== undefined ? patch.reviewerVerdict : current.reviewerVerdict,
            blockedReason: patch.blockedReason !== undefined ? patch.blockedReason : current.blockedReason,
            latestAcceptedAttemptId: patch.latestAcceptedAttemptId !== undefined ? patch.latestAcceptedAttemptId : current.latestAcceptedAttemptId,
            createdAt: current.createdAt,
            updatedAt: patch.updatedAt,
        })
    }

    addWorkAttempt(namespace: string, input: {
        id: string
        programId: string
        workOrderId: string
        role: OmcWorkAttempt['role']
        sessionId?: string | null
        status: OmcWorkAttempt['status']
        summary?: string | null
        sourceMailboxMessageId?: string | null
        createdAt?: number
        completedAt?: number | null
    }): OmcWorkAttempt {
        const now = input.createdAt ?? Date.now()
        const next = OmcWorkAttemptSchema.parse({
            id: input.id,
            programId: input.programId,
            workOrderId: input.workOrderId,
            role: input.role,
            sessionId: input.sessionId ?? null,
            status: input.status,
            summary: input.summary ?? null,
            sourceMailboxMessageId: input.sourceMailboxMessageId ?? null,
            createdAt: now,
            updatedAt: now,
            completedAt: input.completedAt ?? null,
        })

        this.db.prepare(`
            INSERT INTO omc_work_attempts (
                id, program_id, namespace, work_order_id, role, session_id,
                status, summary, source_mailbox_message_id, created_at, updated_at, completed_at
            ) VALUES (
                @id, @program_id, @namespace, @work_order_id, @role, @session_id,
                @status, @summary, @source_mailbox_message_id, @created_at, @updated_at, @completed_at
            )
        `).run({
            id: next.id,
            program_id: next.programId,
            namespace,
            work_order_id: next.workOrderId,
            role: next.role,
            session_id: next.sessionId ?? null,
            status: next.status,
            summary: next.summary ?? null,
            source_mailbox_message_id: next.sourceMailboxMessageId ?? null,
            created_at: next.createdAt,
            updated_at: next.updatedAt,
            completed_at: next.completedAt ?? null,
        })

        const stored = this.getWorkAttemptByNamespace(next.id, namespace)
        if (!stored) {
            throw new Error('Failed to insert OMC work attempt')
        }
        return stored
    }

    getWorkAttemptByNamespace(attemptId: string, namespace: string): OmcWorkAttempt | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_work_attempts
            WHERE id = ? AND namespace = ?
            LIMIT 1
        `).get(attemptId, namespace) as DbOmcWorkAttemptRow | undefined

        return row ? toWorkAttempt(row) : null
    }

    listWorkAttempts(programId: string, workOrderId: string, namespace: string): OmcWorkAttempt[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_work_attempts
            WHERE program_id = ? AND work_order_id = ? AND namespace = ?
            ORDER BY created_at DESC, id DESC
        `).all(programId, workOrderId, namespace) as DbOmcWorkAttemptRow[]

        return rows.map(toWorkAttempt)
    }

    listWorkAttemptsForProgram(programId: string, namespace: string): OmcWorkAttempt[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_work_attempts
            WHERE program_id = ? AND namespace = ?
            ORDER BY created_at DESC, id DESC
        `).all(programId, namespace) as DbOmcWorkAttemptRow[]

        return rows.map(toWorkAttempt)
    }

    updateWorkAttempt(namespace: string, attemptId: string, patch: {
        sessionId?: string | null
        status?: OmcWorkAttempt['status']
        summary?: string | null
        sourceMailboxMessageId?: string | null
        completedAt?: number | null
    }): OmcWorkAttempt | null {
        const current = this.getWorkAttemptByNamespace(attemptId, namespace)
        if (!current) {
            return null
        }

        const next = OmcWorkAttemptSchema.parse({
            ...current,
            sessionId: patch.sessionId !== undefined ? patch.sessionId : current.sessionId,
            status: patch.status ?? current.status,
            summary: patch.summary !== undefined ? patch.summary : current.summary,
            sourceMailboxMessageId: patch.sourceMailboxMessageId !== undefined ? patch.sourceMailboxMessageId : current.sourceMailboxMessageId,
            completedAt: patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
            updatedAt: Date.now(),
        })

        this.db.prepare(`
            UPDATE omc_work_attempts
            SET session_id = @session_id,
                status = @status,
                summary = @summary,
                source_mailbox_message_id = @source_mailbox_message_id,
                updated_at = @updated_at,
                completed_at = @completed_at
            WHERE id = @id AND namespace = @namespace
        `).run({
            id: attemptId,
            namespace,
            session_id: next.sessionId ?? null,
            status: next.status,
            summary: next.summary ?? null,
            source_mailbox_message_id: next.sourceMailboxMessageId ?? null,
            updated_at: next.updatedAt,
            completed_at: next.completedAt ?? null,
        })

        return this.getWorkAttemptByNamespace(attemptId, namespace)
    }

    upsertCoordinationAgentState(namespace: string, input: {
        programId: string
        role: OmcCoordinationAgentState['role']
        busy: boolean
        currentWorkOrderId?: string | null
        activeSessionId?: string | null
        model?: string | null
        mode?: string | null
        lastHeartbeat?: number
    }): OmcCoordinationAgentState {
        const next = OmcCoordinationAgentStateSchema.parse({
            programId: input.programId,
            role: input.role,
            busy: input.busy,
            currentWorkOrderId: input.currentWorkOrderId ?? null,
            activeSessionId: input.activeSessionId ?? null,
            model: input.model ?? null,
            mode: input.mode ?? null,
            lastHeartbeat: input.lastHeartbeat ?? Date.now(),
        })

        this.db.prepare(`
            INSERT INTO omc_coordination_agents (
                program_id, namespace, role, busy, current_work_order_id,
                active_session_id, model, mode, last_heartbeat
            ) VALUES (
                @program_id, @namespace, @role, @busy, @current_work_order_id,
                @active_session_id, @model, @mode, @last_heartbeat
            )
            ON CONFLICT(namespace, program_id, role) DO UPDATE SET
                busy = excluded.busy,
                current_work_order_id = excluded.current_work_order_id,
                active_session_id = excluded.active_session_id,
                model = excluded.model,
                mode = excluded.mode,
                last_heartbeat = excluded.last_heartbeat
        `).run({
            program_id: next.programId,
            namespace,
            role: next.role,
            busy: next.busy ? 1 : 0,
            current_work_order_id: next.currentWorkOrderId ?? null,
            active_session_id: next.activeSessionId ?? null,
            model: next.model ?? null,
            mode: next.mode ?? null,
            last_heartbeat: next.lastHeartbeat,
        })

        const stored = this.getCoordinationAgentState(next.programId, next.role, namespace)
        if (!stored) {
            throw new Error('Failed to upsert OMC coordination agent state')
        }
        return stored
    }

    getCoordinationAgentState(programId: string, role: OmcCoordinationAgentState['role'], namespace: string): OmcCoordinationAgentState | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_coordination_agents
            WHERE program_id = ? AND role = ? AND namespace = ?
            LIMIT 1
        `).get(programId, role, namespace) as DbOmcCoordinationAgentStateRow | undefined

        return row ? toCoordinationAgentState(row) : null
    }

    listCoordinationAgentStates(programId: string, namespace: string): OmcCoordinationAgentState[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_coordination_agents
            WHERE program_id = ? AND namespace = ?
            ORDER BY role ASC
        `).all(programId, namespace) as DbOmcCoordinationAgentStateRow[]

        return rows.map(toCoordinationAgentState)
    }

    upsertDirectiveLedgerEntry(namespace: string, input: {
        id: string
        programId: string
        scopeType: OmcDirectiveLedgerEntry['scopeType']
        scopeId: string
        sourceTopicId?: string | null
        key: string
        summary: string
        rawText?: string | null
        createdAt?: number
        updatedAt?: number
    }): OmcDirectiveLedgerEntry {
        const current = this.getDirectiveLedgerEntryByNamespace(input.id, namespace)
        const now = Date.now()
        const next = OmcDirectiveLedgerEntrySchema.parse({
            id: input.id,
            programId: input.programId,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            sourceTopicId: input.sourceTopicId ?? current?.sourceTopicId ?? null,
            key: input.key,
            summary: input.summary,
            rawText: input.rawText ?? current?.rawText ?? null,
            createdAt: current?.createdAt ?? input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        })

        this.db.prepare(`
            INSERT INTO omc_directive_ledger (
                id, program_id, namespace, scope_type, scope_id, source_topic_id,
                key, summary, raw_text, created_at, updated_at
            ) VALUES (
                @id, @program_id, @namespace, @scope_type, @scope_id, @source_topic_id,
                @key, @summary, @raw_text, @created_at, @updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
                program_id = excluded.program_id,
                namespace = excluded.namespace,
                scope_type = excluded.scope_type,
                scope_id = excluded.scope_id,
                source_topic_id = excluded.source_topic_id,
                key = excluded.key,
                summary = excluded.summary,
                raw_text = excluded.raw_text,
                updated_at = excluded.updated_at
        `).run({
            id: next.id,
            program_id: next.programId,
            namespace,
            scope_type: next.scopeType,
            scope_id: next.scopeId,
            source_topic_id: next.sourceTopicId ?? null,
            key: next.key,
            summary: next.summary,
            raw_text: next.rawText ?? null,
            created_at: next.createdAt,
            updated_at: next.updatedAt,
        })

        const stored = this.getDirectiveLedgerEntryByNamespace(next.id, namespace)
        if (!stored) {
            throw new Error('Failed to upsert OMC directive ledger entry')
        }
        return stored
    }

    getDirectiveLedgerEntryByNamespace(entryId: string, namespace: string): OmcDirectiveLedgerEntry | null {
        const row = this.db.prepare(`
            SELECT * FROM omc_directive_ledger
            WHERE id = ? AND namespace = ?
            LIMIT 1
        `).get(entryId, namespace) as DbOmcDirectiveLedgerEntryRow | undefined

        return row ? toDirectiveLedgerEntry(row) : null
    }

    listDirectiveLedgerEntries(programId: string, namespace: string): OmcDirectiveLedgerEntry[] {
        const rows = this.db.prepare(`
            SELECT * FROM omc_directive_ledger
            WHERE program_id = ? AND namespace = ?
            ORDER BY updated_at DESC, id ASC
        `).all(programId, namespace) as DbOmcDirectiveLedgerEntryRow[]

        return rows.map(toDirectiveLedgerEntry)
    }
}
