import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '@/router'
import { PrototypeStoreProvider } from '@/prototype/store'
import './index.css'

const routerBasepath = (() => {
    const basePath = import.meta.env.BASE_URL || '/'
    return basePath.endsWith('/') && basePath !== '/' ? basePath.slice(0, -1) : basePath
})()

const router = createAppRouter(routerBasepath)

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <PrototypeStoreProvider>
            <RouterProvider router={router} />
        </PrototypeStoreProvider>
    </React.StrictMode>
)
