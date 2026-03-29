import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig(({ command }) => ({
    plugins: [react()],
    base: command === 'serve' ? '/' : '/omc/',
    server: {
        host: true,
        proxy: {
            '/api': {
                target: process.env.HOPI_HUB_URL?.trim() || 'http://127.0.0.1:3006',
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
}))
