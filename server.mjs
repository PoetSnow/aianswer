/**
 * 可选独立 API 服务（不经 Vite 时用）。
 * 开发默认走 Vite 中间件；本文件便于对照或单独挂载。
 *
 *   node server.mjs
 */
import http from 'node:http'
import { llmProxyMiddleware } from './server/llmProxy.mjs'
import { questionsApiMiddleware } from './server/questionsApi.mjs'

const PORT = Number(process.env.API_PORT || 5174)

const server = http.createServer((req, res) => {
  questionsApiMiddleware(req, res, () => {
    llmProxyMiddleware(req, res, () => {
      res.statusCode = 404
      res.end('Not Found')
    })
  })
})

server.listen(PORT, () => {
  console.log(`[api] http://127.0.0.1:${PORT}/api/questions`)
  console.log(`[api] http://127.0.0.1:${PORT}/api/llm/chat/completions`)
})
