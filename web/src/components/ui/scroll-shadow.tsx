import { forwardRef } from 'react'
import type { CSSProperties, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type ScrollShadowStyle = CSSProperties & {
    '--scroll-shadow-bg'?: string
    '--scroll-shadow-color'?: string
}

export type ScrollShadowProps = HTMLAttributes<HTMLDivElement> & {
    background?: string
    shadowColor?: string
}

export const ScrollShadow = forwardRef<HTMLDivElement, ScrollShadowProps>(function ScrollShadow(
    { className, style, background, shadowColor, ...rest },
    ref
) {
    const mergedStyle: ScrollShadowStyle = {
        ...(background ? { '--scroll-shadow-bg': background } : {}),
        ...(shadowColor ? { '--scroll-shadow-color': shadowColor } : {}),
        ...(style as ScrollShadowStyle | undefined)
    }

    return (
        <div
            ref={ref}
            className={cn('scroll-shadow-y', className)}
            style={mergedStyle}
            {...rest}
        />
    )
})

ScrollShadow.displayName = 'ScrollShadow'
