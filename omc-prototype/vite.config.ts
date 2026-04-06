import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const prototypePortEnv = process.env.HOPI_OMC_PROTOTYPE_PORT?.trim()
const prototypePort = prototypePortEnv ? Number.parseInt(prototypePortEnv, 10) : 5175
const hubUrl = process.env.HOPI_HUB_URL?.trim() || ''
const defaultHubUrl = 'http://127.0.0.1:3006'

export default defineConfig({
    plugins: [react()],
    base: '/',
    server: {
        host: true,
        port: Number.isFinite(prototypePort) ? prototypePort : 5175,
        allowedHosts: ['macbook-pro-2.tailfbf761.ts.net'],
        strictPort: Boolean(prototypePortEnv),
        proxy: {
            '/api': {
                target: hubUrl || defaultHubUrl,
                changeOrigin: true,
            },
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    }
})
