/**
 * Sync Engine for HOPI Telegram Bot (Direct Connect)
 *
 * In the direct-connect architecture:
 * - hopi-hub is the hub (Socket.IO + REST)
 * - hopi CLI connects directly to the hub (no relay)
 * - No E2E encryption; data is stored as JSON in SQLite
 */

import { isModelModeAllowedForFlavor, isPermissionModeAllowedForFlavor } from '@hopi/protocol'
import type { DecryptedMessage, ModelMode, PermissionMode, Session, SyncEvent } from '@hopi/protocol/types'
import type { Server } from 'socket.io'
import type { Store } from '../store'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { SSEManager } from '../sse/sseManager'
import { EventPublisher, type SyncEventListener } from './eventPublisher'
import { MachineCache, type Machine } from './machineCache'
import { MessageService } from './messageService'
import { AutoRunScheduler } from './autoRunScheduler'
import {
    RpcGateway,
    type RpcCommandResponse,
    type RpcDeleteUploadResponse,
    type RpcGitAutocommitWorktreeResponse,
    type RpcGitCaptureWorktreeMergeSnapshotResponse,
    type RpcGitMergeWorktreeResponse,
    type RpcGitMergeWorktreeStateResponse,
    type RpcGitVerifyWorktreeMergeResponse,
    type RpcListDirectoryResponse,
    type RpcPathExistsResponse,
    type RpcPreviewStatus,
    type RpcReadFileResponse,
    type RpcUploadFileResponse
} from './rpcGateway'
import { SessionCache } from './sessionCache'
import { TaskAutomation } from './taskAutomation'

export type { Session, SyncEvent } from '@hopi/protocol/types'
export type { Machine } from './machineCache'
export type { SyncEventListener } from './eventPublisher'
export type {
    RpcCommandResponse,
    RpcDeleteUploadResponse,
    RpcGitAutocommitWorktreeResponse,
    RpcGitCaptureWorktreeMergeSnapshotResponse,
    RpcGitMergeWorktreeResponse,
    RpcGitMergeWorktreeStateResponse,
    RpcGitVerifyWorktreeMergeResponse,
    RpcListDirectoryResponse,
    RpcPathExistsResponse,
    RpcPreviewStatus,
    RpcReadFileResponse,
    RpcUploadFileResponse
} from './rpcGateway'

export type ResumeSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code: 'session_not_found' | 'access_denied' | 'no_machine_online' | 'resume_unavailable' | 'resume_failed' }

const SESSION_CONFIG_APPLY_ATTEMPTS = 8
const SESSION_CONFIG_APPLY_RETRY_DELAY_MS = 250

function shouldRetrySessionConfigApply(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return message.startsWith('RPC handler not registered:') || message.startsWith('RPC socket disconnected:')
}

export class SyncEngine {
    private readonly store: Store
    private readonly eventPublisher: EventPublisher
    private readonly sessionCache: SessionCache
    private readonly machineCache: MachineCache
    private readonly messageService: MessageService
    private readonly rpcGateway: RpcGateway
    private readonly taskAutomation: TaskAutomation
    private readonly autoRunScheduler: AutoRunScheduler
    private inactivityTimer: NodeJS.Timeout | null = null

    constructor(
        store: Store,
        io: Server,
        rpcRegistry: RpcRegistry,
        sseManager: SSEManager
    ) {
        this.store = store
        this.eventPublisher = new EventPublisher(sseManager, (event) => this.resolveNamespace(event))
        this.sessionCache = new SessionCache(this.store, this.eventPublisher)
        this.machineCache = new MachineCache(this.store, this.eventPublisher)
        this.messageService = new MessageService(this.store, io, this.eventPublisher)
        this.rpcGateway = new RpcGateway(io, rpcRegistry)
        this.taskAutomation = new TaskAutomation(this.store, this)
        this.autoRunScheduler = new AutoRunScheduler(this.store, this)
        this.eventPublisher.subscribe((event) => this.taskAutomation.handleEvent(event))
        this.eventPublisher.subscribe((event) => this.autoRunScheduler.handleEvent(event))
        this.reloadAll()
        this.inactivityTimer = setInterval(() => this.expireInactive(), 5_000)
    }

    requestAutoRunTick(namespace: string, projectId: string): void {
        this.autoRunScheduler.requestTick(namespace, projectId, { delayMs: 0 })
    }

    stop(): void {
        if (this.inactivityTimer) {
            clearInterval(this.inactivityTimer)
            this.inactivityTimer = null
        }
    }

    subscribe(listener: SyncEventListener): () => void {
        return this.eventPublisher.subscribe(listener)
    }

    private resolveNamespace(event: SyncEvent): string | undefined {
        if (event.namespace) {
            return event.namespace
        }
        if ('sessionId' in event) {
            return this.getSession(event.sessionId)?.namespace
        }
        if ('machineId' in event) {
            return this.machineCache.getMachine(event.machineId)?.namespace
        }
        return undefined
    }

    private resolveOnlineMachineForSessionRpc(sessionId: string): {
        ok: true
        machineId: string
        sessionPath: string
    } | {
        ok: false
        error: string
    } {
        const session = this.getSession(sessionId)
        if (!session) {
            return { ok: false, error: 'Session not found' }
        }

        const sessionPath = session.metadata?.path
        if (!sessionPath) {
            return { ok: false, error: 'Session path not available' }
        }

        const namespace = session.namespace
        const metadata = session.metadata

        const onlineMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        if (onlineMachines.length === 0) {
            return {
                ok: false,
                error: 'No machine online. Start the runner and try again: hopi runner start'
            }
        }

        const targetMachine = (() => {
            if (metadata?.machineId) {
                const exact = onlineMachines.find((machine) => machine.id === metadata.machineId)
                if (exact) return exact
            }
            if (metadata?.host) {
                const hostMatch = onlineMachines.find((machine) => machine.metadata?.host === metadata.host)
                if (hostMatch) return hostMatch
            }
            return null
        })()

        if (!targetMachine) {
            return {
                ok: false,
                error: 'Session machine is offline. Start the runner on that machine and try again.'
            }
        }

        return { ok: true, machineId: targetMachine.id, sessionPath }
    }

    getSessions(): Session[] {
        return this.sessionCache.getSessions()
    }

    getSessionsByNamespace(namespace: string): Session[] {
        return this.sessionCache.getSessionsByNamespace(namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId) ?? undefined
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessionCache.getSessionByNamespace(sessionId, namespace)
            ?? this.sessionCache.refreshSession(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        return this.sessionCache.resolveSessionAccess(sessionId, namespace)
    }

    getActiveSessions(): Session[] {
        return this.sessionCache.getActiveSessions()
    }

    getMachines(): Machine[] {
        return this.machineCache.getMachines()
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getMachinesByNamespace(namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machineCache.getMachine(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        return this.machineCache.getMachineByNamespace(machineId, namespace)
    }

    getOnlineMachines(): Machine[] {
        return this.machineCache.getOnlineMachines()
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getOnlineMachinesByNamespace(namespace)
    }

    getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
        }
    } {
        return this.messageService.getMessagesPage(sessionId, options)
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        return this.messageService.getMessagesAfter(sessionId, options)
    }

    handleRealtimeEvent(event: SyncEvent): void {
        if (event.type === 'session-updated' && event.sessionId) {
            this.sessionCache.refreshSession(event.sessionId)
            return
        }

        if (event.type === 'machine-updated' && event.machineId) {
            this.machineCache.refreshMachine(event.machineId)
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            if (!this.getSession(event.sessionId)) {
                this.sessionCache.refreshSession(event.sessionId)
            }
        }

        this.eventPublisher.emit(event)
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        thinking?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        modelMode?: ModelMode
    }): void {
        this.sessionCache.handleSessionAlive(payload)
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        this.sessionCache.handleSessionEnd(payload)
    }

    handleMachineAlive(payload: { machineId: string; time: number }): void {
        this.machineCache.handleMachineAlive(payload)
    }

    private expireInactive(): void {
        this.sessionCache.expireInactive()
        this.machineCache.expireInactive()
    }

    private reloadAll(): void {
        this.sessionCache.reloadAll()
        this.machineCache.reloadAll()
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string): Session {
        return this.sessionCache.getOrCreateSession(tag, metadata, agentState, namespace)
    }

    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        return this.machineCache.getOrCreateMachine(id, metadata, runnerState, namespace)
    }

    async sendMessage(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            attachments?: Array<{
                id: string
                filename: string
                mimeType: string
                size: number
                path: string
                previewUrl?: string
            }>
            sentFrom?: 'telegram-bot' | 'webapp'
        }
    ): Promise<void> {
        await this.messageService.sendMessage(sessionId, payload)
    }

    injectMessage(
        sessionId: string,
        payload: {
            content: unknown
            localId?: string | null
        }
    ): void {
        this.messageService.injectMessage(sessionId, payload)
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.rpcGateway.approvePermission(sessionId, requestId, mode, allowTools, decision, answers)
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.rpcGateway.denyPermission(sessionId, requestId, decision)
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.rpcGateway.abortSession(sessionId)
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.rpcGateway.killSession(sessionId)
        this.handleSessionEnd({ sid: sessionId, time: Date.now() })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.rpcGateway.switchSession(sessionId, to)
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.sessionCache.renameSession(sessionId, name)
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.sessionCache.deleteSession(sessionId)
    }

    async applySessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            modelMode?: ModelMode
            collaborationMode?: string
        }
    ): Promise<void> {
        const result = await this.rpcGateway.requestSessionConfig(sessionId, config)
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response from session config RPC')
        }
        const obj = result as {
            applied?: {
                permissionMode?: Session['permissionMode']
                modelMode?: Session['modelMode']
                collaborationMode?: string
            }
        }
        const applied = obj.applied
        if (!applied || typeof applied !== 'object') {
            throw new Error('Missing applied session config')
        }

        this.sessionCache.applySessionConfig(sessionId, applied)
    }

    private async applySessionConfigWithRetry(
        sessionId: string,
        patch: {
            permissionMode?: PermissionMode
            modelMode?: ModelMode
        }
    ): Promise<void> {
        for (let attempt = 1; attempt <= SESSION_CONFIG_APPLY_ATTEMPTS; attempt += 1) {
            try {
                await this.applySessionConfig(sessionId, patch)
                return
            } catch (error) {
                if (!shouldRetrySessionConfigApply(error) || attempt >= SESSION_CONFIG_APPLY_ATTEMPTS) {
                    return
                }
                await new Promise((resolve) => setTimeout(resolve, SESSION_CONFIG_APPLY_RETRY_DELAY_MS))
            }
        }
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
        worktreeWorkspacePaths?: string[]
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        return await this.rpcGateway.spawnSession(
            machineId,
            directory,
            agent,
            model,
            yolo,
            sessionType,
            worktreeName,
            resumeSessionId,
            worktreeWorkspacePaths
        )
    }

    async resumeSession(sessionId: string, namespace: string): Promise<ResumeSessionResult> {
        const access = this.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) {
            return {
                type: 'error',
                message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found'
            }
        }

        const session = access.session
        if (session.active) {
            return { type: 'success', sessionId: access.sessionId }
        }

        const metadata = session.metadata
        if (!metadata || typeof metadata.path !== 'string') {
            return { type: 'error', message: 'Session metadata missing path', code: 'resume_unavailable' }
        }

        const flavor = metadata.flavor === 'codex' || metadata.flavor === 'gemini' || metadata.flavor === 'opencode'
            ? metadata.flavor
            : 'claude'
        const resumeToken = flavor === 'codex'
            ? metadata.codexSessionId
            : flavor === 'gemini'
                ? metadata.geminiSessionId
                : flavor === 'opencode'
                    ? metadata.opencodeSessionId
                    : metadata.claudeSessionId

        if (!resumeToken) {
            return { type: 'error', message: 'Resume session ID unavailable', code: 'resume_unavailable' }
        }

        const onlineMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        if (onlineMachines.length === 0) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const targetMachine = (() => {
            if (metadata.machineId) {
                const exact = onlineMachines.find((machine) => machine.id === metadata.machineId)
                if (exact) return exact
            }
            if (metadata.host) {
                const hostMatch = onlineMachines.find((machine) => machine.metadata?.host === metadata.host)
                if (hostMatch) return hostMatch
            }
            return null
        })()

        if (!targetMachine) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const taskModeFallback = (() => {
            const linkedTasks = this.store.tasks.listTasksByActiveSessionIdAndNamespace(
                access.sessionId,
                namespace,
                { includeArchived: true }
            )
            const linkedTask = linkedTasks[0]
            if (!linkedTask) {
                return null
            }
            return {
                permissionMode: typeof linkedTask.permissionMode === 'string'
                    ? linkedTask.permissionMode as PermissionMode
                    : undefined,
                modelMode: typeof linkedTask.modelMode === 'string'
                    ? linkedTask.modelMode as ModelMode
                    : undefined
            }
        })()

        const fallbackPermissionMode = taskModeFallback?.permissionMode
        const fallbackModelMode = taskModeFallback?.modelMode

        const previousPermissionMode = session.permissionMode
            ?? (fallbackPermissionMode && isPermissionModeAllowedForFlavor(fallbackPermissionMode, flavor)
                ? fallbackPermissionMode
                : undefined)
        const previousModelMode = session.modelMode
            ?? (fallbackModelMode && isModelModeAllowedForFlavor(fallbackModelMode, flavor)
                ? fallbackModelMode
                : undefined)
        const resumeWithYolo = previousPermissionMode === 'yolo' ? true : undefined

        const spawnResult = await this.rpcGateway.spawnSession(
            targetMachine.id,
            metadata.path,
            flavor,
            undefined,
            resumeWithYolo,
            undefined,
            undefined,
            resumeToken
        )

        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'resume_failed' }
        }

        const becameActive = await this.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
            return { type: 'error', message: 'Session failed to become active', code: 'resume_failed' }
        }

        if (previousPermissionMode || previousModelMode) {
            await this.applySessionConfigWithRetry(spawnResult.sessionId, {
                permissionMode: previousPermissionMode,
                modelMode: previousModelMode
            })
        }

        if (spawnResult.sessionId !== access.sessionId) {
            try {
                await this.sessionCache.mergeSessions(access.sessionId, spawnResult.sessionId, namespace)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to merge resumed session'
                return { type: 'error', message, code: 'resume_failed' }
            }
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }

    async waitForSessionActive(sessionId: string, timeoutMs: number = 15_000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.getSession(sessionId)
            if (session?.active) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return false
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        return await this.rpcGateway.checkPathsExist(machineId, paths)
    }

    async runBash(sessionId: string, params: {
        command: string
        cwd?: string
        timeout?: number
    }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.runBash(sessionId, params)
    }

    async previewStart(machineId: string, params: {
        taskId: string
        sessionId: string
        rootPath: string
        mode: 'local' | 'worktree'
        basePort?: number
    }): Promise<RpcPreviewStatus> {
        return await this.rpcGateway.previewStart(machineId, params)
    }

    async previewStatus(machineId: string): Promise<RpcPreviewStatus> {
        return await this.rpcGateway.previewStatus(machineId)
    }

    async previewStop(machineId: string, params?: { taskId?: string }): Promise<RpcPreviewStatus> {
        return await this.rpcGateway.previewStop(machineId, params)
    }

    async previewStartForSession(sessionId: string, params: {
        taskId: string
        rootPath: string
        mode: 'local' | 'worktree'
        basePort?: number
    }): Promise<RpcPreviewStatus> {
        return await this.rpcGateway.previewStartForSession(sessionId, params)
    }

    async previewStatusForSession(sessionId: string): Promise<RpcPreviewStatus> {
        return await this.rpcGateway.previewStatusForSession(sessionId)
    }

    async previewStopForSession(sessionId: string, params?: { taskId?: string }): Promise<RpcPreviewStatus> {
        return await this.rpcGateway.previewStopForSession(sessionId, params)
    }
    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        try {
            return await this.rpcGateway.getGitStatus(sessionId, cwd)
        } catch (error) {
            if (!shouldRetrySessionConfigApply(error)) {
                throw error
            }

            const fallback = this.resolveOnlineMachineForSessionRpc(sessionId)
            if (!fallback.ok) {
                return { success: false, error: fallback.error }
            }

            return await this.rpcGateway.getGitStatusOnMachine(
                fallback.machineId,
                cwd ?? fallback.sessionPath
            )
        }
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean; baseRef?: string }): Promise<RpcCommandResponse> {
        try {
            return await this.rpcGateway.getGitDiffNumstat(sessionId, options)
        } catch (error) {
            if (!shouldRetrySessionConfigApply(error)) {
                throw error
            }

            const fallback = this.resolveOnlineMachineForSessionRpc(sessionId)
            if (!fallback.ok) {
                return { success: false, error: fallback.error }
            }

            return await this.rpcGateway.getGitDiffNumstatOnMachine(fallback.machineId, {
                ...options,
                cwd: options.cwd ?? fallback.sessionPath
            })
        }
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean; baseRef?: string }): Promise<RpcCommandResponse> {
        try {
            return await this.rpcGateway.getGitDiffFile(sessionId, options)
        } catch (error) {
            if (!shouldRetrySessionConfigApply(error)) {
                throw error
            }

            const fallback = this.resolveOnlineMachineForSessionRpc(sessionId)
            if (!fallback.ok) {
                return { success: false, error: fallback.error }
            }

            return await this.rpcGateway.getGitDiffFileOnMachine(fallback.machineId, {
                ...options,
                cwd: options.cwd ?? fallback.sessionPath
            })
        }
    }

    async gitAutocommitWorktree(sessionId: string, options: { message: string }): Promise<RpcGitAutocommitWorktreeResponse> {
        return await this.rpcGateway.gitAutocommitWorktree(sessionId, options)
    }

    async gitMergeWorktree(sessionId: string, options: { targetBranch: string; commitMessage: string }): Promise<RpcGitMergeWorktreeResponse> {
        return await this.rpcGateway.gitMergeWorktree(sessionId, options)
    }

    async gitMergeWorktreeState(sessionId: string, options: { targetBranch: string }): Promise<RpcGitMergeWorktreeStateResponse> {
        return await this.rpcGateway.gitMergeWorktreeState(sessionId, options)
    }

    async gitCaptureWorktreeMergeSnapshot(sessionId: string, options: { targetBranch: string }): Promise<RpcGitCaptureWorktreeMergeSnapshotResponse> {
        return await this.rpcGateway.gitCaptureWorktreeMergeSnapshot(sessionId, options)
    }

    async gitVerifyWorktreeMerge(sessionId: string, options: {
        targetBranch: string
        mergeBase: string
        snapshotRef: string
    }): Promise<RpcGitVerifyWorktreeMergeResponse> {
        return await this.rpcGateway.gitVerifyWorktreeMerge(sessionId, options)
    }

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        try {
            return await this.rpcGateway.readSessionFile(sessionId, path)
        } catch (error) {
            if (!shouldRetrySessionConfigApply(error)) {
                throw error
            }

            const fallback = this.resolveOnlineMachineForSessionRpc(sessionId)
            if (!fallback.ok) {
                return { success: false, error: fallback.error }
            }

            return await this.rpcGateway.readFileOnMachine(
                fallback.machineId,
                path,
                fallback.sessionPath
            )
        }
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        try {
            return await this.rpcGateway.listDirectory(sessionId, path)
        } catch (error) {
            if (!shouldRetrySessionConfigApply(error)) {
                throw error
            }

            const fallback = this.resolveOnlineMachineForSessionRpc(sessionId)
            if (!fallback.ok) {
                return { success: false, error: fallback.error }
            }

            return await this.rpcGateway.listDirectoryOnMachine(
                fallback.machineId,
                path,
                fallback.sessionPath
            )
        }
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.rpcGateway.uploadFile(sessionId, filename, content, mimeType)
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.rpcGateway.deleteUploadFile(sessionId, path)
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        try {
            return await this.rpcGateway.runRipgrep(sessionId, args, cwd)
        } catch (error) {
            if (!shouldRetrySessionConfigApply(error)) {
                throw error
            }

            const fallback = this.resolveOnlineMachineForSessionRpc(sessionId)
            if (!fallback.ok) {
                return { success: false, error: fallback.error }
            }

            return await this.rpcGateway.runRipgrepOnMachine(
                fallback.machineId,
                args,
                cwd ?? fallback.sessionPath
            )
        }
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' }>
        error?: string
    }> {
        return await this.rpcGateway.listSlashCommands(sessionId, agent)
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.rpcGateway.listSkills(sessionId)
    }
}
