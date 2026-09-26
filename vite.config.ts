import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import { llmProxyMiddleware } from './server/llmProxy.mjs'
import { questionsApiMiddleware } from './server/questionsApi.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))

function apiPlugin(): Plugin {
  return {
    name: 'ai-math-tutor-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(questionsApiMiddleware)
      server.middlewares.use(llmProxyMiddleware)
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(questionsApiMiddleware)
      server.middlewares.use(llmProxyMiddleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    fs: {
      allow: [root],
    },
  },
})
