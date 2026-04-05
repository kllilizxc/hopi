import type { Database } from 'bun:sqlite'
import {
    OmcAttemptSchema,
    OmcEvidenceSchema,
    OmcGuidedPlanningBriefSchema,
    OmcGuidedPlanningRunSchema,
    OmcPlanRuntimeSchema,
    OmcProgramSchema
} from '@hopi/protocol/schemas'
import type {
    OmcAttempt,
    OmcAttemptCheck,
    OmcContextPack,
    OmcEvidence,
    OmcGuidedPlanningBrief,
    OmcGuidedPlanningRun,
    OmcPlanRuntime,
    OmcProgram
} from '@hopi/protocol/types'
import type {
    OmcAttemptRow,
    OmcEvidenceRow,
    OmcPlanningRunRow,
    OmcPlanRuntimeRow,
    OmcProgramRow
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

export class OmcRuntimeStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
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
}
