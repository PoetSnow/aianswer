import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isLlmConfigured, llmConfig } from '../config'
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
import type { ChoiceKey, Question } from '../types'
import { CHOICE_KEYS } from '../types'

const MAX_GUIDE_ROUNDS = 3
const OFF_TOPIC_REDIRECT =
  '我们先专注这一道题哦～请围绕题目的条件、选项或知识点来提问（例如「这一步怎么想」「我不懂」）。'

const STAGE_LABELS = ['对照知识点', '组织引导', '生成回复'] as const

type TutorPhase =
  | 'idle'
  | 'explaining'
  | 'correct_done'
  | 'wrong_tutoring'
  | 'revealed'

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 模型 reasoning 字段；无则空，UI 用阶段标签代替 */
  reasoning: string
  hadReasoningField: boolean
  /** 流式时用的阶段标签（无 reasoning 时） */
  stageLabel?: string
  isStreaming?: boolean
}

function questionBlock(question: Question, selected: ChoiceKey): string {
  const optionLines = CHOICE_KEYS.map((k) => `${k}. ${question.options[k]}`).join('\n')
  const tags = question.tags.length ? question.tags.join('、') : '（未标注）'
  const solution = question.solution?.trim() || '（无标准解析，请自行推导完整步骤）'
  return [
    `题目：${question.stem}`,
    optionLines,
    `学生选择：${selected}`,
    `正确答案：${question.correctAnswer}`,
    `知识点标签：${tags}`,
    `标准解析：${solution}`,
  ].join('\n')
}

function baseSystemPrompt(): string {
  return [
    '你是一位耐心的初中数学私教，只用中文讲解当前这道选择题。',
    '语气温暖鼓励。严禁闲聊、讲笑话、谈天气或与本题无关的话题。',
    '若学生偏离题目，只简短把话题拉回本题，不要回答闲聊内容。',
  ].join('')
}

function buildCorrectPrompt(question: Question, selected: ChoiceKey): string {
  return [
    '学生刚刚答对了。请：',
    '1) 先鼓励肯定；',
    '2) 给出完整解题思路与最终答案（优先展开「标准解析」，写清步骤）；',
    '3) 点出知识点。',
    '',
    questionBlock(question, selected),
  ].join('\n')
}

function buildWrongRoundPrompt(
  question: Question,
  selected: ChoiceKey,
  round: number,
  studentFollowUp?: string,
): string {
  const block = questionBlock(question, selected)
  const follow = studentFollowUp
    ? `\n学生本轮补充说：${studentFollowUp}\n`
    : '\n'

  if (round === 1) {
    return [
      '【引导第 1/3 轮】学生刚答错。请：',
      '1) 肯定尝试；',
      '2) 点出知识点标签；',
      '3) 用 1–2 个苏格拉底式问题引导，可给轻微提示；',
      '4) **严禁**说出正确选项字母或「答案是 X」。',
      follow,
      block,
    ].join('\n')
  }

  if (round === 2) {
    return [
      '【引导第 2/3 轮】学生仍未掌握。请：',
      '1) 给出更强的思路提示（关键步骤、易错点）；',
      '2) 仍尽量**不要**直接公布正确选项字母；',
      '3) 可再提一个引导问题。',
      follow,
      block,
    ].join('\n')
  }

  return [
    '【引导第 3/3 轮·最终讲解】请给出完整解析与正确答案（写明正确选项字母），',
    '步骤清晰，语气鼓励。这是本轮最后一次辅导。',
    follow,
    block,
  ].join('\n')
}

function buildReportPrompt(wrongQuestions: Question[]): string {
  const lines = wrongQuestions.map((q, i) => {
    const tags = q.tags.length ? q.tags.join('、') : '未标注'
    return `${i + 1}. ${q.stem.slice(0, 60)}…｜标签：${tags}`
  })
  return [
    '请根据学生今日错题的知识点标签，用简洁中文写一份「今日学习诊断报告」。',
    '要求：指出薄弱知识点、给出 2–3 条复习建议、鼓励收尾。不要逐题公布正确答案。',
    '只谈学习诊断，不要闲聊。',
    '',
    '错题列表：',
    ...lines,
  ].join('\n')
}

/** 轻量离题检测；「不懂」等学习相关不算离题 */
function isOffTopic(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/不懂|不会|为什么|怎么|思路|选项|题目|知识点|提示|再讲|解析|帮我/.test(t)) {
    return false
  }
  if (
    /笑话|搞笑|聊天|闲聊|天气|星座|八卦|游戏|唱歌|写诗|你是谁|你叫什么|讲个故事|陪我玩|今天吃什么/.test(
      t,
    )
  ) {
    return true
  }
  // 很短且无数学/题目痕迹
  if (t.length <= 4 && !/[ABCD选项方程面积周长计算加减乘除]/.test(t)) {
    return true
  }
  return false
}

function welcomeMessages(): UiMessage[] {
  return [
    {
      id: 'welcome',
      role: 'assistant',
      content: '你好！选好选项后点「确认」。答错时我会分最多 3 轮引导你；答对会直接讲完整思路。',
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
  const [llmTurns, setLlmTurns] = useState<ChatTurn[]>([])
  const [phase, setPhase] = useState<TutorPhase>('idle')
  const [guideRound, setGuideRound] = useState(0)
  const [confirmedChoice, setConfirmedChoice] = useState<ChoiceKey | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [wrongIds, setWrongIds] = useState<string[]>(() => loadWrongBookIds())
  const [error, setError] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
              ? `无法加载题库：${err.message}（请确认 npm run dev 已启动，题库来自 data/questions.json）`
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
  const showNextCta = phase === 'correct_done' || phase === 'revealed'
  const chatEnabled =
    phase === 'wrong_tutoring' && guideRound > 0 && guideRound < MAX_GUIDE_ROUNDS && !streaming

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
      prev.map((m) =>
        m.id === assistantId ? { ...m, stageLabel: STAGE_LABELS[0] } : m,
      ),
    )
    stageTimerRef.current = setInterval(() => {
      i = Math.min(i + 1, STAGE_LABELS.length - 1)
      const label = STAGE_LABELS[i]
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && !m.hadReasoningField
            ? { ...m, stageLabel: label }
            : m,
        ),
      )
    }, 900)
  }

  function resetTutorForQuestion() {
    abortRef.current?.abort()
    clearStageTimer()
    setMessages(welcomeMessages())
    setLlmTurns([])
    setPhase('idle')
    setGuideRound(0)
    setConfirmedChoice(null)
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

  async function runAssistantTurn(opts: {
    displayUserText: string | null
    userForLlm: string
    systemExtra?: string
    priorTurns?: ChatTurn[]
    onDone?: () => void
  }) {
    setError(null)
    const assistantId = crypto.randomUUID()
    setMessages((prev) => {
      const next = [...prev]
      if (opts.displayUserText) {
        next.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: opts.displayUserText,
          reasoning: '',
          hadReasoningField: false,
        })
      }
      next.push({
        id: assistantId,
        role: 'assistant',
        content: '',
        reasoning: '',
        hadReasoningField: false,
        isStreaming: true,
        stageLabel: STAGE_LABELS[0],
      })
      return next
    })
    setStreaming(true)
    startStageTicker(assistantId)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const baseTurns: ChatTurn[] = [
      {
        role: 'system',
        content: baseSystemPrompt() + (opts.systemExtra ? ` ${opts.systemExtra}` : ''),
      },
      ...(opts.priorTurns ?? []),
      { role: 'user', content: opts.userForLlm },
    ]

    try {
      const result = await streamChatCompletion(
        baseTurns,
        (delta) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m
              const next = { ...m }
              if (delta.reasoning) {
                next.hadReasoningField = true
                next.reasoning += delta.reasoning
              }
              if (delta.content) {
                next.content += delta.content
              }
              return next
            }),
          )
        },
        controller.signal,
      )

      clearStageTimer()
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                isStreaming: false,
                hadReasoningField: result.hadReasoningField || m.hadReasoningField,
                reasoning: result.reasoning || m.reasoning,
                content: result.content || m.content || '（模型未返回正文）',
                stageLabel: result.hadReasoningField ? undefined : STAGE_LABELS[2],
              }
            : m,
        ),
      )

      setLlmTurns([
        ...(opts.priorTurns ?? []),
        { role: 'user', content: opts.userForLlm },
        { role: 'assistant', content: result.content },
      ])
      opts.onDone?.()
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
            ? {
                ...m,
                isStreaming: false,
                content:
                  m.content ||
                  `（未能完成流式回复）\n${text}\n请检查 .env 中的 VITE_LLM_* 后重启 npm run dev。`,
              }
            : m,
        ),
      )
    } finally {
      clearStageTimer()
      setStreaming(false)
    }
  }

  async function handleConfirm() {
    if (!current || !selected || streaming) return
    if (phase !== 'idle') return

    const choice = selected
    const isCorrect = choice === current.correctAnswer
    setConfirmedChoice(choice)

    if (!isCorrect) {
      const nextWrong = addToWrongBook(current.id)
      setWrongIds(nextWrong)
      setPhase('wrong_tutoring')
      setGuideRound(1)
      await runAssistantTurn({
        displayUserText: `我选了 ${choice}，好像不太对，能引导我一下吗？`,
        userForLlm: buildWrongRoundPrompt(current, choice, 1),
        systemExtra: '第1轮：禁止公布正确选项字母。只谈本题。',
        priorTurns: [],
      })
      return
    }

    setPhase('explaining')
    await runAssistantTurn({
      displayUserText: `我选了 ${choice}，请讲完整解题思路和答案。`,
      userForLlm: buildCorrectPrompt(current, choice),
      systemExtra: '学生答对：鼓励并给出完整思路与答案。',
      priorTurns: [],
    })
    setPhase('correct_done')
  }

  async function handleChatSend() {
    if (!current || !confirmedChoice || !chatEnabled) return
    const text = chatInput.trim()
    if (!text) return

    if (isOffTopic(text)) {
      setChatInput('')
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          reasoning: '',
          hadReasoningField: false,
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: OFF_TOPIC_REDIRECT,
          reasoning: '',
          hadReasoningField: false,
        },
      ])
      return
    }

    const nextRound = guideRound + 1
    setChatInput('')
    setGuideRound(nextRound)

    const isFinal = nextRound >= MAX_GUIDE_ROUNDS
    await runAssistantTurn({
      displayUserText: text,
      userForLlm: buildWrongRoundPrompt(current, confirmedChoice, nextRound, text),
      systemExtra: isFinal
        ? '第3轮最终讲解：必须给出完整解析与正确选项。'
        : `第${nextRound}轮：尽量不公布正确选项字母。只谈本题。`,
      priorTurns: llmTurns,
    })
    if (isFinal) setPhase('revealed')
  }

  async function handleTodayReport() {
    if (streaming) return
    if (wrongQuestions.length === 0) {
      setError('错题本为空，先做错几道再生成报告。')
      return
    }
    await runAssistantTurn({
      displayUserText: '请根据我的错题本生成今日学习诊断报告。',
      userForLlm: buildReportPrompt(wrongQuestions),
      systemExtra: '只写学习诊断报告，勿闲聊。',
      priorTurns: [],
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
            模型：{llmConfig.model}
            {configured ? ' · API 已配置' : ' · 未配置 API Key'}
          </p>
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
          尚未配置 LLM。复制 <code>.env.example</code> 为 <code>.env</code>，填写{' '}
          <code>VITE_LLM_API_KEY</code> 等后重启开发服务器。
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

          <p className="stem">{current.stem}</p>
          {current.tags.length > 0 && (
            <p className="tags">
              知识点：
              {current.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </p>
          )}

          <div className="choice-list" role="radiogroup" aria-label="选项">
            {CHOICE_KEYS.map((key) => (
              <label
                key={key}
                className={`choice ${selected === key ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="choice"
                  value={key}
                  checked={selected === key}
                  disabled={phase !== 'idle' || streaming}
                  onChange={() => setSelected(key)}
                />
                <span className="choice-key">{key}</span>
                <span>{current.options[key]}</span>
              </label>
            ))}
          </div>

          <button
            type="button"
            className="primary"
            disabled={!selected || streaming || phase !== 'idle'}
            onClick={() => void handleConfirm()}
          >
            {phase === 'idle' ? (streaming ? '辅导生成中…' : '确认作答') : '已确认'}
          </button>

          {phase === 'wrong_tutoring' && (
            <p className="round-badge" aria-live="polite">
              引导 {Math.min(guideRound, MAX_GUIDE_ROUNDS)}/{MAX_GUIDE_ROUNDS}
              {guideRound < MAX_GUIDE_ROUNDS
                ? ' · 可在右侧继续提问（「不懂」也会消耗轮次）'
                : ''}
            </p>
          )}
          {phase === 'revealed' && (
            <p className="round-badge done">引导已结束 · 见完整解析</p>
          )}
          {phase === 'correct_done' && (
            <p className="round-badge done">答对 · 完整思路已给出</p>
          )}
        </section>

        <section className="panel chat-pane">
          <div className="row between">
            <h2>AI 辅导</h2>
            {phase === 'wrong_tutoring' && (
              <span className="round-pill">
                引导 {Math.min(guideRound, MAX_GUIDE_ROUNDS)}/{MAX_GUIDE_ROUNDS}
              </span>
            )}
          </div>

          <div className="chat-log">
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                <div className="bubble-role">{m.role === 'user' ? '你' : '老师'}</div>
                {m.role === 'assistant' && m.id !== 'welcome' && (
                  <details className="think-panel" open={Boolean(m.isStreaming)}>
                    <summary>思考过程</summary>
                    <div className="think-body">
                      {m.hadReasoningField || m.reasoning ? (
                        m.reasoning || (m.isStreaming ? '…' : '（无）')
                      ) : m.isStreaming || m.stageLabel ? (
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
                                {idx === activeIdx && m.isStreaming ? ' …' : ''}
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <span className="muted">本模型未返回思考字段</span>
                      )}
                    </div>
                  </details>
                )}
                <div className="bubble-body">
                  {m.role === 'assistant' && m.id !== 'welcome' && (
                    <div className="reply-label">对学生说的话</div>
                  )}
                  {m.content || (m.isStreaming ? '…' : '')}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {showNextCta && (
            <button
              type="button"
              className="next-cta"
              disabled={streaming}
              onClick={handleNextQuestion}
            >
              下一题 →
            </button>
          )}

          {chatEnabled && (
            <form
              className="chat-input-row"
              onSubmit={(e) => {
                e.preventDefault()
                void handleChatSend()
              }}
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="围绕本题提问，或说「不懂」…"
                disabled={streaming}
                aria-label="辅导对话输入"
              />
              <button type="submit" className="primary" disabled={streaming || !chatInput.trim()}>
                发送
              </button>
            </form>
          )}

          {phase === 'wrong_tutoring' && guideRound >= MAX_GUIDE_ROUNDS && !showNextCta && (
            <p className="muted">正在生成最终解析…</p>
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
