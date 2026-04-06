import { createContext, useContext, type ReactNode } from 'react'
import type {
    DecryptedMessage,
    OmcAttachLocalRepoRequest,
    OmcGuidedPlanningBrief,
    OmcGuidedPlanningControlResponse,
    OmcGuidedPlanningStateResponse,
    OmcMergeStatus,
    OmcPlanControlResponse,
    OmcPlanDetailResponse,
    OmcPlanRuntimeListResponse,
    OmcPlanningIndexResponse,
    OmcProgramListResponse,
    OmcProgramOverviewResponse,
    OmcProgramBootstrapResponse,
    OmcReviewReopenAction,
    Session,
} from '@hopi/protocol/types'

const ACCESS_TOKEN_PREFIX = 'hopi:omc-prototype:access-token::'

function getAccessTokenKey(baseUrl: string): string {
    return `${ACCESS_TOKEN_PREFIX}${baseUrl}`
}

export function getStoredAccessToken(baseUrl: string): string | null {
    try {
        return localStorage.getItem(getAccessTokenKey(baseUrl))
    } catch {
        return null
    }
}

export function storeAccessToken(baseUrl: string, token: string): void {
    try {
        localStorage.setItem(getAccessTokenKey(baseUrl), token)
    } catch {
    }
}

export async function authenticateWithAccessToken(baseUrl: string, accessToken: string): Promise<{ token: string }> {
    const response = await fetch(new URL('/api/auth', baseUrl).toString(), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({ accessToken }),
    })

    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(body || `Auth failed: HTTP ${response.status}`)
    }

    return await response.json() as { token: string }
}

type PrototypeRemoteApiOptions = {
    getToken?: () => string | null
    onUnauthorized?: () => Promise<string | null>
}

export type PrototypeMergeApproveResponse = {
    programId: string
    planKey: string
    runtime: OmcPlanControlResponse['runtime']
    attempt?: OmcPlanControlResponse['attempt']
    packet: unknown
    merge: {
        outcome: 'merged' | 'blocked' | 'conflict'
        targetBranch: string | null
        sourceBranch: string | null
        blockedReason: string | null
        conflictFiles: string[]
        commitHash: string | null
        sessionId: string | null
        sessionUrl: string | null
        mergeStatus?: OmcMergeStatus
    }
}

export type PrototypeSessionMessagesResponse = {
    messages: Array<DecryptedMessage & {
        status?: 'sending' | 'sent' | 'failed'
        originalText?: string
    }>
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}

export class PrototypeRemoteApiClient {
    constructor(
        private readonly baseUrl: string,
        private readonly token: string,
        private readonly options?: PrototypeRemoteApiOptions,
    ) {}

    private async request<T>(path: string, init?: RequestInit, attempt: number = 0): Promise<T> {
        const liveToken = this.options?.getToken?.() ?? this.token
        const response = await fetch(new URL(path, this.baseUrl).toString(), {
            method: init?.method,
            body: init?.body,
            headers: {
                authorization: `Bearer ${liveToken}`,
                ...(init?.headers ?? {}),
            },
        })

        if (response.status === 401 && attempt === 0 && this.options?.onUnauthorized) {
            const refreshed = await this.options.onUnauthorized()
            if (refreshed) {
                return await this.request<T>(path, init, attempt + 1)
            }
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '')
            throw new Error(body || `HTTP ${response.status}`)
        }

        return await response.json() as T
    }

    async getPrograms(): Promise<OmcProgramListResponse> {
        return await this.request<OmcProgramListResponse>('/api/omc/programs')
    }

    async getProgram(programId: string): Promise<OmcProgramOverviewResponse> {
        return await this.request<OmcProgramOverviewResponse>(`/api/omc/programs/${encodeURIComponent(programId)}`)
    }

    async attachLocalRepo(input: OmcAttachLocalRepoRequest): Promise<OmcProgramBootstrapResponse> {
        return await this.request<OmcProgramBootstrapResponse>('/api/omc/programs/attach-local-repo', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify(input),
        })
    }

    async createPlanningSeed(programId: string): Promise<OmcProgramBootstrapResponse> {
        return await this.request<OmcProgramBootstrapResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/create-planning-seed`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({}),
            },
        )
    }

    async getGuidedPlanningState(programId: string): Promise<OmcGuidedPlanningStateResponse> {
        return await this.request<OmcGuidedPlanningStateResponse>(`/api/omc/programs/${encodeURIComponent(programId)}/planning-run`)
    }

    async startGuidedPlanning(programId: string, brief: OmcGuidedPlanningBrief): Promise<OmcGuidedPlanningControlResponse> {
        return await this.request<OmcGuidedPlanningControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/planning-run/start`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ brief }),
            },
        )
    }

    async retryGuidedPlanning(programId: string): Promise<OmcGuidedPlanningControlResponse> {
        return await this.request<OmcGuidedPlanningControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/planning-run/retry`,
            { method: 'POST' },
        )
    }

    async getPlanningIndex(programId: string): Promise<OmcPlanningIndexResponse> {
        return await this.request<OmcPlanningIndexResponse>(`/api/omc/programs/${encodeURIComponent(programId)}/planning-index`)
    }

    async getPlanRuntimes(programId: string): Promise<OmcPlanRuntimeListResponse> {
        return await this.request<OmcPlanRuntimeListResponse>(`/api/omc/programs/${encodeURIComponent(programId)}/plan-runtimes`)
    }

    async getPlanDetail(programId: string, planKey: string): Promise<OmcPlanDetailResponse> {
        return await this.request<OmcPlanDetailResponse>(`/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}`)
    }

    async approveReview(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/review/approve`,
            { method: 'POST' },
        )
    }

    async reopenReview(programId: string, planKey: string, action: OmcReviewReopenAction): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/review/reopen`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ action }),
            },
        )
    }

    async approveMerge(programId: string, planKey: string): Promise<PrototypeMergeApproveResponse> {
        return await this.request<PrototypeMergeApproveResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/merge/approve`,
            { method: 'POST' },
        )
    }

    async takeoverPlan(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/takeover`,
            { method: 'POST' },
        )
    }

    async resumePlan(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/resume`,
            { method: 'POST' },
        )
    }

    async retryPlan(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/retry`,
            { method: 'POST' },
        )
    }

    async getSession(sessionId: string): Promise<{ session: Session }> {
        return await this.request<{ session: Session }>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    }

    async resumeSession(sessionId: string): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
            { method: 'POST' },
        )
        return response.sessionId
    }

    async sendMessage(sessionId: string, text: string, localId?: string | null): Promise<void> {
        await this.request<void>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                text,
                localId: localId ?? undefined,
            }),
        })
    }

    async getMessages(
        sessionId: string,
        options?: { beforeSeq?: number | null; limit?: number },
    ): Promise<PrototypeSessionMessagesResponse> {
        const params = new URLSearchParams()
        if (typeof options?.beforeSeq === 'number') {
            params.set('beforeSeq', String(options.beforeSeq))
        }
        if (typeof options?.limit === 'number') {
            params.set('limit', String(options.limit))
        }

        const query = params.toString()
        return await this.request<PrototypeSessionMessagesResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/messages${query ? `?${query}` : ''}`,
        )
    }

    createEventsUrl(): string {
        const params = new URLSearchParams()
        params.set('token', this.options?.getToken?.() ?? this.token)
        params.set('all', 'true')
        params.set('visibility', 'visible')
        return new URL(`/api/events?${params.toString()}`, this.baseUrl).toString()
    }

    createSessionTerminalUrl(sessionId: string): string {
        return new URL(`/sessions/${encodeURIComponent(sessionId)}/terminal`, this.baseUrl).toString()
    }
}

const PrototypeRemoteApiContext = createContext<PrototypeRemoteApiClient | null>(null)

export function PrototypeRemoteApiProvider(props: {
    api: PrototypeRemoteApiClient
    children: ReactNode
}) {
    return (
        <PrototypeRemoteApiContext.Provider value={props.api}>
            {props.children}
        </PrototypeRemoteApiContext.Provider>
    )
}

export function usePrototypeRemoteApiOptional(): PrototypeRemoteApiClient | null {
    return useContext(PrototypeRemoteApiContext)
}

export function usePrototypeRemoteApi(): PrototypeRemoteApiClient {
    const context = usePrototypeRemoteApiOptional()
    if (!context) {
        throw new Error('Prototype remote API context is not available')
    }
    return context
}
