import { tutorLimits } from '../config'
import type { ChoiceKey, GuideStep, Question } from '../types'
import { CHOICE_KEYS, DEFAULT_SUBJECT } from '../types'

export type InteractionMode = 'ANSWERING' | 'VARIANT' | 'GUIDING' | 'COMPLETED'

export type GuideAssessment = 'correct' | 'wrong' | 'confused' | 'off_topic'

/** LLM 引导轮结构化结果；程序只读字段推进状态 */
export interface GuideTurnResult {
  assessment: GuideAssessment
  /** 进入下一步教学目标 */
  shouldAdvance: boolean
  /** 引导结束 → 出解析 */
  shouldComplete: boolean
  /** 放弃引导 → 完整揭晓 */
  shouldReveal: boolean
  /** 对学生说的话 */
  message: string
}

export type GuideInputIntent = 'CONFUSED' | 'ANSWER' | 'OFF_TOPIC'

/** @deprecated 用 tutorLimits.maxStepMisses */
export const MAX_STEP_MISSES = tutorLimits.maxStepMisses

const CONFUSED_RE =
  /不懂|不会|没明白|看不懂|不理解|不知道|还是不会|还是不懂|有点懵|没跟上/

const OFF_TOPIC_RE =
  /^(讲个)?笑话$|搞笑一下|闲聊|今天天气|星座运势|陪我玩|你是谁|你叫什么/

/** 粗筛：高确定性才用；真正分类交给 LLM assessment */
export function isConfused(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return CONFUSED_RE.test(t)
}

export function classifyGuideInput(text: string): GuideInputIntent {
  const t = text.trim()
  if (!t) return 'OFF_TOPIC'
  if (isConfused(t)) return 'CONFUSED'
  if (OFF_TOPIC_RE.test(t)) return 'OFF_TOPIC'
  return 'ANSWER'
}

export function normalizeAnswer(raw: string): string {
  let s = raw.trim().toLowerCase()
  s = s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
  s = s.replace(/[－—–]/g, '-')
  s = s.replace(/\s+/g, '')
  s = s.replace(/两边|同时|应该|我觉得|大概|可能/g, '')
  s = s.replace(/等于/g, '=')
  s = s.replace(/减去?/g, '-')
  s = s.replace(/加上?/g, '+')
  s = s.replace(/除以?/g, '/')
  s = s.replace(/乘以?/g, '*')
  if (s === '减法' || s === '减') s = '-'
  if (s === '加法' || s === '加') s = '+'
  if (s === '除法' || s === '除') s = '/'
  if (s === '乘法' || s === '乘') s = '*'
  return s
}

/** 兜底比对：仅 LLM 不可用或 JSON 解析失败时使用 */
export function answersMatch(student: string, expectedList: string[] | undefined): boolean {
  if (!expectedList || expectedList.length === 0) return false
  const got = normalizeAnswer(student)
  if (!got) return false
  return expectedList.some((exp) => {
    const e = normalizeAnswer(exp)
    if (!e) return false
    if (got === e) return true
    const gotNum = /^-?\d+(\.\d+)?$/.test(got)
    const expNum = /^-?\d+(\.\d+)?$/.test(e)
    if (gotNum && expNum) return got === e
    if (gotNum) {
      if (e.endsWith(`=${got}`)) return true
      const eCore = e.replace(/(cm²|cm2|㎡|cm|米|度|%|倍)$/i, '')
      return eCore === got
    }
    if (expNum && got.endsWith(`=${e}`)) return true
    return false
  })
}

function optionValueCandidates(question: Question): string[] {
  const key = question.correctAnswer
  const opt = question.options[key]
  const cands = new Set<string>([key, key.toLowerCase()])
  if (opt) {
    cands.add(opt.trim())
    const num = opt.match(/-?\d+(?:\.\d+)?/)
    if (num) cands.add(num[0])
    const stripped = opt.replace(/\s*(cm²|cm2|㎡|cm|米|度|%|倍).*$/i, '').trim()
    if (stripped) cands.add(stripped)
  }
  return [...cands]
}

export function questionSubject(question: Question): string {
  const s = question.subject?.trim()
  return s || DEFAULT_SUBJECT
}

/** 统一老师人格：跟题目学科走 */
export function tutorSystemPrompt(
  question: Question,
  style: 'teacher' | 'tutor' | 'planner' = 'teacher',
): string {
  const subject = questionSubject(question)
  if (style === 'planner') {
    return `你是初中${subject}教研员。根据题目写「分步引导教案」草稿，供老师审核。只输出 JSON，不要复述写作要求。`
  }
  if (style === 'tutor') {
    return `你是有耐心的初中${subject}私教。对学生只写自然、简洁的中文，有温度；不要复述写作要求。`
  }
  return `你是初中${subject}老师。对学生只写自然、简洁的中文，不要复述写作要求。`
}

export function isGuidePlanApproved(question: Question): boolean {
  if (!question.guideSteps || question.guideSteps.length === 0) return false
  if (question.guidePlanStatus === 'draft') return false
  // approved，或旧题库未写 status
  return true
}

export function getGuidePlan(question: Question): GuideStep[] {
  if (isGuidePlanApproved(question) && question.guideSteps) {
    return question.guideSteps
  }
  return [
    {
      id: 'final',
      ask: '引导学生求出本题最终关键结果（数字或正确选项）',
      expectedAnswers: optionValueCandidates(question),
      hintAsk: '把问题拆得更小，仍对准最终结果',
    },
  ]
}

/** 题库：根据题干生成 guideSteps 草稿 */
export function buildGuidePlanDraftPrompt(question: Question): string {
  const subject = questionSubject(question)
  const optionLines = CHOICE_KEYS.map((k) => `${k}. ${question.options[k]}`).join('\n')
  return [
    `学科：${subject}。按该学科的教法拆步骤，不要套用其它学科的术语习惯。`,
    '学生答错选择题后，会按这些步骤短问答引导，不要一次问出最终选项字母。',
    '',
    `题干：${question.stem}`,
    optionLines,
    `正确答案：${question.correctAnswer}`,
    `标签：${question.tags.join('、') || '（无）'}`,
    '',
    '没有标准解析：请根据题干、选项与正确答案自行推断合理分步。',
    '',
    '输出要求：只输出一个 JSON 数组（不要 Markdown 围栏），2～4 步，例如：',
    '[',
    '  {',
    '    "id": "step-1",',
    '    "ask": "本步教学目标（一句话，可写成对学生的小问题）",',
    '    "expectedAnswers": ["可选参考短答1", "短答2"],',
    '    "hintAsk": "答错时更简单的问法（可选）"',
    '  }',
    ']',
    '规则：',
    '- ask 写清「这一步要学生想到什么」，不要剧透最终选项字母',
    '- expectedAnswers 给 1～4 个可接受短答，供程序兜底',
    '- 最后一步对准最终结论，仍尽量不要求学生答选项字母',
    '- 步骤由易到难，贴合该学科解析',
  ].join('\n')
}

export function parseGuidePlanDraft(raw: string): GuideStep[] | null {
  const trimmed = raw.trim()
  let text = trimmed
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  else {
    const start = trimmed.indexOf('[')
    const end = trimmed.lastIndexOf(']')
    if (start >= 0 && end > start) text = trimmed.slice(start, end + 1)
  }
  try {
    const arr = JSON.parse(text) as unknown
    if (!Array.isArray(arr) || arr.length === 0) return null
    const steps: GuideStep[] = []
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i] as Record<string, unknown>
      if (!s || typeof s !== 'object') continue
      const ask = String(s.ask ?? '').trim()
      if (!ask) continue
      const expectedRaw = s.expectedAnswers
      const expectedAnswers = Array.isArray(expectedRaw)
        ? expectedRaw.map((a) => String(a).trim()).filter(Boolean)
        : undefined
      const hintAsk = String(s.hintAsk ?? '').trim()
      steps.push({
        id: typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `step-${i + 1}`,
        ask,
        ...(expectedAnswers && expectedAnswers.length > 0 ? { expectedAnswers } : {}),
        ...(hintAsk ? { hintAsk } : {}),
      })
    }
    return steps.length > 0 ? steps : null
  } catch {
    return null
  }
}

export function baseSystemPrompt(question?: Question): string {
  if (question) return tutorSystemPrompt(question, 'teacher')
  return `你是初中${DEFAULT_SUBJECT}老师。对学生只写自然、简洁的中文，不要复述写作要求。`
}

/** 开场 / 纯话术润色（无学生本轮作答） */
export function buildGuideSpeakPrompt(opts: {
  question: Question
  step: GuideStep
  tone: 'open' | 'retry' | 'confused' | 'advance'
  studentChoice?: ChoiceKey
  prefaceIntent?: string
  previousStudentReply?: string
}): string {
  const toneLine =
    opts.tone === 'open'
      ? '学生刚在选择题上答错（或需要引导）。先轻轻接住情绪，再只抛出当前这一步的小问题。'
      : opts.tone === 'advance'
        ? '学生对上一步答对了。先真诚肯定一句，再自然引出下一步小问题。'
        : opts.tone === 'confused'
          ? '学生说不太懂。更耐心、更小步地换一种问法。'
          : '学生对当前这一步答得不对。不要指责，换更简单的问法。'

  return [
    '【话术】步骤意图固定，你写有温度的人话。',
    `学科：${questionSubject(opts.question)}`,
    toneLine,
    opts.prefaceIntent ? `开场意图：${opts.prefaceIntent}` : '',
    `本步教学目标：${opts.step.ask}`,
    opts.step.hintAsk && (opts.tone === 'retry' || opts.tone === 'confused')
      ? `降难度参考：${opts.step.hintAsk}`
      : '',
    opts.studentChoice ? `学生选择题曾选：${opts.studentChoice}` : '',
    opts.previousStudentReply ? `学生刚说：${opts.previousStudentReply}` : '',
    `题目：${opts.question.stem}`,
    '',
    '只输出对学生说的中文；禁止泄露正确选项字母与最终答案；一次只问当前一小步。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function fallbackGuideSpeak(opts: {
  step: GuideStep
  tone: 'open' | 'retry' | 'confused' | 'advance'
  prefaceIntent?: string
}): string {
  const ask =
    (opts.tone === 'retry' || opts.tone === 'confused') && opts.step.hintAsk?.trim()
      ? opts.step.hintAsk.trim()
      : opts.step.ask
  if (opts.tone === 'advance') return `做对了！\n\n${ask}`
  if (opts.prefaceIntent) return `${opts.prefaceIntent}\n\n${ask}`
  return ask
}

/**
 * 引导轮输出协议（一次调用、可流式）：
 * 1) 先写对学生说的自然语言
 * 2) 空行后写分隔符 ---JSON---
 * 3) 再写控制面 JSON（不含对学生正文）
 * 流式时 UI 只展示分隔符之前的人话。
 */
export const GUIDE_TURN_JSON_MARK = '---JSON---'

/**
 * 学生回复后的引导轮：LLM 同时给 assessment + 话术。
 * 程序只读字段，不自行用正则判语义（正则仅兜底）。
 */
export function buildGuideTurnPrompt(opts: {
  question: Question
  step: GuideStep
  stepIndex: number
  totalSteps: number
  nextStep?: GuideStep
  studentChoice?: ChoiceKey
  studentMessage: string
  guideTurnsUsed: number
  maxGuideTurns: number
}): string {
  const isLast = opts.stepIndex >= opts.totalSteps - 1
  const nearLimit = opts.guideTurnsUsed >= opts.maxGuideTurns - 1

  return [
    '【引导轮】先写对学生说的话，再写控制 JSON。',
    `学科：${questionSubject(opts.question)}（按该学科判断对错与表述）`,
    `题目：${opts.question.stem}`,
    `标准解析（仅供你判断，勿直接甩给学生）：${opts.question.solution?.trim() || '（无）'}`,
    `选择题正确答案字母（勿提前泄露）：${opts.question.correctAnswer}`,
    opts.studentChoice ? `学生最初选项：${opts.studentChoice}` : '',
    `当前步骤 ${opts.stepIndex + 1}/${opts.totalSteps} 教学目标：${opts.step.ask}`,
    opts.step.hintAsk ? `降难度参考：${opts.step.hintAsk}` : '',
    opts.step.expectedAnswers?.length
      ? `参考正解示例（学生说法可不同，请语义判断）：${opts.step.expectedAnswers.join(' / ')}`
      : '无参考示例，请根据教学目标语义判断对错。',
    opts.nextStep && !isLast
      ? `若本步正确，下一步教学目标是：${opts.nextStep.ask}`
      : '',
    `学生本轮说：${opts.studentMessage}`,
    `已用引导轮次：${opts.guideTurnsUsed}/${opts.maxGuideTurns}`,
    isLast ? '这是最后一步教学目标。' : '',
    nearLimit ? '轮次将尽：若仍不对可考虑 shouldReveal=true。' : '',
    '',
    '严格按下面格式输出（不要 Markdown 围栏）：',
    '（第一段：对学生说的中文，温暖自然；若本步正确且有下一步，须含肯定并引出下一步）',
    GUIDE_TURN_JSON_MARK,
    '{',
    '  "assessment": "correct" | "wrong" | "confused" | "off_topic",',
    '  "shouldAdvance": boolean,',
    '  "shouldComplete": boolean,',
    '  "shouldReveal": boolean',
    '}',
    '规则：',
    '- 第一段只能是对学生说的话，禁止出现 JSON、字段名、分隔符',
    '- assessment=correct：本步目标已达成（允许「负三」「-3」「3的相反数」等等价说法）',
    '- assessment=wrong：未达成，继续本步或降难度问',
    '- assessment=confused：听不懂，换更小步问法',
    '- assessment=off_topic：明显跑题，拉回本题；此时 shouldAdvance/Complete/Reveal 都必须 false',
    '- shouldAdvance：仅 correct 且还有下一步时可为 true',
    '- shouldComplete：最后一步也 correct，或引导已可收束出解析',
    '- shouldReveal：多次失败建议揭晓完整解；与 shouldComplete 不要同时 true',
    '- 禁止在第一段泄露正确选项字母（除非 shouldReveal/shouldComplete 进入收束）',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 流式展示：只保留分隔符之前的人话；并去掉尚未写完的分隔符前缀 */
export function extractGuideTurnVisible(raw: string): string {
  const mark = GUIDE_TURN_JSON_MARK
  const idx = raw.indexOf(mark)
  if (idx >= 0) return raw.slice(0, idx).replace(/\s+$/, '')
  for (let n = Math.min(mark.length - 1, raw.length); n > 0; n--) {
    if (raw.endsWith(mark.slice(0, n))) {
      return raw.slice(0, -n).replace(/\s+$/, '')
    }
  }
  return raw
}

function parseGuideControlJson(jsonText: string): Omit<GuideTurnResult, 'message'> | null {
  let text = jsonText.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  else {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) text = text.slice(start, end + 1)
  }
  try {
    const o = JSON.parse(text) as Record<string, unknown>
    const assessment = String(o.assessment ?? '') as GuideAssessment
    if (!['correct', 'wrong', 'confused', 'off_topic'].includes(assessment)) {
      return null
    }
    return {
      assessment,
      shouldAdvance: Boolean(o.shouldAdvance),
      shouldComplete: Boolean(o.shouldComplete),
      shouldReveal: Boolean(o.shouldReveal),
    }
  } catch {
    return null
  }
}

export function parseGuideTurnResult(raw: string): GuideTurnResult | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const markIdx = trimmed.indexOf(GUIDE_TURN_JSON_MARK)
  if (markIdx >= 0) {
    const message = trimmed.slice(0, markIdx).trim()
    const control = parseGuideControlJson(
      trimmed.slice(markIdx + GUIDE_TURN_JSON_MARK.length),
    )
    if (!control || !message) return null
    return { ...control, message }
  }

  // 兼容旧格式：整段纯 JSON 且含 message
  const control = parseGuideControlJson(trimmed)
  if (!control) return null
  try {
    let jsonText = trimmed
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence) jsonText = fence[1].trim()
    else {
      const start = trimmed.indexOf('{')
      const end = trimmed.lastIndexOf('}')
      if (start >= 0 && end > start) jsonText = trimmed.slice(start, end + 1)
    }
    const o = JSON.parse(jsonText) as Record<string, unknown>
    const message = String(o.message ?? '').trim()
    if (!message) return null
    return { ...control, message }
  } catch {
    return null
  }
}

/** 程序安全钳制：防止 LLM 乱推进 */
export function clampGuideTurnResult(
  result: GuideTurnResult,
  opts: { isLastStep: boolean; turnsUsed: number; maxTurns: number },
): GuideTurnResult {
  let { assessment, shouldAdvance, shouldComplete, shouldReveal, message } = result

  if (assessment === 'off_topic') {
    return {
      assessment,
      shouldAdvance: false,
      shouldComplete: false,
      shouldReveal: false,
      message: message || GUIDE_OFF_TOPIC_REDIRECT,
    }
  }

  if (assessment !== 'correct') {
    shouldAdvance = false
    shouldComplete = false
  }

  if (shouldAdvance && opts.isLastStep) {
    shouldAdvance = false
    shouldComplete = true
  }

  if (shouldComplete && shouldReveal) {
    shouldReveal = false
  }

  if (opts.turnsUsed >= opts.maxTurns && assessment !== 'correct') {
    shouldReveal = true
    shouldComplete = false
    shouldAdvance = false
  }

  return { assessment, shouldAdvance, shouldComplete, shouldReveal, message }
}

/** LLM 失败时的本地兜底判断 */
export function fallbackGuideTurn(opts: {
  studentMessage: string
  step: GuideStep
  nextStep?: GuideStep
  isLastStep: boolean
  turnsUsed: number
  maxTurns: number
}): GuideTurnResult {
  const intent = classifyGuideInput(opts.studentMessage)
  if (intent === 'OFF_TOPIC') {
    return {
      assessment: 'off_topic',
      shouldAdvance: false,
      shouldComplete: false,
      shouldReveal: false,
      message: GUIDE_OFF_TOPIC_REDIRECT,
    }
  }
  if (intent === 'CONFUSED') {
    const reveal = opts.turnsUsed >= opts.maxTurns
    return {
      assessment: 'confused',
      shouldAdvance: false,
      shouldComplete: false,
      shouldReveal: reveal,
      message: reveal
        ? '没关系，我们直接看完整解法。'
        : opts.step.hintAsk?.trim() || opts.step.ask,
    }
  }
  const ok = answersMatch(opts.studentMessage, opts.step.expectedAnswers)
  if (ok) {
    if (opts.isLastStep) {
      return {
        assessment: 'correct',
        shouldAdvance: false,
        shouldComplete: true,
        shouldReveal: false,
        message: '对，这一步也清楚了。我们看完整解析。',
      }
    }
    const nextAsk = opts.nextStep?.ask?.trim() || '继续想下一步。'
    return {
      assessment: 'correct',
      shouldAdvance: true,
      shouldComplete: false,
      shouldReveal: false,
      message: `对！\n\n${nextAsk}`,
    }
  }
  const reveal = opts.turnsUsed >= opts.maxTurns
  return {
    assessment: 'wrong',
    shouldAdvance: false,
    shouldComplete: false,
    shouldReveal: reveal,
    message: reveal
      ? '我们换种方式，直接看完整解法。'
      : opts.step.hintAsk?.trim() || opts.step.ask,
  }
}

export function buildNarrationPrompt(opts: {
  intent: string
  questionStem?: string
  subject?: string
  extra?: string
}): string {
  return [
    '用一两句有温度的中文对学生说话。',
    opts.subject ? `学科：${opts.subject}` : '',
    `意图（必达，可自由改措辞）：${opts.intent}`,
    opts.questionStem ? `相关题目：${opts.questionStem}` : '',
    opts.extra ?? '',
    '只输出对学生说的话；不要解析整题、不要 JSON、不要复述「意图」二字。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildCorrectPrompt(opts: {
  question: Question
  studentAnswer: ChoiceKey
  afterHints: boolean
  afterVariant?: boolean
  variantAnswer?: ChoiceKey
}): string {
  const optionLines = CHOICE_KEYS.map((k) => `${k}. ${opts.question.options[k]}`).join('\n')
  const variant = opts.question.variant
  const wrong =
    opts.studentAnswer !== opts.question.correctAnswer
      ? `学生曾选 ${opts.studentAnswer}（不对），正确是 ${opts.question.correctAnswer}。先肯定其努力，再纠正。`
      : `学生选对了 ${opts.studentAnswer}。`

  const hintLine = opts.afterHints
    ? '可提一句：刚才按步骤想清楚了。'
    : opts.afterVariant
      ? '可提一句：原题和变式都过了。'
      : ''

  const variantBlock =
    opts.afterVariant && variant
      ? [
          '',
          '变式也做对了：',
          `变式：${variant.stem}`,
          CHOICE_KEYS.map((k) => `${k}. ${variant.options[k]}`).join('\n'),
          `变式选 ${opts.variantAnswer ?? variant.correctAnswer}，正确 ${variant.correctAnswer}`,
          `变式解析：${variant.solution?.trim() || '（无）'}`,
        ].join('\n')
      : ''

  return [
    '写一段给学生看的解析（纯正文）：',
    `学科：${questionSubject(opts.question)}`,
    wrong,
    hintLine,
    '开头可用一句很短的肯定（若选对），紧接着写清关键步骤，结尾点明正确选项字母。',
    '不要提问、不要写元话语、不要单独再问「掌握了吗」（界面会提供按钮）。',
    '',
    `题目：${opts.question.stem}`,
    optionLines,
    opts.question.solution?.trim()
      ? `参考解析：${opts.question.solution.trim()}`
      : '无参考解析：请根据题干与选项自行写清理由。',
    variantBlock,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildRevealPrompt(opts: {
  question: Question
  studentAnswer: ChoiceKey
}): string {
  const optionLines = CHOICE_KEYS.map((k) => `${k}. ${opts.question.options[k]}`).join('\n')
  return [
    '引导多次仍未完成。给学生写完整解析与正确选项，语气温和。不要提问。',
    `学科：${questionSubject(opts.question)}`,
    '',
    `题目：${opts.question.stem}`,
    optionLines,
    `学生曾选：${opts.studentAnswer}`,
    `正确答案：${opts.question.correctAnswer}`,
    `标准解析：${opts.question.solution?.trim() || '（无）'}`,
  ].join('\n')
}

export function buildReportPrompt(wrongQuestions: Question[]): string {
  const lines = wrongQuestions.map((q, i) => {
    const tags = q.tags.length ? q.tags.join('、') : '未标注'
    const subject = questionSubject(q)
    return `${i + 1}. [${subject}] ${q.stem.slice(0, 60)}…｜标签：${tags}`
  })
  return [
    '请根据学生今日错题的学科与知识点标签，用简洁中文写一份「今日学习诊断报告」。',
    '指出薄弱知识点、给出 2–3 条复习建议、鼓励收尾。不要逐题公布正确答案。',
    '',
    '错题列表：',
    ...lines,
  ].join('\n')
}

export const GUIDE_OFF_TOPIC_REDIRECT =
  '请直接回答老师当前这一步的问题（例如填一个数），或者说「不懂」。'

export const STAGE_LABELS = ['对照知识点', '组织解析', '生成回复'] as const
