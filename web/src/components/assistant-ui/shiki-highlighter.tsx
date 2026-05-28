import { useEffect, useRef, useState } from 'react'
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import { useShikiHighlighter } from '@/lib/shiki'

export function SyntaxHighlighter(props: SyntaxHighlighterProps) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [shouldHighlight, setShouldHighlight] = useState(false)

    useEffect(() => {
        const el = containerRef.current
        if (!el) {
            return
        }

        if (typeof IntersectionObserver === 'undefined') {
            setShouldHighlight(true)
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        setShouldHighlight(true)
                        observer.disconnect()
                        break
                    }
                }
            },
            { root: null, rootMargin: '800px 0px 800px 0px' }
        )

        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const highlighted = useShikiHighlighter(props.code, props.language, { enabled: shouldHighlight })

    return (
        <div
            ref={containerRef}
            className="aui-md-codeblock min-w-0 w-full max-w-full overflow-x-hidden overflow-y-hidden rounded-b-md bg-[var(--app-code-bg)]"
        >
            <pre className="shiki m-0 w-full min-w-0 whitespace-pre-wrap break-words p-3 text-[13px] font-mono leading-relaxed [overflow-wrap:anywhere]">
                <code className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{highlighted ?? props.code}</code>
            </pre>
        </div>
    )
}
