import { useCallback } from 'react'
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'

export function useAppGoBack(): () => void {
    const navigate = useNavigate()
    const router = useRouter()
    const pathname = useLocation({ select: (location) => location.pathname })

    return useCallback(() => {
        if (pathname.startsWith('/sessions/')) {
            const normalizedPath = pathname.replace(/\/+$/, '')
            const match = normalizedPath.match(/^\/sessions\/([^/]+)(?:\/.+)?$/)
            const sessionId = match?.[1] ?? null
            if (!sessionId || sessionId === 'new') {
                navigate({ to: '/sessions' })
                return
            }
            const hasNestedSessionRoute = normalizedPath.split('/').length > 3
            if (hasNestedSessionRoute) {
                navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                return
            }
            navigate({ to: '/sessions' })
            return
        }

        router.history.back()
    }, [navigate, pathname, router])
}
