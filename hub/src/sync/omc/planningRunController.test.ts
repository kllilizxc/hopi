import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { OmcPlanningRunController } from './planningRunController'

const createdPaths: string[] = []

function makeSeedWorkspaceFixture(): { repoRoot: string; planningRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'hopi-omc-guided-planning-'))
    createdPaths.push(root)

    const repoRoot = join(root, 'personal-quant')
    const planningRoot = join(repoRoot, '.planning')
    const phaseDir = join(planningRoot, 'phases', '01-bootstrap')

    mkdirSync(join(repoRoot, '.git'), { recursive: true })
    writeFileSync(join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(planningRoot, 'PROJECT.md'), '# PersonalQuant\n')
    writeFileSync(join(planningRoot, 'REQUIREMENTS.md'), '# Requirements\n')
    writeFileSync(join(planningRoot, 'ROADMAP.md'), '# Roadmap\n')
    writeFileSync(join(planningRoot, 'STATE.md'), '# State\n')
    writeFileSync(join(phaseDir, '01-CONTEXT.md'), '# Context\n')

    return { repoRoot, planningRoot }
}

function makeEngine(repoRoot: string): {
    engine: SyncEngine
    sentMessages: string[]
    abortedSessions: string[]
    appliedConfigs: Array<{ sessionId: string; permissionMode?: string }>
    spawnCalls: Array<{ yolo?: boolean }>
} {
    let spawnCount = 0
    const sentMessages: string[] = []
    const abortedSessions: string[] = []
    const appliedConfigs: Array<{ sessionId: string; permissionMode?: string }> = []
    const spawnCalls: Array<{ yolo?: boolean }> = []

    const engine = {
        getMachineByNamespace() {
            return undefined
        },
        getOnlineMachinesByNamespace() {
            return [{ id: 'machine-1', active: true }]
        },
        async spawnSession(_machineId: string, _directory: string, _agent: string, _model?: string, yolo?: boolean) {
            spawnCount += 1
            spawnCalls.push({ yolo })
            return { type: 'success' as const, sessionId: `planning-session-${spawnCount}` }
        },
        async waitForSessionActive() {
            return true
        },
        async applySessionConfig(sessionId: string, config: { permissionMode?: string }) {
            appliedConfigs.push({ sessionId, permissionMode: config.permissionMode })
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

    return { engine, sentMessages, abortedSessions, appliedConfigs, spawnCalls }
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

describe('OmcPlanningRunController', () => {
    it('starts guided planning from a seed-only repo and dispatches the brief prompt', async () => {
        const store = new Store(':memory:')
        const fixture = makeSeedWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-guided',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            primaryBranch: 'main',
            targetBranch: 'main'
        })
        const { engine, sentMessages, appliedConfigs, spawnCalls } = makeEngine(fixture.repoRoot)
        const controller = new OmcPlanningRunController({
            store,
            engine,
            namespace: 'default'
        })

        const result = await controller.startPlanning(program, {
            productIntent: 'PersonalQuant tracks portfolio performance and trading analytics.',
            firstSlice: 'Create the first executable plan cards for ingestion and analytics foundations.'
        })

        expect(result.run.status).toBe('running')
        expect(result.run.stage).toBe('plan')
        expect(result.run.sessionId).toBe('planning-session-1')
        expect(spawnCalls).toEqual([{ yolo: true }])
        expect(appliedConfigs).toEqual([
            { sessionId: 'planning-session-1', permissionMode: 'safe-yolo' }
        ])
        expect(sentMessages).toHaveLength(1)
        expect(sentMessages[0]).toContain('OMC_GUIDED_PLANNING_OUTCOME')
        expect(sentMessages[0]).toContain('PersonalQuant tracks portfolio performance')
        expect(result.run.summary).toContain('actively drafting')
    })

    it('marks guided planning as failed when the session stops before plan cards appear', async () => {
        const store = new Store(':memory:')
        const fixture = makeSeedWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-guided',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            primaryBranch: 'main',
            targetBranch: 'main'
        })
        const { engine } = makeEngine(fixture.repoRoot)
        const controller = new OmcPlanningRunController({
            store,
            engine,
            namespace: 'default'
        })

        const started = await controller.startPlanning(program, {
            productIntent: 'PersonalQuant tracks portfolio performance and trading analytics.',
            firstSlice: 'Create the first executable plan cards for ingestion and analytics foundations.'
        })

        await controller.handleRunStopped({
            program,
            runId: started.run.id,
            summary: 'The guided-planning session became inactive before plan cards appeared.',
            error: 'session-inactive'
        })

        const latest = store.omcRuntime.getLatestPlanningRun(program.id, 'default')
        expect(latest?.status).toBe('failed')
        expect(latest?.error).toBe('session-inactive')
        expect(latest?.summary).toContain('became inactive')
    })

    it('completes guided planning only after real plan cards appear', async () => {
        const store = new Store(':memory:')
        const fixture = makeSeedWorkspaceFixture()
        const phaseDir = join(fixture.planningRoot, 'phases', '01-bootstrap')
        const program = store.omcRuntime.upsertProgram({
            id: 'program-guided',
            namespace: 'default',
            name: 'PersonalQuant',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
            primaryBranch: 'main',
            targetBranch: 'main'
        })
        const { engine } = makeEngine(fixture.repoRoot)
        const controller = new OmcPlanningRunController({
            store,
            engine,
            namespace: 'default'
        })

        const started = await controller.startPlanning(program, {
            productIntent: 'PersonalQuant tracks portfolio performance and trading analytics.',
            firstSlice: 'Create the first executable plan cards for ingestion and analytics foundations.'
        })

        writeFileSync(join(phaseDir, '01-01-PLAN.md'), `---
phase: 01-bootstrap
plan: 01
---

<objective>
Create the first executable PersonalQuant plan.
Purpose: Validate that OMC can hand off from guided planning to real plan cards.
</objective>

<tasks>
<task type="auto">
  <name>Capture the first analytics planning slice</name>
</task>
</tasks>
`)

        await controller.handleRunMessage({
            program,
            runId: started.run.id,
            summaryText: 'Created the first executable PersonalQuant planning card.'
        })

        const latest = store.omcRuntime.getLatestPlanningRun(program.id, 'default')
        expect(latest?.status).toBe('completed')
        expect(latest?.generatedPlanPaths).toContain('.planning/phases/01-bootstrap/01-01-PLAN.md')
        expect(latest?.summary).toContain('Created the first executable PersonalQuant planning card')
    })
})
