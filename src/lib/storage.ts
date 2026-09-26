import { seedQuestions } from '../data/seedQuestions'
import { WRONG_BOOK_KEY, type Question } from '../types'

export class QuestionsApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'QuestionsApiError'
    this.status = status
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    if (data.error) return data.error
  } catch {
    // ignore
  }
  return `题库 API 失败 (${res.status})`
}

/** 从 data/questions.json（经 /api/questions）加载题库 */
export async function loadQuestions(): Promise<Question[]> {
  const res = await fetch('/api/questions')
  if (!res.ok) {
    throw new QuestionsApiError(await parseError(res), res.status)
  }
  const data = (await res.json()) as Question[]
  if (!Array.isArray(data) || data.length === 0) {
    throw new QuestionsApiError('题库为空或格式无效')
  }
  return data
}

/** 写入 data/questions.json；失败时抛错，不静默回退 localStorage */
export async function saveQuestions(questions: Question[]): Promise<Question[]> {
  const res = await fetch('/api/questions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(questions),
  })
  if (!res.ok) {
    throw new QuestionsApiError(await parseError(res), res.status)
  }
  return (await res.json()) as Question[]
}

export async function resetToSeed(): Promise<Question[]> {
  return saveQuestions(structuredClone(seedQuestions))
}

export function loadWrongBookIds(): string[] {
  try {
    const raw = localStorage.getItem(WRONG_BOOK_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveWrongBookIds(ids: string[]): void {
  localStorage.setItem(WRONG_BOOK_KEY, JSON.stringify(ids))
}

export function addToWrongBook(questionId: string): string[] {
  const ids = loadWrongBookIds()
  if (!ids.includes(questionId)) {
    ids.push(questionId)
    saveWrongBookIds(ids)
  }
  return ids
}

export function createEmptyQuestion(): Question {
  return {
    id: crypto.randomUUID(),
    stem: '新题目（请编辑题干）',
    options: { A: '', B: '', C: '', D: '' },
    correctAnswer: 'A',
    tags: [],
    solution: '',
  }
}
