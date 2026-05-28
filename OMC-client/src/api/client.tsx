import { createContext, useContext, type ReactNode } from 'react'
import { productStorageNamespaceKey } from '@hopi/protocol/brand'
import type {
    OmcAttachLocalRepoRequest,
    OmcAttachPlanningRootRequest,
    OmcAttemptDetailResponse,
    OmcGuidedPlanningBrief,
    OmcGuidedPlanningControlResponse,
    OmcGuidedPlanningStateResponse,
    OmcMergePacket,
    OmcMergePacketResponse,
    OmcPlanControlResponse,
    OmcPlanDetailResponse,
    OmcPlanRuntimeListResponse,
    OmcPlanStartResponse,
    OmcPlanRuntime,
    OmcPlanningIndexResponse,
    OmcProgramBootstrapResponse,
    OmcProgramListResponse,
    OmcProgramOverviewResponse,
    OmcReviewReopenAction
} from '@hopi/protocol/types'

const ACCESS_TOKEN_PREFIX = `${productStorageNamespaceKey('access-token')}::`

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
            'content-type': 'application/json'
        },
        body: JSON.stringify({ accessToken })
    })

    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(body || `Auth failed: HTTP ${response.status}`)
    }

    return await response.json() as { token: string }
}

export type OmcMergeApproveResponse = {
    programId: string
    planKey: string
    runtime: OmcPlanRuntime
    attempt?: OmcPlanControlResponse['attempt']
    packet: OmcMergePacket
    merge: {
        outcome: 'merged' | 'blocked' | 'conflict'
        targetBranch: string | null
        sourceBranch: string | null
        blockedReason: string | null
        conflictFiles: string[]
        commitHash: string | null
        sessionId: string | null
        sessionUrl: string | null
    }
}

export class OmcApiClient {
    constructor(
        private readonly baseUrl: string,
        private readonly token: string,
        private readonly options?: {
            getToken?: () => string | null
            onUnauthorized?: () => Promise<string | null>
            hubOrigin?: string | null
            getAccessToken?: () => string | null
        }
    ) {}

    private getHubBaseUrl(): string {
        const configured = this.options?.hubOrigin?.trim()
        return configured && configured.length > 0 ? configured : this.baseUrl
    }

    private maybeAttachAccessToken(url: URL): URL {
        const accessToken = this.options?.getAccessToken?.()?.trim()
        if (!accessToken || url.searchParams.has('token')) {
            return url
        }

        try {
            const apiOrigin = new URL(this.baseUrl).origin
            if (url.origin !== apiOrigin) {
                url.searchParams.set('token', accessToken)
            }
        } catch {
        }

        return url
    }

    resolveAppUrl(pathOrUrl: string | null | undefined, options?: { includeAccessToken?: boolean }): string | null {
        if (!pathOrUrl) {
            return null
        }

        let url: URL
        try {
            url = new URL(pathOrUrl)
        } catch {
            url = new URL(pathOrUrl, this.getHubBaseUrl())
        }

        if (options?.includeAccessToken !== false && url.pathname.startsWith('/sessions/')) {
            this.maybeAttachAccessToken(url)
        }

        return url.toString()
    }

    createSessionUrl(sessionId: string | null | undefined): string | null {
        if (!sessionId) {
            return null
        }

        return this.resolveAppUrl(`/sessions/${encodeURIComponent(sessionId)}/terminal`)
    }

    private async request<T>(path: string, init?: RequestInit, attempt: number = 0): Promise<T> {
        const liveToken = this.options?.getToken?.() ?? this.token
        const response = await fetch(new URL(path, this.baseUrl).toString(), {
            method: init?.method,
            body: init?.body,
            headers: {
                authorization: `Bearer ${liveToken}`,
                ...(init?.headers ?? {})
            }
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
                'content-type': 'application/json'
            },
            body: JSON.stringify(input)
        })
    }

    async attachPlanningRoot(programId: string, input: OmcAttachPlanningRootRequest): Promise<OmcProgramBootstrapResponse> {
        return await this.request<OmcProgramBootstrapResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/attach-planning-root`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify(input)
            }
        )
    }

    async createPlanningSeed(programId: string): Promise<OmcProgramBootstrapResponse> {
        return await this.request<OmcProgramBootstrapResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/create-planning-seed`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({})
            }
        )
    }

    async getGuidedPlanningState(programId: string): Promise<OmcGuidedPlanningStateResponse> {
        return await this.request<OmcGuidedPlanningStateResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/planning-run`
        )
    }

    async startGuidedPlanning(programId: string, brief: OmcGuidedPlanningBrief): Promise<OmcGuidedPlanningControlResponse> {
        return await this.request<OmcGuidedPlanningControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/planning-run/start`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ brief })
            }
        )
    }

    async retryGuidedPlanning(programId: string): Promise<OmcGuidedPlanningControlResponse> {
        return await this.request<OmcGuidedPlanningControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/planning-run/retry`,
            {
                method: 'POST'
            }
        )
    }

    async cancelGuidedPlanning(programId: string): Promise<OmcGuidedPlanningControlResponse> {
        return await this.request<OmcGuidedPlanningControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/planning-run/cancel`,
            {
                method: 'POST'
            }
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

    async startPlan(programId: string, planKey: string): Promise<OmcPlanStartResponse> {
        return await this.request<OmcPlanStartResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/start`,
            { method: 'POST' }
        )
    }

    async retryPlan(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/retry`,
            { method: 'POST' }
        )
    }

    async resumePlan(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/resume`,
            { method: 'POST' }
        )
    }

    async takeoverPlan(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/takeover`,
            { method: 'POST' }
        )
    }

    async cancelPlan(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/cancel`,
            { method: 'POST' }
        )
    }

    async getAttempt(attemptId: string): Promise<OmcAttemptDetailResponse> {
        return await this.request<OmcAttemptDetailResponse>(`/api/omc/attempts/${encodeURIComponent(attemptId)}`)
    }

    async getMergePacket(programId: string, planKey: string): Promise<OmcMergePacketResponse> {
        return await this.request<OmcMergePacketResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/merge-packet`
        )
    }

    async approveReview(programId: string, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/review/approve`,
            { method: 'POST' }
        )
    }

    async reopenReview(programId: string, planKey: string, action: OmcReviewReopenAction): Promise<OmcPlanControlResponse> {
        return await this.request<OmcPlanControlResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/review/reopen`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ action })
            }
        )
    }

    async approveMerge(programId: string, planKey: string): Promise<OmcMergeApproveResponse> {
        return await this.request<OmcMergeApproveResponse>(
            `/api/omc/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/merge/approve`,
            { method: 'POST' }
        )
    }

    createEventsUrl(): string {
        const params = new URLSearchParams()
        params.set('token', this.options?.getToken?.() ?? this.token)
        params.set('all', 'true')
        params.set('visibility', 'visible')
        return new URL(`/api/events?${params.toString()}`, this.baseUrl).toString()
    }
}

const OmcApiContext = createContext<OmcApiClient | null>(null)

export function OmcApiProvider(props: { api: OmcApiClient; children: ReactNode }) {
    return <OmcApiContext.Provider value={props.api}>{props.children}</OmcApiContext.Provider>
}

export function useOmcApi(): OmcApiClient {
    const context = useContext(OmcApiContext)
    if (!context) {
        throw new Error('OMC API context is not available')
    }
    return context
}
