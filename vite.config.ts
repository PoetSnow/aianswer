import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import { questionsApiMiddleware } from './server/questionsApi.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))

function questionsApiPlugin(): Plugin {
  return {
    name: 'questions-json-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(questionsApiMiddleware)
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(questionsApiMiddleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), questionsApiPlugin()],
  server: {
    fs: {
      allow: [root],
    },
  },
})
