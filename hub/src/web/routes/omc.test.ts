import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createOmcRoutes } from './omc'

const createdPaths: string[] = []

function createTestApp(store: Store, engine?: SyncEngine | null): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createOmcRoutes({
        store,
        getSyncEngine: engine ? () => engine : undefined
    }))
    return app
}

function createLocalRepoFixture(name: string): string {
    const root = mkdtempSync(join(tmpdir(), `hopi-omc-repo-${name}-`))
    createdPaths.push(root)

    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')

    return root
}

function makeSeedOnlyRepoFixture(name: string): { repoRoot: string; planningRoot: string } {
    const repoRoot = createLocalRepoFixture(name)
    const planningRoot = join(repoRoot, '.planning')
    const phaseDir = join(planningRoot, 'phases', '01-bootstrap')
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(planningRoot, 'PROJECT.md'), '# Project\n')
    writeFileSync(join(planningRoot, 'ROADMAP.md'), '# Roadmap\n')
    writeFileSync(join(phaseDir, '01-CONTEXT.md'), '# Context\n')
    return { repoRoot, planningRoot }
}

function makeWorkspaceFixture(): { repoRoot: string; planningRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'hopi-omc-route-'))
    createdPaths.push(root)

    const repoRoot = join(root, 'hopi')
    const planningRoot = join(root, '.planning')
    mkdirSync(repoRoot, { recursive: true })
    mkdirSync(join(planningRoot, 'phases', '01-omc-foundation'), { recursive: true })
    writeFileSync(join(planningRoot, 'PROJECT.md'), '# Project\n')
    writeFileSync(join(planningRoot, 'ROADMAP.md'), '# Roadmap\n')

    const phaseDir = join(planningRoot, 'phases', '01-omc-foundation')
    writeFileSync(join(phaseDir, '01-CONTEXT.md'), '# Context\n')
    writeFileSync(join(phaseDir, '01-RESEARCH.md'), '# Research\n')
    writeFileSync(join(phaseDir, '01-01-PLAN.md'), `---
phase: 01-omc-foundation
plan: 01
---

<objective>
Seed the OMC runtime contract.
Purpose: Establish OMC shared and hub foundations.
</objective>

<tasks>
<task type="auto">
  <name>Introduce shared OMC schemas</name>
</task>
<task type="auto">
  <name>Expose /api/omc planning-index routes</name>
</task>
</tasks>
`)

    writeFileSync(join(phaseDir, '01-02-PLAN.md'), `---
phase: 01-omc-foundation
plan: 02
---

<objective>
Build the OMC board shell.
Purpose: Render the phase-grouped board.
</objective>

<tasks>
<task type="auto">
  <name>Create OMC-client</name>
</task>
</tasks>
`)
    writeFileSync(join(phaseDir, '01-02-SUMMARY.md'), '# Complete\n')

    return { repoRoot, planningRoot }
}

function makeMergeEngine(repoRoot: string, overrides?: {
    mergeState?: () => Promise<{
        success: boolean
        targetBranch?: string
        sourceBranch?: string
        hasWorkingTreeChanges?: boolean
        committedChangedCount?: number
        mergeable?: boolean
        stdout?: string
        stderr?: string
        error?: string
    }>
    mergeResult?: () => Promise<{
        success: boolean
        commitHash?: string
        skippedReason?: 'no_changes'
        conflictFiles?: string[]
        stdout?: string
        stderr?: string
        error?: string
    }>
}): SyncEngine {
    return {
        getSessionByNamespace() {
            return {
                metadata: {
                    path: repoRoot,
                    machineId: 'machine-1',
                    worktree: {
                        basePath: repoRoot,
                        worktreePath: `${repoRoot}-worktree`,
                        branch: 'hopi-omc-01-01'
                    }
                }
            }
        },
        async gitMergeWorktreeState() {
            return await overrides?.mergeState?.() ?? {
                success: true,
                targetBranch: 'main',
                sourceBranch: 'hopi-omc-01-01',
                hasWorkingTreeChanges: false,
                committedChangedCount: 2,
                mergeable: true
            }
        },
        async gitMergeWorktree() {
            return await overrides?.mergeResult?.() ?? {
                success: true,
                commitHash: 'abc123'
            }
        },
        handleRealtimeEvent() {
            return
        }
    } as unknown as SyncEngine
}

function makeGuidedPlanningEngine(repoRoot: string): {
    engine: SyncEngine
    sentMessages: string[]
    abortedSessions: string[]
} {
    let spawnCount = 0
    const sentMessages: string[] = []
    const abortedSessions: string[] = []

    const engine = {
        getMachineByNamespace() {
            return undefined
        },
        getOnlineMachinesByNamespace() {
            return [{ id: 'machine-1', active: true }]
        },
        async spawnSession() {
            spawnCount += 1
            return { type: 'success' as const, sessionId: `planning-session-${spawnCount}` }
        },
        async waitForSessionActive() {
            return true
        },
        async applySessionConfig() {
            return
        },
        getSessionByNamespace(sessionId: string) {
            return {
                metadata: {
                    path: repoRoot,
                    machineId: 'machine-1',
                    codexSessionId: sessionId
                }
            }
        },
        async sendMessage(_sessionId: string, payload: { text: string }) {
            sentMessages.push(payload.text)
        },
        async abortSession(sessionId: string) {
            abortedSessions.push(sessionId)
        },
        handleRealtimeEvent() {
            return
        }
    } as unknown as SyncEngine

    return { engine, sentMessages, abortedSessions }
}

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (!path) {
            continue
        }
        rmSync(path, { recursive: true, force: true })
    }
})

describe('omc routes', () => {
    it('attaches a local git repo as a new OMC program', async () => {
        const store = new Store(':memory:')
        const repoRoot = createLocalRepoFixture('attach')
        const app = createTestApp(store)

        const response = await app.request('/api/omc/programs/attach-local-repo', {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                repoRoot,
                name: 'PersonalQuant'
            })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            program: { name: string; repoRoot: string; planningRoot: string }
            planning: { status: string; hasPlanning: boolean; hasPlans: boolean }
        }

        expect(body.program.name).toBe('PersonalQuant')
        expect(body.program.repoRoot).toBe(repoRoot)
        expect(body.program.repoRoot).not.toBe(process.cwd())
        expect(body.program.planningRoot).toContain(repoRoot)
        expect(body.planning.status).toBe('missing')
        expect(body.planning.hasPlanning).toBe(false)
        expect(body.planning.hasPlans).toBe(false)
    })

    it('rejects attach-local-repo for non-git inputs', async () => {
        const store = new Store(':memory:')
        const invalidRoot = mkdtempSync(join(tmpdir(), 'hopi-omc-invalid-'))
        createdPaths.push(invalidRoot)
        const app = createTestApp(store)

        const response = await app.request('/api/omc/programs/attach-local-repo', {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                repoRoot: invalidRoot
            })
        })

        expect(response.status).toBe(400)
        const body = await response.json() as { error: string }
        expect(body.error).toContain('local git repo')
    })

    it('attaches an explicit planning root for an attached program', async () => {
        const store = new Store(':memory:')
        const repoRoot = createLocalRepoFixture('planning-root')
        const fixture = makeWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-attach',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot,
            planningRoot: join(repoRoot, '.planning'),
            primaryBranch: 'main',
            targetBranch: 'main'
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/omc/programs/${program.id}/attach-planning-root`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                planningRoot: fixture.planningRoot
            })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            program: { planningRoot: string }
            planning: { status: string; hasPlanning: boolean; hasPlans: boolean; planCount: number }
        }

        expect(body.program.planningRoot).toBe(fixture.planningRoot)
        expect(body.planning.status).toBe('attached')
        expect(body.planning.hasPlanning).toBe(true)
        expect(body.planning.hasPlans).toBe(true)
        expect(body.planning.planCount).toBe(2)
    })

    it('creates a repo-local planning seed for an attached repo without planning', async () => {
        const store = new Store(':memory:')
        const repoRoot = createLocalRepoFixture('seed')
        const program = store.omcRuntime.upsertProgram({
            id: 'program-seed',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot,
            planningRoot: join(repoRoot, '.planning'),
            primaryBranch: 'main',
            targetBranch: 'main'
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/omc/programs/${program.id}/create-planning-seed`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            program: { planningRoot: string }
            planning: { status: string; hasPlanning: boolean; hasPlans: boolean; seedFiles: string[] }
        }

        expect(body.program.planningRoot).toBe(join(repoRoot, '.planning'))
        expect(body.planning.status).toBe('seeded')
        expect(body.planning.hasPlanning).toBe(true)
        expect(body.planning.hasPlans).toBe(false)
        expect(body.planning.seedFiles).toContain('.planning/PROJECT.md')
        expect(body.planning.seedFiles).toContain('.planning/phases/01-bootstrap/01-CONTEXT.md')
    })

    it('starts guided planning from a seed-only program', async () => {
        const store = new Store(':memory:')
        const fixture = makeSeedOnlyRepoFixture('guided-start')
        const program = store.omcRuntime.upsertProgram({
            id: 'program-guided-start',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            primaryBranch: 'main',
            targetBranch: 'main'
        })
        const runtime = makeGuidedPlanningEngine(fixture.repoRoot)
        const app = createTestApp(store, runtime.engine)

        const response = await app.request(`/api/omc/programs/${program.id}/planning-run/start`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                brief: {
                    productIntent: 'PersonalQuant tracks portfolio performance.',
                    firstSlice: 'Create the first executable plan cards for ingestion and analytics.'
                }
            })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            planning: { hasPlanning: boolean; hasPlans: boolean }
            run: { status: string; stage: string; sessionId: string | null }
        }

        expect(body.planning.hasPlanning).toBe(true)
        expect(body.planning.hasPlans).toBe(false)
        expect(body.run.status).toBe('running')
        expect(body.run.stage).toBe('plan')
        expect(body.run.sessionId).toBe('planning-session-1')
        expect(runtime.sentMessages).toHaveLength(1)
        expect(runtime.sentMessages[0]).toContain('OMC_GUIDED_PLANNING_OUTCOME')
    })

    it('retries guided planning using the previous brief', async () => {
        const store = new Store(':memory:')
        const fixture = makeSeedOnlyRepoFixture('guided-retry')
        const program = store.omcRuntime.upsertProgram({
            id: 'program-guided-retry',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            primaryBranch: 'main',
            targetBranch: 'main'
        })
        store.omcRuntime.addPlanningRun('default', {
            id: 'planning-run-failed',
            programId: program.id,
            status: 'failed',
            stage: 'plan',
            brief: {
                productIntent: 'PersonalQuant tracks portfolio performance.',
                firstSlice: 'Create the first executable plan cards for ingestion and analytics.'
            },
            summary: 'Previous guided planning run failed.',
            error: 'session-inactive',
            completedAt: Date.now()
        })
        const runtime = makeGuidedPlanningEngine(fixture.repoRoot)
        const app = createTestApp(store, runtime.engine)

        const response = await app.request(`/api/omc/programs/${program.id}/planning-run/retry`, {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            run: { id: string; status: string; sessionId: string | null }
        }

        expect(body.run.id).not.toBe('planning-run-failed')
        expect(body.run.status).toBe('running')
        expect(body.run.sessionId).toBe('planning-session-1')
        expect(runtime.sentMessages).toHaveLength(1)
    })

    it('cancels an active guided planning run', async () => {
        const store = new Store(':memory:')
        const fixture = makeSeedOnlyRepoFixture('guided-cancel')
        const program = store.omcRuntime.upsertProgram({
            id: 'program-guided-cancel',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            primaryBranch: 'main',
            targetBranch: 'main'
        })
        store.omcRuntime.addPlanningRun('default', {
            id: 'planning-run-active',
            programId: program.id,
            status: 'running',
            stage: 'plan',
            brief: {
                productIntent: 'PersonalQuant tracks portfolio performance.',
                firstSlice: 'Create the first executable plan cards for ingestion and analytics.'
            },
            sessionId: 'planning-session-9',
            summary: 'Guided planning is running.'
        })
        const runtime = makeGuidedPlanningEngine(fixture.repoRoot)
        const app = createTestApp(store, runtime.engine)

        const response = await app.request(`/api/omc/programs/${program.id}/planning-run/cancel`, {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            run: { status: string; completedAt: number | null }
        }

        expect(body.run.status).toBe('canceled')
        expect(typeof body.run.completedAt).toBe('number')
        expect(runtime.abortedSessions).toEqual(['planning-session-9'])
    })

    it('returns the latest guided-planning runtime state for a program', async () => {
        const store = new Store(':memory:')
        const fixture = makeSeedOnlyRepoFixture('planning-run')
        const program = store.omcRuntime.upsertProgram({
            id: 'program-guided-planning',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            primaryBranch: 'main',
            targetBranch: 'main'
        })
        store.omcRuntime.addPlanningRun('default', {
            id: 'planning-run-1',
            programId: program.id,
            status: 'running',
            stage: 'discuss',
            brief: {
                productIntent: 'PersonalQuant analyzes personal portfolio performance.',
                firstSlice: 'Generate the first executable planning cards for portfolio ingest and analytics.'
            },
            sessionId: 'session-guided-1',
            summary: 'Reading the seed scaffold and preparing the first discuss outputs.'
        })

        const runtime = makeGuidedPlanningEngine(fixture.repoRoot)
        const app = createTestApp(store, runtime.engine)
        const response = await app.request(`/api/omc/programs/${program.id}/planning-run`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            programId: string
            planning: { hasPlanning: boolean; hasPlans: boolean; planCount: number }
            run: {
                id: string
                status: string
                stage: string
                sessionId: string | null
                brief: { productIntent: string; firstSlice: string }
            } | null
        }

        expect(body.programId).toBe(program.id)
        expect(body.planning.hasPlanning).toBe(true)
        expect(body.planning.hasPlans).toBe(false)
        expect(body.planning.planCount).toBe(0)
        expect(body.run?.id).toBe('planning-run-1')
        expect(body.run?.status).toBe('running')
        expect(body.run?.stage).toBe('plan')
        expect(body.run?.sessionId).toBe('session-guided-1')
        expect(body.run?.brief.productIntent).toContain('PersonalQuant')
        expect(body.run?.brief.firstSlice).toContain('planning cards')
    })

    it('reconciles a running guided-planning run once executable plan cards appear', async () => {
        const store = new Store(':memory:')
        const fixture = makeSeedOnlyRepoFixture('planning-run-reconcile')
        const phaseDir = join(fixture.planningRoot, 'phases', '01-bootstrap')
        const program = store.omcRuntime.upsertProgram({
            id: 'program-guided-reconcile',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            primaryBranch: 'main',
            targetBranch: 'main'
        })
        store.omcRuntime.addPlanningRun('default', {
            id: 'planning-run-active',
            programId: program.id,
            status: 'running',
            stage: 'plan',
            brief: {
                productIntent: 'PersonalQuant analyzes personal portfolio performance.',
                firstSlice: 'Generate the first executable planning cards for portfolio ingest and analytics.'
            },
            sessionId: 'session-guided-1',
            summary: 'Guided planning is actively drafting the first executable plan cards.'
        })
        writeFileSync(join(phaseDir, '01-01-PLAN.md'), `---
phase: 01-bootstrap
plan: 01
---

<objective>
Create the first executable PersonalQuant plan.
Purpose: Validate that guided-planning polling can reconcile into a completed handoff.
</objective>

<tasks>
<task type="auto">
  <name>Capture the first analytics planning slice</name>
</task>
</tasks>
`)

        const runtime = makeGuidedPlanningEngine(fixture.repoRoot)
        const app = createTestApp(store, runtime.engine)
        const response = await app.request(`/api/omc/programs/${program.id}/planning-run`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            planning: { hasPlans: boolean; planCount: number }
            run: { status: string; stage: string; generatedPlanPaths: string[] } | null
        }

        expect(body.planning.hasPlans).toBe(true)
        expect(body.planning.planCount).toBe(1)
        expect(body.run?.status).toBe('completed')
        expect(body.run?.stage).toBe('handoff')
        expect(body.run?.generatedPlanPaths).toContain('.planning/phases/01-bootstrap/01-01-PLAN.md')
    })

    it('returns planning-index data grouped by phase from GSD plan files', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })

        const app = createTestApp(store)
        const response = await app.request('/api/omc/programs/program-1/planning-index')

        expect(response.status).toBe(200)
        const body = await response.json() as {
            program: { id: string }
            phases: Array<{
                phaseKey: string
                plans: Array<{ planKey: string; checklistTotal: number; checklistDone: number; firstOpenItem: string | null }>
            }>
        }

        expect(body.program.id).toBe('program-1')
        expect(body.phases).toHaveLength(1)
        expect(body.phases[0]?.phaseKey).toBe('01-omc-foundation')
        expect(body.phases[0]?.plans.map((plan) => plan.planKey)).toEqual(['01-01', '01-02'])
        expect(body.phases[0]?.plans[0]?.checklistTotal).toBe(2)
        expect(body.phases[0]?.plans[0]?.checklistDone).toBe(0)
        expect(body.phases[0]?.plans[0]?.firstOpenItem).toBe('Introduce shared OMC schemas')
        expect(body.phases[0]?.plans[1]?.checklistDone).toBe(1)
    })

    it('returns plan detail with runtime state', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Running',
            loopStatus: 'running',
            attemptCount: 2,
            consecutiveFailureCount: 1,
            lastFailureFingerprint: 'typecheck:shared',
            currentWorktreePath: '/tmp/worktree-1',
            currentBranch: 'omc/01-01'
        })

        const app = createTestApp(store)
        const response = await app.request('/api/omc/programs/program-1/plans/01-01')

        expect(response.status).toBe(200)
        const body = await response.json() as {
            plan: { planTitle: string; checklist: Array<{ text: string }> }
            runtime: { column: string; attemptCount: number; lastFailureFingerprint: string | null }
            attempts: Array<{ id: string }>
            evidence: Array<{ id: string }>
        }

        expect(body.plan.planTitle).toBe('Seed the OMC runtime contract.')
        expect(body.plan.checklist).toHaveLength(2)
        expect(body.runtime.column).toBe('Running')
        expect(body.runtime.attemptCount).toBe(2)
        expect(body.runtime.lastFailureFingerprint).toBe('typecheck:shared')
        expect(body.attempts).toHaveLength(0)
        expect(body.evidence).toHaveLength(0)
    })

    it('returns attempt detail with evidence', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            attemptNumber: 1,
            status: 'progressed',
            summary: 'Added shared schemas',
            terminationReason: 'structured-completion',
            changedFiles: ['shared/src/schemas.ts']
        })
        store.omcRuntime.addEvidence('default', {
            id: 'evidence-1',
            programId: 'program-1',
            planKey: '01-01',
            attemptId: 'attempt-1',
            kind: 'check',
            label: 'typecheck:hub',
            status: 'passed',
            summary: 'hub types compile'
        })

        const app = createTestApp(store)
        const response = await app.request('/api/omc/attempts/attempt-1')

        expect(response.status).toBe(200)
        const body = await response.json() as {
            attempt: { id: string; summary: string | null; terminationReason: string | null }
            evidence: Array<{ id: string; label: string }>
        }

        expect(body.attempt.id).toBe('attempt-1')
        expect(body.attempt.summary).toBe('Added shared schemas')
        expect(body.attempt.terminationReason).toBe('structured-completion')
        expect(body.evidence).toHaveLength(1)
        expect(body.evidence[0]?.label).toBe('typecheck:hub')
    })

    it('starts one manual plan attempt and records context-pack evidence', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })

        const dispatchedMessages: string[] = []
        const engine = {
            getMachineByNamespace() {
                return undefined
            },
            getOnlineMachinesByNamespace() {
                return [{ id: 'machine-1', active: true }]
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: 'session-1' }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
                return
            },
            getSessionByNamespace() {
                return {
                    metadata: {
                        path: fixture.repoRoot,
                        worktree: {
                            basePath: fixture.repoRoot,
                            worktreePath: `${fixture.repoRoot}-worktree`,
                            branch: 'hopi-omc-01-01'
                        }
                    }
                }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                dispatchedMessages.push(payload.text)
            },
            handleRealtimeEvent() {
                return
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request('/api/omc/programs/program-1/plans/01-01/start', {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            planKey: string
            runtime: { column: string; loopStatus: string; attemptCount: number; currentWorktreePath: string | null }
            attempt: {
                status: string
                sessionId: string | null
                contextPack: {
                    currentObjective: { smallestNextStep: string | null }
                    outputContract: { requiredFields: string[] }
                    promptText: string
                } | null
            }
            evidence: Array<{ label: string }>
        }

        expect(body.planKey).toBe('01-01')
        expect(body.runtime.column).toBe('Running')
        expect(body.runtime.loopStatus).toBe('running')
        expect(body.runtime.attemptCount).toBe(1)
        expect(body.runtime.currentWorktreePath).toContain('-worktree')
        expect(body.attempt.status).toBe('running')
        expect(body.attempt.sessionId).toBe('session-1')
        expect(body.attempt.contextPack?.currentObjective.smallestNextStep).toBe('Introduce shared OMC schemas')
        expect(body.attempt.contextPack?.outputContract.requiredFields).toContain('summary')
        expect(body.evidence.map((item) => item.label).sort()).toEqual(['context-pack', 'prompt-dispatched', 'session-start'])
        expect(dispatchedMessages).toHaveLength(1)
        expect(dispatchedMessages[0]).toContain('You are running one OMC attempt')
    })

    it('prepares a takeover session from the plan control API', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            reviewRequired: true,
            updatedAt: Date.now()
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            loopRunId: 'loop-1',
            sessionId: 'session-1',
            attemptNumber: 1,
            status: 'blocked',
            summary: 'Need a human decision',
            terminationReason: 'structured-completion'
        })

        const engine = {
            getSessionByNamespace() {
                return {
                    active: true,
                    metadata: {
                        machineId: 'machine-1',
                        path: fixture.repoRoot,
                        worktree: {
                            basePath: fixture.repoRoot,
                            worktreePath: `${fixture.repoRoot}-worktree`,
                            branch: 'hopi-omc-01-01'
                        }
                    }
                }
            },
            getMachineByNamespace() {
                return { id: 'machine-1', active: true }
            },
            getOnlineMachinesByNamespace() {
                return [{ id: 'machine-1', active: true }]
            },
            handleRealtimeEvent() {
                return
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request('/api/omc/programs/program-1/plans/01-01/takeover', {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            runtime: { column: string; loopStatus: string; reviewRequired: boolean }
            sessionId: string | null
            sessionUrl: string | null
        }

        expect(body.runtime.column).toBe('Review')
        expect(body.runtime.loopStatus).toBe('review')
        expect(body.runtime.reviewRequired).toBe(true)
        expect(body.sessionId).toBe('session-1')
        expect(body.sessionUrl).toBe('/sessions/session-1/terminal')
    })

    it('returns a merge packet for a reviewable plan', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            targetBranch: 'main'
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            reviewRequired: true,
            latestEvidenceSummary: 'Waiting for human review.'
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            loopRunId: 'loop-1',
            sessionId: 'session-1',
            attemptNumber: 1,
            status: 'completed',
            summary: 'Completed the contract work.',
            terminationReason: 'structured-completion',
            changedFiles: ['shared/src/schemas.ts'],
            checks: [
                { label: 'bun run typecheck', result: 'passed', detail: 'Shared types compile.' }
            ]
        })
        store.omcRuntime.addEvidence('default', {
            id: 'evidence-1',
            programId: 'program-1',
            planKey: '01-01',
            attemptId: 'attempt-1',
            kind: 'diff',
            label: 'diff-summary',
            status: 'info',
            summary: '1 file currently changed in the worktree.',
            payload: {
                files: [{ fullPath: 'shared/src/schemas.ts' }]
            }
        })

        const app = createTestApp(store)
        const response = await app.request('/api/omc/programs/program-1/plans/01-01/merge-packet')

        expect(response.status).toBe(200)
        const body = await response.json() as {
            packet: {
                planKey: string
                planTitle: string
                sourceBranch: string | null
                targetBranch: string | null
                blockers: string[]
                changedFilesSummary: { totalFiles: number }
                checksSummary: { passed: number }
            }
        }

        expect(body.packet.planKey).toBe('01-01')
        expect(body.packet.planTitle).toBe('Seed the OMC runtime contract.')
        expect(body.packet.sourceBranch).toBe('hopi-omc-01-01')
        expect(body.packet.targetBranch).toBe('main')
        expect(body.packet.changedFilesSummary.totalFiles).toBe(1)
        expect(body.packet.checksSummary.passed).toBe(1)
        expect(body.packet.blockers).toContain('Review has not been approved yet.')
    })

    it('approves review without merging the plan', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            reviewRequired: true
        })

        const app = createTestApp(store)
        const response = await app.request('/api/omc/programs/program-1/plans/01-01/review/approve', {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            runtime: {
                column: string
                loopStatus: string
                reviewRequired: boolean
                reviewApprovedAt: number | null
                mergeStatus: string | null
                mergeApprovedAt: number | null
            }
        }

        expect(body.runtime.column).toBe('Review')
        expect(body.runtime.loopStatus).toBe('review')
        expect(body.runtime.reviewRequired).toBe(false)
        expect(typeof body.runtime.reviewApprovedAt).toBe('number')
        expect(body.runtime.mergeStatus).toBe('ready')
        expect(body.runtime.mergeApprovedAt).toBeNull()

        const persisted = store.omcRuntime.getPlanRuntime('program-1', '01-01', 'default')
        expect(persisted?.reviewRequired).toBe(false)
        expect(persisted?.mergeStatus).toBe('ready')
    })

    it('reopens review back to planning', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            reviewRequired: false,
            reviewApprovedAt: Date.now(),
            mergeStatus: 'ready'
        })

        const app = createTestApp(store)
        const response = await app.request('/api/omc/programs/program-1/plans/01-01/review/reopen', {
            method: 'POST',
            body: JSON.stringify({ action: 'back_to_planning' }),
            headers: { 'content-type': 'application/json' }
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            runtime: {
                column: string
                loopStatus: string
                reviewApprovedAt: number | null
                mergeStatus: string | null
            }
        }

        expect(body.runtime.column).toBe('Planning')
        expect(body.runtime.loopStatus).toBe('idle')
        expect(body.runtime.reviewApprovedAt).toBeNull()
        expect(body.runtime.mergeStatus).toBe('idle')
    })

    it('reopens review back into the running loop', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            reviewRequired: true,
            reviewApprovedAt: Date.now(),
            mergeStatus: 'ready'
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            loopRunId: 'loop-1',
            sessionId: 'session-1',
            attemptNumber: 1,
            status: 'blocked',
            summary: 'Need a human decision',
            terminationReason: 'structured-completion'
        })

        const dispatchedMessages: string[] = []
        const engine = {
            getMachineByNamespace() {
                return undefined
            },
            getOnlineMachinesByNamespace() {
                return [{ id: 'machine-1', active: true }]
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: 'session-2' }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
                return
            },
            getSessionByNamespace() {
                return {
                    metadata: {
                        path: fixture.repoRoot,
                        worktree: {
                            basePath: fixture.repoRoot,
                            worktreePath: `${fixture.repoRoot}-worktree`,
                            branch: 'hopi-omc-01-01'
                        }
                    }
                }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                dispatchedMessages.push(payload.text)
            },
            handleRealtimeEvent() {
                return
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request('/api/omc/programs/program-1/plans/01-01/review/reopen', {
            method: 'POST',
            body: JSON.stringify({ action: 'resume_loop' }),
            headers: { 'content-type': 'application/json' }
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            runtime: {
                column: string
                loopStatus: string
                reviewRequired: boolean
                reviewApprovedAt: number | null
                mergeStatus: string | null
            }
            attempt: { status: string; attemptNumber: number } | null
        }

        expect(body.runtime.column).toBe('Running')
        expect(body.runtime.loopStatus).toBe('running')
        expect(body.runtime.reviewRequired).toBe(false)
        expect(body.runtime.reviewApprovedAt).toBeNull()
        expect(body.runtime.mergeStatus).toBe('idle')
        expect(body.attempt?.status).toBe('running')
        expect(body.attempt?.attemptNumber).toBe(2)
        expect(dispatchedMessages).toHaveLength(1)
    })

    it('approves merge and moves the plan into done', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            targetBranch: 'main'
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            reviewRequired: false,
            reviewApprovedAt: Date.now(),
            mergeStatus: 'ready'
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            loopRunId: 'loop-1',
            sessionId: 'session-1',
            attemptNumber: 1,
            status: 'completed',
            summary: 'Review is complete and ready to merge.',
            terminationReason: 'structured-completion'
        })

        const app = createTestApp(store, makeMergeEngine(fixture.repoRoot))
        const response = await app.request('/api/omc/programs/program-1/plans/01-01/merge/approve', {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            runtime: {
                column: string
                loopStatus: string
                mergeStatus: string | null
                mergeApprovedAt: number | null
            }
            merge: {
                outcome: string
                commitHash: string | null
            }
        }

        expect(body.runtime.column).toBe('Done')
        expect(body.runtime.loopStatus).toBe('done')
        expect(body.runtime.mergeStatus).toBe('merged')
        expect(typeof body.runtime.mergeApprovedAt).toBe('number')
        expect(body.merge.outcome).toBe('merged')
        expect(body.merge.commitHash).toBe('abc123')
    })

    it('returns conflict details from merge approval without leaving review', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            targetBranch: 'main'
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            reviewRequired: false,
            reviewApprovedAt: Date.now(),
            mergeStatus: 'ready'
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            loopRunId: 'loop-1',
            sessionId: 'session-1',
            attemptNumber: 1,
            status: 'completed',
            summary: 'Ready for merge.',
            terminationReason: 'structured-completion'
        })

        const app = createTestApp(store, makeMergeEngine(fixture.repoRoot, {
            mergeResult: async () => ({
                success: false,
                stderr: 'CONFLICT (content): Merge conflict in shared/src/schemas.ts',
                conflictFiles: ['shared/src/schemas.ts']
            })
        }))
        const response = await app.request('/api/omc/programs/program-1/plans/01-01/merge/approve', {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            runtime: {
                column: string
                mergeStatus: string | null
                mergeBlockedReason: string | null
            }
            merge: {
                outcome: string
                conflictFiles: string[]
                sessionUrl: string | null
            }
            packet: {
                blockers: string[]
            }
        }

        expect(body.runtime.column).toBe('Review')
        expect(body.runtime.mergeStatus).toBe('conflict')
        expect(body.runtime.mergeBlockedReason).toContain('CONFLICT')
        expect(body.merge.outcome).toBe('conflict')
        expect(body.merge.conflictFiles).toEqual(['shared/src/schemas.ts'])
        expect(body.merge.sessionUrl).toBe('/sessions/session-1/terminal')
        expect(body.packet.blockers).toContain(body.runtime.mergeBlockedReason as string)
    })
})
