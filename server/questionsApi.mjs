/**
 * 题库 JSON 读写（供 Vite 开发中间件与可选独立 server 复用）。
 * 主持久化文件：data/questions.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const QUESTIONS_PATH = path.resolve(__dirname, '../data/questions.json')

const CHOICES = ['A', 'B', 'C', 'D']

export function validateQuestions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('题库须为非空数组')
  }
  return raw.map((q, i) => {
    if (!q || typeof q !== 'object') {
      throw new Error(`第 ${i + 1} 题格式无效`)
    }
    if (typeof q.stem !== 'string' || !q.stem.trim()) {
      throw new Error(`第 ${i + 1} 题缺少题干 stem`)
    }
    if (!q.options || typeof q.options !== 'object') {
      throw new Error(`第 ${i + 1} 题缺少 options`)
    }
    for (const k of CHOICES) {
      if (typeof q.options[k] !== 'string') {
        throw new Error(`第 ${i + 1} 题缺少选项 ${k}`)
      }
    }
    if (!CHOICES.includes(q.correctAnswer)) {
      throw new Error(`第 ${i + 1} 题 correctAnswer 须为 A/B/C/D`)
    }
    if (!Array.isArray(q.tags) || !q.tags.every((t) => typeof t === 'string')) {
      throw new Error(`第 ${i + 1} 题 tags 须为字符串数组`)
    }
    if (q.subject != null && (typeof q.subject !== 'string' || !q.subject.trim())) {
      throw new Error(`第 ${i + 1} 题 subject 须为非空字符串`)
    }
    if (q.solution != null && typeof q.solution !== 'string') {
      throw new Error(`第 ${i + 1} 题 solution 须为字符串`)
    }

    let guideSteps
    if (q.guideSteps != null) {
      if (!Array.isArray(q.guideSteps) || q.guideSteps.length === 0) {
        throw new Error(`第 ${i + 1} 题 guideSteps 须为非空数组`)
      }
      guideSteps = q.guideSteps.map((s, j) => {
        if (!s || typeof s !== 'object') {
          throw new Error(`第 ${i + 1} 题 guideSteps[${j}] 无效`)
        }
        if (typeof s.ask !== 'string' || !s.ask.trim()) {
          throw new Error(`第 ${i + 1} 题 guideSteps[${j}] 缺少 ask`)
        }
        if (s.expectedAnswers != null) {
          if (
            !Array.isArray(s.expectedAnswers) ||
            !s.expectedAnswers.every((a) => typeof a === 'string')
          ) {
            throw new Error(`第 ${i + 1} 题 guideSteps[${j}].expectedAnswers 须为字符串数组`)
          }
        }
        return {
          id: typeof s.id === 'string' && s.id ? s.id : `step-${j + 1}`,
          ask: s.ask.trim(),
          ...(Array.isArray(s.expectedAnswers) && s.expectedAnswers.length > 0
            ? {
                expectedAnswers: s.expectedAnswers
                  .map((a) => String(a).trim())
                  .filter(Boolean),
              }
            : {}),
          ...(typeof s.hintAsk === 'string' && s.hintAsk.trim()
            ? { hintAsk: s.hintAsk.trim() }
            : {}),
        }
      })
    }

    let variant
    if (q.variant != null) {
      const v = q.variant
      if (!v || typeof v !== 'object') {
        throw new Error(`第 ${i + 1} 题 variant 无效`)
      }
      if (typeof v.stem !== 'string' || !v.stem.trim()) {
        throw new Error(`第 ${i + 1} 题 variant 缺少 stem`)
      }
      if (!v.options || typeof v.options !== 'object') {
        throw new Error(`第 ${i + 1} 题 variant 缺少 options`)
      }
      for (const k of CHOICES) {
        if (typeof v.options[k] !== 'string') {
          throw new Error(`第 ${i + 1} 题 variant 缺少选项 ${k}`)
        }
      }
      if (!CHOICES.includes(v.correctAnswer)) {
        throw new Error(`第 ${i + 1} 题 variant.correctAnswer 须为 A/B/C/D`)
      }
      variant = {
        stem: v.stem.trim(),
        options: {
          A: v.options.A,
          B: v.options.B,
          C: v.options.C,
          D: v.options.D,
        },
        correctAnswer: v.correctAnswer,
        ...(typeof v.solution === 'string' && v.solution.trim()
          ? { solution: v.solution.trim() }
          : {}),
      }
    }

    return {
      id: typeof q.id === 'string' && q.id ? q.id : crypto.randomUUID(),
      stem: q.stem.trim(),
      options: {
        A: q.options.A,
        B: q.options.B,
        C: q.options.C,
        D: q.options.D,
      },
      correctAnswer: q.correctAnswer,
      tags: q.tags,
      ...(typeof q.subject === 'string' && q.subject.trim()
        ? { subject: q.subject.trim() }
        : {}),
      ...(q.solution != null && q.solution !== ''
        ? { solution: q.solution }
        : {}),
      ...(guideSteps ? { guideSteps } : {}),
      ...(q.guidePlanStatus === 'draft' || q.guidePlanStatus === 'approved'
        ? { guidePlanStatus: q.guidePlanStatus }
        : {}),
      ...(variant ? { variant } : {}),
    }
  })
}

export function readQuestionsFile() {
  if (!fs.existsSync(QUESTIONS_PATH)) {
    throw new Error(`题库文件不存在：${QUESTIONS_PATH}`)
  }
  const raw = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'))
  return validateQuestions(raw)
}

/** 原子写入：先写 .tmp 再 rename */
export function writeQuestionsFile(questions) {
  const validated = validateQuestions(questions)
  const dir = path.dirname(QUESTIONS_PATH)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${QUESTIONS_PATH}.${process.pid}.tmp`
  const payload = `${JSON.stringify(validated, null, 2)}\n`
  fs.writeFileSync(tmp, payload, 'utf8')
  fs.renameSync(tmp, QUESTIONS_PATH)
  return validated
}

export async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(data)
}

/** Connect / Vite 中间件 */
export function questionsApiMiddleware(req, res, next) {
  const url = req.url?.split('?')[0] ?? ''
  if (url !== '/api/questions' && url !== '/api/questions/') {
    next()
    return
  }

  if (req.method === 'GET') {
    try {
      sendJson(res, 200, readQuestionsFile())
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : '读取题库失败',
      })
    }
    return
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    readRequestBody(req)
      .then((text) => {
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          sendJson(res, 400, { error: '请求体须为合法 JSON' })
          return
        }
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.questions)
            ? parsed.questions
            : null
        if (!list) {
          sendJson(res, 400, { error: '请求体须为题目数组，或 { questions: [] }' })
          return
        }
        const saved = writeQuestionsFile(list)
        sendJson(res, 200, saved)
      })
      .catch((err) => {
        sendJson(res, 400, {
          error: err instanceof Error ? err.message : '保存题库失败',
        })
      })
    return
  }

  res.statusCode = 405
  res.setHeader('Allow', 'GET, PUT, POST')
  res.end('Method Not Allowed')
}
