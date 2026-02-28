import { useCallback } from 'react'
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'

export function useAppGoBack(): () => void {
    const navigate = useNavigate()
    const router = useRouter()
    const pathname = useLocation({ select: (location) => location.pathname })

    return useCallback(() => {
        // Use explicit path navigation for consistent behavior across all environments
        if (pathname === '/settings') {
            navigate({ to: '/projects' })
            return
        }

        // Legacy sessions UI deprecated; route back to project UI.
        if (pathname.startsWith('/sessions')) {
            navigate({ to: '/projects' })
            return
        }

        // Fallback to history.back() for other cases
        router.history.back()
    }, [navigate, pathname, router])
}
