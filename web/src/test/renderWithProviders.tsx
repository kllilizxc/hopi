import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
    Outlet,
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
} from '@tanstack/react-router'
import { I18nContext, I18nProvider, type I18nContextValue } from '@/lib/i18n-context'

type RouterOptions = {
    routePath?: string
    initialEntries?: string[]
}

type RenderWithProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
    withI18n?: boolean
    i18nValue?: I18nContextValue
    withQueryClient?: boolean
    queryClient?: QueryClient
    withRouter?: boolean
    router?: RouterOptions
}

export type { RouterOptions, RenderWithProvidersOptions }

function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    })
}

function createTestRouter(ui: ReactElement, options?: RouterOptions): ReturnType<typeof createRouter> {
    const routePath = options?.routePath ?? '/'
    const initialEntries = options?.initialEntries ?? ['/']

    const rootRoute = createRootRoute({
        component: () => <Outlet />,
    })

    const testRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: routePath,
        component: () => ui,
    })

    const routeTree = rootRoute.addChildren([testRoute])

    return createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries }),
    })
}

function wrapWithI18n(children: ReactNode, options: RenderWithProvidersOptions): ReactNode {
    if (!options.withI18n) {
        return children
    }

    if (options.i18nValue) {
        return (
            <I18nContext.Provider value={options.i18nValue}>
                {children}
            </I18nContext.Provider>
        )
    }

    return (
        <I18nProvider>
            {children}
        </I18nProvider>
    )
}

function wrapWithQueryClient(children: ReactNode, options: RenderWithProvidersOptions): { node: ReactNode; queryClient: QueryClient | null } {
    if (!options.withQueryClient) {
        return { node: children, queryClient: null }
    }

    const queryClient = options.queryClient ?? createTestQueryClient()
    return {
        node: (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        ),
        queryClient,
    }
}

export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
    const {
        withI18n = true,
        i18nValue,
        withQueryClient = true,
        queryClient: providedQueryClient,
        withRouter = false,
        router: routerOptions,
        ...renderOptions
    } = options

    const providerOptions = {
        withI18n,
        i18nValue,
        withQueryClient,
        queryClient: providedQueryClient,
        withRouter,
        router: routerOptions,
    }

    let router: ReturnType<typeof createRouter> | null = null
    let content: ReactNode = ui
    if (withRouter) {
        router = createTestRouter(ui, routerOptions)
        content = <RouterProvider router={router} />
    }

    const withI18nNode = wrapWithI18n(content, providerOptions)
    const { node, queryClient: testQueryClient } = wrapWithQueryClient(withI18nNode, providerOptions)
    const result = render(node, renderOptions)

    return {
        ...result,
        queryClient: testQueryClient,
        router,
    }
}
