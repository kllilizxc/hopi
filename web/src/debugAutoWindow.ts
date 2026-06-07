type AssistantWindowActionName = 'resetAssistantSession' | 'startFreshAssistantSession'

type AssistantWindowTarget = {
    projectId?: string | null
    goalId?: string | null
}

type AssistantWindowTargetInput = AssistantWindowTarget | string | null | undefined

type AssistantWindowActionResult = {
    ok: boolean
    action: AssistantWindowActionName
    projectId: string
    goalId: string
    previousSessionId: string | null
    sessionId: string | null
    created: boolean
    retired: boolean
    retiredSessionIds: string[]
    steps: string[]
    error?: string
}

type ControllerSessionResponse = {
    sessionId: string | null
    session: {
        id: string
        active: boolean
    } | null
    created?: boolean
}

type GoalsResponse = {
    goals?: Array<{ id?: string | null }>
}

type ControllerResetResponse = {
    ok?: boolean
    retiredSessionIds?: string[]
}

type RequestResult<T> = {
    ok: boolean
    status: number
    payload: T | string | null
}

declare global {
    interface Window {
        resetAssistantSession: (
            projectIdOrOptions?: AssistantWindowTargetInput,
            maybeGoalId?: string
        ) => Promise<AssistantWindowActionResult>
        startFreshAssistantSession: (
            projectIdOrOptions?: AssistantWindowTargetInput,
            maybeGoalId?: string
        ) => Promise<AssistantWindowActionResult>
        startAssistant: (
            projectIdOrOptions?: AssistantWindowTargetInput,
            maybeGoalId?: string
        ) => Promise<AssistantWindowActionResult>
        resetAssistant: (
            projectIdOrOptions?: AssistantWindowTargetInput,
            maybeGoalId?: string
        ) => Promise<AssistantWindowActionResult>
    }
}

const LEGACY_STORAGE_KEY = 'hopi:auto-debug-action'
const SELECTED_GOAL_STORAGE_KEY = 'hopi-selected-goals-by-project-v1'

function clearLegacyPendingState(): void {
    try {
        window.sessionStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
        // Ignore storage access failures in debug helper.
    }
}

function trimToNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getCurrentProjectIdFromPath(): string | null {
    const match = window.location.pathname.match(/^\/(?:auto|projects)\/([^/?#]+)/i)
    return trimToNull(match?.[1] ?? null)
}

function getCurrentGoalIdFromSearch(): string | null {
    const search = new URLSearchParams(window.location.search)
    return trimToNull(search.get('goalId'))
}

function findNestedString(
    value: unknown,
    candidateKeys: string[],
    seen = new Set<unknown>(),
    depth = 0
): string | null {
    if (depth > 6 || value == null || typeof value !== 'object' || seen.has(value)) {
        return null
    }

    seen.add(value)

    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = findNestedString(item, candidateKeys, seen, depth + 1)
            if (nested) {
                return nested
            }
        }
        return null
    }

    const record = value as Record<string, unknown>
    for (const key of candidateKeys) {
        const direct = trimToNull(typeof record[key] === 'string' ? record[key] : null)
        if (direct) {
            return direct
        }
    }

    for (const nestedValue of Object.values(record)) {
        const nested = findNestedString(nestedValue, candidateKeys, seen, depth + 1)
        if (nested) {
            return nested
        }
    }

    return null
}

function getReactInternalRoots(): unknown[] {
    if (!document.body) {
        return []
    }

    const roots: unknown[] = []
    const elements = [document.body, ...Array.from(document.querySelectorAll('*'))]
    for (const element of elements) {
        const record = element as unknown as Record<string, unknown>
        for (const key of Object.keys(record)) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactProps$')) {
                roots.push(record[key])
            }
        }
    }
    return roots
}

function findFromReactInternals(candidateKeys: string[]): string | null {
    for (const root of getReactInternalRoots()) {
        const value = findNestedString(root, candidateKeys)
        if (value) {
            return value
        }
    }
    return null
}

function getCurrentProjectIdFromState(): string | null {
    return findNestedString(window.history.state, ['projectId'])
}

function getCurrentGoalIdFromState(): string | null {
    return findNestedString(window.history.state, ['goalId'])
}

function getCurrentProjectIdFromReact(): string | null {
    return findFromReactInternals(['projectId'])
}

function getCurrentGoalIdFromReact(): string | null {
    return findFromReactInternals(['goalId'])
}

function getStoredSelectedGoalId(projectId: string | null): string | null {
    if (!projectId) {
        return null
    }

    try {
        const raw = window.localStorage.getItem(SELECTED_GOAL_STORAGE_KEY)
        if (!raw) {
            return null
        }

        const parsed = JSON.parse(raw) as unknown
        if (!isRecord(parsed)) {
            return null
        }

        return trimToNull(typeof parsed[projectId] === 'string' ? parsed[projectId] : null)
    } catch {
        return null
    }
}

function collectStoredTokenCandidates(): string[] {
    const candidates = new Set<string>()
    const storages = [window.localStorage, window.sessionStorage]

    for (const storage of storages) {
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index)
            if (!key) {
                continue
            }

            const rawValue = storage.getItem(key)
            if (!rawValue) {
                continue
            }

            const lowerKey = key.toLowerCase()
            if (lowerKey.includes('token') || lowerKey.includes('auth') || lowerKey.includes('access')) {
                candidates.add(rawValue)
            }

            try {
                const parsed = JSON.parse(rawValue) as Record<string, unknown>
                for (const candidateKey of ['token', 'accessToken', 'authToken', 'apiToken', 'value']) {
                    const candidate = parsed[candidateKey]
                    if (typeof candidate === 'string' && candidate.trim()) {
                        candidates.add(candidate)
                    }
                }
            } catch {
                // Ignore non-JSON storage values.
            }
        }
    }

    return Array.from(candidates)
}

async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    const requestInit: RequestInit = {
        credentials: 'same-origin',
        ...init
    }

    const first = await fetch(url, requestInit)
    if (first.ok || (first.status !== 401 && first.status !== 403)) {
        return first
    }

    for (const token of collectStoredTokenCandidates()) {
        const retry = await fetch(url, {
            ...requestInit,
            headers: {
                ...(requestInit.headers ?? {}),
                Authorization: `Bearer ${token}`
            }
        })
        if (retry.ok || (retry.status !== 401 && retry.status !== 403)) {
            return retry
        }
    }

    return first
}

async function parseResponsePayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
        return await response.json()
    }
    return await response.text()
}

async function request<T>(url: string, init?: RequestInit): Promise<RequestResult<T>> {
    const response = await fetchWithAuth(url, init)
    const payload = await parseResponsePayload(response).catch(() => null)
    return {
        ok: response.ok,
        status: response.status,
        payload: payload as T | string | null
    }
}

function buildRequestError(result: RequestResult<unknown>, fallback: string): string {
    if (typeof result.payload === 'string' && result.payload.trim()) {
        return `${fallback}: ${result.payload.trim()}`
    }
    if (isRecord(result.payload) && typeof result.payload.error === 'string' && result.payload.error.trim()) {
        return `${fallback}: ${result.payload.error.trim()}`
    }
    return `${fallback}: HTTP ${result.status}`
}

async function getFirstProjectGoalId(projectId: string): Promise<string | null> {
    const result = await request<GoalsResponse>(`/api/projects/${encodeURIComponent(projectId)}/goals`)
    if (!result.ok) {
        throw new Error(buildRequestError(result, 'Failed to load goals'))
    }

    if (!isRecord(result.payload) || !Array.isArray(result.payload.goals)) {
        return null
    }

    for (const goal of result.payload.goals) {
        if (!isRecord(goal)) {
            continue
        }
        const goalId = trimToNull(typeof goal.id === 'string' ? goal.id : null)
        if (goalId) {
            return goalId
        }
    }

    return null
}

async function resolveTarget(
    projectIdOrOptions?: AssistantWindowTargetInput,
    maybeGoalId?: string
): Promise<{ projectId: string | null, goalId: string | null }> {
    let explicitProjectId: string | null = null
    let explicitGoalId: string | null = null

    if (typeof projectIdOrOptions === 'string') {
        explicitProjectId = trimToNull(projectIdOrOptions)
    } else if (projectIdOrOptions && typeof projectIdOrOptions === 'object') {
        explicitProjectId = trimToNull(projectIdOrOptions.projectId ?? null)
        explicitGoalId = trimToNull(projectIdOrOptions.goalId ?? null)
    }

    if (maybeGoalId !== undefined) {
        explicitGoalId = trimToNull(maybeGoalId)
    }

    const projectId = explicitProjectId
        ?? getCurrentProjectIdFromPath()
        ?? getCurrentProjectIdFromState()
        ?? getCurrentProjectIdFromReact()

    const goalId = explicitGoalId
        ?? getCurrentGoalIdFromSearch()
        ?? getCurrentGoalIdFromState()
        ?? getCurrentGoalIdFromReact()
        ?? getStoredSelectedGoalId(projectId)
        ?? (projectId ? await getFirstProjectGoalId(projectId) : null)

    return { projectId, goalId }
}

async function getControllerSession(projectId: string, goalId: string): Promise<ControllerSessionResponse> {
    const params = new URLSearchParams({ goalId })
    const result = await request<ControllerSessionResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/controller-session?${params.toString()}`
    )
    if (!result.ok) {
        throw new Error(buildRequestError(result, 'Failed to load controller session'))
    }
    if (!isRecord(result.payload)) {
        return { sessionId: null, session: null }
    }
    return {
        sessionId: trimToNull(typeof result.payload.sessionId === 'string' ? result.payload.sessionId : null),
        session: isRecord(result.payload.session) && typeof result.payload.session.id === 'string'
            ? {
                id: result.payload.session.id,
                active: result.payload.session.active === true
            }
            : null,
        created: result.payload.created === true
    }
}

async function ensureControllerSession(projectId: string, goalId: string, forceNew = false): Promise<ControllerSessionResponse> {
    const result = await request<ControllerSessionResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/controller-session`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ goalId, ...(forceNew ? { forceNew: true } : {}) })
        }
    )
    if (!result.ok) {
        throw new Error(buildRequestError(result, 'Failed to create controller session'))
    }
    if (!isRecord(result.payload)) {
        throw new Error('Controller session response payload is invalid')
    }

    const sessionId = trimToNull(typeof result.payload.sessionId === 'string' ? result.payload.sessionId : null)
    if (!sessionId) {
        throw new Error('Controller session response did not include sessionId')
    }

    return {
        sessionId,
        session: isRecord(result.payload.session) && typeof result.payload.session.id === 'string'
            ? {
                id: result.payload.session.id,
                active: result.payload.session.active === true
            }
            : null,
        created: result.payload.created === true
    }
}

async function resetResolvedAssistantSession(
    projectId: string,
    goalId: string
): Promise<{ previousSessionId: string | null, retired: boolean, retiredSessionIds: string[], steps: string[] }> {
    const current = await getControllerSession(projectId, goalId)
    const result = await request<ControllerResetResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/controller-session/reset`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ goalId })
        }
    )
    if (!result.ok) {
        throw new Error(buildRequestError(result, 'Failed to reset controller session'))
    }

    const retiredSessionIds = isRecord(result.payload) && Array.isArray(result.payload.retiredSessionIds)
        ? result.payload.retiredSessionIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : []

    return {
        previousSessionId: current.sessionId,
        retired: retiredSessionIds.length > 0,
        retiredSessionIds,
        steps: retiredSessionIds.length > 0
            ? retiredSessionIds.map((sessionId) => `Retired controller session ${sessionId}`)
            : ['No existing controller session found']
    }
}

async function runAssistantAction(
    action: AssistantWindowActionName,
    projectIdOrOptions?: AssistantWindowTargetInput,
    maybeGoalId?: string
): Promise<AssistantWindowActionResult> {
    try {
        const target = await resolveTarget(projectIdOrOptions, maybeGoalId)
        if (!target.projectId || !target.goalId) {
            const result: AssistantWindowActionResult = {
                ok: false,
                action,
                projectId: target.projectId ?? '',
                goalId: target.goalId ?? '',
                previousSessionId: null,
                sessionId: null,
                created: false,
                retired: false,
                retiredSessionIds: [],
                steps: [],
                error: 'Could not resolve projectId/goalId. Pass both explicitly if needed.'
            }
            console.warn('[assistant-window]', result.error, target)
            return result
        }

        const reset = await resetResolvedAssistantSession(target.projectId, target.goalId)
        if (action === 'resetAssistantSession') {
            const result: AssistantWindowActionResult = {
                ok: true,
                action,
                projectId: target.projectId,
                goalId: target.goalId,
                previousSessionId: reset.previousSessionId,
                sessionId: null,
                created: false,
                retired: reset.retired,
                retiredSessionIds: reset.retiredSessionIds,
                steps: reset.steps
            }
            console.info('[assistant-window]', action, result)
            return result
        }

        const ensured = await ensureControllerSession(target.projectId, target.goalId, true)
        const result: AssistantWindowActionResult = {
            ok: true,
            action,
            projectId: target.projectId,
            goalId: target.goalId,
            previousSessionId: reset.previousSessionId,
            sessionId: ensured.sessionId,
            created: ensured.created === true,
            retired: reset.retired,
            retiredSessionIds: reset.retiredSessionIds,
            steps: [
                ...reset.steps,
                `${ensured.created === true ? 'Created' : 'Reused'} controller session ${ensured.sessionId}`
            ]
        }
        console.info('[assistant-window]', action, result)
        return result
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        const failedTarget = await resolveTarget(projectIdOrOptions, maybeGoalId).catch(() => ({
            projectId: null,
            goalId: null
        }))
        const result: AssistantWindowActionResult = {
            ok: false,
            action,
            projectId: failedTarget.projectId ?? '',
            goalId: failedTarget.goalId ?? '',
            previousSessionId: null,
            sessionId: null,
            created: false,
            retired: false,
            retiredSessionIds: [],
            steps: [],
            error: message
        }
        console.warn('[assistant-window]', action, result)
        return result
    }
}

clearLegacyPendingState()

window.resetAssistantSession = (projectIdOrOptions?: AssistantWindowTargetInput, maybeGoalId?: string) =>
    runAssistantAction('resetAssistantSession', projectIdOrOptions, maybeGoalId)

window.startFreshAssistantSession = (projectIdOrOptions?: AssistantWindowTargetInput, maybeGoalId?: string) =>
    runAssistantAction('startFreshAssistantSession', projectIdOrOptions, maybeGoalId)

window.resetAssistant = (projectIdOrOptions?: AssistantWindowTargetInput, maybeGoalId?: string) =>
    runAssistantAction('resetAssistantSession', projectIdOrOptions, maybeGoalId)

window.startAssistant = (projectIdOrOptions?: AssistantWindowTargetInput, maybeGoalId?: string) =>
    runAssistantAction('startFreshAssistantSession', projectIdOrOptions, maybeGoalId)

export {}
