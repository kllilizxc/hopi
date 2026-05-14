import { describe, expect, it } from 'bun:test'
import type { AttachmentMetadata, Session } from '@hopi/protocol/types'
import { Store, type StoredSession } from '../store'
import { SyncEngine } from './syncEngine'
import { createProjectAssistantIntervention } from './projectAssistant'

const MERGE_BASE = '1111111111111111111111111111111111111111'
const SNAPSHOT_REF = '2222222222222222222222222222222222222222'
const TARGET_HEAD = '3333333333333333333333333333333333333333'
const VALID_ACTIONS_MANIFEST = [
    'version: 1',
    'setup:',
    '  steps:',
    '    - id: deps',
    '      type: run',
    '      run: ["bun", "install"]',
    'preview:',
    '  services:',
    '    - id: web',
    '      type: run',
    '      run: ["bun", "run", "dev"]',
    '      ready:',
    '        type: process_alive',
    'merge:',
    '  targetBranch: main',
    '  strategy: squash'
].join('\n')

function runtimeSession(stored: StoredSession, active = true): Session {
    return {
        id: stored.id,
        namespace: stored.namespace,
        seq: stored.seq,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        active,
        activeAt: stored.activeAt ?? stored.createdAt,
        metadata: stored.metadata as Session['metadata'],
        metadataVersion: stored.metadataVersion,
        agentState: null,
        agentStateVersion: stored.agentStateVersion,
        thinking: false,
        thinkingAt: 0
    }
}

function createMergeBlockedAssistantHarness() {
    const store = new Store(':memory:')
    const namespace = 'default'
    const project = store.projects.createProject({
        id: 'project-1',
        namespace,
        machineId: 'machine-1',
        name: 'Project',
        defaultSessionType: 'worktree',
        worktreeTargetBranch: 'main'
    })
    const workspace = store.workspaces.createWorkspace({
        id: 'workspace-1',
        projectId: project.id,
        path: '/tmp/workspace'
    })
    store.projects.updateProject(project.id, namespace, {
        defaultWorkspaceId: workspace.id
    })
    const goal = store.goals.createGoal({
        id: 'goal-1',
        projectId: project.id,
        namespace,
        title: 'Goal'
    })
    const taskSession = store.sessions.getOrCreateSession(
        'task-session',
        {
            path: '/tmp/worktree',
            host: 'localhost',
            projectId: project.id,
            taskId: 'task-1',
            worktree: {
                basePath: '/tmp/workspace',
                branch: 'task-branch',
                name: 'task-branch',
                worktreePath: '/tmp/worktree',
                baseCommit: MERGE_BASE
            }
        },
        null,
        namespace
    )
    const task = store.tasks.createTask({
        id: 'task-1',
        projectId: project.id,
        goalId: goal.id,
        title: 'Blocked merge task',
        status: 'blocked',
        activeSessionId: taskSession.id,
        blockedReason: 'Base repository has uncommitted changes',
        blockedSource: 'merge',
        blockedSessionId: taskSession.id,
        mergeRuntime: {
            status: 'blocked',
            sessionId: taskSession.id,
            requestedAt: 10,
            startedAt: 10,
            updatedAt: 20,
            completedAt: 20,
            retryCount: 0,
            failureFingerprint: null,
            latestNote: 'Auto-merge blocked',
            blockedReason: 'Base repository has uncommitted changes',
            failure: null
        }
    })
    const intervention = createProjectAssistantIntervention({
        store,
        namespace,
        projectId: project.id,
        goalId: goal.id,
        taskId: task.id,
        interventionKey: `merge-blocked:${task.id}`,
        interventionKind: 'merge_blocked',
        title: 'Auto-merge blocked',
        body: 'Base repository has uncommitted changes.',
        suggestedActions: [{ id: 'retry_merge', label: 'Retry merge', recommended: true }]
    })

    const forwarded: Array<{ sessionId: string; text: string }> = []
    const localUsers: Array<{ sessionId: string; text: string; localId?: string | null }> = []
    const localAssistants: Array<{ sessionId: string; text: string }> = []
    const events: unknown[] = []

    const engine = {
        store,
        messageService: {
            async sendMessage(sessionId: string, payload: { text: string }) {
                forwarded.push({ sessionId, text: payload.text })
            },
            recordLocalUserMessage(sessionId: string, payload: {
                text: string
                localId?: string | null
                attachments?: AttachmentMetadata[]
                sentFrom?: 'telegram-bot' | 'webapp'
            }) {
                localUsers.push({ sessionId, text: payload.text, localId: payload.localId })
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text, attachments: payload.attachments }
                }, payload.localId ?? undefined)
            },
            recordLocalAssistantMessage(sessionId: string, payload: { text: string }) {
                localAssistants.push({ sessionId, text: payload.text })
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: payload.text }
                })
            }
        },
        getSession(sessionId: string) {
            const stored = store.sessions.getSessionByNamespace(sessionId, namespace)
            return stored ? runtimeSession(stored) : undefined
        },
        getSessionByNamespace(sessionId: string, requestedNamespace: string) {
            if (requestedNamespace !== namespace) return undefined
            const stored = store.sessions.getSessionByNamespace(sessionId, namespace)
            return stored ? runtimeSession(stored) : undefined
        },
        handleRealtimeEvent(event: unknown) {
            events.push(event)
        },
        async readSessionFile() {
            return {
                success: true,
                content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
            }
        },
        async gitMergeWorktreeState() {
            return {
                success: true,
                sourceBranch: 'task-branch',
                hasWorkingTreeChanges: false,
                committedChangedCount: 1,
                mergeable: true
            }
        },
        async gitCaptureWorktreeMergeSnapshot() {
            return {
                success: true,
                targetBranch: 'main',
                sourceBranch: 'task-branch',
                mergeBase: MERGE_BASE,
                snapshotRef: SNAPSHOT_REF,
                expectedChangeCount: 1
            }
        },
        async gitMergeWorktree() {
            return { success: true, commitHash: TARGET_HEAD }
        },
        async gitVerifyWorktreeMerge() {
            return {
                success: true,
                verified: true,
                targetBranch: 'main',
                mergeBase: MERGE_BASE,
                snapshotRef: SNAPSHOT_REF,
                expectedChangeCount: 1,
                targetHead: TARGET_HEAD
            }
        },
        async getGitDiffNumstat() {
            return { success: true, stdout: '1\t0\tsrc/app.ts\n' }
        },
        async archiveSession() {
        }
    } as unknown as SyncEngine

    return { store, namespace, task, intervention, engine, forwarded, localUsers, localAssistants, events }
}

describe('SyncEngine.sendMessage', () => {
    it('forwards merge-blocked assistant retry replies as ordinary agent chat', async () => {
        const { store, namespace, task, intervention, engine, forwarded, localUsers, localAssistants } = createMergeBlockedAssistantHarness()

        await (SyncEngine.prototype.sendMessage as any).call(engine, intervention.session.id, {
            text: '重试',
            localId: 'local-retry',
            sentFrom: 'webapp'
        })

        expect(forwarded).toEqual([{ sessionId: intervention.session.id, text: '重试' }])
        expect(localUsers).toEqual([])
        expect(localAssistants).toEqual([])
        expect(store.sessions.getSessionByNamespace(intervention.session.id, namespace)?.metadata).toMatchObject({
            interventionStatus: 'pending'
        })
        expect(store.tasks.getTaskByNamespace(task.id, namespace)).toMatchObject({
            status: 'blocked',
            mergeRuntime: {
                status: 'blocked',
                retryCount: 0
            }
        })
    })

    it('does not treat a resolved blocker reply as a hub-side merge retry command', async () => {
        const { store, namespace, task, intervention, engine, forwarded, localAssistants } = createMergeBlockedAssistantHarness()

        await (SyncEngine.prototype.sendMessage as any).call(engine, intervention.session.id, {
            text: '解决了',
            localId: 'local-resolved',
            sentFrom: 'webapp'
        })

        expect(forwarded).toEqual([{ sessionId: intervention.session.id, text: '解决了' }])
        expect(localAssistants).toEqual([])
        expect(store.tasks.getTaskByNamespace(task.id, namespace)?.mergeRuntime?.status).toBe('blocked')
    })
})
