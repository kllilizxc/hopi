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
            attempt: { id: string; summary: string | null }
            evidence: Array<{ id: string; label: string }>
        }

        expect(body.attempt.id).toBe('attempt-1')
        expect(body.attempt.summary).toBe('Added shared schemas')
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
        expect(body.evidence.map((item) => item.label)).toEqual(['context-pack', 'session-start', 'prompt-dispatched'])
        expect(dispatchedMessages).toHaveLength(1)
        expect(dispatchedMessages[0]).toContain('You are running one OMC attempt')
    })
})
