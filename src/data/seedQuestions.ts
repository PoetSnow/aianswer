import type { Question } from '../types'

/** 最小占位；正式题请从 import/grade7-en-math-phy.json 导入 */
export const seedQuestions: Question[] = [
  {
    id: 'placeholder-1',
    stem: '（占位题，请用导入替换）请先导入 import/grade7-en-math-phy.json',
    options: { A: 'A', B: 'B', C: 'C', D: 'D' },
    correctAnswer: 'A',
    tags: ['占位'],
    subject: '数学',
  },
]
