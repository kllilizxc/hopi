// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { defaultComponents } from '@/components/assistant-ui/markdown-text'

vi.mock('@assistant-ui/react-markdown', async importOriginal => {
    const actual = await importOriginal<typeof import('@assistant-ui/react-markdown')>()
    return {
        ...actual,
        unstable_memoizeMarkdownComponents: <T,>(components: T) => components,
        useIsMarkdownCodeBlock: () => true
    }
})

describe('markdown text layout', () => {
    it('wraps fenced code blocks within the chat column', () => {
        const Pre = defaultComponents.pre as ComponentType<ComponentPropsWithoutRef<'pre'>>
        const Code = defaultComponents.code as ComponentType<ComponentPropsWithoutRef<'code'>>

        render(
            <Pre>
                <Code>
                    {'{"actions":[{"type":"update_current_task","status":"finished","evidence":"d252bb99-35c4-460e-b8ff-very-long-token"}]}'}
                </Code>
            </Pre>
        )

        const code = screen.getByText(/update_current_task/)
        expect(code).toHaveClass('whitespace-pre-wrap')
        expect(code).toHaveClass('[overflow-wrap:anywhere]')
        expect(code.closest('pre')).toHaveClass('whitespace-pre-wrap')
        expect(code.closest('pre')).not.toHaveClass('w-max')
    })
})
