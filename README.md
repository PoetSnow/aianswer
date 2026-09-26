# 智学问答 · AI 选择题辅导 MVP

双页 React 应用：多学科题库管理 + 答题辅导（程序判选择题，LLM 写解析 / 分步引导）。

> **实现备忘**：[`docs/implementation-notes.md`](docs/implementation-notes.md)  
> **产品交互规则**：[`docs/产品交互规则.md`](docs/产品交互规则.md)

## 快速开始

```bash
npm install
cp .env.example .env   # 可选；也可只在界面里配模型
npm run dev
```

打开终端提示的地址（默认 `http://localhost:5173`）。

## 演示路径（给评审 / 招聘方）

1. **题库** `/`：导入 `import/grade7-en-math-phy.json`（或自录题干/选项/答案/学科/标签）  
2. **批量生成教案** → 微调 → 点「通过」  
3. **答题** `/answer`：用科目筛选切到英语 / 数学 / 物理  
4. 走一遍「答对 → 解析」和「答错 → 分步引导」

**LLM 调试默认关闭。** 演示时请保持关闭；开发自查可点答题页「调试」，或访问 `?dev=1`。

## 题库持久化

| 方式 | 说明 |
|------|------|
| 主存储 | `data/questions.json` |
| API | `GET/PUT /api/questions` |
| 错题本 | `localStorage`（仅错题 id） |

## LLM 配置

答题页顶部可添加 / 编辑 / 切换模型（存浏览器 localStorage）。编辑已有配置时 **不回显 API Key**（留空=保持原 Key）。请求经 `POST /api/llm/chat/completions` 代理。

## 页面

| 路由 | 能力 |
|------|------|
| `/` | 录入、导入、生成/审核教案 |
| `/answer` | 科目筛选、答题、引导、变式（若有）、掌握确认 |

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | Vite + 题库 / LLM 代理中间件 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览构建产物 |
| `npm run api` | 仅独立 API（5174） |

## 范围

无登录、无支付、无数据库。适合作为带完整闭环的教学辅导 MVP 作品，而非生产系统。
