/**
 * 将浏览器请求转发到任意 OpenAI 兼容端点，规避内网 CORS。
 * POST /api/llm/chat/completions
 * Header: X-LLM-Base-Url（如 http://host:8066/v1）
 * Header: Authorization（可选 Bearer）
 * Body: 原样 Chat Completions JSON（含 stream）
 */
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

  const target = resolveTargetUrl(req.headers['x-llm-base-url'])
  if (!target) {
    sendJson(res, 400, { error: '缺少或非法的 X-LLM-Base-Url' })
    return
  }

  readRequestBody(req)
    .then(async (bodyBuf) => {
      const headers = {
        'Content-Type': 'application/json',
        Accept: req.headers.accept || 'text/event-stream, application/json',
      }
      const auth = req.headers.authorization
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
