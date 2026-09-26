import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createEmptyQuestion,
  loadQuestions,
  QuestionsApiError,
  resetToSeed,
  saveQuestions,
} from '../lib/storage'
import { CHOICE_KEYS, type ChoiceKey, type Question } from '../types'

function tagsToString(tags: string[]): string {
  return tags.join(', ')
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[,，;；]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function BankPage() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [pasteText, setPasteText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionsRef = useRef(questions)
  questionsRef.current = questions

  const jsonPreview = useMemo(() => JSON.stringify(questions, null, 2), [questions])

  const persistNow = useCallback(async (next: Question[], okMsg?: string) => {
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const saved = await saveQuestions(next)
      setQuestions(saved)
      setSaveStatus('saved')
      if (okMsg) setMessage(okMsg)
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
  }, [])

  const persistDebounced = useCallback(
    (next: Question[]) => {
      setQuestions(next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void persistNow(next).catch(() => {
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

  async function addQuestion() {
    const next = [...questions, createEmptyQuestion()]
    setQuestions(next)
    await persistNow(next, '已添加一道空白题目并写入 data/questions.json')
  }

  async function removeQuestion(id: string) {
    const next = questions.filter((q) => q.id !== id)
    if (next.length === 0) {
      setMessage('至少保留一道题')
      return
    }
    setQuestions(next)
    await persistNow(next, '已删除并写入 data/questions.json')
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
        if (!q.id) q.id = crypto.randomUUID()
        if (!Array.isArray(q.tags)) q.tags = []
      }
      setQuestions(parsed)
      await persistNow(parsed, `已导入 ${parsed.length} 道题并写入 data/questions.json`)
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
      await persistNow(questionsRef.current, '已保存到 data/questions.json')
    } catch {
      /* 已展示 */
    }
  }

  return (
    <div className="page bank-page">
      <header className="topbar">
        <div>
          <p className="brand">智学数学</p>
          <h1>题库管理</h1>
          <p className="subtitle">
            上传、粘贴或编辑选择题；持久化到项目文件{' '}
            <code>data/questions.json</code>。
          </p>
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
        <button type="button" className="ghost" disabled={loading || saveStatus === 'saving'} onClick={() => void handleSaveNow()}>
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
          支持 JSON 数组。字段：id（可选）、stem、options（A–D）、correctAnswer、tags、solution（可选）。
          导入/编辑会经 <code>PUT /api/questions</code> 写入磁盘。
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
                  <span>正确答案</span>
                  <select
                    value={q.correctAnswer}
                    onChange={(e) =>
                      updateQuestion(q.id, { correctAnswer: e.target.value as ChoiceKey })
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
                    onChange={(e) => updateQuestion(q.id, { tags: parseTags(e.target.value) })}
                    placeholder="一元一次方程, 解方程"
                  />
                </label>
              </div>

              <label className="field">
                <span>标准解析（可选）</span>
                <textarea
                  rows={3}
                  value={q.solution ?? ''}
                  onChange={(e) => updateQuestion(q.id, { solution: e.target.value })}
                />
              </label>
            </article>
          ))
        )}
      </section>
    </div>
  )
}
