import type {
    AttachmentMetadata,
    AgentOutputLanguage,
    AutomationLaneLimits,
    AuthResponse,
    DeleteUploadResponse,
    ListDirectoryResponse,
    FileReadResponse,
    FileSearchResponse,
    GitCommandResponse,
    Goal,
    GoalDecisionTopicResponse,
    GoalDecisionTopicsResponse,
    GoalResponse,
    GoalTodoResponse,
    GoalsResponse,
    MachinePathsExistsResponse,
    MachinesResponse,
    MessagesResponse,
    ModelMode,
    PermissionMode,
    ProjectAutomationVerificationResponse,
    ProjectResponse,
    ProjectsResponse,
    PushSubscriptionPayload,
    PushUnsubscribePayload,
    PushVapidPublicKeyResponse,
    SlashCommandsResponse,
    SkillsResponse,
    SpawnResponse,
    TaskResponse,
    TaskPreviewResponse,
    TaskStartSessionResponse,
    TaskWorktreeMergeCancelResponse,
    TaskWorktreeMergeResponse,
    TaskWorktreeMergeStateResponse,
    TasksResponse,
    UploadFileResponse,
    VisibilityPayload,
    WorkflowStrategiesResponse,
    WorkspaceResponse,
    WorkspacesResponse,
    SessionResponse,
    SessionsResponse
} from '@/types/api'
import { PRODUCT_HEADERS, productStorageKey } from '@hopi/protocol/brand'

const LOCALE_STORAGE_KEY = productStorageKey('lang')

type ApiClientOptions = {
    baseUrl?: string
    getToken?: () => string | null
    onUnauthorized?: () => Promise<string | null>
}

type ErrorPayload = {
    error?: unknown
}

type ParsedErrorPayload = {
    payload?: ErrorPayload
    code?: string
    message?: string
}

function getStoredLocale(): string | null {
    const storage = typeof globalThis === 'object' ? globalThis.localStorage : undefined
    if (!storage) {
        return null
    }

    try {
        const raw = storage.getItem(LOCALE_STORAGE_KEY)
        const value = raw?.trim()
        return value && value.length > 0 ? value : null
    } catch {
        return null
    }
}

function parseErrorPayload(bodyText: string): ParsedErrorPayload {
    try {
        const parsed = JSON.parse(bodyText) as ErrorPayload
        if (typeof parsed.error === 'string') {
            return {
                payload: parsed,
                code: parsed.error,
                message: parsed.error
            }
        }
        if (parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)) {
            const error = parsed.error as Record<string, unknown>
            return {
                payload: parsed,
                code: typeof error.code === 'string' ? error.code : undefined,
                message: typeof error.message === 'string' ? error.message : undefined
            }
        }
        return { payload: parsed }
    } catch {
        return {}
    }
}

export class ApiError extends Error {
    status: number
    code?: string
    body?: string
    payload?: ErrorPayload

    constructor(message: string, status: number, code?: string, body?: string, payload?: ErrorPayload) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.body = body
        this.payload = payload
    }
}

export class ApiClient {
    private token: string
    private readonly baseUrl: string | null
    private readonly getToken: (() => string | null) | null
    private readonly onUnauthorized: (() => Promise<string | null>) | null

    constructor(token: string, options?: ApiClientOptions) {
        this.token = token
        this.baseUrl = options?.baseUrl ?? null
        this.getToken = options?.getToken ?? null
        this.onUnauthorized = options?.onUnauthorized ?? null
    }

    private buildUrl(path: string): string {
        if (!this.baseUrl) {
            return path
        }
        try {
            return new URL(path, this.baseUrl).toString()
        } catch {
            return path
        }
    }

    private async request<T>(
        path: string,
        init?: RequestInit,
        attempt: number = 0,
        overrideToken?: string | null
    ): Promise<T> {
        const headers = new Headers(init?.headers)
        const liveToken = this.getToken ? this.getToken() : null
        const authToken = overrideToken !== undefined
            ? (overrideToken ?? (liveToken ?? this.token))
            : (liveToken ?? this.token)
        if (authToken) {
            headers.set('authorization', `Bearer ${authToken}`)
        }
        if (!headers.has(PRODUCT_HEADERS.LOCALE)) {
            const locale = getStoredLocale()
            if (locale) {
                headers.set(PRODUCT_HEADERS.LOCALE, locale)
            }
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(this.buildUrl(path), {
            ...init,
            headers
        })

        if (res.status === 401) {
            if (attempt === 0 && this.onUnauthorized) {
                const refreshed = await this.onUnauthorized()
                if (refreshed) {
                    this.token = refreshed
                    return await this.request<T>(path, init, attempt + 1, refreshed)
                }
            }
            throw new Error('Session expired. Please sign in again.')
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const parsedError = parseErrorPayload(body)
            const detail = parsedError.message
                ? `: ${parsedError.message}`
                : parsedError.code
                    ? `: ${parsedError.code}`
                : body
                    ? `: ${body}`
                    : ''
            throw new ApiError(
                `HTTP ${res.status} ${res.statusText}${detail}`,
                res.status,
                parsedError.code,
                body || undefined,
                parsedError.payload
            )
        }

        return await res.json() as T
    }

    async authenticate(auth: { initData: string } | { accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/auth'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const parsedError = parseErrorPayload(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Auth failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, parsedError.code, body || undefined, parsedError.payload)
        }

        return await res.json() as AuthResponse
    }

    async bind(auth: { initData: string; accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/bind'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const parsedError = parseErrorPayload(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Bind failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, parsedError.code, body || undefined, parsedError.payload)
        }

        return await res.json() as AuthResponse
    }

    async getSessions(): Promise<SessionsResponse> {
        return await this.request<SessionsResponse>('/api/sessions')
    }

    async getProjects(options?: { includeArchived?: boolean }): Promise<ProjectsResponse> {
        const params = new URLSearchParams()
        if (options?.includeArchived) {
            params.set('includeArchived', 'true')
        }
        const qs = params.toString()
        return await this.request<ProjectsResponse>(`/api/projects${qs ? `?${qs}` : ''}`)
    }

    async getProject(projectId: string): Promise<ProjectResponse> {
        return await this.request<ProjectResponse>(`/api/projects/${encodeURIComponent(projectId)}`)
    }

    async listWorkflowStrategies(): Promise<WorkflowStrategiesResponse> {
        return await this.request<WorkflowStrategiesResponse>('/api/workflow-strategies')
    }

    async createProject(payload: {
        machineId: string
        name: string
        description?: string
        workspaces: Array<{ path: string; label?: string }>
        defaultAgentFlavor?: 'claude' | 'codex' | 'gemini' | 'opencode'
        defaultPermissionMode?: PermissionMode
        defaultModel?: string
        defaultModelMode?: ModelMode
        defaultSessionType?: 'simple' | 'worktree'
        worktreeTargetBranch?: string
        worktreeAutoCommitMode?: 'off' | 'per_conversation'
        worktreeCleanupAfterMerge?: boolean
        agentOutputLanguage?: AgentOutputLanguage
        autoRunEnabled?: boolean
        maxRunningSessions?: number
        automationLaneLimits?: AutomationLaneLimits
        improvementsEnabled?: boolean
        improvementsMaxPendingTasks?: number
    }): Promise<ProjectResponse> {
        return await this.request<ProjectResponse>('/api/projects', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async updateProject(projectId: string, patch: {
        name?: string
        description?: string | null
        defaultAgentFlavor?: 'claude' | 'codex' | 'gemini' | 'opencode' | null
        defaultPermissionMode?: PermissionMode | null
        defaultModel?: string | null
        defaultModelMode?: ModelMode | null
        defaultSessionType?: 'simple' | 'worktree' | null
        worktreeTargetBranch?: string | null
        worktreeAutoCommitMode?: 'off' | 'per_conversation' | null
        worktreeCleanupAfterMerge?: boolean
        agentOutputLanguage?: AgentOutputLanguage | null
        autoRunEnabled?: boolean
        maxRunningSessions?: number
        automationLaneLimits?: AutomationLaneLimits | null
        improvementsEnabled?: boolean
        improvementsMaxPendingTasks?: number
    }): Promise<ProjectResponse> {
        return await this.request<ProjectResponse>(`/api/projects/${encodeURIComponent(projectId)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch)
        })
    }

    async archiveProject(projectId: string): Promise<void> {
        await this.request(`/api/projects/${encodeURIComponent(projectId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async verifyProjectAutomation(projectId: string): Promise<ProjectAutomationVerificationResponse> {
        return await this.request<ProjectAutomationVerificationResponse>(`/api/projects/${encodeURIComponent(projectId)}/verify-automation`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async listProjectGoals(projectId: string): Promise<GoalsResponse> {
        return await this.request<GoalsResponse>(`/api/projects/${encodeURIComponent(projectId)}/goals`)
    }

    async getGoalTodo(projectId: string, goalId: string): Promise<GoalTodoResponse> {
        return await this.request<GoalTodoResponse>(`/api/projects/${encodeURIComponent(projectId)}/goals/${encodeURIComponent(goalId)}/todo`)
    }

    async createProjectGoal(projectId: string, payload: {
        title: string
        description?: string | null
        successCriteria?: string | null
        autopilotEnabled?: boolean
        deployRequiresApproval?: boolean
    }): Promise<GoalResponse> {
        return await this.request<GoalResponse>(`/api/projects/${encodeURIComponent(projectId)}/goals`, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async updateGoal(goalId: string, patch: {
        title?: string
        description?: string | null
        status?: Goal['status']
        successCriteria?: string | null
        autopilotEnabled?: boolean
        deployRequiresApproval?: boolean
        currentFocus?: string | null
    }): Promise<GoalResponse> {
        return await this.request<GoalResponse>(`/api/goals/${encodeURIComponent(goalId)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch)
        })
    }

    async listGoalDecisionTopics(goalId: string): Promise<GoalDecisionTopicsResponse> {
        return await this.request<GoalDecisionTopicsResponse>(`/api/goals/${encodeURIComponent(goalId)}/topics`)
    }

    async createGoalDecisionTopic(goalId: string, payload: {
        taskId?: string | null
        title: string
        body: string
        blocking?: boolean
    }): Promise<GoalDecisionTopicResponse> {
        return await this.request<GoalDecisionTopicResponse>(`/api/goals/${encodeURIComponent(goalId)}/topics`, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async resolveGoalDecisionTopic(topicId: string, payload: {
        resolution: string
    }): Promise<GoalDecisionTopicResponse> {
        return await this.request<GoalDecisionTopicResponse>(`/api/goal-topics/${encodeURIComponent(topicId)}/resolve`, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async listProjectWorkspaces(projectId: string): Promise<WorkspacesResponse> {
        return await this.request<WorkspacesResponse>(`/api/projects/${encodeURIComponent(projectId)}/workspaces`)
    }

    async createProjectWorkspaces(projectId: string, workspaces: Array<{ path: string; label?: string }>): Promise<WorkspacesResponse> {
        return await this.request<WorkspacesResponse>(`/api/projects/${encodeURIComponent(projectId)}/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ workspaces })
        })
    }

    async updateWorkspace(workspaceId: string, patch: { path?: string; label?: string | null; sort?: number | null }): Promise<WorkspaceResponse> {
        return await this.request<WorkspaceResponse>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch)
        })
    }

    async deleteWorkspace(workspaceId: string): Promise<void> {
        await this.request(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' })
    }

    async listProjectTasks(projectId: string, options?: { includeArchived?: boolean; goalId?: string }): Promise<TasksResponse> {
        const params = new URLSearchParams()
        if (options?.includeArchived) {
            params.set('includeArchived', 'true')
        }
        if (options?.goalId) {
            params.set('goalId', options.goalId)
        }
        const qs = params.toString()
        return await this.request<TasksResponse>(`/api/projects/${encodeURIComponent(projectId)}/tasks${qs ? `?${qs}` : ''}`)
    }

    async createProjectTask(projectId: string, payload: {
        title: string
        description?: string
        status?: 'planned' | 'in_progress' | 'in_review' | 'blocked' | 'finished'
        priority?: 'high' | 'medium' | 'low'
        workspaceId?: string
        agentFlavor?: 'claude' | 'codex' | 'gemini' | 'opencode'
        permissionMode?: PermissionMode
        model?: string
        modelMode?: string
        workflowProfile: string
        workflowPhase?: string | null
        sortKey?: number
        attachments?: Array<{
            id: string
            filename: string
            mimeType: string
            size: number
            dataUrl: string
            previewUrl?: string
        }>
        goalId?: string | null
        contract?: string | null
        handoff?: string | null
        evidence?: string | null
        source?: 'manual' | 'planner' | 'radar' | 'evaluator'
        subTasks?: Array<{
            id: string
            content: string
            status: 'pending' | 'in_progress' | 'completed'
            priority: 'high' | 'medium' | 'low'
        }>
    }): Promise<TaskResponse> {
        return await this.request<TaskResponse>(`/api/projects/${encodeURIComponent(projectId)}/tasks`, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async getTask(taskId: string): Promise<TaskResponse> {
        return await this.request<TaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}`)
    }

    async updateTask(taskId: string, patch: {
        title?: string
        description?: string | null
        status?: 'planned' | 'in_progress' | 'in_review' | 'blocked' | 'finished'
        source?: 'manual' | 'planner' | 'radar' | 'evaluator'
        priority?: 'high' | 'medium' | 'low' | null
        workspaceId?: string | null
        agentFlavor?: 'claude' | 'codex' | 'gemini' | 'opencode' | null
        permissionMode?: PermissionMode | null
        model?: string | null
        modelMode?: ModelMode | null
        workflowProfile?: string
        workflowPhase?: string | null
        sortKey?: number | null
        activeSessionId?: string | null
        attachments?: Array<{
            id: string
            filename: string
            mimeType: string
            size: number
            dataUrl: string
            previewUrl?: string
        }>
        goalId?: string | null
        contract?: string | null
        handoff?: string | null
        evidence?: string | null
        subTasks?: Array<{
            id: string
            content: string
            status: 'pending' | 'in_progress' | 'completed'
            priority: 'high' | 'medium' | 'low'
        }>
    }): Promise<TaskResponse> {
        return await this.request<TaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch)
        })
    }

    async deleteTask(taskId: string): Promise<void> {
        await this.request(`/api/tasks/${encodeURIComponent(taskId)}`, {
            method: 'DELETE'
        })
    }

    async archiveTask(taskId: string): Promise<void> {
        await this.request(`/api/tasks/${encodeURIComponent(taskId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async attachTaskSession(taskId: string, sessionId: string): Promise<TaskResponse> {
        return await this.request<TaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}/attach-session`, {
            method: 'POST',
            body: JSON.stringify({ sessionId })
        })
    }

    async startTaskSession(taskId: string, payload?: {
        workspaceId?: string
        agent?: 'claude' | 'codex' | 'gemini' | 'opencode'
        model?: string
        yolo?: boolean
        permissionMode?: PermissionMode
        modelMode?: ModelMode
    }): Promise<TaskStartSessionResponse> {
        return await this.request<TaskStartSessionResponse>(`/api/tasks/${encodeURIComponent(taskId)}/start-session`, {
            method: 'POST',
            body: JSON.stringify(payload ?? {})
        })
    }

    async startTaskPreview(taskId: string, payload?: {
        mode?: 'auto' | 'local' | 'worktree'
        basePort?: number
    }): Promise<TaskPreviewResponse> {
        return await this.request<TaskPreviewResponse>(`/api/tasks/${encodeURIComponent(taskId)}/preview/start`, {
            method: 'POST',
            body: JSON.stringify(payload ?? {})
        })
    }

    async getTaskPreview(taskId: string): Promise<TaskPreviewResponse> {
        return await this.request<TaskPreviewResponse>(`/api/tasks/${encodeURIComponent(taskId)}/preview`)
    }

    async stopTaskPreview(taskId: string): Promise<TaskPreviewResponse> {
        return await this.request<TaskPreviewResponse>(`/api/tasks/${encodeURIComponent(taskId)}/preview/stop`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async mergeTaskWorktree(taskId: string, payload?: { targetBranch?: string; conflictStrategy?: 'manual' | 'agent' }): Promise<TaskWorktreeMergeResponse> {
        return await this.request<TaskWorktreeMergeResponse>(`/api/tasks/${encodeURIComponent(taskId)}/worktree/merge`, {
            method: 'POST',
            body: JSON.stringify(payload ?? {})
        })
    }

    async cancelTaskWorktreeMerge(taskId: string): Promise<TaskWorktreeMergeCancelResponse> {
        return await this.request<TaskWorktreeMergeCancelResponse>(`/api/tasks/${encodeURIComponent(taskId)}/worktree/merge/cancel`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async getTaskWorktreeMergeState(taskId: string): Promise<TaskWorktreeMergeStateResponse> {
        return await this.request<TaskWorktreeMergeStateResponse>(`/api/tasks/${encodeURIComponent(taskId)}/worktree/merge-state`)
    }

    async getPushVapidPublicKey(): Promise<PushVapidPublicKeyResponse> {
        return await this.request<PushVapidPublicKeyResponse>('/api/push/vapid-public-key')
    }

    async subscribePushNotifications(payload: PushSubscriptionPayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async unsubscribePushNotifications(payload: PushUnsubscribePayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'DELETE',
            body: JSON.stringify(payload)
        })
    }

    async setVisibility(payload: VisibilityPayload): Promise<void> {
        await this.request('/api/visibility', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async getSession(sessionId: string): Promise<SessionResponse> {
        return await this.request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    }

    async getMessages(sessionId: string, options: { beforeSeq?: number | null; limit?: number }): Promise<MessagesResponse> {
        const params = new URLSearchParams()
        if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
            params.set('beforeSeq', `${options.beforeSeq}`)
        }
        if (options.limit !== undefined && options.limit !== null) {
            params.set('limit', `${options.limit}`)
        }

        const qs = params.toString()
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`
        return await this.request<MessagesResponse>(url)
    }

    async getGitStatus(sessionId: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-status`)
    }

    async getGitDiffNumstat(
        sessionId: string,
        stagedOrOptions?: boolean | { staged?: boolean; baseRef?: string }
    ): Promise<GitCommandResponse> {
        const options = typeof stagedOrOptions === 'boolean'
            ? { staged: stagedOrOptions }
            : (stagedOrOptions ?? {})
        const params = new URLSearchParams()
        if (options.staged !== undefined) {
            params.set('staged', options.staged ? 'true' : 'false')
        }
        if (options.baseRef) {
            params.set('baseRef', options.baseRef)
        }
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-numstat?${params.toString()}`)
    }

    async getGitDiffFile(
        sessionId: string,
        path: string,
        stagedOrOptions?: boolean | { staged?: boolean; baseRef?: string }
    ): Promise<GitCommandResponse> {
        const options = typeof stagedOrOptions === 'boolean'
            ? { staged: stagedOrOptions }
            : (stagedOrOptions ?? {})
        const params = new URLSearchParams()
        params.set('path', path)
        if (options.staged !== undefined) {
            params.set('staged', options.staged ? 'true' : 'false')
        }
        if (options.baseRef) {
            params.set('baseRef', options.baseRef)
        }
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-file?${params.toString()}`)
    }

    async getTaskMergedDiffFile(taskId: string, path: string): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        return await this.request<GitCommandResponse>(`/api/tasks/${encodeURIComponent(taskId)}/worktree/merged-diff-file?${params.toString()}`)
    }

    async searchSessionFiles(sessionId: string, query: string, limit?: number): Promise<FileSearchResponse> {
        const params = new URLSearchParams()
        if (query) {
            params.set('query', query)
        }
        if (limit !== undefined) {
            params.set('limit', `${limit}`)
        }
        const qs = params.toString()
        return await this.request<FileSearchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/files${qs ? `?${qs}` : ''}`)
    }

    async readSessionFile(sessionId: string, path: string): Promise<FileReadResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        return await this.request<FileReadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`)
    }

    async listSessionDirectory(sessionId: string, path?: string): Promise<ListDirectoryResponse> {
        const params = new URLSearchParams()
        if (path) {
            params.set('path', path)
        }

        const qs = params.toString()
        return await this.request<ListDirectoryResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/directory${qs ? `?${qs}` : ''}`
        )
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<UploadFileResponse> {
        return await this.request<UploadFileResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload`, {
            method: 'POST',
            body: JSON.stringify({ filename, content, mimeType })
        })
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<DeleteUploadResponse> {
        return await this.request<DeleteUploadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload/delete`, {
            method: 'POST',
            body: JSON.stringify({ path })
        })
    }

    async resumeSession(sessionId: string): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
            { method: 'POST' }
        )
        return response.sessionId
    }

    async sendMessage(sessionId: string, text: string, localId?: string | null, attachments?: AttachmentMetadata[]): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                text,
                localId: localId ?? undefined,
                attachments: attachments ?? undefined
            })
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async switchSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/switch`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permission-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setModelMode(sessionId: string, model: ModelMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
            method: 'POST',
            body: JSON.stringify({ model })
        })
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        modeOrOptions?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | {
            mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
            allowTools?: string[]
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
            answers?: Record<string, string[]> | Record<string, { answers: string[] }>
        }
    ): Promise<void> {
        const body = typeof modeOrOptions === 'string' || modeOrOptions === undefined
            ? { mode: modeOrOptions }
            : modeOrOptions
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/approve`, {
            method: 'POST',
            body: JSON.stringify(body)
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        options?: {
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
        }
    ): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/deny`, {
            method: 'POST',
            body: JSON.stringify(options ?? {})
        })
    }

    async getMachines(): Promise<MachinesResponse> {
        return await this.request<MachinesResponse>('/api/machines')
    }

    async checkMachinePathsExists(
        machineId: string,
        paths: string[]
    ): Promise<MachinePathsExistsResponse> {
        return await this.request<MachinePathsExistsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/paths/exists`,
            {
                method: 'POST',
                body: JSON.stringify({ paths })
            }
        )
    }

    async listMachineDirectory(machineId: string, path?: string): Promise<ListDirectoryResponse> {
        const params = new URLSearchParams()
        if (path) {
            params.set('path', path)
        }

        const qs = params.toString()
        return await this.request<ListDirectoryResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/directory${qs ? `?${qs}` : ''}`
        )
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent?: 'claude' | 'codex' | 'gemini' | 'opencode',
        model?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string
    ): Promise<SpawnResponse> {
        return await this.request<SpawnResponse>(`/api/machines/${encodeURIComponent(machineId)}/spawn`, {
            method: 'POST',
            body: JSON.stringify({ directory, agent, model, yolo, sessionType, worktreeName })
        })
    }

    async getSlashCommands(sessionId: string): Promise<SlashCommandsResponse> {
        return await this.request<SlashCommandsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/slash-commands`
        )
    }

    async getSkills(sessionId: string): Promise<SkillsResponse> {
        return await this.request<SkillsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/skills`
        )
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
        })
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        })
    }

    async fetchVoiceToken(options?: { customAgentId?: string; customApiKey?: string }): Promise<{
        allowed: boolean
        token?: string
        agentId?: string
        error?: string
    }> {
        return await this.request('/api/voice/token', {
            method: 'POST',
            body: JSON.stringify(options || {})
        })
    }
}
