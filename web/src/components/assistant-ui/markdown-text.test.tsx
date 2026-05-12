// @vitest-environment jsdom

import { screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { defaultComponents } from '@/components/assistant-ui/markdown-text'
import { renderWithProviders } from '@/test/renderWithProviders'

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

        renderWithProviders(
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

    it('renders ordinary list item content', () => {
        const ListItem = defaultComponents.li as ComponentType<ComponentPropsWithoutRef<'li'>>

        renderWithProviders(
            <ul>
                <ListItem>Fill current kanban column target</ListItem>
            </ul>
        )

        const item = screen.getByRole('listitem')
        expect(item).toHaveClass('aui-md-li')
        expect(item).not.toHaveClass('aui-md-task-list-item')
        expect(item).toHaveTextContent('Fill current kanban column target')
    })

    it('renders todo list items with compact checklist markers', () => {
        const ListItem = defaultComponents.li as ComponentType<ComponentPropsWithoutRef<'li'>>

        renderWithProviders(
            <ul>
                <ListItem>
                    <input type="checkbox" checked />
                    {' Read task context'}
                </ListItem>
                <ListItem>
                    <input type="checkbox" />
                    {' Run checks'}
                </ListItem>
            </ul>
        )

        const firstItem = screen.getAllByRole('listitem')[0]
        const secondItem = screen.getAllByRole('listitem')[1]

        expect(firstItem).toHaveClass('aui-md-task-list-item')
        expect(secondItem).toHaveClass('aui-md-task-list-item')
        expect(firstItem.querySelector('.aui-md-task-check')).toBeTruthy()
        expect(firstItem.querySelector('.aui-md-task-check')).toHaveClass(
            'border-[var(--app-link)]'
        )
        expect(firstItem).toHaveTextContent('Read task context')
        expect(secondItem).toHaveTextContent('Run checks')
    })
})
