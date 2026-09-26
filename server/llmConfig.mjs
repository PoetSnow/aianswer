/**
 * 全站模型列表：data/llm.json
 * 前端添加/编辑通过 API 写入此文件；Key 只存在服务器。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'llm.json')

function normalizeBaseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/$/, '')
}

function normalizeProfile(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null
  const o = raw
  const baseUrl = normalizeBaseUrl(o.baseUrl ?? o.BaseUrl ?? o.Endpoint ?? '')
  const model = String(o.model ?? o.Model ?? o.ModelName ?? '').trim()
  if (!baseUrl || !model) return null
  const id = String(o.id ?? o.Code ?? fallbackId ?? '').trim() || crypto.randomUUID()
  const apiKey = String(o.apiKey ?? o.ApiKey ?? o.API_KEY ?? '')
  const name = String(o.name ?? o.Name ?? '').trim() || model
  const tempRaw = Number(o.temperature ?? o.Temperature)
  const temperature = Number.isFinite(tempRaw) ? tempRaw : 0.7
  return { id, name, baseUrl, model, apiKey, temperature }
}

function readRaw() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return null
  }
}

/** @returns {{ activeId: string, profiles: Array<{id:string,name:string,baseUrl:string,model:string,apiKey:string,temperature:number}> }} */
export function loadLlmStore() {
  const raw = readRaw()
  if (!raw) return { activeId: '', profiles: [] }

  // 新格式：{ activeId, profiles: [] }
  if (Array.isArray(raw.profiles)) {
    const profiles = raw.profiles
      .map((p, i) => normalizeProfile(p, `profile-${i}`))
      .filter(Boolean)
    let activeId = String(raw.activeId || '').trim()
    if (activeId && !profiles.some((p) => p.id === activeId)) activeId = ''
    if (!activeId) activeId = profiles[0]?.id ?? ''
    return { activeId, profiles }
  }

  // 旧格式：单个对象
  if (!Array.isArray(raw) && typeof raw === 'object') {
    const one = normalizeProfile(raw, 'server-shared')
    if (!one) return { activeId: '', profiles: [] }
    return { activeId: one.id, profiles: [one] }
  }

  // 数组格式
  if (Array.isArray(raw)) {
    const profiles = raw
      .map((p, i) => normalizeProfile(p, `profile-${i}`))
      .filter(Boolean)
    return { activeId: profiles[0]?.id ?? '', profiles }
  }

  return { activeId: '', profiles: [] }
}

export function saveLlmStore(store) {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const profiles = (store.profiles || [])
    .map((p, i) => normalizeProfile(p, `profile-${i}`))
    .filter(Boolean)
  let activeId = String(store.activeId || '').trim()
  if (activeId && !profiles.some((p) => p.id === activeId)) activeId = ''
  if (!activeId) activeId = profiles[0]?.id ?? ''
  const payload = { activeId, profiles }
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

/** 兼容：当前选用的完整配置（含 key） */
export function getServerLlmConfig() {
  const { activeId, profiles } = loadLlmStore()
  if (profiles.length === 0) return null
  return profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null
}

export function findProfileById(id) {
  if (!id) return null
  return loadLlmStore().profiles.find((p) => p.id === String(id)) ?? null
}

export function findProfileByBaseUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl)
  if (!base) return null
  return loadLlmStore().profiles.find((p) => p.baseUrl === base) ?? null
}

function toPublicProfile(p) {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    temperature: p.temperature,
    shared: true,
    hasApiKey: Boolean(String(p.apiKey || '').trim()),
  }
}

/** GET /api/llm/config */
export function getPublicLlmConfig() {
  const { activeId, profiles } = loadLlmStore()
  if (profiles.length === 0) {
    return { configured: false, activeId: '', profiles: [] }
  }
  return {
    configured: true,
    activeId,
    profiles: profiles.map(toPublicProfile),
  }
}

/**
 * PUT body: { activeId?, profiles: [{ id, name, baseUrl, model, apiKey?, temperature }] }
 * apiKey 为空字符串时保留原 Key
 */
export function putLlmProfiles(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体须为 JSON 对象')
  }
  const incoming = Array.isArray(body.profiles) ? body.profiles : null
  if (!incoming) throw new Error('缺少 profiles 数组')

  const existing = loadLlmStore()
  const byId = new Map(existing.profiles.map((p) => [p.id, p]))

  const profiles = incoming
    .map((raw, i) => {
      const base = normalizeProfile(
        {
          ...raw,
          apiKey:
            raw && typeof raw === 'object' && 'apiKey' in raw
              ? raw.apiKey
              : undefined,
        },
        `profile-${i}`,
      )
      if (!base) return null
      const prev = byId.get(base.id)
      const keyFromClient = String(raw?.apiKey ?? '').trim()
      if (!keyFromClient && prev) {
        base.apiKey = prev.apiKey
      } else {
        base.apiKey = keyFromClient
      }
      return base
    })
    .filter(Boolean)

  return saveLlmStore({
    activeId: body.activeId ?? existing.activeId,
    profiles,
  })
}

export function getLlmConfigPath() {
  return CONFIG_PATH
}
