// @vitest-environment jsdom

import { screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { MarkdownRenderer } from './MarkdownRenderer'

vi.mock('@assistant-ui/react', async importOriginal => {
    const actual = await importOriginal<typeof import('@assistant-ui/react')>()
    return {
        ...actual,
        TextMessagePartProvider: (props: { text: string; children: ReactNode }) => (
            <div>
                <div>{props.text}</div>
                {props.children}
            </div>
        )
    }
})

vi.mock('@assistant-ui/react-markdown', async importOriginal => {
    const actual = await importOriginal<typeof import('@assistant-ui/react-markdown')>()
    return {
        ...actual,
        MarkdownTextPrimitive: (props: { className?: string }) => (
            <div data-testid="markdown-primitive" className={props.className} />
        )
    }
})

describe('MarkdownRenderer', () => {
    it('renders HOPI_ACTIONS packets as readable task action results', () => {
        renderWithProviders(
            <MarkdownRenderer
                content={[
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [{
                            type: 'update_current_task',
                            status: 'blocked',
                            handoff: 'Docs contract is not aligned with the implementation.',
                            evidence: 'Tests pass, but main uses presentation.mapWidth.'
                        }]
                    }, null, 2),
                    '```'
                ].join('\n')}
            />
        )

        expect(screen.getByText('Task blocked')).toBeInTheDocument()
        expect(screen.getByText('Why')).toBeInTheDocument()
        expect(screen.getByText('Docs contract is not aligned with the implementation.')).toBeInTheDocument()
        expect(screen.getByText('Evidence')).toBeInTheDocument()
        expect(screen.getByText('Tests pass, but main uses presentation.mapWidth.')).toBeInTheDocument()
    })

    it('renders HOPI_ACTIONS surfaces without border styling', () => {
        const { container } = renderWithProviders(
            <MarkdownRenderer
                content={[
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [{
                            type: 'update_current_task',
                            status: 'finished',
                            handoff: 'Done.',
                            evidence: 'Commit created.'
                        }]
                    }, null, 2),
                    '```'
                ].join('\n')}
            />
        )

        expect(screen.getByText('HOPI_ACTIONS')).toBeInTheDocument()
        expect(container.querySelector('[class*="app-shadow-border"]')).toBeNull()
        expect(container.querySelector('[class*="inset_0_0_0_1px"]')).toBeNull()
        expect(container.querySelector('.app-shadow-surface')).toBeInTheDocument()
        expect(container.querySelector('.app-shadow-control')).toBeInTheDocument()
    })

    it('keeps kickoff task contracts visible when they include instructional HOPI_ACTIONS examples', () => {
        renderWithProviders(
            <MarkdownRenderer
                content={[
                    'Final HOPI_ACTIONS packet:',
                    '- HOPI applies this JSON after your turn.',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [{
                            type: 'update_current_task',
                            status: 'finished',
                            handoff: '...',
                            evidence: '...'
                        }]
                    }, null, 2),
                    '```',
                    '',
                    'Task Contract:',
                    '## Objective',
                    'Use the brainstorming protocol to clarify this Goal before implementation: 调整为成熟的游戏架构'
                ].join('\n')}
            />
        )

        expect(screen.getByText(/Task Contract:/)).toBeInTheDocument()
        expect(screen.getByText(/调整为成熟的游戏架构/)).toBeInTheDocument()
        expect(screen.queryByText('Task finished')).not.toBeInTheDocument()
    })

    it('allows long paths and ids to wrap inside the message column', () => {
        renderWithProviders(
            <MarkdownRenderer content="Read .hopi/docs/goals/d252bb99-35c4-460e-b8ff-very-long-unbroken-path.md before continuing." />
        )

        expect(screen.getByTestId('markdown-primitive')).toHaveClass('[overflow-wrap:anywhere]')
        expect(screen.getByTestId('markdown-primitive')).toHaveClass('leading-relaxed')
    })
})
