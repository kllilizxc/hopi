import { createContext, useContext, type ReactNode } from 'react'
import { productStorageNamespaceKey } from '@hopi/protocol/brand'
import type {
    OmcAttemptDetailResponse,
    OmcPlanDetailResponse,
    OmcPlanStartResponse,
    OmcPlanRuntime,
    OmcPlanningIndexResponse,
    OmcProgramListResponse
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

export class OmcApiClient {
    constructor(
        private readonly baseUrl: string,
        private readonly token: string,
        private readonly options?: {
            getToken?: () => string | null
            onUnauthorized?: () => Promise<string | null>
        }
    ) {}

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

    async getPlanningIndex(programId: string): Promise<OmcPlanningIndexResponse> {
        return await this.request<OmcPlanningIndexResponse>(`/api/omc/programs/${encodeURIComponent(programId)}/planning-index`)
    }

    async getPlanRuntimes(programId: string): Promise<{ programId: string; runtimes: OmcPlanRuntime[] }> {
        return await this.request<{ programId: string; runtimes: OmcPlanRuntime[] }>(`/api/omc/programs/${encodeURIComponent(programId)}/plan-runtimes`)
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

    async getAttempt(attemptId: string): Promise<OmcAttemptDetailResponse> {
        return await this.request<OmcAttemptDetailResponse>(`/api/omc/attempts/${encodeURIComponent(attemptId)}`)
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
