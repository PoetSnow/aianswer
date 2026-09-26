import { getActiveProfile, isProfileReady } from './lib/llmModels'
import { getCachedServerSharedProfile, getServerLlmState } from './lib/serverLlm'
import type { LlmModelProfile } from './types'

/** 教学流程可调参数（勿散落魔法数字） */
export const tutorLimits = {
  /** 引导对话轮次上限，超过则揭晓 */
  maxGuideTurns: 8,
  /** 仅兜底路径：同一步连续答错几次后换 hint */
  maxStepMisses: 2,
} as const

/** 当前生效的 LLM（data/llm.json 经 API 同步） */
export function getLlmConfig(): LlmModelProfile {
  const active = getActiveProfile()
  if (active && isProfileReady(active)) return active

  const shared = getCachedServerSharedProfile()
  if (shared) return shared

  return {
    id: 'fallback',
    name: '未配置',
    baseUrl: (import.meta.env.VITE_LLM_BASE_URL as string | undefined)?.replace(/\/$/, '') || '',
    apiKey: (import.meta.env.VITE_LLM_API_KEY as string | undefined) || '',
    model: (import.meta.env.VITE_LLM_MODEL as string | undefined) || '',
    temperature: 0.7,
  }
}

/** @deprecated 请用 getLlmConfig()；保留字段兼容旧引用 */
export const llmConfig = {
  get baseUrl() {
    return getLlmConfig().baseUrl
  },
  get apiKey() {
    return getLlmConfig().apiKey
  },
  get model() {
    return getLlmConfig().model
  },
}

export function isLlmConfigured(): boolean {
  if (getServerLlmState().profiles.some(isProfileReady)) return true
  return isProfileReady(getActiveProfile())
}
