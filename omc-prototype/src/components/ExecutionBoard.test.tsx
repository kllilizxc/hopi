import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ExecutionBoard from './ExecutionBoard'
import { OperatorSurfaceProvider } from './operator/OperatorSurfaceContext'
import type { PrototypePhase, PrototypePlanCard, TraceSelection } from '@/prototype/types'

function buildBoardProps(): {
    phases: PrototypePhase[]
    planCards: PrototypePlanCard[]
} {
    return {
        phases: [
            {
                id: 'phase-ingest-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                title: 'Phase 01 · Ingest framing',
                status: 'Running',
                summary: 'Draft the first safe execution sequence.',
            },
        ],
        planCards: [
            {
                id: 'plan-approval-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                phaseId: 'phase-ingest-1',
                title: 'Lock first broker CSV contract',
                column: 'Running',
                summary: "Capture the first broker's CSV assumptions and a narrow parsing contract.",
                signal: 'Files and parser seams are being mapped.',
                updatedAt: 'Day 1 · 09:06',
                badges: ['critical-path'],
            },
            {
                id: 'plan-approval-2',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                phaseId: 'phase-ingest-1',
                title: 'Stage holdings normalization proof',
                column: 'Planning',
                summary: 'Prepare validation fixtures without widening scope prematurely.',
                signal: 'Waiting on ingest contract.',
                updatedAt: 'Day 1 · 09:04',
                badges: ['dependent'],
            },
        ],
    }
}

function renderWithSurface(
    ui: ReactElement,
    overrides: Partial<{
        activeTrace: TraceSelection | null
        openTrace: (input: { planId: string; streamId: string }) => void
    }> = {},
) {
    const openTrace = overrides.openTrace ?? vi.fn()

    return render(
        <OperatorSurfaceProvider
            value={{
                openInbox: vi.fn(),
                openThread: vi.fn(),
                openTrace,
                openSessionLog: vi.fn(),
                clearSessionLog: vi.fn(),
                closePanel: vi.fn(),
                isOpen: true,
                activeTrace: overrides.activeTrace ?? null,
                activeSessionLog: null,
            }}
        >
            {ui}
        </OperatorSurfaceProvider>,
    )
}

describe('ExecutionBoard', () => {
    it('opens trace mode for a clicked plan card', () => {
        const openTrace = vi.fn()

        renderWithSurface(
            <ExecutionBoard {...buildBoardProps()} />,
            { openTrace },
        )

        fireEvent.click(screen.getByRole('button', { name: /放行导入证明分支/i }))

        expect(openTrace).toHaveBeenCalledWith({
            planId: 'plan-approval-1',
            streamId: 'stream-ingest-contracts',
        })
    })

    it('marks the active trace card as pressed', () => {
        const { container } = renderWithSurface(
            <ExecutionBoard {...buildBoardProps()} />,
            {
                activeTrace: {
                    planId: 'plan-approval-1',
                    streamId: 'stream-ingest-contracts',
                },
            },
        )

        expect(screen.getByRole('button', { name: /放行导入证明分支/i })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /完成持仓证明链/i })).toHaveAttribute('aria-pressed', 'false')
        expect(container.querySelector('.prototype-board-shell--balanced')).not.toBeNull()
        expect(container.querySelector('.prototype-kanban--balanced')).not.toBeNull()
    })
})
