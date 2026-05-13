import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { ProjectAssistantSessionSummary } from '@/types/api'
import { ProjectAssistantPage } from './project-assistant'

const session: ProjectAssistantSessionSummary = {
    id: 'assistant-session-1',
    projectId: 'project-1',
    goalId: 'goal-1',
    taskId: null,
    kind: 'normal',
    interventionKind: null,
    interventionStatus: null,
    interventionKey: null,
    suggestedActions: [],
    createdAt: 1,
    updatedAt: 2,
    title: 'Assistant thread',
    pending: false
}

const mocks = vi.hoisted(() => ({
    useProjectAssistantSessions: vi.fn()
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: {} })
}))

vi.mock('@/lib/toast-context', () => ({
    useToast: () => ({ addToast: vi.fn() })
}))

vi.mock('@/hooks/queries/useProjectAssistantSessions', () => ({
    useProjectAssistantSessions: mocks.useProjectAssistantSessions
}))

vi.mock('@/hooks/mutations/useProjectAssistantActions', () => ({
    useProjectAssistantActions: () => ({
        ensureSession: vi.fn(),
        resolveIntervention: vi.fn(),
        isPending: false,
        error: null
    })
}))

vi.mock('@/hooks/queries/useMessages', () => ({
    useMessages: () => ({
        messages: [],
        isLoading: false
    })
}))

vi.mock('@/routes/projects/project-assistant-session-chat', () => ({
    ProjectAssistantSessionChat: (props: { sessionId: string }) => (
        <div>Shared session panel: {props.sessionId}</div>
    )
}))

describe('ProjectAssistantPage', () => {
    beforeEach(() => {
        mocks.useProjectAssistantSessions.mockReset()
        mocks.useProjectAssistantSessions.mockReturnValue({
            sessions: [session],
            pendingCount: 0,
            isLoading: false,
            error: null,
            refetch: vi.fn()
        })
    })

    it('uses the shared session panel instead of assistant-specific action forms', () => {
        renderWithProviders(
            <ProjectAssistantPage
                projectId="project-1"
                selectedGoalId="goal-1"
                goals={[{
                    id: 'goal-1',
                    projectId: 'project-1',
                    namespace: 'default',
                    goalKey: 'ship-ui',
                    title: 'Ship UI',
                    description: null,
                    status: 'active',
                    successCriteria: null,
                    autopilotEnabled: false,
                    automationPausedAt: null,
                    deployRequiresApproval: false,
                    currentFocus: null,
                    createdAt: 1,
                    updatedAt: 2,
                    archivedAt: null
                }]}
            />
        )

        expect(screen.getAllByText('Assistant thread').length).toBeGreaterThan(0)
        expect(screen.getByText('Shared session panel: assistant-session-1')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Briefing' })).not.toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Send an idea, request, or preference for the next planner run.')).not.toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Record a durable preference for this goal.')).not.toBeInTheDocument()
    })

    it('loads assistant sessions scoped to the selected goal', () => {
        renderWithProviders(
            <ProjectAssistantPage
                projectId="project-1"
                selectedGoalId="goal-1"
                goals={[{
                    id: 'goal-1',
                    projectId: 'project-1',
                    namespace: 'default',
                    goalKey: 'ship-ui',
                    title: 'Ship UI',
                    description: null,
                    status: 'active',
                    successCriteria: null,
                    autopilotEnabled: false,
                    automationPausedAt: null,
                    deployRequiresApproval: false,
                    currentFocus: null,
                    createdAt: 1,
                    updatedAt: 2,
                    archivedAt: null
                }]}
            />
        )

        expect(mocks.useProjectAssistantSessions).toHaveBeenCalledWith({}, 'project-1', 'goal-1')
    })
})
