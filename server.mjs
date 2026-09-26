/**
 * 生产入口：静态 dist + 题库 API + LLM 代理
 *
 *   npm run build
 *   node server.mjs
 *
 * 环境变量：
 *   PORT / API_PORT  监听端口，默认 5174
 *   HOST             默认 0.0.0.0
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { llmProxyMiddleware } from './server/llmProxy.mjs'
import { getLlmConfigPath, getServerLlmConfig } from './server/llmConfig.mjs'
import { questionsApiMiddleware } from './server/questionsApi.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT || process.env.API_PORT || 5174)
const HOST = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  res.statusCode = 200
  res.setHeader('Content-Type', type)
  fs.createReadStream(filePath).pipe(res)
}

function safeJoinDist(urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0])
  const rel = decoded.replace(/^\/+/, '')
  const full = path.normalize(path.join(DIST, rel || 'index.html'))
  if (!full.startsWith(DIST)) return null
  return full
}

function serveStatic(req, res) {
  if (!fs.existsSync(DIST)) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('未找到 dist/，请先在项目根目录执行 npm run build')
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  let filePath = safeJoinDist(req.url || '/')
  if (!filePath) {
    res.statusCode = 400
    res.end('Bad Request')
    return
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath)
    return
  }

  // SPA：/answer 等前端路由回退到 index.html
  const index = path.join(DIST, 'index.html')
  if (fs.existsSync(index)) {
    sendFile(res, index)
    return
  }

  res.statusCode = 404
  res.end('Not Found')
}

const server = http.createServer((req, res) => {
  questionsApiMiddleware(req, res, () => {
    llmProxyMiddleware(req, res, () => {
      serveStatic(req, res)
    })
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[aianswer] http://${HOST}:${PORT}`)
  console.log(`[aianswer] static: ${DIST}`)
  console.log(`[aianswer] api: /api/questions , /api/llm/config , /api/llm/chat/completions`)
  const cfg = getServerLlmConfig()
  console.log(
    `[aianswer] shared LLM: ${cfg ? `${cfg.model} @ ${cfg.baseUrl}` : `off (edit ${getLlmConfigPath()})`}`,
  )
})
