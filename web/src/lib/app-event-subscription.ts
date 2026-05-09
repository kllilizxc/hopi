type AppEventCategory = 'messages' | 'sessions' | 'machines' | 'projects' | 'workspaces' | 'tasks' | 'toasts'

export type AppEventSubscription = {
    all?: boolean
    sessionId?: string
    machineId?: string
    projectId?: string
    include?: ReadonlyArray<AppEventCategory>
}

export function buildAppEventSubscription(options: {
    pathname: string
    selectedProjectId: string | null
    selectedSessionId: string | null
}): AppEventSubscription {
    const includeToasts = ['toasts'] as const
    const includeMachines = ['machines'] as const

    if (options.selectedProjectId) {
        return {
            all: false,
            projectId: options.selectedProjectId,
            include: ['projects', 'workspaces', 'tasks', 'sessions', ...includeMachines, ...includeToasts] as const
        }
    }

    if (options.pathname.startsWith('/projects')) {
        return {
            all: true,
            include: ['projects', ...includeMachines, ...includeToasts] as const
        }
    }

    if (options.pathname.startsWith('/sessions') && !options.selectedSessionId) {
        return {
            all: true,
            include: ['sessions', ...includeMachines, ...includeToasts] as const
        }
    }

    return {
        all: true,
        include: [...includeMachines, ...includeToasts] as const
    }
}
