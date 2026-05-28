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

function getStateClasses(state: PrototypeToolState): string {
    switch (state) {
        case 'completed': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
        case 'error': return 'bg-red-50 text-red-700 border-red-200'
        case 'running': return 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
        default: return 'bg-zinc-100 text-zinc-600 border-zinc-200'
    }
}

function renderBlock(block: ToolDisplayBlock) {
    if (block.mode === 'markdown') {
        return (
            <div className="prose prose-sm prose-zinc max-w-none overflow-x-hidden [overflow-wrap:anywhere] prose-pre:overflow-x-hidden prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:break-all">
                <MarkdownRenderer content={block.content} />
            </div>
        )
    }

    return (
        <pre className="max-w-full p-3 bg-zinc-950 text-zinc-300 font-mono text-xs rounded-md overflow-x-hidden whitespace-pre-wrap break-all">
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
        <section className="prototype-session-log__tool-card flex flex-col w-full bg-zinc-50 border border-zinc-200 rounded-lg overflow-hidden my-2 shadow-sm">
            <header className="flex items-center justify-between gap-4 p-3 bg-white border-b border-zinc-200">
                <div className="flex flex-col min-w-0">
                    <h3 className="text-sm font-bold text-zinc-900 font-mono truncate">{presentation.title}</h3>
                    {presentation.subtitle ? (
                        <p className="text-xs text-zinc-500 font-mono truncate mt-0.5">{presentation.subtitle}</p>
                    ) : null}
                </div>
                <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border flex-shrink-0 ${getStateClasses(props.state)}`}>
                    {getStateLabel(props.state)}
                </span>
            </header>

            <div className="flex flex-col">
                {sections.input ? (
                    <section className="flex flex-col gap-1.5 p-3 border-b border-zinc-100/50">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Input</p>
                        {renderBlock(sections.input)}
                    </section>
                ) : null}

                {sections.result ? (
                    <section className="flex flex-col gap-1.5 p-3">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Result</p>
                        {renderBlock(sections.result)}
                    </section>
                ) : null}
            </div>
        </section>
    )
}
