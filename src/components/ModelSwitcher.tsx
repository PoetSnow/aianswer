import { useEffect, useState } from 'react'
import {
  createEmptyProfile,
  deleteProfile,
  getActiveModelId,
  loadModelProfiles,
  profileFromExternalJson,
  setActiveModelId,
  upsertProfile,
} from '../lib/llmModels'
import type { LlmModelProfile } from '../types'

interface ModelSwitcherProps {
  disabled?: boolean
  onChange?: (profile: LlmModelProfile | null) => void
}

export default function ModelSwitcher({ disabled, onChange }: ModelSwitcherProps) {
  const [profiles, setProfiles] = useState<LlmModelProfile[]>([])
  const [activeId, setActiveId] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<LlmModelProfile | null>(null)
  const [importText, setImportText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function refresh() {
    const list = loadModelProfiles()
    const id = getActiveModelId(list)
    setProfiles(list)
    setActiveId(id)
    onChange?.(list.find((p) => p.id === id) ?? list[0] ?? null)
  }

  useEffect(() => {
    refresh()
  }, [])

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]

  function handleSelect(id: string) {
    setActiveModelId(id)
    setActiveId(id)
    const list = loadModelProfiles()
    onChange?.(list.find((p) => p.id === id) ?? null)
  }

  function openNew() {
    setFormError(null)
    setImportText('')
    setEditing(createEmptyProfile())
    setOpen(true)
  }

  function openEdit(p: LlmModelProfile) {
    setFormError(null)
    setImportText('')
    setEditing({ ...p })
    setOpen(true)
  }

  function handleSave() {
    if (!editing) return
    if (!editing.baseUrl.trim() || !editing.model.trim()) {
      setFormError('请填写 Base URL 与 Model 名称')
      return
    }
    const list = upsertProfile(editing)
    setProfiles(list)
    if (!activeId || !list.some((p) => p.id === activeId)) {
      setActiveModelId(editing.id)
      setActiveId(editing.id)
    }
    onChange?.(list.find((p) => p.id === getActiveModelId(list)) ?? null)
    setOpen(false)
    setEditing(null)
  }

  function handleDelete(id: string) {
    if (!confirm('确定删除该模型配置？')) return
    const list = deleteProfile(id)
    setProfiles(list)
    const nextId = getActiveModelId(list)
    setActiveId(nextId)
    onChange?.(list.find((p) => p.id === nextId) ?? null)
    if (editing?.id === id) {
      setEditing(null)
      setOpen(false)
    }
  }

  function handleImportJson() {
    try {
      const parsed = JSON.parse(importText) as unknown
      const profile = profileFromExternalJson(parsed)
      setEditing((prev) => ({
        ...profile,
        id: prev?.id && prev.id !== 'env-default' ? prev.id : profile.id,
      }))
      setFormError(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'JSON 解析失败')
    }
  }

  return (
    <div className="model-switcher">
      <label className="model-switcher-bar">
        <span className="muted">模型</span>
        <select
          value={active?.id ?? ''}
          disabled={disabled || profiles.length === 0}
          onChange={(e) => handleSelect(e.target.value)}
          aria-label="切换模型"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.model}
              {!p.apiKey ? '（无 Key）' : ''}
            </option>
          ))}
        </select>
        <button type="button" className="ghost" disabled={disabled} onClick={openNew}>
          添加
        </button>
        <button
          type="button"
          className="ghost"
          disabled={disabled || !active}
          onClick={() => active && openEdit(active)}
        >
          编辑
        </button>
      </label>

      {open && editing && (
        <div className="model-drawer panel" role="dialog" aria-label="模型配置">
          <div className="row between wrap gap">
            <h3 style={{ margin: 0 }}>模型配置</h3>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setOpen(false)
                setEditing(null)
              }}
            >
              关闭
            </button>
          </div>
          <p className="hint">
            配置保存在本机浏览器。内网 vLLM 可留空 API Key。请求经本地{' '}
            <code>/api/llm</code> 代理，避免 CORS。
          </p>

          <label className="field">
            <span>显示名称</span>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="内网 Qwen …"
            />
          </label>
          <label className="field">
            <span>Base URL（含 /v1）</span>
            <input
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
              placeholder="http://61.144.189.71:8066/v1"
            />
          </label>
          <label className="field">
            <span>Model 名称</span>
            <input
              value={editing.model}
              onChange={(e) => setEditing({ ...editing, model: e.target.value })}
              placeholder="Qwen/Qwen2.5-3B-Instruct"
            />
          </label>
          <label className="field">
            <span>API Key（可选）</span>
            <input
              type="password"
              autoComplete="off"
              value={editing.apiKey}
              onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
              placeholder="本地模型可留空"
            />
          </label>
          <label className="field inline">
            <span>Temperature</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={editing.temperature}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  temperature: Number(e.target.value),
                })
              }
            />
          </label>

          <details className="import-json">
            <summary>从外部 JSON 导入</summary>
            <textarea
              className="code-area"
              rows={8}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={`{\n  "Code": "local",\n  "Name": "内网 Qwen",\n  "Endpoint": "http://61.144.189.71:8066",\n  "ModelName": "Qwen/Qwen2.5-3B-Instruct",\n  "ApiKey": "",\n  "Temperature": 0.1,\n  "ChatCompletionsPath": "/v1/chat/completions"\n}`}
            />
            <button type="button" className="ghost" onClick={handleImportJson}>
              解析并填入表单
            </button>
          </details>

          {formError && (
            <p className="banner warn" role="alert">
              {formError}
            </p>
          )}

          <div className="row gap wrap">
            <button type="button" className="primary" onClick={handleSave}>
              保存
            </button>
            {profiles.some((p) => p.id === editing.id) && editing.id !== 'env-default' && (
              <button type="button" className="danger" onClick={() => handleDelete(editing.id)}>
                删除
              </button>
            )}
          </div>

          {profiles.length > 0 && (
            <ul className="model-list">
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`text-btn ${p.id === activeId ? 'active-model' : ''}`}
                    onClick={() => handleSelect(p.id)}
                  >
                    {p.name || p.model}
                  </button>
                  <span className="muted mono-sm">{p.model}</span>
                  <button type="button" className="ghost" onClick={() => openEdit(p)}>
                    改
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
