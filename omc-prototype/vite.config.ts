import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const prototypePortEnv = process.env.HOPI_OMC_PROTOTYPE_PORT?.trim()
const prototypePort = prototypePortEnv ? Number.parseInt(prototypePortEnv, 10) : 5175

export default defineConfig({
    plugins: [react()],
    base: '/',
    server: {
        host: true,
        port: Number.isFinite(prototypePort) ? prototypePort : 5175,
        strictPort: Boolean(prototypePortEnv)
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
