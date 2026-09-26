import { getLlmConfig, isLlmConfigured } from '../config'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamDelta {
  reasoning?: string
  content?: string
}

export interface StreamResult {
  reasoning: string
  content: string
  /** 是否收到过 reasoning / reasoning_content 字段 */
  hadReasoningField: boolean
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('未配置 LLM：请在界面「模型」中添加 baseUrl 与 model（本地模型可无 API Key）。')
    this.name = 'LlmNotConfiguredError'
  }
}

/** 临时调试：每次请求打印发给模型的完整上下文 + 完整返回（浏览器 Console） */
const DEBUG_LLM_CONTEXT = true

function debugLogLlmRequest(
  kind: 'stream' | 'chat',
  messages: ChatTurn[],
  meta: { model: string; baseUrl: string; temperature: number },
) {
  if (!DEBUG_LLM_CONTEXT) return
  const payload = {
    kind,
    model: meta.model,
    baseUrl: meta.baseUrl,
    temperature: meta.temperature,
    messageCount: messages.length,
    messages: messages.map((m, i) => ({
      index: i,
      role: m.role,
      contentLength: m.content.length,
      content: m.content,
    })),
  }
  console.groupCollapsed(
    `%c[LLM ${kind} →] ${meta.model} · ${messages.length} msgs`,
    'color:#1f6b4a;font-weight:bold',
  )
  console.log(payload)
  console.log('—— 按角色展开 ——')
  for (const m of messages) {
    console.log(`【${m.role}】\n${m.content}`)
  }
  console.groupEnd()
}

function debugLogLlmResponse(
  kind: 'stream' | 'chat',
  meta: {
    model: string
    content: string
    reasoning?: string
    hadReasoningField?: boolean
    rawJson?: unknown
  },
) {
  if (!DEBUG_LLM_CONTEXT) return
  console.groupCollapsed(
    `%c[LLM ${kind} ←] ${meta.model} · content ${meta.content.length} chars`,
    'color:#0b57d0;font-weight:bold',
  )
  console.log('—— 完整 content ——')
  console.log(meta.content)
  if (meta.reasoning) {
    console.log('—— 完整 reasoning ——')
    console.log(meta.reasoning)
  }
  console.log({
    contentLength: meta.content.length,
    reasoningLength: meta.reasoning?.length ?? 0,
    hadReasoningField: meta.hadReasoningField ?? false,
  })
  if (meta.rawJson !== undefined) {
    console.log('—— 原始 JSON 响应 ——')
    console.log(meta.rawJson)
  }
  console.groupEnd()
}

/**
 * OpenAI 兼容 Chat Completions 流式调用。
 * 经本地 /api/llm 代理转发，便于访问内网端点并规避 CORS。
 * 解析 content，以及 DeepSeek-R1 风格的 reasoning_content / reasoning。
 */
export async function streamChatCompletion(
  messages: ChatTurn[],
  onDelta: (delta: StreamDelta) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  if (!isLlmConfigured()) {
    throw new LlmNotConfiguredError()
  }

  const cfg = getLlmConfig()
  const temperature = cfg.temperature ?? 0.7
  debugLogLlmRequest('stream', messages, {
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    temperature,
  })

  const url = '/api/llm/chat/completions'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-LLM-Base-Url': cfg.baseUrl,
  }
  if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      temperature,
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`LLM 请求失败 (${response.status}): ${errText || response.statusText}`)
  }

  if (!response.body) {
    throw new Error('响应无 body，无法流式读取')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let reasoning = ''
  let content = ''
  let hadReasoningField = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue

      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string | null
              reasoning_content?: string | null
              reasoning?: string | null
            }
          }>
        }
        const delta = json.choices?.[0]?.delta
        if (!delta) continue

        const r = delta.reasoning_content ?? delta.reasoning
        if (typeof r === 'string' && r.length > 0) {
          hadReasoningField = true
          reasoning += r
          onDelta({ reasoning: r })
        }
        const c = delta.content
        if (typeof c === 'string' && c.length > 0) {
          content += c
          onDelta({ content: c })
        }
      } catch {
        // 忽略不完整或非 JSON 行
      }
    }
  }

  debugLogLlmResponse('stream', {
    model: cfg.model,
    content,
    reasoning,
    hadReasoningField,
  })

  return { reasoning, content, hadReasoningField }
}

/**
 * 非流式 Chat Completions（引导态结构化 JSON）。
 */
export async function chatCompletion(
  messages: ChatTurn[],
  signal?: AbortSignal,
): Promise<string> {
  if (!isLlmConfigured()) {
    throw new LlmNotConfiguredError()
  }

  const cfg = getLlmConfig()
  const temperature = cfg.temperature ?? 0.7
  debugLogLlmRequest('chat', messages, {
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    temperature,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-LLM-Base-Url': cfg.baseUrl,
  }
  if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`
  }

  const response = await fetch('/api/llm/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: false,
      temperature,
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`LLM 请求失败 (${response.status}): ${errText || response.statusText}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null
        reasoning_content?: string | null
        reasoning?: string | null
      }
    }>
  }
  const message = data.choices?.[0]?.message
  const content = message?.content
  const reasoning =
    (typeof message?.reasoning_content === 'string' && message.reasoning_content) ||
    (typeof message?.reasoning === 'string' && message.reasoning) ||
    ''
  if (typeof content !== 'string' || !content.trim()) {
    debugLogLlmResponse('chat', {
      model: cfg.model,
      content: '',
      reasoning,
      hadReasoningField: Boolean(reasoning),
      rawJson: data,
    })
    throw new Error('LLM 未返回正文')
  }
  const trimmed = content.trim()
  debugLogLlmResponse('chat', {
    model: cfg.model,
    content: trimmed,
    reasoning,
    hadReasoningField: Boolean(reasoning),
    rawJson: data,
  })
  return trimmed
}

