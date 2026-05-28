import type { ReactNode } from 'react'
import { Theme } from '@radix-ui/themes'
import { useTheme } from '@/hooks/useTheme'

export function AppThemeProvider(props: { children: ReactNode }) {
    const { isDark } = useTheme()

    return (
        <Theme
            appearance={isDark ? 'dark' : 'light'}
            grayColor="slate"
            radius="large"
            scaling="100%"
            className="h-full"
        >
            {props.children}
        </Theme>
    )
}
