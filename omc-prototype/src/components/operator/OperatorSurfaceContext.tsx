import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { SessionLogSelection, TraceSelection } from '@/prototype/types'

type OperatorSurfaceContextValue = {
    openInbox(): void
    openThread(threadId: string): void
    openTrace(input: { planId: string; streamId: string }): void
    openSessionLog(input: SessionLogSelection): void
    clearSessionLog(): void
    closePanel(): void
    isOpen: boolean
    activeTrace: TraceSelection | null
    activeSessionLog: SessionLogSelection | null
}

const OperatorSurfaceContext = createContext<OperatorSurfaceContextValue | null>(null)

export function OperatorSurfaceProvider(props: {
    value: OperatorSurfaceContextValue
    children: ReactNode
}) {
    return (
        <OperatorSurfaceContext.Provider value={props.value}>
            {props.children}
        </OperatorSurfaceContext.Provider>
    )
}

export function useOperatorSurface() {
    const value = useContext(OperatorSurfaceContext)
    if (!value) {
        throw new Error('OperatorSurfaceProvider is missing')
    }
    return value
}
