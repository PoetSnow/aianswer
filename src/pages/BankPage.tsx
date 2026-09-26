import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ModelSwitcher from '../components/ModelSwitcher'
import { getLlmConfig, isLlmConfigured } from '../config'
import { chatCompletion } from '../lib/llm'
import { randomId } from '../lib/id'
import {
  createEmptyQuestion,
  loadQuestions,
  QuestionsApiError,
  resetToSeed,
  saveQuestions,
} from '../lib/storage'
import {
  buildGuidePlanDraftPrompt,
  isGuidePlanApproved,
  parseGuidePlanDraft,
  tutorSystemPrompt,
} from '../lib/tutor'
import {
  CHOICE_KEYS,
  DEFAULT_SUBJECT,
  SUBJECT_OPTIONS,
  type ChoiceKey,
  type GuideStep,
  type LlmModelProfile,
  type Question,
} from '../types'

function tagsToString(tags: string[]): string {
  return tags.join(', ')
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[,，;；]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function guideStatusLabel(q: Question): string {
  if (!q.guideSteps?.length) return '无教案'
  if (q.guidePlanStatus === 'draft') return '草稿待审'
  if (q.guidePlanStatus === 'approved' || isGuidePlanApproved(q)) return '已通过'
  return '无教案'
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function BankPage() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [pasteText, setPasteText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchProgress, setBatchProgress] = useState<string | null>(null)
  const [guideTips, setGuideTips] = useState<Record<string, string>>({})
  const [activeModel, setActiveModel] = useState<LlmModelProfile | null>(() => getLlmConfig())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionsRef = useRef(questions)
  const batchAbortRef = useRef(false)
  const batchBusyRef = useRef(false)
  const configured = isLlmConfigured()

  // 批量生成期间禁止用 state 回写 ref，否则每次成功后的重渲染会冲掉后续题目的本地累加
  useEffect(() => {
    if (!batchBusyRef.current) {
      questionsRef.current = questions
    }
  }, [questions])

  const jsonPreview = useMemo(() => JSON.stringify(questions, null, 2), [questions])

  const setGuideTip = useCallback((id: string, text: string) => {
    setGuideTips((prev) => ({ ...prev, [id]: text }))
  }, [])

  /**
   * @param replaceState 为 false 时不整表替换
   * @param silent 不改顶部「正在写入」状态（批量生成用，避免每次成功都顶页面）
   */
  const persistNow = useCallback(
    async (
      next: Question[],
      opts?: { okMsg?: string; replaceState?: boolean; silent?: boolean },
    ) => {
      const replaceState = opts?.replaceState !== false
      const silent = Boolean(opts?.silent)
      if (!silent) {
        setSaveStatus('saving')
        setSaveError(null)
      }
      try {
        const saved = await saveQuestions(next)
        if (replaceState) {
          setQuestions(saved)
        }
        if (!silent) {
          setSaveStatus('saved')
          if (opts?.okMsg) setMessage(opts.okMsg)
        }
      } catch (err) {
        const text =
          err instanceof QuestionsApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '保存失败'
        setSaveStatus('error')
        setSaveError(text)
        setMessage(`保存到 data/questions.json 失败：${text}`)
        throw err
      }
    },
    [],
  )

  const persistDebounced = useCallback(
    (next: Question[]) => {
      questionsRef.current = next
      setQuestions(next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void persistNow(questionsRef.current, {
          replaceState: false,
          silent: true,
        }).catch(() => {
          /* 错误已展示 */
        })
      }, 450)
    },
    [persistNow],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const list = await loadQuestions()
        if (!cancelled) {
          setQuestions(list)
          setSaveStatus('saved')
        }
      } catch (err) {
        if (!cancelled) {
          const text =
            err instanceof Error ? err.message : '加载题库失败'
          setSaveError(text)
          setSaveStatus('error')
          setMessage(
            `无法从 /api/questions 加载题库（data/questions.json）。请确认已运行 npm run dev。${text}`,
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function updateQuestion(id: string, patch: Partial<Question>) {
    persistDebounced(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  function updateOption(id: string, key: ChoiceKey, value: string) {
    persistDebounced(
      questions.map((q) =>
        q.id === id ? { ...q, options: { ...q.options, [key]: value } } : q,
      ),
    )
  }

  function patchGuideSteps(
    id: string,
    steps: GuideStep[],
    status: 'draft' | 'approved' = 'draft',
  ) {
    persistDebounced(
      questions.map((q) =>
        q.id === id
          ? { ...q, guideSteps: steps, guidePlanStatus: status }
          : q,
      ),
    )
  }

  function updateGuideStep(
    questionId: string,
    stepIndex: number,
    patch: Partial<GuideStep>,
  ) {
    const q = questions.find((x) => x.id === questionId)
    if (!q?.guideSteps) return
    const steps = q.guideSteps.map((s, i) =>
      i === stepIndex ? { ...s, ...patch } : s,
    )
    // 已通过后再改 → 退回草稿，需重新点通过
    patchGuideSteps(questionId, steps, 'draft')
  }

  function needsGuideDraft(q: Question): boolean {
    return !q.guideSteps?.length || q.guidePlanStatus === 'draft'
  }

  /** 单题生成；成功返回 true。batch 模式下只改内存，结束时统一落盘。 */
  async function runGenerateGuideDraft(
    id: string,
    opts?: { persist?: boolean },
  ): Promise<boolean> {
    const persist = opts?.persist !== false
    const q = questionsRef.current.find((x) => x.id === id)
    if (!q) return false
    if (!isLlmConfigured()) {
      setGuideTip(id, '请先配置可用模型，再生成教案草稿。')
      return false
    }
    if (!q.stem.trim()) {
      setGuideTip(id, '请先填写题干。')
      return false
    }
    setGuideTip(id, '正在生成…')
    try {
      const raw = await chatCompletion([
        {
          role: 'system',
          content: tutorSystemPrompt(q, 'planner'),
        },
        { role: 'user', content: buildGuidePlanDraftPrompt(q) },
      ])
      const steps = parseGuidePlanDraft(raw)
      if (!steps) {
        setGuideTip(id, '模型返回无法解析，请重试或换模型。')
        return false
      }
      const next = questionsRef.current.map((item) =>
        item.id === id
          ? { ...item, guideSteps: steps, guidePlanStatus: 'draft' as const }
          : item,
      )
      questionsRef.current = next
      setQuestions(next)
      if (persist) {
        await persistNow(next, { replaceState: false, silent: true })
      }
      setGuideTip(id, `已生成 ${steps.length} 步草稿，微调后点「通过」。`)
      return true
    } catch (err) {
      setGuideTip(id, err instanceof Error ? err.message : '生成教案失败')
      return false
    }
  }

  async function generateGuideDraft(id: string) {
    if (batchBusyRef.current) return
    setGeneratingId(id)
    try {
      await runGenerateGuideDraft(id, { persist: true })
    } finally {
      setGeneratingId(null)
    }
  }

  async function batchGenerateGuideDrafts() {
    if (batchBusyRef.current) return
    if (!isLlmConfigured()) {
      setBatchProgress('请先配置可用模型。')
      return
    }
    const targets = questionsRef.current.filter(needsGuideDraft)
    if (targets.length === 0) {
      setBatchProgress('没有需要生成的题（已通过的会跳过；仅处理无教案或草稿）。')
      return
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    batchAbortRef.current = false
    batchBusyRef.current = true
    setBatchBusy(true)
    let ok = 0
    let fail = 0
    for (let i = 0; i < targets.length; i++) {
      if (batchAbortRef.current) {
        setBatchProgress(
          `已中止：成功 ${ok}，失败 ${fail}，剩余未跑 ${targets.length - i}`,
        )
        break
      }
      const q = targets[i]
      setGeneratingId(q.id)
      setBatchProgress(`批量生成 ${i + 1}/${targets.length}：${q.stem.slice(0, 24)}…`)
      const success = await runGenerateGuideDraft(q.id, { persist: false })
      if (success) ok += 1
      else fail += 1
    }
    setGeneratingId(null)
    try {
      await persistNow(questionsRef.current, {
        replaceState: false,
        silent: true,
      })
      setSaveStatus('saved')
    } catch {
      /* 错误横幅已展示 */
    }
    batchBusyRef.current = false
    setBatchBusy(false)
    if (!batchAbortRef.current) {
      setBatchProgress(`批量完成：成功 ${ok}，失败 ${fail}。请逐题点「通过」。`)
    }
  }

  function stopBatchGenerate() {
    batchAbortRef.current = true
    setBatchProgress('正在中止…')
  }

  async function approveGuidePlan(id: string) {
    const q = questionsRef.current.find((x) => x.id === id)
    if (!q?.guideSteps?.length) {
      setGuideTip(id, '没有可审核的教案，请先生成草稿。')
      return
    }
    const next = questionsRef.current.map((item) =>
      item.id === id ? { ...item, guidePlanStatus: 'approved' as const } : item,
    )
    questionsRef.current = next
    setQuestions(next)
    await persistNow(next, { replaceState: false, silent: true })
    setGuideTip(id, '已通过，答题页将使用该引导计划。')
  }

  async function clearGuidePlan(id: string) {
    const next = questionsRef.current.map((item) => {
      if (item.id !== id) return item
      const copy: Question = { ...item }
      delete copy.guideSteps
      delete copy.guidePlanStatus
      return copy
    })
    questionsRef.current = next
    setQuestions(next)
    await persistNow(next, { replaceState: false, silent: true })
    setGuideTip(id, '已清除教案。')
  }

  async function addQuestion() {
    const next = [...questions, createEmptyQuestion()]
    setQuestions(next)
    await persistNow(next, {
      okMsg: '已添加一道空白题目并写入 data/questions.json',
    })
  }

  async function removeQuestion(id: string) {
    const next = questions.filter((q) => q.id !== id)
    if (next.length === 0) {
      setMessage('至少保留一道题')
      return
    }
    setQuestions(next)
    await persistNow(next, { okMsg: '已删除并写入 data/questions.json' })
  }

  async function handleResetSeed() {
    try {
      const next = await resetToSeed()
      setQuestions(next)
      setSaveStatus('saved')
      setMessage('已恢复示例题并写入 data/questions.json')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '恢复失败')
    }
  }

  async function handleImportJson() {
    try {
      const parsed = JSON.parse(pasteText) as Question[]
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('JSON 需为非空题目数组')
      }
      for (const q of parsed) {
        if (!q.id) q.id = randomId()
        if (!Array.isArray(q.tags)) q.tags = []
      }
      setQuestions(parsed)
      await persistNow(parsed, {
        okMsg: `已导入 ${parsed.length} 道题并写入 data/questions.json`,
      })
      setPasteText('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '导入失败')
    }
  }

  function handleFileUpload(file: File | null) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setPasteText(String(reader.result ?? ''))
      setMessage(`已读取文件 ${file.name}，请确认后点击「从下方 JSON 导入」`)
    }
    reader.readAsText(file)
  }

  async function handleSaveNow() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    try {
      await persistNow(questionsRef.current, {
        okMsg: '已保存到 data/questions.json',
      })
    } catch {
      /* 已展示 */
    }
  }

  return (
    <div className="page bank-page">
      <header className="topbar">
        <div>
          <p className="brand">智学问答</p>
          <h1>题库管理</h1>
          <p className="subtitle">
            人员只录题干 / 选项 / 答案 / 学科 / 标签；教案可单题或批量生成草稿，审核通过后答题才用。
            持久化 <code>data/questions.json</code>。
          </p>
          <ModelSwitcher
            disabled={Boolean(generatingId)}
            onChange={(p) => {
              setActiveModel(p)
              setMessage(null)
            }}
          />
          {!configured && (
            <p className="muted">生成教案需要先配置模型（本地模型可无 Key）。</p>
          )}
          {configured && activeModel && (
            <p className="muted">生成教案将使用：{activeModel.name}</p>
          )}
        </div>
        <nav className="nav-links">
          <Link to="/">题库</Link>
          <Link to="/answer" className="primary-link">
            去答题 →
          </Link>
        </nav>
      </header>

      <div className="banner" role="status">
        <span>
          磁盘题库：
          {loading
            ? '加载中…'
            : saveStatus === 'saving'
              ? '正在写入 data/questions.json…'
              : saveStatus === 'saved'
                ? `已同步（${questions.length} 题）`
                : saveStatus === 'error'
                  ? `保存失败${saveError ? `：${saveError}` : ''}`
                  : '—'}
        </span>
        <button
          type="button"
          className="ghost"
          disabled={loading || saveStatus === 'saving'}
          onClick={() => void handleSaveNow()}
        >
          立即保存
        </button>
      </div>

      {message && (
        <div className={`banner ${saveStatus === 'error' ? 'warn' : ''}`} role="status">
          {message}
          <button type="button" className="text-btn" onClick={() => setMessage(null)}>
            关闭
          </button>
        </div>
      )}

      <section className="panel">
        <h2>导入 / 导出</h2>
        <p className="hint">
          支持 JSON 数组。必填：stem、options、correctAnswer、tags；可选 subject（缺省数学）。
          不必写 solution。教案用下方「生成 / 批量生成」写入。
        </p>
        <div className="row gap wrap">
          <label className="file-btn">
            选择 JSON 文件
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => handleFileUpload(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="button" onClick={() => void handleImportJson()}>
            从下方 JSON 导入
          </button>
          <button type="button" className="ghost" onClick={() => void handleResetSeed()}>
            恢复示例题
          </button>
          <button type="button" className="ghost" onClick={() => void addQuestion()}>
            + 新增题目
          </button>
        </div>
        <textarea
          className="code-area"
          rows={8}
          placeholder='粘贴题目 JSON，例如 [{"stem":"...","options":{"A":"..."},"correctAnswer":"A","tags":["一元一次方程"]}]'
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <details>
          <summary>当前题库 JSON 预览（{questions.length} 题）</summary>
          <pre className="code-block">{jsonPreview}</pre>
        </details>
      </section>

      <section className="question-list">
        <div className="panel batch-guide-bar">
          <div className="row between wrap gap">
            <div>
              <h2 className="batch-guide-title">批量教案</h2>
              <p className="hint">
                对「无教案」或「草稿」逐题生成；已通过的跳过。生成中可中止。
              </p>
            </div>
            <div className="row gap wrap">
              <button
                type="button"
                disabled={!configured || batchBusy || loading}
                onClick={() => void batchGenerateGuideDrafts()}
              >
                {batchBusy ? '批量生成中…' : '批量生成教案草稿'}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!batchBusy}
                onClick={() => stopBatchGenerate()}
              >
                中止批量
              </button>
            </div>
          </div>
          {batchProgress ? (
            <p className="guide-inline-tip" role="status">
              {batchProgress}
            </p>
          ) : null}
        </div>
        <datalist id="subject-options">
          {SUBJECT_OPTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {loading ? (
          <p className="muted">正在从 API 加载题库…</p>
        ) : (
          questions.map((q, index) => (
            <article key={q.id} className="panel question-editor">
              <div className="row between">
                <h3>
                  第 {index + 1} 题 <span className="muted">#{q.id.slice(0, 8)}</span>
                </h3>
                <button
                  type="button"
                  className="danger ghost"
                  disabled={batchBusy}
                  onClick={() => void removeQuestion(q.id)}
                >
                  删除
                </button>
              </div>

              <label className="field">
                <span>题干</span>
                <textarea
                  rows={3}
                  value={q.stem}
                  onChange={(e) => updateQuestion(q.id, { stem: e.target.value })}
                />
              </label>

              <div className="options-grid">
                {CHOICE_KEYS.map((key) => (
                  <label key={key} className="field">
                    <span>选项 {key}</span>
                    <input
                      value={q.options[key]}
                      onChange={(e) => updateOption(q.id, key, e.target.value)}
                    />
                  </label>
                ))}
              </div>

              <div className="row gap wrap">
                <label className="field inline">
                  <span>学科</span>
                  <input
                    list="subject-options"
                    value={q.subject ?? DEFAULT_SUBJECT}
                    onChange={(e) =>
                      updateQuestion(q.id, {
                        subject: e.target.value.trim() || DEFAULT_SUBJECT,
                      })
                    }
                    placeholder={DEFAULT_SUBJECT}
                  />
                </label>
                <label className="field inline">
                  <span>正确答案</span>
                  <select
                    value={q.correctAnswer}
                    onChange={(e) =>
                      updateQuestion(q.id, {
                        correctAnswer: e.target.value as ChoiceKey,
                      })
                    }
                  >
                    {CHOICE_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  <span>知识点标签（逗号分隔）</span>
                  <input
                    value={tagsToString(q.tags)}
                    onChange={(e) =>
                      updateQuestion(q.id, { tags: parseTags(e.target.value) })
                    }
                    placeholder="一元一次方程, 解方程"
                  />
                </label>
              </div>

              <div className="guide-plan-box">
                <div className="row between wrap gap">
                  <h4>
                    引导教案{' '}
                    <span
                      className={`tag guide-status-${
                        q.guidePlanStatus === 'draft'
                          ? 'draft'
                          : q.guideSteps?.length
                            ? 'approved'
                            : 'none'
                      }`}
                    >
                      {guideStatusLabel(q)}
                    </span>
                  </h4>
                  <div className="row gap wrap">
                    <button
                      type="button"
                      disabled={
                        generatingId === q.id || !configured || batchBusy
                      }
                      onClick={() => void generateGuideDraft(q.id)}
                    >
                      {generatingId === q.id ? '生成中…' : '生成教案草稿'}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={
                        !q.guideSteps?.length ||
                        q.guidePlanStatus === 'approved' ||
                        batchBusy
                      }
                      onClick={() => void approveGuidePlan(q.id)}
                    >
                      通过
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      disabled={!q.guideSteps?.length || batchBusy}
                      onClick={() => void clearGuidePlan(q.id)}
                    >
                      清除教案
                    </button>
                  </div>
                </div>
                <p className="hint">
                  草稿不会在答题页生效；点「通过」后才用于分步引导。微调后会退回草稿。
                </p>
                {guideTips[q.id] ? (
                  <p className="guide-inline-tip" role="status">
                    {guideTips[q.id]}
                  </p>
                ) : null}
                {q.guideSteps?.map((step, si) => (
                  <div key={step.id || si} className="guide-step-editor">
                    <p className="muted">步骤 {si + 1}</p>
                    <label className="field">
                      <span>教学目标 ask</span>
                      <textarea
                        rows={2}
                        value={step.ask}
                        onChange={(e) =>
                          updateGuideStep(q.id, si, { ask: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>参考短答 expectedAnswers（逗号分隔，可选）</span>
                      <input
                        value={(step.expectedAnswers ?? []).join(', ')}
                        onChange={(e) =>
                          updateGuideStep(q.id, si, {
                            expectedAnswers: parseTags(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>降难度 hintAsk（可选）</span>
                      <input
                        value={step.hintAsk ?? ''}
                        onChange={(e) =>
                          updateGuideStep(q.id, si, {
                            hintAsk: e.target.value || undefined,
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  )
}
