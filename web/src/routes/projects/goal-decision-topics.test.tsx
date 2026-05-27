import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { GoalDecisionTopic } from '@/types/api'
import { GoalDecisionTopicsPanel } from './goal-decision-topics'

const mocks = vi.hoisted(() => ({
    topicsState: {
        topics: [] as GoalDecisionTopic[],
        isLoading: false,
        error: null as string | null
    },
    resolveTopic: vi.fn(),
    addToast: vi.fn()
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: {} })
}))

vi.mock('@/lib/toast-context', () => ({
    useToast: () => ({ addToast: mocks.addToast })
}))

vi.mock('@/hooks/queries/useGoalDecisionTopics', () => ({
    useGoalDecisionTopics: () => mocks.topicsState
}))

vi.mock('@/hooks/mutations/useResolveGoalDecisionTopic', () => ({
    useResolveGoalDecisionTopic: () => ({
        resolveTopic: mocks.resolveTopic,
        isPending: false
    })
}))

function createTopic(overrides: Partial<GoalDecisionTopic> = {}): GoalDecisionTopic {
    const now = 1_700_000_000_000
    const taskId = overrides.taskId !== undefined ? overrides.taskId : 'task-123456789'
    return {
        id: overrides.id ?? 'topic-1',
        projectId: overrides.projectId ?? 'project-1',
        goalId: overrides.goalId ?? 'goal-1',
        scope: overrides.scope ?? (taskId ? 'task' : 'goal'),
        taskId,
        title: overrides.title ?? 'Choose final story navigation entry',
        body: overrides.body ?? 'Pick MainMenu, Hub scene, Expedition exit, or debug-only button.',
        status: overrides.status ?? 'waiting',
        blocking: overrides.blocking ?? true,
        resolution: overrides.resolution ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now
    }
}

afterEach(() => {
    mocks.topicsState.topics = []
    mocks.topicsState.isLoading = false
    mocks.topicsState.error = null
    mocks.resolveTopic.mockReset()
    mocks.addToast.mockReset()
})

describe('GoalDecisionTopicsPanel', () => {
    it('uses a full-width scan-friendly decision queue layout', () => {
        mocks.topicsState.topics = [
            createTopic(),
            createTopic({
                id: 'topic-2',
                title: 'Choose final navigation direction',
                body: 'Pick MainMenu, Hub scene, Expedition exit, or debug-only button.',
                blocking: false
            })
        ]

        renderWithProviders(<GoalDecisionTopicsPanel projectId="project-1" goalId="goal-1" />)

        expect(screen.getByTestId('goal-decision-panel')).toHaveClass('max-w-7xl')
        expect(screen.getByTestId('goal-decision-tray')).not.toHaveClass('max-h-[min(45vh,32rem)]')
        expect(screen.getByTestId('goal-decision-tray')).not.toHaveClass('overflow-y-auto')
        expect(screen.getByTestId('goal-decision-grid')).toHaveClass(
            'grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))]'
        )
        expect(screen.getByTestId('goal-decision-topic-topic-1')).toHaveClass(
            'xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]'
        )
        const firstTopic = screen.getByTestId('goal-decision-topic-topic-1')
        expect(within(firstTopic).getByText('Pick MainMenu, Hub scene, Expedition exit, or debug-only button.')).not.toHaveClass(
            'md:max-h-40',
            'md:overflow-y-auto'
        )
        expect(within(firstTopic).getByPlaceholderText('Answer or approval…')).toHaveAttribute(
            'name',
            'decision-resolution-topic-1'
        )
    })

    it('keeps recent resolved decisions visible in planning', () => {
        mocks.topicsState.topics = [
            createTopic({
                status: 'resolved',
                resolution: 'Use MainMenu as the player-facing story entry.'
            })
        ]

        renderWithProviders(<GoalDecisionTopicsPanel projectId="project-1" goalId="goal-1" />)

        expect(screen.getByTestId('goal-decision-resolved-list')).toBeInTheDocument()
        expect(screen.getByTestId('goal-decision-resolved-list')).not.toHaveClass('max-h-72')
        expect(screen.getByTestId('goal-decision-resolved-list')).not.toHaveClass('overflow-y-auto')
        expect(screen.getByText('Use MainMenu as the player-facing story entry.')).toBeInTheDocument()
        expect(screen.queryByText('0 waiting')).not.toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Answer or approval…')).not.toBeInTheDocument()
    })
})
