import { describe, expect, it } from 'bun:test'
import type { SyncEngine } from '../syncEngine'
import { CodexAttemptRuntimeAdapter } from './runtimeAdapter'

function makeProgram() {
    return {
        id: 'program-1',
        namespace: 'default',
        machineId: null,
        name: 'OMC Workspace',
        repoRoot: '/repo',
        planningRoot: '/repo/.planning',
        primaryBranch: 'main',
        targetBranch: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
    }
}

function makePlan() {
    return {
        planKey: '01-01',
        planPath: '.planning/phases/01-foundation/01-01-PLAN.md',
        phaseKey: '01-foundation',
        phaseLabel: '01 Foundation',
        planTitle: 'Seed runtime adapter',
        summary: 'Build the runtime adapter seam.',
        checklist: [],
        refs: {
            projectPath: '.planning/PROJECT.md',
            roadmapPath: '.planning/ROADMAP.md'
        },
        lastModifiedAt: Date.now()
    }
}

describe('CodexAttemptRuntimeAdapter', () => {
    it('uses worktree spawn for a fresh plan and simple spawn for an existing worktree', async () => {
        const calls: Array<{ sessionType?: string; directory: string; worktreeName?: string; yolo?: boolean }> = []
        const appliedConfigs: Array<{ sessionId: string; permissionMode?: string }> = []
        let sessionCounter = 0
        const engine = {
            getMachineByNamespace() {
                return undefined
            },
            getOnlineMachinesByNamespace() {
                return [{ id: 'machine-1', active: true }]
            },
            async spawnSession(_machineId: string, directory: string, _agent: string, _model?: string, yolo?: boolean, sessionType?: string, worktreeName?: string) {
                sessionCounter += 1
                calls.push({ sessionType, directory, worktreeName, yolo })
                return { type: 'success' as const, sessionId: `session-${sessionCounter}` }
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
                        path: sessionId === 'session-1' ? '/repo' : '/repo-worktree',
                        worktree: {
                            basePath: '/repo',
                            worktreePath: sessionId === 'session-1' ? '/repo-worktree' : '/repo-worktree',
                            branch: sessionId === 'session-1' ? 'omc-01-01' : 'omc-01-01'
                        }
                    }
                }
            }
        } as unknown as SyncEngine

        const adapter = new CodexAttemptRuntimeAdapter()

        const fresh = await adapter.startAttemptSession({
            engine,
            namespace: 'default',
            program: makeProgram(),
            plan: makePlan(),
            runtime: {
                programId: 'program-1',
                planKey: '01-01',
                planPath: '.planning/phases/01-foundation/01-01-PLAN.md',
                phaseKey: '01-foundation',
                phaseLabel: '01 Foundation',
                column: 'Planning',
                loopStatus: 'idle',
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
        })

        const reused = await adapter.startAttemptSession({
            engine,
            namespace: 'default',
            program: makeProgram(),
            plan: makePlan(),
            runtime: {
                programId: 'program-1',
                planKey: '01-01',
                planPath: '.planning/phases/01-foundation/01-01-PLAN.md',
                phaseKey: '01-foundation',
                phaseLabel: '01 Foundation',
                column: 'Running',
                loopStatus: 'running',
                currentLoopRunId: 'loop-1',
                currentWorktreePath: '/repo-worktree',
                currentBranch: 'omc-01-01',
                targetBranch: 'main',
                attemptCount: 1,
                consecutiveFailureCount: 0,
                lastFailureFingerprint: null,
                reviewRequired: false,
                mergeApprovedAt: null,
                doneAt: null,
                latestEvidenceSummary: null,
                lastAttemptAt: Date.now(),
                updatedAt: Date.now()
            }
        })

        expect(calls[0]).toEqual({
            directory: '/repo',
            sessionType: 'worktree',
            worktreeName: '01-01-seed-runtime-adapter',
            yolo: true
        })
        expect(calls[1]).toEqual({
            directory: '/repo-worktree',
            sessionType: 'simple',
            worktreeName: undefined,
            yolo: true
        })
        expect(appliedConfigs).toEqual([
            { sessionId: 'session-1', permissionMode: 'safe-yolo' },
            { sessionId: 'session-2', permissionMode: 'safe-yolo' }
        ])
        expect(fresh.worktreePath).toBe('/repo-worktree')
        expect(reused.worktreePath).toBe('/repo-worktree')
    })
})
