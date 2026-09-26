import { getLlmConfig, isLlmConfigured } from '../config'
import { isDevMode } from './devMode'
import { randomId } from './id'

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

/** 页面调试面板用的一次 LLM 调用记录 */
export interface LlmTraceEntry {
  id: string
  at: string
  kind: 'stream' | 'chat'
  phase: 'request' | 'response' | 'error'
  model: string
  baseUrl?: string
  temperature?: number
  /** 请求：完整 messages；响应：content / reasoning */
  title: string
  body: string
}

const TRACE_LIMIT = 80
const traces: LlmTraceEntry[] = []
const listeners = new Set<(entries: LlmTraceEntry[]) => void>()

function notifyTraceListeners() {
  const snapshot = [...traces]
  for (const fn of listeners) fn(snapshot)
}

export function getLlmTraces(): LlmTraceEntry[] {
  return [...traces]
}

export function subscribeLlmTraces(fn: (entries: LlmTraceEntry[]) => void): () => void {
  listeners.add(fn)
  fn([...traces])
  return () => {
    listeners.delete(fn)
  }
}

export function clearLlmTraces() {
  traces.length = 0
  notifyTraceListeners()
}

function pushTrace(entry: Omit<LlmTraceEntry, 'id' | 'at'>) {
  if (!isDevMode()) return
  traces.push({
    ...entry,
    id: randomId(),
    at: new Date().toISOString(),
  })
  while (traces.length > TRACE_LIMIT) traces.shift()
  notifyTraceListeners()
}

function formatMessages(messages: ChatTurn[]): string {
  return messages
    .map((m, i) => `—— [${i}] ${m.role} (${m.content.length} chars) ——\n${m.content}`)
    .join('\n\n')
}

/** 站点模型：只传 Profile-Id，由服务端从 data/llm.json 注入 Key */
function buildLlmHeaders(cfg: ReturnType<typeof getLlmConfig>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (cfg.shared || cfg.id !== 'fallback') {
    headers['X-LLM-Profile-Id'] = cfg.id
    return headers
  }
  headers['X-LLM-Base-Url'] = cfg.baseUrl
  if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`
  }
  return headers
}

function debugLogLlmRequest(
  kind: 'stream' | 'chat',
  messages: ChatTurn[],
  meta: { model: string; baseUrl: string; temperature: number },
) {
  if (!isDevMode()) return
  const body = formatMessages(messages)
  pushTrace({
    kind,
    phase: 'request',
    model: meta.model,
    baseUrl: meta.baseUrl,
    temperature: meta.temperature,
    title: `→ 输入 · ${kind} · ${messages.length} msgs`,
    body,
  })
  console.groupCollapsed(
    `%c[LLM ${kind} →] ${meta.model} · ${messages.length} msgs`,
    'color:#1f6b4a;font-weight:bold',
  )
  console.log({
    kind,
    model: meta.model,
    baseUrl: meta.baseUrl,
    temperature: meta.temperature,
    messages,
  })
  console.log(body)
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
    error?: string
  },
) {
  if (!isDevMode()) return
  const parts = [
    meta.error ? `【error】\n${meta.error}` : '',
    '【content】',
    meta.content || '（空）',
    meta.reasoning ? `\n【reasoning】\n${meta.reasoning}` : '',
    meta.rawJson !== undefined
      ? `\n【rawJson】\n${JSON.stringify(meta.rawJson, null, 2)}`
      : '',
  ].filter(Boolean)
  const body = parts.join('\n')
  pushTrace({
    kind,
    phase: meta.error ? 'error' : 'response',
    model: meta.model,
    title: meta.error
      ? `← 错误 · ${kind}`
      : `← 输出 · ${kind} · ${meta.content.length} chars`,
    body,
  })
  console.groupCollapsed(
    `%c[LLM ${kind} ←] ${meta.model} · content ${meta.content.length} chars`,
    'color:#0b57d0;font-weight:bold',
  )
  console.log(body)
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
  const headers = buildLlmHeaders(cfg)

  let response: Response
  try {
    response = await fetch(url, {
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
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    debugLogLlmResponse('stream', {
      model: cfg.model,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    const msg = `LLM 请求失败 (${response.status}): ${errText || response.statusText}`
    debugLogLlmResponse('stream', {
      model: cfg.model,
      content: '',
      error: msg,
    })
    throw new Error(msg)
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

  const headers = buildLlmHeaders(cfg)

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

