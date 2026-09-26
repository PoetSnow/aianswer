import type { LlmModelProfile } from '../types'

export interface ServerLlmState {
  configured: boolean
  activeId: string
  profiles: LlmModelProfile[]
}

let cache: ServerLlmState = { configured: false, activeId: '', profiles: [] }
let loadPromise: Promise<ServerLlmState> | null = null

function toProfiles(raw: unknown[]): LlmModelProfile[] {
  const out: LlmModelProfile[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    if (
      typeof p.id !== 'string' ||
      typeof p.baseUrl !== 'string' ||
      typeof p.model !== 'string'
    ) {
      continue
    }
    out.push({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : p.model,
      baseUrl: String(p.baseUrl).replace(/\/$/, ''),
      model: p.model,
      apiKey: '',
      temperature: typeof p.temperature === 'number' ? p.temperature : 0.7,
      shared: true,
      hasApiKey: Boolean(p.hasApiKey),
    })
  }
  return out
}

export function getServerLlmState(): ServerLlmState {
  return cache
}

/** @deprecated 取当前第一条；请用 getServerLlmState */
export function getCachedServerSharedProfile(): LlmModelProfile | null {
  const { activeId, profiles } = cache
  if (profiles.length === 0) return null
  return profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null
}

export function applyServerLlmPayload(data: {
  configured?: boolean
  activeId?: string
  profiles?: unknown[]
}): ServerLlmState {
  const profiles = Array.isArray(data.profiles) ? toProfiles(data.profiles) : []
  let activeId = typeof data.activeId === 'string' ? data.activeId : ''
  if (activeId && !profiles.some((p) => p.id === activeId)) activeId = ''
  if (!activeId) activeId = profiles[0]?.id ?? ''
  cache = {
    configured: Boolean(data.configured) && profiles.length > 0,
    activeId,
    profiles,
  }
  return cache
}

export async function ensureServerLlmConfig(): Promise<LlmModelProfile | null> {
  if (loadPromise) {
    await loadPromise
    return getCachedServerSharedProfile()
  }
  loadPromise = (async () => {
    try {
      const res = await fetch('/api/llm/config')
      if (!res.ok) {
        cache = { configured: false, activeId: '', profiles: [] }
        return cache
      }
      const data = (await res.json()) as {
        configured?: boolean
        activeId?: string
        profiles?: unknown[]
        // 兼容旧单模型响应
        id?: string
        name?: string
        baseUrl?: string
        model?: string
        temperature?: number
        hasApiKey?: boolean
      }
      if (Array.isArray(data.profiles)) {
        return applyServerLlmPayload(data)
      }
      // 旧格式单条
      if (data.configured && data.baseUrl && data.model) {
        return applyServerLlmPayload({
          configured: true,
          activeId: data.id || 'server-shared',
          profiles: [
            {
              id: data.id || 'server-shared',
              name: data.name || data.model,
              baseUrl: data.baseUrl,
              model: data.model,
              temperature: data.temperature ?? 0.7,
              hasApiKey: data.hasApiKey,
            },
          ],
        })
      }
      cache = { configured: false, activeId: '', profiles: [] }
      return cache
    } catch {
      cache = { configured: false, activeId: '', profiles: [] }
      return cache
    } finally {
      loadPromise = null
    }
  })()

  await loadPromise
  return getCachedServerSharedProfile()
}

/** 整表写入 data/llm.json；profiles[].apiKey 空则服务端保留原 Key */
export async function saveProfilesToServer(
  profiles: LlmModelProfile[],
  activeId: string,
): Promise<ServerLlmState> {
  const res = await fetch('/api/llm/models', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      activeId,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model,
        temperature: p.temperature,
        apiKey: p.apiKey,
      })),
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      typeof (err as { error?: string }).error === 'string'
        ? (err as { error: string }).error
        : `保存失败 (${res.status})`,
    )
  }
  const data = (await res.json()) as {
    configured?: boolean
    activeId?: string
    profiles?: unknown[]
  }
  return applyServerLlmPayload(data)
}
