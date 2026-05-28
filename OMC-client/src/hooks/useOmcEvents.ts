import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SyncEvent } from '@hopi/protocol/types'
import { useOmcApi } from '@/api/client'

function parseEvent(data: string): SyncEvent | null {
    try {
        return JSON.parse(data) as SyncEvent
    } catch {
        return null
    }
}

export function useOmcEvents(): void {
    const api = useOmcApi()
    const queryClient = useQueryClient()

    useEffect(() => {
        const eventSource = new EventSource(api.createEventsUrl())

        const invalidatePlanScope = (programId: string, planKey: string) => {
            void queryClient.invalidateQueries({ queryKey: ['omc', 'programs'] })
            void queryClient.invalidateQueries({ queryKey: ['omc', 'plan-runtimes', programId] })
            void queryClient.invalidateQueries({ queryKey: ['omc', 'plan', programId, planKey] })
            void queryClient.invalidateQueries({ queryKey: ['omc', 'planning-index', programId] })
            void queryClient.invalidateQueries({ queryKey: ['omc', 'merge-packet', programId, planKey] })
        }

        const invalidateProgramScope = (programId: string) => {
            void queryClient.invalidateQueries({ queryKey: ['omc', 'programs'] })
            void queryClient.invalidateQueries({ queryKey: ['omc', 'program', programId] })
            void queryClient.invalidateQueries({ queryKey: ['omc', 'planning-run', programId] })
            void queryClient.invalidateQueries({ queryKey: ['omc', 'planning-index', programId] })
            void queryClient.invalidateQueries({ queryKey: ['omc', 'plan-runtimes', programId] })
        }

        eventSource.onmessage = (message) => {
            const event = parseEvent(message.data)
            if (!event) {
                return
            }

            if (event.type === 'omc-program-updated') {
                invalidateProgramScope(event.programId)
                return
            }

            if (event.type === 'omc-guided-planning-updated') {
                invalidateProgramScope(event.programId)
                return
            }

            if (event.type === 'omc-plan-runtime-updated') {
                invalidatePlanScope(event.programId, event.planKey)
                return
            }

            if (event.type === 'omc-attempt-added' || event.type === 'omc-attempt-updated') {
                invalidatePlanScope(event.programId, event.planKey)
                void queryClient.invalidateQueries({ queryKey: ['omc', 'attempt', event.attemptId] })
                return
            }

            if (event.type === 'omc-evidence-added') {
                invalidatePlanScope(event.programId, event.planKey)
                if (event.attemptId) {
                    void queryClient.invalidateQueries({ queryKey: ['omc', 'attempt', event.attemptId] })
                }
                return
            }

            if (event.type === 'omc-review-updated' || event.type === 'omc-merge-updated') {
                invalidatePlanScope(event.programId, event.planKey)
            }
        }

        return () => {
            eventSource.close()
        }
    }, [api, queryClient])
}
