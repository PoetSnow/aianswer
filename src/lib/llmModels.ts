import { LLM_ACTIVE_MODEL_KEY, type LlmModelProfile } from '../types'
import { randomId } from './id'
import {
  ensureServerLlmConfig,
  getServerLlmState,
  saveProfilesToServer,
} from './serverLlm'

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '')
}

export function loadModelProfiles(): LlmModelProfile[] {
  return getServerLlmState().profiles
}

export function getActiveModelId(profiles: LlmModelProfile[]): string {
  const state = getServerLlmState()
  if (state.activeId && profiles.some((p) => p.id === state.activeId)) {
    return state.activeId
  }
  try {
    const id = localStorage.getItem(LLM_ACTIVE_MODEL_KEY)
    if (id && profiles.some((p) => p.id === id)) return id
  } catch {
    // ignore
  }
  return profiles[0]?.id ?? ''
}

export function setActiveModelId(id: string): void {
  try {
    localStorage.setItem(LLM_ACTIVE_MODEL_KEY, id)
  } catch {
    // ignore
  }
  const state = getServerLlmState()
  state.activeId = id
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

async function persist(list: LlmModelProfile[], activeId: string): Promise<LlmModelProfile[]> {
  const saved = await saveProfilesToServer(list, activeId)
  setActiveModelId(saved.activeId)
  return saved.profiles
}

export async function upsertProfile(profile: LlmModelProfile): Promise<LlmModelProfile[]> {
  await ensureServerLlmConfig()
  const list = [...loadModelProfiles()]
  const next: LlmModelProfile = {
    ...profile,
    shared: true,
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    name: profile.name.trim() || profile.model,
    model: profile.model.trim(),
    apiKey: profile.apiKey.trim(),
    temperature:
      typeof profile.temperature === 'number' && !Number.isNaN(profile.temperature)
        ? profile.temperature
        : 0.7,
  }
  const idx = list.findIndex((p) => p.id === next.id)
  if (idx >= 0) list[idx] = next
  else list.push(next)
  const activeId = getActiveModelId(list) || next.id
  return persist(list, activeId)
}

export async function deleteProfile(id: string): Promise<LlmModelProfile[]> {
  await ensureServerLlmConfig()
  const list = loadModelProfiles().filter((p) => p.id !== id)
  let activeId = getActiveModelId(list)
  if (!list.some((p) => p.id === activeId)) {
    activeId = list[0]?.id ?? ''
  }
  return persist(list, activeId)
}

export async function selectActiveModel(id: string): Promise<LlmModelProfile[]> {
  await ensureServerLlmConfig()
  const list = loadModelProfiles()
  if (!list.some((p) => p.id === id)) return list
  setActiveModelId(id)
  return persist(list, id)
}

export function createEmptyProfile(): LlmModelProfile {
  const existing = loadModelProfiles()[0]
  return {
    id: randomId(),
    name: '',
    baseUrl: existing?.baseUrl ?? '',
    model: '',
    apiKey: '',
    temperature: existing?.temperature ?? 0.7,
    shared: true,
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
    id: code || randomId(),
    name,
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
    apiKey,
    temperature,
    shared: true,
  }
}

/** 兼容旧调用：本地不再单独存模型表 */
export function saveModelProfiles(_profiles: LlmModelProfile[]): void {
  // no-op：持久化走 saveProfilesToServer
}
