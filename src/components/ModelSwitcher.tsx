import { useEffect, useState, type ClipboardEvent } from 'react'
import {
  createEmptyProfile,
  deleteProfile,
  getActiveModelId,
  loadModelProfiles,
  profileFromExternalJson,
  selectActiveModel,
  upsertProfile,
} from '../lib/llmModels'
import { ensureServerLlmConfig } from '../lib/serverLlm'
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
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [hadApiKey, setHadApiKey] = useState(false)
  const [replacingKey, setReplacingKey] = useState(false)
  const [importText, setImportText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function refresh() {
    await ensureServerLlmConfig()
    const list = loadModelProfiles()
    const id = getActiveModelId(list)
    setProfiles(list)
    setActiveId(id)
    onChange?.(list.find((p) => p.id === id) ?? list[0] ?? null)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]

  const importPlaceholder = (() => {
    const sample = profiles[0]
    if (sample) {
      const endpoint = sample.baseUrl.replace(/\/v1\/?$/, '')
      return JSON.stringify(
        {
          Code: sample.id,
          Name: sample.name || sample.model,
          Endpoint: endpoint,
          ModelName: sample.model,
          ApiKey: '',
          Temperature: sample.temperature,
          ChatCompletionsPath: '/v1/chat/completions',
        },
        null,
        2,
      )
    }
    return `{\n  "Code": "",\n  "Name": "",\n  "Endpoint": "",\n  "ModelName": "",\n  "ApiKey": "",\n  "Temperature": 0.7,\n  "ChatCompletionsPath": "/v1/chat/completions"\n}`
  })()

  async function handleSelect(id: string) {
    try {
      setSaving(true)
      const list = await selectActiveModel(id)
      setProfiles(list)
      setActiveId(id)
      onChange?.(list.find((p) => p.id === id) ?? null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '切换失败')
    } finally {
      setSaving(false)
    }
  }

  function openNew() {
    setFormError(null)
    setImportText('')
    setApiKeyDraft('')
    setHadApiKey(false)
    setReplacingKey(false)
    setEditing(createEmptyProfile())
    setOpen(true)
  }

  function openEdit(p: LlmModelProfile) {
    setFormError(null)
    setImportText('')
    setHadApiKey(Boolean(p.hasApiKey) || Boolean(p.apiKey?.trim()))
    setReplacingKey(false)
    setApiKeyDraft('')
    // 永不把真实 apiKey 放进表单，避免显示 / 复制
    setEditing({ ...p, apiKey: '' })
    setOpen(true)
  }

  async function handleSave() {
    if (!editing) return
    if (!editing.baseUrl.trim() || !editing.model.trim()) {
      setFormError('请填写 Base URL 与 Model 名称')
      return
    }
    // 已有 Key 且未点「更换」：传空字符串，服务端保留原 Key
    const nextKey =
      hadApiKey && !replacingKey ? '' : apiKeyDraft.trim()
    const toSave: LlmModelProfile = {
      ...editing,
      apiKey: nextKey,
      shared: true,
    }
    try {
      setSaving(true)
      setFormError(null)
      const list = await upsertProfile(toSave)
      setProfiles(list)
      const id = getActiveModelId(list)
      setActiveId(id)
      onChange?.(list.find((p) => p.id === id) ?? null)
      setOpen(false)
      setEditing(null)
      setApiKeyDraft('')
      setReplacingKey(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除该模型？将从服务器 data/llm.json 移除。')) return
    try {
      setSaving(true)
      const list = await deleteProfile(id)
      setProfiles(list)
      const nextId = getActiveModelId(list)
      setActiveId(nextId)
      onChange?.(list.find((p) => p.id === nextId) ?? null)
      if (editing?.id === id) {
        setEditing(null)
        setOpen(false)
        setApiKeyDraft('')
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }

  function handleImportJson() {
    try {
      const parsed = JSON.parse(importText) as unknown
      const profile = profileFromExternalJson(parsed)
      const importedKey = profile.apiKey?.trim() ?? ''
      setHadApiKey(Boolean(importedKey) || hadApiKey)
      if (importedKey) {
        setReplacingKey(true)
        setApiKeyDraft(importedKey)
      }
      setEditing((prev) => ({
        ...profile,
        apiKey: '',
        shared: true,
        id: prev?.id && !prev.id.startsWith('server-') ? prev.id : profile.id,
      }))
      setFormError(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'JSON 解析失败')
    }
  }

  function blockKeyCopy(e: ClipboardEvent) {
    e.preventDefault()
  }

  return (
    <div className="model-switcher">
      <label className="model-switcher-bar">
        <span className="muted">模型</span>
        <select
          value={active?.id ?? ''}
          disabled={disabled || saving || profiles.length === 0}
          onChange={(e) => void handleSelect(e.target.value)}
          aria-label="切换模型"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.model}
              {p.hasApiKey ? '' : '（无 Key）'}
            </option>
          ))}
        </select>
        <button type="button" className="ghost" disabled={disabled || saving} onClick={openNew}>
          添加
        </button>
        <button
          type="button"
          className="ghost"
          disabled={disabled || saving || !active}
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
            保存后写入服务器 <code>data/llm.json</code>，全站共用。已存 Key 永不回显，不可复制。
          </p>

          <label className="field">
            <span>显示名称</span>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={active?.name || '名称'}
            />
          </label>
          <label className="field">
            <span>Base URL（含 /v1）</span>
            <input
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
              placeholder={active?.baseUrl || 'https://…/v1'}
            />
          </label>
          <label className="field">
            <span>Model 名称</span>
            <input
              value={editing.model}
              onChange={(e) => setEditing({ ...editing, model: e.target.value })}
              placeholder={active?.model || 'model-id'}
            />
          </label>
          <label className="field">
            <span>API Key（可选）</span>
            {hadApiKey && !replacingKey ? (
              <div className="row gap wrap" style={{ alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: '0.9rem', userSelect: 'none' }}>
                  已保存在服务器（不可查看 / 复制 / 粘贴原文）
                </span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setReplacingKey(true)
                    setApiKeyDraft('')
                  }}
                >
                  更换 Key
                </button>
              </div>
            ) : (
              <input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onCopy={blockKeyCopy}
                onCut={blockKeyCopy}
                placeholder={hadApiKey ? '粘贴或输入新 Key（保存后替换）' : '可粘贴；本地模型可留空'}
              />
            )}
            {hadApiKey && replacingKey ? (
              <button
                type="button"
                className="ghost"
                style={{ marginTop: 4 }}
                onClick={() => {
                  setReplacingKey(false)
                  setApiKeyDraft('')
                }}
              >
                取消更换（保留原 Key）
              </button>
            ) : null}
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
              placeholder={importPlaceholder}
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
            <button type="button" className="primary" disabled={saving} onClick={() => void handleSave()}>
              {saving ? '保存中…' : '保存到服务器'}
            </button>
            {profiles.some((p) => p.id === editing.id) && (
              <button
                type="button"
                className="danger"
                disabled={saving}
                onClick={() => void handleDelete(editing.id)}
              >
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
                    onClick={() => void handleSelect(p.id)}
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
