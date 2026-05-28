import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OperatorMessageCard, getOperatorMessageRootClass } from './OperatorMessageCard'

describe('OperatorMessageCard', () => {
    it('renders shared bubble chrome and message meta for session transcript entries', () => {
        const { container } = render(
            <article className={getOperatorMessageRootClass('assistant')}>
                <OperatorMessageCard
                    role="assistant"
                    timestampLabel="04/06 18:00"
                    statusLabel="sent"
                >
                    <p>Created the first executable planning cards.</p>
                </OperatorMessageCard>
            </article>,
        )

        expect(screen.getByText('agent')).toBeInTheDocument()
        expect(screen.getByText('04/06 18:00')).toBeInTheDocument()
        expect(screen.getByText('sent')).toBeInTheDocument()
        expect(screen.getByText('Created the first executable planning cards.')).toBeInTheDocument()
        expect(container.querySelector('.prototype-thread-bubble--agent')).not.toBeNull()
    })

    it('omits the meta row when timestamp and status are absent', () => {
        const { container } = render(
            <article className={getOperatorMessageRootClass('user')}>
                <OperatorMessageCard role="user">
                    <p>继续追问，或直接给 Agent 一条明确指令</p>
                </OperatorMessageCard>
            </article>,
        )

        expect(screen.getByText('继续追问，或直接给 Agent 一条明确指令')).toBeInTheDocument()
        expect(container.querySelector('.prototype-session-log__message-meta')).toBeNull()
        expect(container.querySelector('.prototype-thread-bubble--user')).not.toBeNull()
    })
})
