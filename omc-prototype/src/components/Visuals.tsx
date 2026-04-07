import type { PrototypeGlyphName } from '@/prototype/presenter'

export function Glyph(props: { name: PrototypeGlyphName; className?: string }) {
    const className = `prototype-glyph ${props.className ?? ''}`.trim()

    switch (props.name) {
        case 'back':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="m14.5 6.5-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M10 11.5h8" strokeLinecap="round" />
                </svg>
            )
        case 'close':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M7 7 17 17" strokeLinecap="round" />
                    <path d="M17 7 7 17" strokeLinecap="round" />
                </svg>
            )
        case 'portfolio':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 7.5h16" />
                    <path d="M6.5 4.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
                    <path d="M8 12h3.5v4H8z" />
                    <path d="M14 12h2.5" />
                    <path d="M14 15h2.5" />
                </svg>
            )
        case 'brief':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M7 5.5h10a2 2 0 0 1 2 2v11h-9a3 3 0 0 0-3 3z" />
                    <path d="M7 5.5a2.5 2.5 0 0 0-2.5 2.5v13.5" />
                    <path d="M10 10h6" />
                    <path d="M10 13.5h6" />
                    <path d="M10 17h4" />
                </svg>
            )
        case 'repo':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M6 5h8l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
                    <path d="M14 5v4h4" />
                    <path d="M8 14h8" />
                    <path d="M8 18h5" />
                </svg>
            )
        case 'digest':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M5 18V6" />
                    <path d="M10 18V10" />
                    <path d="M15 18V8" />
                    <path d="M20 18V12" />
                </svg>
            )
        case 'approval':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M12 3.5 19 7v5.5c0 4-2.6 6.7-7 8-4.4-1.3-7-4-7-8V7z" />
                    <path d="m9.5 12 1.8 1.8 3.5-3.8" />
                </svg>
            )
        case 'risk':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M12 4 20 19H4z" />
                    <path d="M12 9v4.5" />
                    <circle cx="12" cy="16.8" r=".8" fill="currentColor" stroke="none" />
                </svg>
            )
        case 'stream':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M5 7.5h8" />
                    <path d="M11 12h8" />
                    <path d="M5 16.5h10" />
                    <circle cx="16.5" cy="7.5" r="2.2" />
                    <circle cx="7.5" cy="12" r="2.2" />
                    <circle cx="18.5" cy="16.5" r="2.2" />
                </svg>
            )
        case 'strategy':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M5 18 11 6l3.5 7 2.5-4 2 9" />
                    <path d="M5 18h14" />
                </svg>
            )
        case 'phase':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="4.5" y="5.5" width="5" height="5" rx="1.2" />
                    <rect x="14.5" y="5.5" width="5" height="5" rx="1.2" />
                    <rect x="9.5" y="13.5" width="5" height="5" rx="1.2" />
                    <path d="M9.5 8h5" />
                    <path d="M12 10.5v3" />
                </svg>
            )
        case 'kanban':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="4.5" y="5" width="4.5" height="14" rx="1.2" />
                    <rect x="10.2" y="8" width="4.5" height="11" rx="1.2" />
                    <rect x="15.9" y="11" width="4.5" height="8" rx="1.2" />
                </svg>
            )
        case 'clock':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v4.4l2.6 1.6" />
                </svg>
            )
        case 'pulse':
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M3.5 12h4l2-4 4.2 8 2.1-4H20.5" />
                </svg>
            )
        default:
            return null
    }
}

export function LinearMeter(props: { value: number; label?: string; showValue?: boolean }) {
    const value = Math.max(0, Math.min(100, props.value))
    const showValue = props.showValue ?? true

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-end justify-between text-xs font-medium">
                {showValue ? <strong className="text-zinc-900">{value}</strong> : <strong aria-hidden="true" className="invisible">.</strong>}
                <span className="text-zinc-500">{props.label ?? '置信'}</span>
            </div>
            <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden" aria-hidden="true">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${value}%` }} />
            </div>
        </div>
    )
}

export function SparkBar(props: { value: number }) {
    const bars = [0.28, 0.44, 0.62, 0.82]
    const active = Math.max(1, Math.round((props.value / 100) * bars.length))

    return (
        <div className="flex items-end gap-[2px] h-3 w-4" aria-hidden="true">
            {bars.map((height, index) => (
                <span
                    key={`${height}-${index}`}
                    className={`w-0.5 rounded-t-[1px] transition-colors ${index < active ? 'bg-blue-500' : 'bg-zinc-200'}`}
                    style={{ height: `${height * 100}%` }}
                />
            ))}
        </div>
    )
}
