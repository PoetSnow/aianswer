# 智学数学 · AI 选择题辅导 MVP

最小可用的双页 React 应用：题库管理 + 答题辅导（流式 LLM）。

> **实现备忘**：[`docs/implementation-notes.md`](docs/implementation-notes.md)  
> **产品交互规则（双通道）**：[`docs/产品交互规则.md`](docs/产品交互规则.md)

## 快速开始

```bash
npm install
cp .env.example .env   # 填入你的 API Key
npm run dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。

`npm run dev` 会同时启动 Vite 与题库 API 中间件（`GET/PUT /api/questions`），读写项目内 **`data/questions.json`**。

未配置 LLM 时仍可浏览题库与作答 UI；确认后流式聊天需在界面配置模型（本地模型可无 Key）。

## 题库持久化

| 方式 | 说明 |
|------|------|
| 主存储 | 磁盘文件 `data/questions.json` |
| API | `GET /api/questions` 读取；`PUT /api/questions` 校验并原子写入 |
| 错题本 | 仍用浏览器 `localStorage`（仅错题 id 列表） |

题库页的编辑 / 导入 / 恢复示例题都会经 API 写回 JSON。保存失败会明确报错，**不会**静默只写 localStorage。

可选独立 API（一般不必）：`npm run api` → `http://127.0.0.1:5174/api/questions`。

## LLM 配置（界面切换）

答题页顶部可 **添加 / 编辑 / 切换模型**，配置保存在浏览器 `localStorage`（含 API Key，不入库）。

| 字段 | 说明 | 示例 |
|------|------|------|
| 显示名称 | 下拉框里看到的名字 | `内网 Qwen …` |
| Base URL | OpenAI 兼容根路径（含 `/v1`） | `http://61.144.189.71:8066/v1` |
| Model | `model` 字段 | `Qwen/Qwen2.5-3B-Instruct` |
| API Key | 可选；本地 vLLM 可留空 | `sk-...` 或空 |
| Temperature | 采样温度 | `0.1` |

首次打开会预置「内网 Qwen」；若存在 `.env` 的 `VITE_LLM_*` 也会作为一条「环境变量」模型。

也可在「从外部 JSON 导入」粘贴 NetAgent 风格配置（`Endpoint` / `ModelName` / `ApiKey` / `ChatCompletionsPath`）。

请求经开发服务器 **`POST /api/llm/chat/completions`** 代理到目标端点，便于访问内网并规避浏览器 CORS。

可选 `.env`（参考 `.env.example`）仍可作为默认条目；**不必重启**即可在界面切换模型。切勿把真实密钥提交到 Git。

## 页面说明

### 1. 题库管理 `/`

- 编辑多选题：题干、A–D、正确答案、知识点标签、可选标准解析
- 支持粘贴 / 上传 JSON，或「恢复示例题」
- 写入 `data/questions.json`（经 `/api/questions`）

### 2. 答题辅导 `/answer`

- 从同一 JSON 加载题目
- 答对：完整思路 + 「下一题」；答错：最多 3 轮引导 + 思考过程面板

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | Vite + 题库 API 中间件 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览构建产物（同样挂载题库 API） |
| `npm run api` | 仅启动独立题库 API（5174） |

## 范围说明

无登录、无支付、无数据库。题库为本地 JSON 文件；错题本为 localStorage。
