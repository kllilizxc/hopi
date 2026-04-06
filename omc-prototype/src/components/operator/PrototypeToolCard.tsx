import {
    getToolDisplayPresentation,
    getToolDisplaySections,
    type ToolDisplayBlock,
} from '@hopi/protocol'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

type PrototypeToolState = 'pending' | 'running' | 'completed' | 'error'

function getStateLabel(state: PrototypeToolState): string {
    if (state === 'completed') return 'completed'
    if (state === 'error') return 'error'
    if (state === 'pending') return 'pending'
    return 'running'
}

function renderBlock(block: ToolDisplayBlock) {
    if (block.mode === 'markdown') {
        return <MarkdownRenderer content={block.content} />
    }

    return (
        <pre className="prototype-session-log__tool-code">
            <code>{block.content}</code>
        </pre>
    )
}

export function PrototypeToolCard(props: {
    toolName: string
    description?: string | null
    input: unknown
    result?: unknown
    state: PrototypeToolState
}) {
    const presentation = getToolDisplayPresentation({
        toolName: props.toolName,
        input: props.input,
        result: props.result,
        description: props.description,
    })

    const sections = getToolDisplaySections({
        toolName: props.toolName,
        input: props.input,
        result: props.result,
    })

    return (
        <section className="prototype-session-log__tool-card">
            <header className="prototype-session-log__tool-card-header">
                <div className="prototype-session-log__tool-card-title-wrap">
                    <h3 className="prototype-session-log__tool-card-title">{presentation.title}</h3>
                    {presentation.subtitle ? (
                        <p className="prototype-session-log__tool-card-subtitle">{presentation.subtitle}</p>
                    ) : null}
                </div>
                <span className={`prototype-session-log__tool-card-state prototype-session-log__tool-card-state--${props.state}`}>
                    {getStateLabel(props.state)}
                </span>
            </header>

            <div className="prototype-session-log__tool-card-sections">
                {sections.input ? (
                    <section className="prototype-session-log__tool-card-section">
                        <p className="prototype-session-log__tool-card-label">Input</p>
                        {renderBlock(sections.input)}
                    </section>
                ) : null}

                {sections.result ? (
                    <section className="prototype-session-log__tool-card-section">
                        <p className="prototype-session-log__tool-card-label">Result</p>
                        {renderBlock(sections.result)}
                    </section>
                ) : null}
            </div>
        </section>
    )
}
