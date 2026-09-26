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
  /**
   * 学科（决定老师人格与教案口吻）。
   * 缺省按「数学」处理，兼容旧题库。
   */
  subject?: string
  solution?: string
  /** 答错后的引导计划；缺省则单步问最终结果 */
  guideSteps?: GuideStep[]
  /**
   * 教案审核状态。
   * - draft：LLM/人工草稿，答题页不用
   * - approved：已通过，答题可用
   * - 缺省且已有 guideSteps：视为历史已审（兼容旧题库）
   */
  guidePlanStatus?: 'draft' | 'approved'
  /** 原题答对后进入变式验证；缺省则答对直接解析 */
  variant?: VariantQuestion
}

/** 题库录入常用学科；也可手填其它 */
export const SUBJECT_OPTIONS = [
  '数学',
  '物理',
  '化学',
  '生物',
  '语文',
  '英语',
  '历史',
  '地理',
  '政治',
] as const

export const DEFAULT_SUBJECT = '数学'


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
  /** 可为空（部分内网 vLLM 不校验）；shared 时浏览器不存真实 Key */
  apiKey: string
  temperature: number
  /** 站点共用：Key 在 data/llm.json，请求带 Profile-Id 由服务端注入 */
  shared?: boolean
  /** 服务端是否已存 Key（GET 列表不回传明文） */
  hasApiKey?: boolean
}
