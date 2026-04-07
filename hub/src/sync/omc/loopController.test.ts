import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { OmcLoopController } from './loopController'

const createdPaths: string[] = []

function makeWorkspaceFixture(): { repoRoot: string; planningRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'hopi-omc-loop-'))
    createdPaths.push(root)

    const repoRoot = join(root, 'hopi')
    const planningRoot = join(root, '.planning')
    mkdirSync(repoRoot, { recursive: true })
    mkdirSync(join(planningRoot, 'phases', '01-omc-foundation'), { recursive: true })
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
        name: 'hopi',
        scripts: {
            typecheck: 'tsc --noEmit',
            test: 'vitest'
        }
    }))
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
Loop the adapter work.
Purpose: Keep one plan running until it is ready for review.
</objective>

<tasks>
<task type="auto">
  <name>Introduce the adapter seam</name>
</task>
<task type="auto">
  <name>Wire the event-driven automation</name>
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
                metadata: {
                    path: repoRoot,
                    machineId: 'machine-1',
                    worktree: {
                        basePath: repoRoot,
                        worktreePath: `${repoRoot}-worktree`,
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

describe('OmcLoopController', () => {
    it('auto-continues a progressed attempt inside the same loop run', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })
        const controller = new OmcLoopController({
            store,
            engine: makeEngine(fixture.repoRoot),
            namespace: 'default'
        })
        const initialPlan = {
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            planTitle: 'Loop the adapter work.',
            summary: 'Keep one plan running until it is ready for review.',
            checklist: [
                { text: 'Introduce the adapter seam', checked: false },
                { text: 'Wire the event-driven automation', checked: false }
            ],
            refs: {
                projectPath: '.planning/PROJECT.md',
                roadmapPath: '.planning/ROADMAP.md',
                contextPath: '.planning/phases/01-omc-foundation/01-CONTEXT.md',
                researchPath: '.planning/phases/01-omc-foundation/01-RESEARCH.md'
            },
            lastModifiedAt: Date.now()
        }
        const runtime = {
            programId: program.id,
            planKey: '01-01',
            planPath: initialPlan.planPath,
            phaseKey: initialPlan.phaseKey,
            phaseLabel: initialPlan.phaseLabel,
            column: 'Planning' as const,
            loopStatus: 'idle' as const,
            currentLoopRunId: null,
            currentWorktreePath: null,
            currentBranch: null,
            targetBranch: null,
            attemptCount: 0,
            consecutiveFailureCount: 0,
            lastFailureFingerprint: null,
            reviewRequired: false,
            mergeApprovedAt: null,
            doneAt: null,
            latestEvidenceSummary: null,
            lastAttemptAt: null,
            updatedAt: Date.now()
        }

        const started = await controller.startPlan({
            program,
            plan: initialPlan,
            runtime
        })
        const firstAttempt = started.attempt
        expect(firstAttempt?.status).toBe('running')

        await controller.handleAttemptOutcome({
            program,
            attempt: firstAttempt!,
            outcome: {
                status: 'progressed',
                summary: 'Added the adapter seam.',
                failureFingerprint: null,
                changedFiles: ['hub/src/sync/omc/runtimeAdapter.ts'],
                checks: [],
                nextSuggestedStep: 'Wire the event subscriber.',
                terminationReason: 'structured-completion',
                source: 'assistant-structured'
            }
        })

        const latestRuntime = store.omcRuntime.getPlanRuntime(program.id, '01-01', 'default')
        const attempts = store.omcRuntime.listAttempts(program.id, '01-01', 'default')

        expect(latestRuntime?.loopStatus).toBe('running')
        expect(latestRuntime?.attemptCount).toBe(2)
        expect(attempts).toHaveLength(2)
        expect(attempts[0]?.status).toBe('running')
        expect(attempts[1]?.status).toBe('progressed')
        expect(attempts[0]?.loopRunId).toBe(attempts[1]?.loopRunId)
    })

    it('reconciles a persisted codex outcome for a still-running attempt', async () => {
        const store = new Store(':memory:')
        const fixture = makeWorkspaceFixture()
        const program = store.omcRuntime.upsertProgram({
            id: 'program-1',
            namespace: 'default',
            name: 'OMC Workspace',
            repoRoot: fixture.repoRoot,
            planningRoot: fixture.planningRoot
        })
        const persistedSession = store.sessions.getOrCreateSession(
            'running-loop',
            {
                path: fixture.repoRoot,
                machineId: 'machine-1',
                worktree: {
                    basePath: fixture.repoRoot,
                    worktreePath: `${fixture.repoRoot}-worktree`,
                    branch: 'hopi-omc-session-1'
                }
            },
            null,
            'default'
        )
        let spawnCount = 0
        const controller = new OmcLoopController({
            store,
            engine: {
                getMachineByNamespace() {
                    return undefined
                },
                getOnlineMachinesByNamespace() {
                    return [{ id: 'machine-1', active: true }]
                },
                async spawnSession() {
                    spawnCount += 1
                    return {
                        type: 'success' as const,
                        sessionId: spawnCount === 1 ? persistedSession.id : `session-${spawnCount}`
                    }
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
                            path: fixture.repoRoot,
                            machineId: 'machine-1',
                            worktree: {
                                basePath: fixture.repoRoot,
                                worktreePath: `${fixture.repoRoot}-worktree`,
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
            } as unknown as SyncEngine,
            namespace: 'default'
        })
        const initialPlan = {
            planKey: '01-01',
            planPath: '.planning/phases/01-omc-foundation/01-01-PLAN.md',
            phaseKey: '01-omc-foundation',
            phaseLabel: '01 OMC Foundation',
            planTitle: 'Loop the adapter work.',
            summary: 'Keep one plan running until it is ready for review.',
            checklist: [
                { text: 'Introduce the adapter seam', checked: false },
                { text: 'Wire the event-driven automation', checked: false }
            ],
            refs: {
                projectPath: '.planning/PROJECT.md',
                roadmapPath: '.planning/ROADMAP.md',
                contextPath: '.planning/phases/01-omc-foundation/01-CONTEXT.md',
                researchPath: '.planning/phases/01-omc-foundation/01-RESEARCH.md'
            },
            lastModifiedAt: Date.now()
        }
        const runtime = {
            programId: program.id,
            planKey: '01-01',
            planPath: initialPlan.planPath,
            phaseKey: initialPlan.phaseKey,
            phaseLabel: initialPlan.phaseLabel,
            column: 'Planning' as const,
            loopStatus: 'idle' as const,
            currentLoopRunId: null,
            currentWorktreePath: null,
            currentBranch: null,
            targetBranch: null,
            attemptCount: 0,
            consecutiveFailureCount: 0,
            lastFailureFingerprint: null,
            reviewRequired: false,
            mergeApprovedAt: null,
            doneAt: null,
            latestEvidenceSummary: null,
            lastAttemptAt: null,
            updatedAt: Date.now()
        }

        const started = await controller.startPlan({
            program,
            plan: initialPlan,
            runtime
        })
        const firstAttempt = started.attempt
        expect(firstAttempt?.status).toBe('running')
        expect(firstAttempt?.sessionId).toBe(persistedSession.id)

        store.messages.addMessage(firstAttempt!.sessionId!, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: `OMC_ATTEMPT_OUTCOME
\`\`\`json
{
  "status": "progressed",
  "summary": "Added the adapter seam.",
  "changedFiles": ["hub/src/sync/omc/runtimeAdapter.ts"],
  "checks": [{ "label": "bun run typecheck:hub", "result": "passed", "detail": "tsc clean" }],
  "nextSuggestedStep": "Wire the event subscriber."
}
\`\`\``,
                    id: 'codex-msg-1'
                }
            }
        })

        const reconciled = await controller.reconcilePlan(program, '01-01')
        const latestRuntime = store.omcRuntime.getPlanRuntime(program.id, '01-01', 'default')
        const attempts = store.omcRuntime.listAttempts(program.id, '01-01', 'default')

        expect(reconciled?.runtime.loopStatus).toBe('running')
        expect(latestRuntime?.attemptCount).toBe(2)
        expect(latestRuntime?.latestEvidenceSummary).toBe('Added the adapter seam.')
        expect(attempts).toHaveLength(2)
        expect(attempts[1]?.status).toBe('progressed')
        expect(attempts[1]?.completedAt).not.toBeNull()
        expect(attempts[0]?.status).toBe('running')
        expect(attempts[0]?.attemptNumber).toBe(2)
    })
})
