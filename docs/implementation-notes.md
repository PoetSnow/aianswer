# 实现备忘（下次对话优先读本文）

> 仓库：`PoetSnow/aianswer`（本地目录可能仍叫 `ai-math-tutor`）  
> 用途：快速了解已实现能力与改法，减少翻代码。  
> **产品交互规则（权威）**：[`产品交互规则.md`](./产品交互规则.md)（含双通道 ANSWERING / GUIDING）

---

## 1. 产品现状（一句话）

双页 React MVP：题库管理 + 答题 AI 辅导（流式）。验证「答错后有限次启发、答对给简洁解析」。题库存 `data/questions.json`；错题本与多模型配置存 `localStorage`。

---

## 2. 状态机

| Mode | 含义 |
|------|------|
| `ANSWERING` | 原题 |
| `VARIANT` | 变式验证（`question.variant`） |
| `GUIDING` | `guideSteps` + `stepIndex` |
| `COMPLETED` | 解析 + 掌握确认 |

流程：原题对 → 变式；变式对 → 解析 → 掌握？；任一答错 → 引导。

| 数据 | 文件 |
|------|------|
| `guideSteps`（意图） | 题库；开场话术 LLM 润色；学生回复后 LLM 返回 `GuideTurnResult` |
| `variant` | 变式选择题 |
| 契约 / 钳制 / 兜底 | `src/lib/tutor.ts`（`parseGuideTurnResult` / `clampGuideTurnResult` / `fallbackGuideTurn`） |
| 轮次上限等常量 | `src/config.ts` → `tutorLimits` |
| UI | `src/pages/AnswerPage.tsx` |

---

## 3. 多模型切换

### 用户能做什么

- 答题页顶部：下拉切换 / 添加 / 编辑模型
- Base URL（含 `/v1`）、Model、API Key（可空）、Temperature
- 可导入 NetAgent 风格 JSON；本地 vLLM 可无 Key；切换无需重启

### 预置

| id | 说明 |
|----|------|
| `local-qwen` | `http://61.144.189.71:8066/v1` · `Qwen/Qwen2.5-3B-Instruct` |
| `env-default` | 有 `.env` 的 `VITE_LLM_*` 时种子一条 |

### 存储

- `ai-math-tutor-llm-models` / `ai-math-tutor-llm-active`

### 请求链路

```text
streamChatCompletion → POST /api/llm/chat/completions
  Header X-LLM-Base-Url + 可选 Authorization
  → llmProxyMiddleware → 上游 {baseUrl}/chat/completions
```

| 文件 | 职责 |
|------|------|
| `src/lib/llmModels.ts` | CRUD / 预置 / JSON 导入 |
| `src/config.ts` | `getLlmConfig` / `isLlmConfigured`（只需 baseUrl+model） |
| `src/lib/llm.ts` | 流式调用 |
| `src/components/ModelSwitcher.tsx` | UI |
| `server/llmProxy.mjs` | 代理 |

---

## 4. 其它能力

| 能力 | 要点 |
|------|------|
| 题库 | `GET/PUT /api/questions` → `data/questions.json` |
| 错题本 | 仅 id 列表（规则文档写明不做完整错题体系） |
| 今日报告 | 流式诊断 |
| 路由 | `/` 题库，`/answer` 答题 |

---

## 5. 常用命令

```bash
npm install
npm run dev      # Vite + 题库 API + LLM 代理
npm run build
npm run preview
npm run api      # 独立 5174
```

---

## 6. 改哪里

| 想改 | 去哪 |
|------|------|
| 交互规则 / 双通道 | `docs/产品交互规则.md` |
| 引导步骤与期望答案 | `data/questions.json` → `guideSteps` |
| 比对 / 输入分类 | `src/lib/tutor.ts` |
| 双通道 UI | `src/pages/AnswerPage.tsx` |
| 预置模型 | `LOCAL_QWEN_PRESET` in `llmModels.ts` |
| 代理协议 | `llm.ts` + `llmProxy.mjs` |

---

## 7. 注意点

- LLM 代理依赖 dev/preview/api；纯静态无 `/api/llm`
- 清空 localStorage 会丢模型列表与错题本
