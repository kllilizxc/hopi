import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const omcPortEnv = process.env.HOPI_OMC_PORT?.trim()
const omcPort = omcPortEnv ? Number.parseInt(omcPortEnv, 10) : 5174
const hubUrl = process.env.HOPI_HUB_URL?.trim() || ''
const defaultHubUrl = 'http://127.0.0.1:3006'

export default defineConfig(({ command }) => {
    const resolvedHubUrl = command === 'serve' ? (hubUrl || defaultHubUrl) : hubUrl

    return {
        plugins: [react()],
        base: command === 'serve' ? '/' : '/omc/',
        define: {
            __HOPI_HUB_URL__: JSON.stringify(resolvedHubUrl)
        },
        server: {
            host: true,
            port: Number.isFinite(omcPort) ? omcPort : 5174,
            strictPort: Boolean(omcPortEnv),
            proxy: {
                '/api': {
                    target: hubUrl || defaultHubUrl,
                    changeOrigin: true
                }
            }
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
    }
})
