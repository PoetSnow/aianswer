# 智学问答 · 产品说明

极简「选择题答题 + AI 辅导」MVP。验证一件事：做错题时用有轮次上限的启发式引导，代替直接抄答案；做对后给完整解题，再流畅进入下一题。

---

## 1. 产品定位

| 项 | 说明 |
|----|------|
| 目标用户 | 刷选择题的学习者（当前素材偏初中数学，题库可换） |
| 核心场景 | 做题 → AI 辅导 →（可选）错题诊断 |
| 不做的事 | 注册登录、支付、复杂后台、自建模型、真实服务端数据库 |

一句话：用最少工程把「答题 → 辅导 → 下一题」闭环跑通，LLM 通过可配置 API 接入。

---

## 2. 页面与信息架构

### 2.1 题库页 `/`

- 维护多选题：题干、A–D、正确答案、知识点标签、可选标准解析
- 支持表单编辑、粘贴 / 上传 JSON、「恢复示例题」
- **持久化到项目文件 `data/questions.json`**（经 `GET/PUT /api/questions`，开发服务器内原子写入）
- 保存失败会在界面明确报错，不再用 localStorage 静默顶替题库

### 2.2 答题页 `/answer`

- **左侧**：当前题、四选一、确认作答（题目来自同一 `questions.json`）
- **右侧**：流式对话（含「思考过程」与对学生可见回复）
- **下方**：错题本（仅错题 id 仍在浏览器 localStorage）；可生成「今日报告」

---

## 3. 数据持久化

| 数据 | 存储 | 说明 |
|------|------|------|
| 题库 | **`data/questions.json`** | `GET/PUT /api/questions`；Vite dev/preview 中间件挂载；原子写入 |
| 错题本 | `localStorage` | 仅保存错题 id 列表 |
| LLM 配置 | 浏览器 localStorage + 可选 `.env` | 界面切换模型；Key 不入库 |

上传 / 编辑题库必须以磁盘 JSON 为准。需保持 `npm run dev` 运行，接口才可用。

---

## 4. 核心交互规则（已实现）

**权威全文**：[`docs/产品交互规则.md`](docs/产品交互规则.md)（含双通道）  
**状态机**：`src/lib/tutor.ts` + `src/pages/AnswerPage.tsx`

### 4.0 双通道（步骤意图在题库，引导判断在 LLM）

| Mode | 行为 |
|------|------|
| ANSWERING | 仅 A–D；程序判选择题 |
| VARIANT | 变式 A–D；程序判 |
| GUIDING | 走题库 `guideSteps`；每轮 LLM 返回 JSON（`assessment` 等），程序推进；失败才 `answersMatch` 兜底 |
| COMPLETED | LLM 写解析；询问掌握 |

常量：`tutorLimits.maxGuideTurns`（默认 8）。

---

## 5. 技术概要

| 层 | 选型 |
|----|------|
| 前端 | Vite + React + TypeScript |
| 题库 API | Vite 中间件（`server/questionsApi.mjs`）读写 `data/questions.json` |
| 大模型 | OpenAI 兼容 Chat Completions，`stream: true`；经 `/api/llm` 代理 |
| 配置 | 界面多模型（localStorage）+ 可选 `.env` 种子 |

支持 DeepSeek、OpenAI、内网 vLLM 或任意兼容代理：在答题页添加并切换即可。

---

## 6. 题库数据约定

```json
[
  {
    "id": "optional-uuid",
    "stem": "题干",
    "options": { "A": "…", "B": "…", "C": "…", "D": "…" },
    "correctAnswer": "B",
    "tags": ["一元二次方程-求根公式"],
    "solution": "标准解析（可选，答对/末轮讲解会优先参考）"
  }
]
```

前期仅支持选择题。非法结构 `PUT` 会返回 400。

---

## 7. 如何运行（验收）

下载包：[ai-math-tutor-mvp.zip](./ai-math-tutor-mvp.zip)  
逐步说明：[本地运行说明](./local-run.md)

```bash
unzip ai-math-tutor-mvp.zip -d ai-math-tutor
cd ai-math-tutor
npm install
cp .env.example .env   # 填写 LLM 配置
npm run dev
```

浏览器打开 `http://localhost:5173`（题库 `/`，答题 `/answer`）。改 `.env` 后需重启 dev。

**题库持久化验收**

1. 题库页新增/上传题目并保存
2. 打开项目里的 `data/questions.json`，确认内容已更新
3. 刷新页面或重开答题页，题目仍在

**辅导验收**

1. 答对 → 完整思路/答案 → 「下一题」
2. 答错 → 多轮输入 → 「引导 n/3」→ 第 3 轮全解后禁聊 + 「下一题」
3. 闲聊 → 被拉回本题；观察「思考过程」双轨

---

## 8. 已知边界与后续可演进

**当前边界**

- 无账号与云端同步；题库文件只在你本机跑 `npm run dev` 的那份目录里
- 约束以 Prompt + 轻量前端规则为主，模型仍可能偶发越界
- 未接大规模题库检索 / RAG；未做压测与 Redis 缓存

**自然演进方向（未做）**

- 数据层：PostgreSQL 等存题与作答记录
- AI 层：按知识点硬过滤 + 向量检索补上下文
- 体验：云端同步、教师端审题、更多题型

---

## 9. 相关文件

| 文件 | 用途 |
|------|------|
| [ai-math-tutor-mvp.zip](./ai-math-tutor-mvp.zip) | 可运行源码包 |
| [本地运行说明](./local-run.md) | 本机启动与持久化说明 |
