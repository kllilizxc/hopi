import { useEffect, useRef } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import { usePrototypeStore } from '@/prototype/store'

export default function ExecutionDetailPage(props: { goalId: string; planId: string }) {
    const { dataSource } = usePrototypeStore()
    const operatorSurface = useOperatorSurface()
    const hasOpenedTrace = useRef(false)
    const detail = dataSource.getPlanDrilldown({
        goalId: props.goalId,
        planId: props.planId
    })

    useEffect(() => {
        if (!detail || hasOpenedTrace.current) {
            return
        }

        hasOpenedTrace.current = true
        operatorSurface.openTrace({
            planId: detail.planCard.id,
            streamId: detail.planCard.streamId,
        })
    }, [detail, operatorSurface])

    return <Navigate to="/" search={{ goal: props.goalId }} />
}
