import { describe, expect, it } from 'bun:test'
import { PRODUCT_ENV, PRODUCT_INIT_SCRIPT_RELATIVE_PATH, PRODUCT_MERGE_SCRIPT_RELATIVE_PATH } from '@hopi/protocol/brand'
import { buildMergeScriptCommand, runInitScriptIfPresent } from './projectScripts'
import type { SyncEngine } from './syncEngine'

describe('buildMergeScriptCommand', () => {
    it('returns a single shell command rooted in the workspace with merge env vars', () => {
        const command = buildMergeScriptCommand({
            rootPath: '/tmp/work tree',
            taskId: 'task-1',
            projectId: 'project-1',
            targetBranch: 'main',
            sourceBranch: 'feature/test',
            worktreeBasePath: '/tmp/base repo',
            worktreePath: '/tmp/work tree',
            worktreeBranch: 'feature/test',
            missingMessage: 'merge script missing'
        })

        expect(command).toContain(`cd '/tmp/work tree' && if [ -f '${PRODUCT_MERGE_SCRIPT_RELATIVE_PATH}' ]; then`)
        expect(command).toContain(`chmod +x '${PRODUCT_MERGE_SCRIPT_RELATIVE_PATH}'`)
        expect(command).toContain(`${PRODUCT_ENV.PROJECT_ROOT}='/tmp/work tree'`)
        expect(command).toContain(`${PRODUCT_ENV.TASK_ID}='task-1'`)
        expect(command).toContain(`${PRODUCT_ENV.TASK_PROJECT_ID}='project-1'`)
        expect(command).toContain(`${PRODUCT_ENV.MERGE_TARGET_BRANCH}='main'`)
        expect(command).toContain(`${PRODUCT_ENV.MERGE_SOURCE_BRANCH}='feature/test'`)
        expect(command).toContain(`${PRODUCT_ENV.WORKTREE_BASE_PATH}='/tmp/base repo'`)
        expect(command).toContain(`${PRODUCT_ENV.WORKTREE_PATH}='/tmp/work tree'`)
        expect(command).toContain(`${PRODUCT_ENV.WORKTREE_BRANCH}='feature/test'`)
        expect(command).toContain(`bash '${PRODUCT_MERGE_SCRIPT_RELATIVE_PATH}'`)
        expect(command).toContain(`printf '%s\\n' 'merge script missing'`)
    })
})

describe('runInitScriptIfPresent', () => {
    it('calls runBash with engine context', async () => {
        const runBashCalls: Array<{
            sessionId: string
            command: string
            cwd?: string
            timeout?: number
        }> = []

        const engine = {
            rpcGateway: {
                async runBash(sessionId: string, params: {
                    command: string
                    cwd?: string
                    timeout?: number
                }) {
                    runBashCalls.push({ sessionId, ...params })
                    return {
                        success: true,
                        stdout: 'init ok',
                        stderr: ''
                    }
                }
            },
            async runBash(this: {
                rpcGateway: {
                    runBash: (sessionId: string, params: { command: string; cwd?: string; timeout?: number }) => Promise<{
                        success: boolean
                        stdout?: string
                        stderr?: string
                        error?: string
                    }>
                }
            }, sessionId: string, params: { command: string; cwd?: string; timeout?: number }) {
                return await this.rpcGateway.runBash(sessionId, params)
            }
        } as unknown as SyncEngine

        const result = await runInitScriptIfPresent({
            engine,
            sessionId: 'session-1',
            cwd: '/tmp/workspace',
            taskId: 'task-1',
            projectId: 'project-1'
        })

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.executed).toBe(true)
        }
        expect(runBashCalls).toHaveLength(1)
        expect(runBashCalls[0]?.sessionId).toBe('session-1')
        expect(runBashCalls[0]?.cwd).toBe('/tmp/workspace')
        expect(runBashCalls[0]?.command).toContain(PRODUCT_INIT_SCRIPT_RELATIVE_PATH)
    })

    it('skips when cwd is outside working directory', async () => {
        const engine = {
            async runBash() {
                return {
                    success: false,
                    error: 'Access denied: Path \'/tmp/base-workspace\' is outside the working directory',
                    stdout: '',
                    stderr: ''
                }
            }
        } as unknown as SyncEngine

        const result = await runInitScriptIfPresent({
            engine,
            sessionId: 'session-1',
            cwd: '/tmp/base-workspace',
            taskId: 'task-1',
            projectId: 'project-1'
        })

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.executed).toBe(false)
        }
    })
})
