import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://backend:8000'

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true },
        '/sanctum': { target: proxyTarget, changeOrigin: true },
        '/login': {
          target: proxyTarget,
          changeOrigin: true,
          // Keep the React login route refresh-safe while forwarding auth
          // submissions and preflight requests to Laravel.
          bypass: (request) => request.method === 'GET' || request.method === 'HEAD'
            ? request.url || '/login'
            : undefined,
        },
        '/logout': { target: proxyTarget, changeOrigin: true },
        '/storage': { target: proxyTarget, changeOrigin: true },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
    },
  }
})
