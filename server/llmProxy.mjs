/**
 * GET  /api/llm/config          — 模型列表（不含 Key）
 * PUT  /api/llm/models          — 前端保存整表到 data/llm.json
 * POST /api/llm/chat/completions
 *   Header: X-LLM-Profile-Id（优先，服务端取 baseUrl+Key）
 *   Header: X-LLM-Base-Url / Authorization（兼容旧客户端）
 */
import {
  findProfileByBaseUrl,
  findProfileById,
  getPublicLlmConfig,
  getServerLlmConfig,
  putLlmProfiles,
} from './llmConfig.mjs'

export async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function resolveTargetUrl(baseUrlHeader) {
  const base = String(baseUrlHeader || '')
    .trim()
    .replace(/\/$/, '')
  if (!base) return null
  try {
    const u = new URL(`${base}/chat/completions`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

export function llmProxyMiddleware(req, res, next) {
  const url = req.url?.split('?')[0] ?? ''

  if (url === '/api/llm/config' || url === '/api/llm/config/') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET')
      res.end('Method Not Allowed')
      return
    }
    sendJson(res, 200, getPublicLlmConfig())
    return
  }

  if (url === '/api/llm/models' || url === '/api/llm/models/') {
    if (req.method === 'GET') {
      sendJson(res, 200, getPublicLlmConfig())
      return
    }
    if (req.method !== 'PUT') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, PUT')
      res.end('Method Not Allowed')
      return
    }
    readRequestBody(req)
      .then((buf) => {
        let body
        try {
          body = JSON.parse(buf.toString('utf8') || '{}')
        } catch {
          sendJson(res, 400, { error: 'JSON 无效' })
          return
        }
        try {
          const saved = putLlmProfiles(body)
          sendJson(res, 200, {
            configured: saved.profiles.length > 0,
            activeId: saved.activeId,
            profiles: getPublicLlmConfig().profiles,
          })
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : '保存失败',
          })
        }
      })
      .catch((err) => {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : '保存失败',
        })
      })
    return
  }

  if (url !== '/api/llm/chat/completions' && url !== '/api/llm/chat/completions/') {
    next()
    return
  }

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Allow', 'POST')
    res.end('Method Not Allowed')
    return
  }

  const profileId = String(req.headers['x-llm-profile-id'] || '').trim()
  let profile = profileId ? findProfileById(profileId) : null
  let baseHeader = req.headers['x-llm-base-url']
  let auth = req.headers.authorization
  let useServerDefault = false

  if (!profile && baseHeader) {
    profile = findProfileByBaseUrl(baseHeader)
  }
  if (!profile && !baseHeader) {
    profile = getServerLlmConfig()
    useServerDefault = Boolean(profile)
  }

  if (profile) {
    if (!baseHeader) baseHeader = profile.baseUrl
    if (!auth && profile.apiKey) {
      auth = `Bearer ${profile.apiKey}`
    }
  }

  if (!baseHeader) {
    sendJson(res, 400, {
      error: '缺少模型配置：请在界面添加模型，或编辑 data/llm.json',
    })
    return
  }

  const target = resolveTargetUrl(baseHeader)
  if (!target) {
    sendJson(res, 400, { error: '缺少或非法的 X-LLM-Base-Url' })
    return
  }

  readRequestBody(req)
    .then(async (bodyBuf) => {
      if (useServerDefault && profile) {
        try {
          const json = JSON.parse(bodyBuf.toString('utf8'))
          if (!json.model) json.model = profile.model
          if (json.temperature == null) json.temperature = profile.temperature
          bodyBuf = Buffer.from(JSON.stringify(json))
        } catch {
          // keep
        }
      }

      const headers = {
        'Content-Type': 'application/json',
        Accept: req.headers.accept || 'text/event-stream, application/json',
      }
      if (auth) headers.Authorization = auth

      let upstream
      try {
        upstream = await fetch(target, {
          method: 'POST',
          headers,
          body: bodyBuf,
        })
      } catch (err) {
        sendJson(res, 502, {
          error: `上游连接失败：${err instanceof Error ? err.message : String(err)}`,
        })
        return
      }

      res.statusCode = upstream.status
      const ct = upstream.headers.get('content-type')
      if (ct) res.setHeader('Content-Type', ct)
      res.setHeader('Cache-Control', 'no-cache')

      if (!upstream.body) {
        const text = await upstream.text()
        res.end(text)
        return
      }

      const reader = upstream.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(Buffer.from(value))
        }
        res.end()
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 502, {
            error: `上流式转发失败：${err instanceof Error ? err.message : String(err)}`,
          })
        } else {
          res.end()
        }
      }
    })
    .catch((err) => {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : '代理失败',
      })
    })
}
