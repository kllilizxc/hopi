import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { OmcExecutionAutomation } from './executionAutomation'

const createdPaths: string[] = []

function makeWorkspaceFixture(): { repoRoot: string; planningRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'hopi-omc-execution-'))
    createdPaths.push(root)

    const repoRoot = join(root, 'cardgame')
    const planningRoot = join(repoRoot, '.planning')
    const phaseDir = join(planningRoot, 'phases', '01-first-playable-expedition')
    mkdirSync(phaseDir, { recursive: true })

    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
        name: 'cardgame',
        scripts: {
            test: 'vitest',
            build: 'vite build'
        }
    }))
    writeFileSync(join(planningRoot, 'PROJECT.md'), '# CardGame\n')
    writeFileSync(join(planningRoot, 'ROADMAP.md'), '# Roadmap\n')
    writeFileSync(join(phaseDir, '01-CONTEXT.md'), '# Context\n')
    writeFileSync(join(phaseDir, '01-RESEARCH.md'), '# Research\n')

    writeFileSync(join(phaseDir, '01-01-PLAN.md'), `---
phase: "01-first-playable-expedition"
plan: "01"
type: "execute"
wave: 1
depends_on: []
autonomous: true
---

<objective>
Establish the expedition domain, persistence, and prototype content backbone for Phase 01.
Purpose: Give later plans a stable base.
</objective>

<tasks>
<task type="auto">
  <name>Task 1: Define expedition contracts</name>
</task>
</tasks>
`)

    writeFileSync(join(phaseDir, '01-02-PLAN.md'), `---
phase: "01-first-playable-expedition"
plan: "02"
type: "execute"
wave: 2
depends_on: ["01-01"]
autonomous: true
---

<objective>
Create the expedition entry scene, fog-of-war map traversal, and non-combat node flow for Phase 01.
Purpose: Turn the new stash and run state into a playable exploration surface.
</objective>

<tasks>
<task type="auto">
  <name>Task 1: Boot into an expedition entry flow with stash review</name>
</task>
</tasks>
`)

    return { repoRoot, planningRoot }
}

function makeEngine(repoRoot: string): SyncEngine {
    let spawnCount = 0
    return {
        getMachineByNamespace() {
            return undefined
        },
        getOnlineMachinesByNamespace() {
            return [{ id: 'machine-1', active: true }]
        },
        async spawnSession() {
            spawnCount += 1
            return { type: 'success' as const, sessionId: `session-${spawnCount}` }
        },
        async waitForSessionActive() {
            return true
        },
        async applySessionConfig() {
            return
        },
        getSessionByNamespace(sessionId: string) {
            return {
                active: true,
                metadata: {
                    path: repoRoot,
                    machineId: 'machine-1',
                    worktree: {
                        basePath: repoRoot,
                        worktreePath: `${repoRoot}-worktree-${sessionId}`,
                        branch: `omc-${sessionId}`
                    }
                }
            }
        },
        async sendMessage() {
            return
        },
        async getGitDiffNumstat() {
            return { success: true, stdout: '' }
        },
        handleRealtimeEvent() {
            return
        }
    } as unknown as SyncEngine
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

describe('OmcExecutionAutomation', () => {
    it('materializes work orders from plans and assigns the first dependency-ready card to driver', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            targetBranch: 'main'
        })

        const automation = new OmcExecutionAutomation(store, makeEngine(fixture.repoRoot))
        await automation.reconcileProgram(program)

        const workOrders = store.omcRuntime.listWorkOrders(program.id, 'default')
        const workAttempts = store.omcRuntime.listWorkAttemptsForProgram(program.id, 'default')
        const firstPlanAttempts = store.omcRuntime.listAttempts(program.id, '01-01', 'default')

        expect(workOrders).toHaveLength(2)
        expect(workOrders.find((workOrder) => workOrder.planKey === '01-01')?.status).toBe('in_progress')
        expect(workOrders.find((workOrder) => workOrder.planKey === '01-01')?.owner).toBe('driver')
        expect(workOrders.find((workOrder) => workOrder.planKey === '01-02')?.status).toBe('ready')
        expect(workAttempts).toHaveLength(1)
        expect(workAttempts[0]?.role).toBe('driver')
        expect(workAttempts[0]?.status).toBe('running')
        expect(workAttempts[0]?.sessionId).toBe('session-1')
        expect(firstPlanAttempts).toHaveLength(1)
        expect(firstPlanAttempts[0]?.status).toBe('running')
    })

    it('starts the next dependency-unblocked plan after the upstream plan is merged', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            targetBranch: 'main'
        })

        store.omcRuntime.upsertPlanRuntime('default', {
            programId: program.id,
            planKey: '01-01',
            planPath: '.planning/phases/01-first-playable-expedition/01-01-PLAN.md',
            phaseKey: '01-first-playable-expedition',
            phaseLabel: '01 First Playable Expedition',
            column: 'Done',
            loopStatus: 'done',
            currentBranch: 'omc-01-01',
            targetBranch: 'main',
            reviewRequired: false,
            reviewApprovedAt: Date.now(),
            mergeStatus: 'merged',
            mergeApprovedAt: Date.now(),
            doneAt: Date.now(),
            latestEvidenceSummary: 'Merged 01-01 into main.',
            updatedAt: Date.now()
        })

        const automation = new OmcExecutionAutomation(store, makeEngine(fixture.repoRoot))
        await automation.reconcileProgram(program)

        const nextRuntime = store.omcRuntime.getPlanRuntime(program.id, '01-02', 'default')
        const nextAttempts = store.omcRuntime.listAttempts(program.id, '01-02', 'default')

        expect(nextRuntime?.loopStatus).toBe('running')
        expect(nextRuntime?.column).toBe('Running')
        expect(nextAttempts).toHaveLength(1)
        expect(nextAttempts[0]?.status).toBe('running')
    })

    it('accepts a finished driver round onto the task board and immediately starts the next ready card', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            targetBranch: 'main'
        })

        store.omcRuntime.upsertWorkOrder('default', {
            id: '01-01',
            programId: program.id,
            goalId: '01-first-playable-expedition',
            planKey: '01-01',
            title: 'Establish the expedition domain',
            owner: 'driver',
            status: 'in_progress',
            currentAttemptId: 'driver-work-1',
        })
        store.omcRuntime.addWorkAttempt('default', {
            id: 'driver-work-1',
            programId: program.id,
            workOrderId: '01-01',
            role: 'driver',
            sessionId: 'session-existing',
            status: 'running',
            summary: 'Establishing the expedition domain.',
        })
        store.omcRuntime.upsertWorkOrder('default', {
            id: '01-02',
            programId: program.id,
            goalId: '01-first-playable-expedition',
            planKey: '01-02',
            title: 'Create the expedition entry scene',
            status: 'ready',
        })

        store.omcRuntime.upsertPlanRuntime('default', {
            programId: program.id,
            planKey: '01-01',
            planPath: '.planning/phases/01-first-playable-expedition/01-01-PLAN.md',
            phaseKey: '01-first-playable-expedition',
            phaseLabel: '01 First Playable Expedition',
            column: 'Review',
            loopStatus: 'review',
            currentBranch: 'omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            reviewRequired: true,
            latestEvidenceSummary: 'The expedition domain backbone is ready.',
            updatedAt: Date.now(),
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: program.id,
            planKey: '01-01',
            planPath: '.planning/phases/01-first-playable-expedition/01-01-PLAN.md',
            sessionId: 'session-existing',
            attemptNumber: 1,
            status: 'progressed',
            summary: 'The expedition domain backbone is ready.',
            completedAt: Date.now(),
        })

        const automation = new OmcExecutionAutomation(store, makeEngine(fixture.repoRoot))
        await automation.reconcileProgram(program)

        const acceptedWorkOrder = store.omcRuntime.getWorkOrderByNamespace('01-01', 'default')
        const nextWorkOrder = store.omcRuntime.getWorkOrderByNamespace('01-02', 'default')
        const reviewAttempts = store.omcRuntime.listWorkAttempts(program.id, '01-01', 'default')
        const nextPlanAttempts = store.omcRuntime.listAttempts(program.id, '01-02', 'default')

        expect(acceptedWorkOrder?.status).toBe('done')
        expect(acceptedWorkOrder?.reviewerVerdict).toBe('accepted')
        expect(reviewAttempts.some((attempt) => attempt.role === 'reviewer' && attempt.status === 'accepted')).toBe(true)
        expect(nextWorkOrder?.status).toBe('in_progress')
        expect(nextWorkOrder?.owner).toBe('driver')
        expect(nextPlanAttempts).toHaveLength(1)
        expect(nextPlanAttempts[0]?.status).toBe('running')
    })
})
