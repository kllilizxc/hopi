import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncEvent } from '@hopi/protocol/types'
import { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { OmcLoopAutomation } from './loopAutomation'

const createdPaths: string[] = []

function makeWorkspaceFixture(): { repoRoot: string; planningRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'hopi-omc-loop-automation-'))
    createdPaths.push(root)

    const repoRoot = join(root, 'hopi')
    const planningRoot = join(root, '.planning')
    const phaseDir = join(planningRoot, 'phases', '01-omc-foundation')

    mkdirSync(repoRoot, { recursive: true })
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(planningRoot, 'PROJECT.md'), '# Project\n')
    writeFileSync(join(planningRoot, 'ROADMAP.md'), '# Roadmap\n')
    writeFileSync(join(phaseDir, '01-CONTEXT.md'), '# Context\n')
    writeFileSync(join(phaseDir, '01-RESEARCH.md'), '# Research\n')
    writeFileSync(join(phaseDir, '01-01-PLAN.md'), `---
phase: 01-omc-foundation
plan: 01
---

<objective>
Loop the adapter work.
Purpose: Keep one plan running until it is ready for review.
</objective>

<tasks>
<task type="auto">
  <name>Introduce the adapter seam</name>
</task>
</tasks>
`)

    return { repoRoot, planningRoot }
}

function makeEngine(): SyncEngine {
    return {
        async getGitDiffNumstat() {
            return { success: true, stdout: '' }
        },
        handleRealtimeEvent() {
            return
        }
    } as unknown as SyncEngine
}

function buildStructuredOutcomeEvent(sessionId: string): SyncEvent {
    return {
        type: 'message-received',
        namespace: 'default',
        sessionId,
        message: {
            id: 'msg-1',
            seq: 1,
            localId: null,
            createdAt: Date.now(),
            content: {
                role: 'assistant',
                content: `OMC_ATTEMPT_OUTCOME
\`\`\`json
{
  "status": "completed",
  "summary": "Finished the adapter work and it is ready for review.",
  "changedFiles": ["hub/src/sync/omc/runtimeAdapter.ts"],
  "checks": [{ "label": "bun run test", "result": "passed", "detail": "green" }],
  "nextSuggestedStep": "Move into review."
}
\`\`\``
            }
        }
    }
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

describe('OmcLoopAutomation', () => {
    it('does not fail a running attempt when the linked session only becomes inactive', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: program.id,
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Running',
            loopStatus: 'running',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            updatedAt: Date.now(),
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: program.id,
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            loopRunId: 'loop-1',
            sessionId: 'session-1',
            attemptNumber: 1,
            status: 'running',
            summary: 'Still working.',
        })

        const automation = new OmcLoopAutomation(store, makeEngine())
        automation.handleEvent({
            type: 'session-updated',
            namespace: 'default',
            sessionId: 'session-1',
            data: { active: false }
        })

        await Bun.sleep(5)

        const attempt = store.omcRuntime.getAttemptByNamespace('attempt-1', 'default')
        expect(attempt?.status).toBe('running')
        expect(attempt?.completedAt).toBeNull()
    })

    it('accepts a late structured outcome after a prior session-inactive transport event', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'CardGame',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot,
        })
        store.omcRuntime.upsertPlanRuntime('default', {
            programId: program.id,
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            column: 'Running',
            loopStatus: 'running',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: `${fixture.repoRoot}-worktree`,
            currentBranch: 'hopi-omc-01-01',
            targetBranch: 'main',
            attemptCount: 1,
            updatedAt: Date.now(),
        })
        store.omcRuntime.addAttempt('default', {
            id: 'attempt-1',
            programId: program.id,
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            loopRunId: 'loop-1',
            sessionId: 'session-1',
            attemptNumber: 1,
            status: 'running',
            summary: 'Still working.',
        })

        const automation = new OmcLoopAutomation(store, makeEngine())
        automation.handleEvent({
            type: 'session-updated',
            namespace: 'default',
            sessionId: 'session-1',
            data: { active: false }
        })
        await Bun.sleep(5)

        automation.handleEvent(buildStructuredOutcomeEvent('session-1'))
        await Bun.sleep(5)

        const attempts = store.omcRuntime.listAttempts(program.id, '01-01', 'default')
        expect(attempts[0]?.status).toBe('completed')
        expect(attempts[0]?.summary).toContain('ready for review')

        const runtime = store.omcRuntime.getPlanRuntime(program.id, '01-01', 'default')
        expect(runtime?.loopStatus).toBe('review')
        expect(runtime?.reviewRequired).toBe(true)
    })
})
