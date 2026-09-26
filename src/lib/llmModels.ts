import {
  LLM_ACTIVE_MODEL_KEY,
  LLM_MODELS_KEY,
  type LlmModelProfile,
} from '../types'

/** 内网小模型预设，便于先验证界面切换 */
export const LOCAL_QWEN_PRESET: Omit<LlmModelProfile, 'id'> = {
  name: '内网 Qwen (61.144.189.71:8066 Chat)',
  baseUrl: 'http://61.144.189.71:8066/v1',
  model: 'Qwen/Qwen2.5-3B-Instruct',
  apiKey: '',
  temperature: 0.1,
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '')
}

function envSeedProfile(): LlmModelProfile | null {
  const baseUrl = (import.meta.env.VITE_LLM_BASE_URL as string | undefined)?.trim()
  const apiKey = (import.meta.env.VITE_LLM_API_KEY as string | undefined)?.trim() ?? ''
  const model = (import.meta.env.VITE_LLM_MODEL as string | undefined)?.trim()
  if (!baseUrl || !model) return null
  return {
    id: 'env-default',
    name: `环境变量 · ${model}`,
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
    apiKey,
    temperature: 0.7,
  }
}

function defaultProfiles(): LlmModelProfile[] {
  const list: LlmModelProfile[] = [
    {
      id: 'local-qwen',
      ...LOCAL_QWEN_PRESET,
    },
  ]
  const fromEnv = envSeedProfile()
  if (fromEnv) list.unshift(fromEnv)
  return list
}

function isProfile(raw: unknown): raw is LlmModelProfile {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.baseUrl === 'string' &&
    typeof p.model === 'string' &&
    typeof p.apiKey === 'string' &&
    (typeof p.temperature === 'number' || p.temperature == null)
  )
}

export function loadModelProfiles(): LlmModelProfile[] {
  try {
    const raw = localStorage.getItem(LLM_MODELS_KEY)
    if (!raw) {
      const seeded = defaultProfiles()
      saveModelProfiles(seeded)
      return seeded
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seeded = defaultProfiles()
      saveModelProfiles(seeded)
      return seeded
    }
    return parsed.filter(isProfile).map((p) => ({
      ...p,
      baseUrl: normalizeBaseUrl(p.baseUrl),
      temperature: typeof p.temperature === 'number' ? p.temperature : 0.7,
    }))
  } catch {
    return defaultProfiles()
  }
}

export function saveModelProfiles(profiles: LlmModelProfile[]): void {
  localStorage.setItem(LLM_MODELS_KEY, JSON.stringify(profiles))
}

export function getActiveModelId(profiles: LlmModelProfile[]): string {
  try {
    const id = localStorage.getItem(LLM_ACTIVE_MODEL_KEY)
    if (id && profiles.some((p) => p.id === id)) return id
  } catch {
    // ignore
  }
  return profiles[0]?.id ?? ''
}

export function setActiveModelId(id: string): void {
  localStorage.setItem(LLM_ACTIVE_MODEL_KEY, id)
}

export function getActiveProfile(): LlmModelProfile | null {
  const profiles = loadModelProfiles()
  if (profiles.length === 0) return null
  const id = getActiveModelId(profiles)
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? null
}

export function isProfileReady(profile: LlmModelProfile | null | undefined): boolean {
  if (!profile) return false
  return Boolean(profile.baseUrl.trim() && profile.model.trim())
}

export function upsertProfile(profile: LlmModelProfile): LlmModelProfile[] {
  const list = loadModelProfiles()
  const idx = list.findIndex((p) => p.id === profile.id)
  const next = {
    ...profile,
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    name: profile.name.trim() || profile.model,
    model: profile.model.trim(),
    apiKey: profile.apiKey.trim(),
    temperature:
      typeof profile.temperature === 'number' && !Number.isNaN(profile.temperature)
        ? profile.temperature
        : 0.7,
  }
  if (idx >= 0) list[idx] = next
  else list.push(next)
  saveModelProfiles(list)
  return list
}

export function deleteProfile(id: string): LlmModelProfile[] {
  const list = loadModelProfiles().filter((p) => p.id !== id)
  saveModelProfiles(list)
  const active = getActiveModelId(list)
  if (active === id || !list.some((p) => p.id === active)) {
    setActiveModelId(list[0]?.id ?? '')
  }
  return list
}

export function createEmptyProfile(): LlmModelProfile {
  return {
    id: crypto.randomUUID(),
    name: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: '',
    apiKey: '',
    temperature: 0.7,
  }
}

/**
 * 兼容外部配置 JSON（如 NetAgent 风格）：
 * Code / Name / Endpoint / ModelName / ApiKey / Temperature / ChatCompletionsPath
 */
export function profileFromExternalJson(raw: unknown): LlmModelProfile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('须为 JSON 对象')
  }
  const o = raw as Record<string, unknown>
  const endpoint = String(o.Endpoint ?? o.baseUrl ?? o.BaseUrl ?? '').trim()
  const pathHint = String(o.ChatCompletionsPath ?? '').trim()
  let baseUrl = endpoint
  if (baseUrl && pathHint.includes('/v1/') && !/\/v1\/?$/.test(baseUrl)) {
    baseUrl = `${normalizeBaseUrl(baseUrl)}/v1`
  }
  const model = String(o.ModelName ?? o.model ?? o.Model ?? '').trim()
  const name = String(o.Name ?? o.name ?? (model || '未命名模型')).trim()
  const apiKey = String(o.ApiKey ?? o.apiKey ?? o.API_KEY ?? '')
  const temperature =
    typeof o.Temperature === 'number'
      ? o.Temperature
      : typeof o.temperature === 'number'
        ? o.temperature
        : 0.7
  const code = String(o.Code ?? o.id ?? '').trim()
  if (!baseUrl || !model) {
    throw new Error('需要 Endpoint（或 baseUrl）与 ModelName（或 model）')
  }
  return {
    id: code || crypto.randomUUID(),
    name,
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
    apiKey,
    temperature,
  }
}
