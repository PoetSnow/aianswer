import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ModelSwitcher from '../components/ModelSwitcher'
import { getLlmConfig, isLlmConfigured, tutorLimits } from '../config'
import {
  LlmNotConfiguredError,
  streamChatCompletion,
  type ChatTurn,
} from '../lib/llm'
import {
  addToWrongBook,
  loadQuestions,
  loadWrongBookIds,
  saveWrongBookIds,
} from '../lib/storage'
import {
  STAGE_LABELS,
  baseSystemPrompt,
  buildCorrectPrompt,
  buildGuideSpeakPrompt,
  buildGuideTurnPrompt,
  buildNarrationPrompt,
  buildReportPrompt,
  buildRevealPrompt,
  clampGuideTurnResult,
  fallbackGuideSpeak,
  fallbackGuideTurn,
  getGuidePlan,
  parseGuideTurnResult,
  type GuideTurnResult,
  type InteractionMode,
} from '../lib/tutor'
import type { ChoiceKey, GuideStep, LlmModelProfile, Question } from '../types'
import { CHOICE_KEYS } from '../types'

const MAX_GUIDE_TURNS = tutorLimits.maxGuideTurns

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string
  hadReasoningField: boolean
  stageLabel?: string
  isStreaming?: boolean
  /** LLM 流式回复才展示思考面板；引导短句不展示 */
  showThink?: boolean
}

type Verdict = 'correct' | 'wrong' | null


function welcomeMessages(): UiMessage[] {
  return [
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '先做选择题。答对后进入变式验证；变式再对才给解析。原题或变式答错则进入分步引导。',
      reasoning: '',
      hadReasoningField: false,
    },
  ]
}

export default function AnswerPage() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<ChoiceKey | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>(welcomeMessages)
  const [mode, setMode] = useState<InteractionMode>('ANSWERING')
  const [stepIndex, setStepIndex] = useState(0)
  const [stepMisses, setStepMisses] = useState(0)
  const [guideTurns, setGuideTurns] = useState(0)
  const [plan, setPlan] = useState<GuideStep[]>([])
  const [confirmedChoice, setConfirmedChoice] = useState<ChoiceKey | null>(null)
  const [verdict, setVerdict] = useState<Verdict>(null)
  const [variantChoice, setVariantChoice] = useState<ChoiceKey | null>(null)
  const [askMastery, setAskMastery] = useState(false)
  const [mastered, setMastered] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [wrongIds, setWrongIds] = useState<string[]>(() => loadWrongBookIds())
  const [error, setError] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<LlmModelProfile | null>(() => getLlmConfig())
  const chatEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stepIndexRef = useRef(0)
  const stepMissesRef = useRef(0)
  const guideTurnsRef = useRef(0)
  const planRef = useRef<GuideStep[]>([])
  stepIndexRef.current = stepIndex
  stepMissesRef.current = stepMisses
  guideTurnsRef.current = guideTurns
  planRef.current = plan

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await loadQuestions()
        if (!cancelled) setQuestions(list)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `无法加载题库：${err.message}`
              : '无法加载题库',
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (stageTimerRef.current) clearInterval(stageTimerRef.current)
    }
  }, [])

  const current = questions[index]
  const wrongQuestions = questions.filter((q) => wrongIds.includes(q.id))
  const configured = isLlmConfigured()
  const modelLabel = activeModel?.name || activeModel?.model || '未选择'
  const answering = mode === 'ANSWERING'
  const varianting = mode === 'VARIANT'
  const guiding = mode === 'GUIDING'
  const completed = mode === 'COMPLETED'
  const currentStep = guiding ? plan[stepIndex] : undefined
  const activeStem =
    varianting && current?.variant ? current.variant.stem : current?.stem
  const activeOptions =
    varianting && current?.variant ? current.variant.options : current?.options
  const activeSelected = varianting ? variantChoice : selected
  const canPickChoice = (answering || varianting) && !streaming
  const canSubmitChoice =
    (answering || varianting) && Boolean(activeSelected) && !streaming

  async function startGuiding(
    question: Question,
    prefaceIntent?: string,
    studentChoice?: ChoiceKey,
  ) {
    const steps = getGuidePlan(question)
    planRef.current = steps
    setPlan(steps)
    stepIndexRef.current = 0
    setStepIndex(0)
    stepMissesRef.current = 0
    setStepMisses(0)
    guideTurnsRef.current = 0
    setGuideTurns(0)
    setAskMastery(false)
    setMode('GUIDING')
    const step = steps[0]
    if (!step) return
    await speakGuideStep({
      question,
      step,
      tone: 'open',
      prefaceIntent,
      studentChoice: studentChoice ?? confirmedChoice ?? undefined,
    })
  }

  function clearStageTimer() {
    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current)
      stageTimerRef.current = null
    }
  }

  function startStageTicker(assistantId: string) {
    clearStageTimer()
    let i = 0
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, stageLabel: STAGE_LABELS[0] } : m)),
    )
    stageTimerRef.current = setInterval(() => {
      i = Math.min(i + 1, STAGE_LABELS.length - 1)
      const label = STAGE_LABELS[i]
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && !m.hadReasoningField ? { ...m, stageLabel: label } : m,
        ),
      )
    }, 900)
  }

  function resetTutorForQuestion() {
    abortRef.current?.abort()
    clearStageTimer()
    setMessages(welcomeMessages())
    setMode('ANSWERING')
    setStepIndex(0)
    stepIndexRef.current = 0
    setStepMisses(0)
    stepMissesRef.current = 0
    setGuideTurns(0)
    guideTurnsRef.current = 0
    setPlan([])
    planRef.current = []
    setConfirmedChoice(null)
    setVerdict(null)
    setVariantChoice(null)
    setAskMastery(false)
    setMastered(false)
    setSelected(null)
    setChatInput('')
    setStreaming(false)
    setError(null)
  }

  function goToQuestion(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= questions.length) return
    setIndex(nextIndex)
    resetTutorForQuestion()
  }

  function handleNextQuestion() {
    if (index >= questions.length - 1) {
      resetTutorForQuestion()
      setError('已经是最后一题了，可在题库添加更多题目。')
      return
    }
    goToQuestion(index + 1)
  }

  function pushUser(text: string) {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        reasoning: '',
        hadReasoningField: false,
      },
    ])
  }

  function pushTeacher(text: string) {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: text,
        reasoning: '',
        hadReasoningField: false,
        showThink: false,
      },
    ])
  }

  /** LLM 润色引导话术（开场）；步骤意图来自题库，失败时回退题库原文 */
  async function speakGuideStep(opts: {
    question: Question
    step: GuideStep
    tone: 'open' | 'retry' | 'confused' | 'advance'
    prefaceIntent?: string
    studentChoice?: ChoiceKey
    previousStudentReply?: string
  }) {
    const fallback = fallbackGuideSpeak({
      step: opts.step,
      tone: opts.tone,
      prefaceIntent: opts.prefaceIntent,
    })

    if (!isLlmConfigured()) {
      pushTeacher(fallback)
      return
    }

    setStreaming(true)
    setError(null)
    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        reasoning: '',
        hadReasoningField: false,
        isStreaming: true,
        showThink: false,
      },
    ])
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    try {
      const result = await streamChatCompletion(
        [
          {
            role: 'system',
            content: '你是有耐心的初中数学私教。只输出对学生说的自然语言，有温度，短一些。',
          },
          {
            role: 'user',
            content: buildGuideSpeakPrompt(opts),
          },
        ],
        (delta) => {
          if (!delta.content) return
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + delta.content }
                : m,
            ),
          )
        },
        ac.signal,
      )
      const cleaned =
        result.content.replace(/^["「]|["」]$/g, '').trim() || fallback
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: cleaned, isStreaming: false }
            : m,
        ),
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: fallback, isStreaming: false }
            : m,
        ),
      )
    } finally {
      setStreaming(false)
    }
  }

  /** 短旁白：答对/切变式/掌握等，意图固定、措辞 LLM */
  async function speakNarration(intent: string, fallback: string, extra?: string) {
    if (!isLlmConfigured()) {
      pushTeacher(fallback)
      return
    }
    setStreaming(true)
    setError(null)
    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        reasoning: '',
        hadReasoningField: false,
        isStreaming: true,
        showThink: false,
      },
    ])
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const result = await streamChatCompletion(
        [
          {
            role: 'system',
            content: '你是有耐心的初中数学私教。只输出对学生说的自然语言，有温度，一两句即可。',
          },
          {
            role: 'user',
            content: buildNarrationPrompt({
              intent,
              questionStem: current?.stem,
              extra,
            }),
          },
        ],
        (delta) => {
          if (!delta.content) return
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + delta.content }
                : m,
            ),
          )
        },
        ac.signal,
      )
      const cleaned =
        result.content.replace(/^["「]|["」]$/g, '').trim() || fallback
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: cleaned, isStreaming: false } : m,
        ),
      )
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: fallback, isStreaming: false } : m,
        ),
      )
    } finally {
      setStreaming(false)
    }
  }

  async function runStreamText(opts: {
    userForLlm: string
    systemExtra?: string
  }) {
    setError(null)
    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        reasoning: '',
        hadReasoningField: false,
        isStreaming: true,
        showThink: true,
        stageLabel: STAGE_LABELS[0],
      },
    ])
    setStreaming(true)
    startStageTicker(assistantId)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    const messagesForApi: ChatTurn[] = [
      {
        role: 'system',
        content: `${baseSystemPrompt()}${opts.systemExtra ? ` ${opts.systemExtra}` : ''}`,
      },
      { role: 'user', content: opts.userForLlm },
    ]

    try {
      const result = await streamChatCompletion(
        messagesForApi,
        (delta) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m
              // 只更新对学生可见的正文；不把模型 reasoning 展示给学生
              // （DeepSeek 等常把「如何满足提示词」写进 reasoning，语义怪异）
              return {
                ...m,
                content: delta.content ? m.content + delta.content : m.content,
              }
            }),
          )
        },
        ac.signal,
      )
      clearStageTimer()
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: result.content.trim() || m.content || '（模型未返回正文）',
                reasoning: '',
                hadReasoningField: false,
                isStreaming: false,
                // 生成结束后收起阶段条，避免像「假思考」
                showThink: false,
                stageLabel: undefined,
              }
            : m,
        ),
      )
    } catch (err) {
      clearStageTimer()
      if (err instanceof DOMException && err.name === 'AbortError') return
      const text =
        err instanceof LlmNotConfiguredError
          ? err.message
          : err instanceof Error
            ? err.message
            : '未知错误'
      setError(text)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, isStreaming: false, showThink: true, content: m.content || `（失败）${text}` }
            : m,
        ),
      )
    } finally {
      clearStageTimer()
      setStreaming(false)
    }
  }

  async function emitExplanation(
    question: Question,
    choice: ChoiceKey,
    opts: {
      afterHints?: boolean
      afterVariant?: boolean
      variantAnswer?: ChoiceKey
    } = {},
  ) {
    setMode('COMPLETED')
    await runStreamText({
      userForLlm: buildCorrectPrompt({
        question,
        studentAnswer: choice,
        afterHints: Boolean(opts.afterHints),
        afterVariant: Boolean(opts.afterVariant),
        variantAnswer: opts.variantAnswer,
      }),
    })
    setAskMastery(true)
    await speakNarration(
      '解析已经给完，温柔地问学生这道题的方法是否掌握了；可提示点「我掌握了」或「还不太懂」。',
      '这道题的方法你掌握了吗？',
    )
  }

  async function emitReveal(question: Question, choice: ChoiceKey) {
    setMode('COMPLETED')
    await runStreamText({
      userForLlm: buildRevealPrompt({ question, studentAnswer: choice }),
    })
    setAskMastery(true)
    await speakNarration(
      '解析看完了，若还不清楚可以选「还不太懂」再走引导；掌握了就点「我掌握了」。',
      '先看完解析。若仍不清楚，可选「还不太懂」再走一遍引导。',
    )
  }

  /** 原题选择题 */
  async function handleSubmitChoice() {
    if (!current || !selected || streaming || !answering) return
    const choice = selected
    setConfirmedChoice(choice)
    pushUser(`我选了 ${choice}。`)

    if (choice === current.correctAnswer) {
      setVerdict('correct')
      if (current.variant) {
        await speakNarration(
          '原题答对了，热情肯定，并说明接下来做一道变式题检验是否真掌握；不要开始讲完整解析。',
          '✅ 原题正确！再做一道变式，检验是否真的掌握。',
        )
        setVariantChoice(null)
        setMode('VARIANT')
        return
      }
      await speakNarration(
        '答对了，简短肯定，并说明下面给出简洁解析。',
        '✅ 回答正确！下面给出简洁解析。',
      )
      await emitExplanation(current, choice, {})
      return
    }

    setVerdict('wrong')
    setWrongIds(addToWrongBook(current.id))
    await startGuiding(
      current,
      '学生刚选错了，不要公布答案，温柔地开始第一步引导',
      choice,
    )
  }

  /** 变式验证 */
  async function handleSubmitVariant() {
    if (!current?.variant || !variantChoice || streaming || !varianting) return
    const choice = variantChoice
    pushUser(`变式我选了 ${choice}。`)

    if (choice === current.variant.correctAnswer) {
      setVerdict('correct')
      await speakNarration(
        '变式也做对了，说明方法比较扎实，简短肯定并说明下面给出解析。',
        '✅ 变式也做对了！说明方法比较扎实，下面给出解析。',
      )
      await emitExplanation(current, confirmedChoice ?? current.correctAnswer, {
        afterVariant: true,
        variantAnswer: choice,
      })
      return
    }

    setVerdict('wrong')
    setWrongIds(addToWrongBook(current.id))
    await startGuiding(
      current,
      '变式没做对，说明方法还不稳，温柔地回到分步引导，不要公布答案',
      confirmedChoice ?? undefined,
    )
  }

  async function handleMastered() {
    setAskMastery(false)
    setMastered(true)
    await speakNarration('学生表示掌握了，简短鼓励，可以说可以进入下一题。', '很好，可以进入下一题了。')
  }

  function handleNotMastered() {
    if (!current) return
    setAskMastery(false)
    setMastered(false)
    setVerdict('wrong')
    void startGuiding(current, '学生说还不太懂，温柔地再带一遍关键步骤')
  }

  /** 通道 B：LLM 结构化 assessment 推进；解析失败才走本地兜底 */
  async function handleGuideSend() {
    if (!current || !confirmedChoice || !guiding || streaming) return
    const text = chatInput.trim()
    if (!text) return

    setChatInput('')
    pushUser(text)

    const steps = planRef.current
    const idx = stepIndexRef.current
    const step = steps[idx]
    if (!step) {
      await emitReveal(current, confirmedChoice)
      return
    }

    const turns = guideTurnsRef.current + 1
    guideTurnsRef.current = turns
    setGuideTurns(turns)

    const isLastStep = idx >= steps.length - 1
    const nextStep = !isLastStep ? steps[idx + 1] : undefined
    const clampOpts = {
      isLastStep,
      turnsUsed: turns,
      maxTurns: MAX_GUIDE_TURNS,
    }

    const localFallback = () =>
      clampGuideTurnResult(
        fallbackGuideTurn({
          studentMessage: text,
          step,
          nextStep,
          isLastStep,
          turnsUsed: turns,
          maxTurns: MAX_GUIDE_TURNS,
        }),
        clampOpts,
      )

    let result: GuideTurnResult = localFallback()

    setStreaming(true)
    setError(null)
    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        reasoning: '',
        hadReasoningField: false,
        isStreaming: true,
        showThink: false,
      },
    ])
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    try {
      if (isLlmConfigured()) {
        const streamResult = await streamChatCompletion(
          [
            {
              role: 'system',
              content:
                '你是初中数学私教。只输出一个 JSON 对象，字段：assessment、shouldAdvance、shouldComplete、shouldReveal、message。',
            },
            {
              role: 'user',
              content: buildGuideTurnPrompt({
                question: current,
                step,
                stepIndex: idx,
                totalSteps: steps.length,
                nextStep,
                studentChoice: confirmedChoice,
                studentMessage: text,
                guideTurnsUsed: turns,
                maxGuideTurns: MAX_GUIDE_TURNS,
              }),
            },
          ],
          (delta) => {
            if (!delta.content) return
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + delta.content }
                  : m,
              ),
            )
          },
          ac.signal,
        )
        const raw = streamResult.content
        const parsed = parseGuideTurnResult(raw)
        result = parsed
          ? clampGuideTurnResult(parsed, clampOpts)
          : localFallback()
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStreaming(false)
        return
      }
      result = localFallback()
    } finally {
      setStreaming(false)
    }

    // 流式阶段可能先打出 JSON；结束后只保留对学生说的 message
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? { ...m, content: result.message, isStreaming: false }
          : m,
      ),
    )

    if (result.assessment === 'wrong' || result.assessment === 'confused') {
      const misses = stepMissesRef.current + 1
      stepMissesRef.current = misses
      setStepMisses(misses)
    } else if (result.assessment === 'correct') {
      stepMissesRef.current = 0
      setStepMisses(0)
    }

    if (result.shouldReveal) {
      await emitReveal(current, confirmedChoice)
      return
    }
    if (result.shouldComplete) {
      await emitExplanation(current, confirmedChoice, { afterHints: true })
      return
    }
    if (result.shouldAdvance) {
      const next = idx + 1
      if (next < steps.length) {
        stepIndexRef.current = next
        setStepIndex(next)
      }
    }
  }

  async function handleTodayReport() {
    if (streaming) return
    if (wrongQuestions.length === 0) {
      setError('错题本为空，先做错几道再生成报告。')
      return
    }
    await runStreamText({
      userForLlm: buildReportPrompt(wrongQuestions),
      systemExtra: '只写学习诊断报告。',
    })
  }

  function clearWrongBook() {
    saveWrongBookIds([])
    setWrongIds([])
  }

  if (!current) {
    return (
      <div className="page">
        <p>
          暂无题目。请先到 <Link to="/">题库页</Link> 添加或恢复示例题。
        </p>
      </div>
    )
  }

  return (
    <div className="page answer-page">
      <header className="topbar">
        <div>
          <p className="brand">智学数学</p>
          <h1>答题辅导</h1>
          <p className="subtitle">
            当前：{modelLabel}
            {configured
              ? activeModel?.apiKey
                ? ' · Key 已填'
                : ' · 无 Key（本地可用）'
              : ' · 未就绪'}
          </p>
          <ModelSwitcher
            disabled={streaming}
            onChange={(p) => {
              setActiveModel(p)
              setError(null)
            }}
          />
        </div>
        <nav className="nav-links">
          <Link to="/">← 题库</Link>
          <button
            type="button"
            className="ghost"
            disabled={streaming}
            onClick={() => void handleTodayReport()}
          >
            今日报告
          </button>
        </nav>
      </header>

      {!configured && (
        <div className="banner warn">
          解析需要模型：请在上方配置 DeepSeek 等（引导步骤本身不依赖模型判题）。
        </div>
      )}
      {error && (
        <div className="banner warn" role="alert">
          {error}
          <button type="button" className="text-btn" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}

      <div className="answer-layout">
        <section className="panel question-pane">
          <div className="row between">
            <h2>
              第 {index + 1} / {questions.length} 题
            </h2>
            <div className="row gap">
              <button
                type="button"
                className="ghost"
                disabled={index === 0 || streaming}
                onClick={() => goToQuestion(index - 1)}
              >
                上一题
              </button>
              <button
                type="button"
                className="ghost"
                disabled={index >= questions.length - 1 || streaming}
                onClick={() => goToQuestion(index + 1)}
              >
                下一题
              </button>
            </div>
          </div>

          <p className="stem">
            {varianting ? <span className="tag">变式验证</span> : null}{' '}
            {activeStem}
          </p>
          {!varianting && current.tags.length > 0 && (
            <p className="tags">
              知识点：
              {current.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </p>
          )}

          <div
            className={`choice-list ${guiding || completed ? 'choice-list-dimmed' : ''}`}
            role="radiogroup"
            aria-label={varianting ? '变式选项' : '选项'}
          >
            {CHOICE_KEYS.map((key) => (
              <label
                key={key}
                className={`choice ${activeSelected === key ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="choice"
                  value={key}
                  checked={activeSelected === key}
                  disabled={!canPickChoice}
                  onChange={() =>
                    varianting ? setVariantChoice(key) : setSelected(key)
                  }
                />
                <span className="choice-key">{key}</span>
                <span>{activeOptions?.[key]}</span>
              </label>
            ))}
          </div>

          {answering && (
            <>
              <button
                type="button"
                className="primary"
                disabled={!canSubmitChoice}
                onClick={() => void handleSubmitChoice()}
              >
                {streaming ? '生成中…' : '确认作答'}
              </button>
              <p className="round-badge">原题 · 选择题</p>
            </>
          )}
          {varianting && (
            <>
              <button
                type="button"
                className="primary"
                disabled={!canSubmitChoice}
                onClick={() => void handleSubmitVariant()}
              >
                {streaming ? '生成中…' : '确认变式'}
              </button>
              <p className="round-badge">变式验证 · 答对再给解析，答错进引导</p>
            </>
          )}
          {verdict === 'correct' && !varianting && (
            <p className="round-badge verdict-ok" aria-live="polite">
              ✅ 回答正确
              {confirmedChoice ? ` · 原题选 ${confirmedChoice}` : ''}
              {variantChoice ? ` · 变式选 ${variantChoice}` : ''}
            </p>
          )}
          {verdict === 'wrong' && (
            <p className="round-badge verdict-bad" aria-live="polite">
              ❌ 未通过
              {guiding ? ' · 进入引导' : ''}
            </p>
          )}
          {guiding && currentStep && (
            <p className="round-badge" aria-live="polite">
              分步引导 · 步骤 {stepIndex + 1}/{plan.length}
              {stepMisses > 0 ? ` · 本步已错 ${stepMisses}` : ''}
              {` · 引导 ${guideTurns}/${MAX_GUIDE_TURNS}`}
            </p>
          )}
          {completed && mastered && (
            <p className="round-badge done">已掌握 · 可下一题</p>
          )}
          {completed && !mastered && !askMastery && (
            <p className="round-badge done">本题已完成 · 见右侧解析</p>
          )}
        </section>

        <section className="panel chat-pane">
          <div className="row between">
            <h2>{guiding ? '老师引导' : 'AI 辅导'}</h2>
            <span className="round-pill">{mode}</span>
          </div>

          <div className="chat-log">
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                {m.role === 'assistant' && m.id !== 'welcome' && m.showThink && m.isStreaming && (
                  <details className="think-panel" open>
                    <summary>生成中</summary>
                    <div className="think-body">
                      <ul className="stage-list">
                        {STAGE_LABELS.map((label, idx) => {
                          const activeIdx = Math.max(
                            0,
                            STAGE_LABELS.indexOf(
                              (m.stageLabel as (typeof STAGE_LABELS)[number]) ??
                                STAGE_LABELS[0],
                            ),
                          )
                          const cls =
                            idx === activeIdx ? 'active' : idx < activeIdx ? 'done' : ''
                          return (
                            <li key={label} className={cls}>
                              {label}
                              {idx === activeIdx ? ' …' : ''}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </details>
                )}
                <div className="bubble-body">
                  {m.content || (m.isStreaming ? '…' : '')}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {completed && askMastery && !streaming && (
            <div className="mastery-row">
              <button type="button" className="primary" onClick={() => void handleMastered()}>
                我掌握了
              </button>
              <button type="button" className="ghost" onClick={handleNotMastered}>
                还不太懂
              </button>
            </div>
          )}

          {completed && mastered && (
            <button
              type="button"
              className="next-cta"
              disabled={streaming}
              onClick={handleNextQuestion}
            >
              下一题 →
            </button>
          )}

          {completed && !askMastery && !mastered && (
            <button
              type="button"
              className="next-cta"
              disabled={streaming}
              onClick={handleNextQuestion}
            >
              下一题 →
            </button>
          )}

          {guiding && !streaming && (
            <form
              className="chat-input-row"
              onSubmit={(e) => {
                e.preventDefault()
                void handleGuideSend()
              }}
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="回答当前步骤，例如 8；不懂就说「不懂」"
                aria-label="引导回答"
                autoFocus
              />
              <button type="submit" className="primary" disabled={!chatInput.trim()}>
                发送
              </button>
            </form>
          )}

          {answering && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              答对 → 变式验证；变式再对 → 解析 → 确认是否掌握。答错或变式错 → 分步引导。
            </p>
          )}
          {varianting && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              这是变式题：换了数字/表述，考同一方法。
            </p>
          )}
        </section>
      </div>

      <section className="panel wrong-book">
        <div className="row between">
          <h2>错题本（{wrongQuestions.length}）</h2>
          {wrongQuestions.length > 0 && (
            <button type="button" className="ghost" onClick={clearWrongBook}>
              清空
            </button>
          )}
        </div>
        {wrongQuestions.length === 0 ? (
          <p className="muted">答错的题目会自动出现在这里。</p>
        ) : (
          <ul className="wrong-list">
            {wrongQuestions.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    const i = questions.findIndex((x) => x.id === q.id)
                    if (i >= 0) goToQuestion(i)
                  }}
                >
                  {q.stem}
                </button>
                <span className="muted">
                  {q.tags.length ? q.tags.join('、') : '无标签'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
