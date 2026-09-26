export type ChoiceKey = 'A' | 'B' | 'C' | 'D'

export interface Question {
  id: string
  stem: string
  options: Record<ChoiceKey, string>
  correctAnswer: ChoiceKey
  tags: string[]
  solution?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export const CHOICE_KEYS: ChoiceKey[] = ['A', 'B', 'C', 'D']

/** 错题本仍用 localStorage；题库已改为 data/questions.json */
export const WRONG_BOOK_KEY = 'ai-math-tutor-wrong-book'
