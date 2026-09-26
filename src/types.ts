export type ChoiceKey = 'A' | 'B' | 'C' | 'D'

/**
 * 引导微步骤：描述教学目标。
 * expectedAnswers 可选，仅作 LLM 不可用时的程序兜底比对。
 */
export interface GuideStep {
  id: string
  /** 本步教学目标 / 意图（给 LLM 与兜底话术） */
  ask: string
  /** 可选：兜底可接受短答；主路径由 LLM assessment 判断 */
  expectedAnswers?: string[]
  /** 可选：降难度意图 */
  hintAsk?: string
}

/** 原题答对后的变式验证题（仍为选择题） */
export interface VariantQuestion {
  stem: string
  options: Record<ChoiceKey, string>
  correctAnswer: ChoiceKey
  solution?: string
}

export interface Question {
  id: string
  stem: string
  options: Record<ChoiceKey, string>
  correctAnswer: ChoiceKey
  tags: string[]
  solution?: string
  /** 答错后的引导计划；缺省则单步问最终结果 */
  guideSteps?: GuideStep[]
  /** 原题答对后进入变式验证；缺省则答对直接解析 */
  variant?: VariantQuestion
}


export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export const CHOICE_KEYS: ChoiceKey[] = ['A', 'B', 'C', 'D']

/** 错题本仍用 localStorage；题库已改为 data/questions.json */
export const WRONG_BOOK_KEY = 'ai-math-tutor-wrong-book'

/** 多模型配置（含 API Key）存浏览器 localStorage，不入库 */
export const LLM_MODELS_KEY = 'ai-math-tutor-llm-models'
export const LLM_ACTIVE_MODEL_KEY = 'ai-math-tutor-llm-active'

/** 一条可切换的 OpenAI 兼容模型配置 */
export interface LlmModelProfile {
  id: string
  /** 界面显示名 */
  name: string
  /** API 根路径，如 https://api.deepseek.com/v1 或 http://host:8066/v1 */
  baseUrl: string
  /** Chat Completions 的 model 字段 */
  model: string
  /** 可为空（部分内网 vLLM 不校验） */
  apiKey: string
  temperature: number
}
