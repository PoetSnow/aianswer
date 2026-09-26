import { isLlmConfigured, llmConfig } from '../config'

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
    super('未配置 LLM：请在 .env 中设置 VITE_LLM_API_KEY 等变量后重启开发服务器。')
    this.name = 'LlmNotConfiguredError'
  }
}

/**
 * OpenAI 兼容 Chat Completions 流式调用。
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

  const url = `${llmConfig.baseUrl}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model,
      messages,
      stream: true,
      temperature: 0.7,
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

  return { reasoning, content, hadReasoningField }
}
