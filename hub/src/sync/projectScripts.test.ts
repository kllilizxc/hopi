import { describe, expect, it } from 'bun:test'
import { PRODUCT_INIT_SCRIPT_RELATIVE_PATH } from '@hopi/protocol/brand'
import { runInitScriptIfPresent } from './projectScripts'
import type { SyncEngine } from './syncEngine'

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
})
