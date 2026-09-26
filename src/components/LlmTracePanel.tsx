import { useEffect, useRef, useState } from 'react'
import {
  clearLlmTraces,
  subscribeLlmTraces,
  type LlmTraceEntry,
} from '../lib/llm'

/** 临时调试：页面内记录每次 LLM 输入 / 输出 */
export default function LlmTracePanel() {
  const [entries, setEntries] = useState<LlmTraceEntry[]>([])
  const [open, setOpen] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeLlmTraces(setEntries), [])

  useEffect(() => {
    if (!open) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [entries, open])

  return (
    <section className={`llm-trace-panel${open ? '' : ' collapsed'}`}>
      <header className="llm-trace-head">
        <button type="button" className="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'} LLM 调试记录（{entries.length}）
        </button>
        <button
          type="button"
          className="ghost"
          disabled={entries.length === 0}
          onClick={() => clearLlmTraces()}
        >
          清空
        </button>
      </header>
      {open && (
        <div className="llm-trace-body">
          {entries.length === 0 ? (
            <p className="muted">尚无调用。每次请求与完整返回会追加在这里。</p>
          ) : (
            entries.map((e) => (
              <article key={e.id} className={`llm-trace-item phase-${e.phase}`}>
                <div className="llm-trace-meta">
                  <strong>{e.title}</strong>
                  <span className="muted">
                    {e.at} · {e.model}
                    {e.baseUrl ? ` · ${e.baseUrl}` : ''}
                  </span>
                </div>
                <pre className="llm-trace-pre">{e.body}</pre>
              </article>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </section>
  )
}
