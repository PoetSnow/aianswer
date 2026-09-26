import { getActiveProfile, isProfileReady } from './lib/llmModels'
import type { LlmModelProfile } from './types'

/** 教学流程可调参数（勿散落魔法数字） */
export const tutorLimits = {
  /** 引导对话轮次上限，超过则揭晓 */
  maxGuideTurns: 8,
  /** 仅兜底路径：同一步连续答错几次后换 hint */
  maxStepMisses: 2,
} as const

/** 当前生效的 LLM（优先界面所选模型，回退 .env） */
export function getLlmConfig(): LlmModelProfile {
  const active = getActiveProfile()
  if (active) return active
  return {
    id: 'fallback',
    name: '未配置',
    baseUrl:
      (import.meta.env.VITE_LLM_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
      'https://api.deepseek.com/v1',
    apiKey: (import.meta.env.VITE_LLM_API_KEY as string | undefined) || '',
    model: (import.meta.env.VITE_LLM_MODEL as string | undefined) || 'deepseek-chat',
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

/** baseUrl + model 即可；本地 vLLM 可无 ApiKey */
export function isLlmConfigured(): boolean {
  return isProfileReady(getActiveProfile())
}
