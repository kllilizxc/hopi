import { ListDirectoryResponseSchema } from '@hopi/protocol/schemas'
import type { SessionProfile } from '@hopi/protocol/goal-assistant'
import type { ModelMode, PermissionMode } from '@hopi/protocol/types'
import type { DirectoryEntry as SharedDirectoryEntry, ListDirectoryResponse as SharedListDirectoryResponse } from '@hopi/protocol/types'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'

const DEFAULT_RPC_TIMEOUT_MS = 30_000
const WORKTREE_MERGE_RPC_TIMEOUT_MS = 90_000

export type RpcCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcReadFileResponse = {
    success: boolean
    content?: string
    error?: string
}

export type RpcWriteFileResponse = {
    success: boolean
    hash?: string
    error?: string
}

export type RpcUploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type RpcDeleteUploadResponse = {
    success: boolean
    error?: string
}

export type RpcDirectoryEntry = SharedDirectoryEntry
export type RpcListDirectoryResponse = SharedListDirectoryResponse

export type RpcPathExistsResponse = {
    exists: Record<string, boolean>
}

export type RpcGitAutocommitWorktreeResponse = {
    success: boolean
    commitHash?: string
    skippedReason?: 'clean'
    stdout?: string
    stderr?: string
    error?: string
}

export type RpcGitMergeWorktreeResponse = {
    success: boolean
    commitHash?: string
    skippedReason?: 'no_changes'
    conflictFiles?: string[]
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcGitRemoveWorktreeResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcGitMergeWorktreeStateResponse = {
    success: boolean
    targetBranch?: string
    sourceBranch?: string
    mergeBase?: string
    hasWorkingTreeChanges?: boolean
    committedChangedCount?: number
    mergeable?: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcGitCaptureWorktreeMergeSnapshotResponse = {
    success: boolean
    targetBranch?: string
    sourceBranch?: string
    mergeBase?: string
    snapshotRef?: string
    expectedChangeCount?: number
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcGitVerifyWorktreeMergeResponse = {
    success: boolean
    verified?: boolean
    targetBranch?: string
    mergeBase?: string
    snapshotRef?: string
    expectedChangeCount?: number
    targetHead?: string
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcPreviewStatus = {
    active: boolean
    status: 'idle' | 'starting' | 'ready' | 'error' | 'stopped'
    taskId?: string
    sessionId?: string
    mode?: 'local' | 'worktree'
    rootPath?: string
    runPath?: string
    command?: string
    port?: number
    url?: string
    pid?: number
    startedAt?: number
    updatedAt: number
    error?: string
    logTail: string[]
}

export class RpcGateway {
    constructor(
        private readonly io: Server,
        private readonly rpcRegistry: RpcRegistry
    ) {
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: true,
            mode,
            allowTools,
            decision,
            answers
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'abort', { reason: 'User aborted via Telegram Bot' })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.sessionRpc(sessionId, 'switch', { to })
    }

    async requestSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            modelMode?: ModelMode
            collaborationMode?: string
        }
    ): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'set-session-config', config)
    }

    async killSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'killSession', {})
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' | 'codex' | 'gemini' | 'opencode' = 'claude',
        model?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        worktreeWorkspacePaths?: string[],
        worktreeTargetBranch?: string,
        sessionProfile?: SessionProfile
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-happy-session',
                {
                    type: 'spawn-in-directory',
                    directory,
                    worktreeWorkspacePaths,
                    agent,
                    model,
                    yolo,
                    sessionType,
                    worktreeName,
                    resumeSessionId,
                    worktreeTargetBranch,
                    sessionProfile
                }
            )
            if (result && typeof result === 'object') {
                const obj = result as Record<string, unknown>
                if (obj.type === 'success' && typeof obj.sessionId === 'string') {
                    return { type: 'success', sessionId: obj.sessionId }
                }
                if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
                    return { type: 'error', message: obj.errorMessage }
                }
                if (obj.type === 'requestToApproveDirectoryCreation' && typeof obj.directory === 'string') {
                    return {
                        type: 'error',
                        message: `Directory does not exist: ${obj.directory}`
                    }
                }
                if (typeof obj.error === 'string') {
                    return { type: 'error', message: obj.error }
                }
            }
            return { type: 'error', message: 'Unexpected spawn result' }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.startsWith('RPC handler not registered:') || message.startsWith('RPC socket disconnected:')) {
                return {
                    type: 'error',
                    message: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start'
                }
            }
            return { type: 'error', message }
        }
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        const result = await this.machineRpc(machineId, 'path-exists', { paths }) as RpcPathExistsResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const existsValue = (result as RpcPathExistsResponse).exists
        if (!existsValue || typeof existsValue !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(existsValue)) {
            exists[key] = value === true
        }
        return exists
    }

    async runBash(sessionId: string, params: {
        command: string
        cwd?: string
        timeout?: number
    }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'bash', params) as RpcCommandResponse
    }

    async previewStart(machineId: string, params: {
        taskId: string
        sessionId: string
        rootPath: string
        mode: 'local' | 'worktree'
        basePort?: number
    }): Promise<RpcPreviewStatus> {
        return await this.machineRpc(machineId, 'preview-start', params) as RpcPreviewStatus
    }

    async previewStatus(machineId: string): Promise<RpcPreviewStatus> {
        return await this.machineRpc(machineId, 'preview-status', {}) as RpcPreviewStatus
    }

    async previewStop(machineId: string, params?: { taskId?: string }): Promise<RpcPreviewStatus> {
        return await this.machineRpc(machineId, 'preview-stop', params ?? {}) as RpcPreviewStatus
    }

    async previewStartForSession(sessionId: string, params: {
        taskId: string
        rootPath: string
        mode: 'local' | 'worktree'
        basePort?: number
    }): Promise<RpcPreviewStatus> {
        return await this.sessionRpc(sessionId, 'preview-start', {
            taskId: params.taskId,
            sessionId,
            rootPath: params.rootPath,
            mode: params.mode,
            basePort: params.basePort
        }) as RpcPreviewStatus
    }

    async previewStatusForSession(sessionId: string): Promise<RpcPreviewStatus> {
        return await this.sessionRpc(sessionId, 'preview-status', {}) as RpcPreviewStatus
    }

    async previewStopForSession(sessionId: string, params?: { taskId?: string }): Promise<RpcPreviewStatus> {
        return await this.sessionRpc(sessionId, 'preview-stop', params ?? {}) as RpcPreviewStatus
    }
    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-status', { cwd }) as RpcCommandResponse
    }

    async getGitStatusOnMachine(machineId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.machineRpc(machineId, 'git-status', { cwd }) as RpcCommandResponse
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean; baseRef?: string; targetRef?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-numstat', options) as RpcCommandResponse
    }

    async getGitDiffNumstatOnMachine(machineId: string, options: { cwd?: string; staged?: boolean; baseRef?: string; targetRef?: string }): Promise<RpcCommandResponse> {
        return await this.machineRpc(machineId, 'git-diff-numstat', options) as RpcCommandResponse
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean; baseRef?: string; targetRef?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-file', options) as RpcCommandResponse
    }

    async getGitDiffFileOnMachine(machineId: string, options: { cwd?: string; filePath: string; staged?: boolean; baseRef?: string; targetRef?: string }): Promise<RpcCommandResponse> {
        return await this.machineRpc(machineId, 'git-diff-file', options) as RpcCommandResponse
    }

    async gitAutocommitWorktree(sessionId: string, options: { message: string }): Promise<RpcGitAutocommitWorktreeResponse> {
        return await this.sessionRpc(sessionId, 'git-autocommit-worktree', options) as RpcGitAutocommitWorktreeResponse
    }

    async gitMergeWorktree(sessionId: string, options: {
        targetBranch: string
        commitMessage: string
        strategy?: 'ff' | 'merge_commit' | 'squash'
    }): Promise<RpcGitMergeWorktreeResponse> {
        return await this.sessionRpc(sessionId, 'git-merge-worktree', options, {
            timeoutMs: WORKTREE_MERGE_RPC_TIMEOUT_MS
        }) as RpcGitMergeWorktreeResponse
    }

    async gitRemoveWorktree(sessionId: string): Promise<RpcGitRemoveWorktreeResponse> {
        return await this.sessionRpc(sessionId, 'git-remove-worktree', {}, {
            timeoutMs: WORKTREE_MERGE_RPC_TIMEOUT_MS
        }) as RpcGitRemoveWorktreeResponse
    }

    async gitMergeWorktreeState(sessionId: string, options: { targetBranch: string }): Promise<RpcGitMergeWorktreeStateResponse> {
        return await this.sessionRpc(sessionId, 'git-merge-worktree-state', options) as RpcGitMergeWorktreeStateResponse
    }

    async gitCaptureWorktreeMergeSnapshot(sessionId: string, options: { targetBranch: string }): Promise<RpcGitCaptureWorktreeMergeSnapshotResponse> {
        return await this.sessionRpc(sessionId, 'git-capture-worktree-merge-snapshot', options) as RpcGitCaptureWorktreeMergeSnapshotResponse
    }

    async gitVerifyWorktreeMerge(sessionId: string, options: {
        targetBranch: string
        mergeBase: string
        snapshotRef: string
    }): Promise<RpcGitVerifyWorktreeMergeResponse> {
        return await this.sessionRpc(sessionId, 'git-verify-worktree-merge', options, {
            timeoutMs: WORKTREE_MERGE_RPC_TIMEOUT_MS
        }) as RpcGitVerifyWorktreeMergeResponse
    }

    async readSessionFile(sessionId: string, path: string, cwd?: string): Promise<RpcReadFileResponse> {
        return await this.sessionRpc(sessionId, 'readFile', { path, cwd }) as RpcReadFileResponse
    }

    async readFileOnMachine(machineId: string, path: string, cwd?: string): Promise<RpcReadFileResponse> {
        return await this.machineRpc(machineId, 'readFile', { path, cwd }) as RpcReadFileResponse
    }

    async writeSessionFile(sessionId: string, path: string, options: {
        content: string
        cwd?: string
        expectedHash?: string | null
        createParents?: boolean
        overwrite?: boolean
    }): Promise<RpcWriteFileResponse> {
        return await this.sessionRpc(sessionId, 'writeFile', { path, ...options }) as RpcWriteFileResponse
    }

    async writeFileOnMachine(machineId: string, path: string, options: {
        content: string
        cwd?: string
        expectedHash?: string | null
        createParents?: boolean
        overwrite?: boolean
    }): Promise<RpcWriteFileResponse> {
        return await this.machineRpc(machineId, 'writeFile', { path, ...options }) as RpcWriteFileResponse
    }

    async listDirectory(sessionId: string, path: string, cwd?: string): Promise<RpcListDirectoryResponse> {
        return parseListDirectoryResponse(await this.sessionRpc(sessionId, 'listDirectory', { path, cwd }))
    }

    async listDirectoryOnMachine(machineId: string, path: string, cwd?: string): Promise<RpcListDirectoryResponse> {
        return parseListDirectoryResponse(await this.machineRpc(machineId, 'listDirectory', { path, cwd }))
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.sessionRpc(sessionId, 'uploadFile', { sessionId, filename, content, mimeType }) as RpcUploadFileResponse
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.sessionRpc(sessionId, 'deleteUpload', { sessionId, path }) as RpcDeleteUploadResponse
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'ripgrep', { args, cwd }) as RpcCommandResponse
    }

    async runRipgrepOnMachine(machineId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.machineRpc(machineId, 'ripgrep', { args, cwd }) as RpcCommandResponse
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSlashCommands', { agent }) as {
            success: boolean
            commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' }>
            error?: string
        }
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSkills', {}) as {
            success: boolean
            skills?: Array<{ name: string; description?: string }>
            error?: string
        }
    }

    private async sessionRpc(
        sessionId: string,
        method: string,
        params: unknown,
        options?: { timeoutMs?: number }
    ): Promise<unknown> {
        return await this.rpcCall(`${sessionId}:${method}`, params, options)
    }

    private async machineRpc(
        machineId: string,
        method: string,
        params: unknown,
        options?: { timeoutMs?: number }
    ): Promise<unknown> {
        return await this.rpcCall(`${machineId}:${method}`, params, options)
    }

    private async rpcCall(
        method: string,
        params: unknown,
        options?: { timeoutMs?: number }
    ): Promise<unknown> {
        const socketId = this.rpcRegistry.getSocketIdForMethod(method)
        if (!socketId) {
            throw new Error(`RPC handler not registered: ${method}`)
        }

        const socket = this.io.of('/cli').sockets.get(socketId)
        if (!socket) {
            throw new Error(`RPC socket disconnected: ${method}`)
        }

        const timeoutMs = options?.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
        const response = await socket.timeout(timeoutMs).emitWithAck('rpc-request', {
            method,
            params: JSON.stringify(params)
        }) as unknown

        if (typeof response !== 'string') {
            return response
        }

        try {
            return JSON.parse(response) as unknown
        } catch {
            return response
        }
    }
}

function parseListDirectoryResponse(result: unknown): RpcListDirectoryResponse {
    const parsed = ListDirectoryResponseSchema.safeParse(result)
    if (!parsed.success) {
        throw new Error('Invalid listDirectory response')
    }
    return parsed.data
}
