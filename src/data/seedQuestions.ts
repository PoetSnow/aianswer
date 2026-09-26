import type { Question } from '../types'

export const seedQuestions: Question[] = [
  {
    id: 'seed-1',
    stem: '若方程 2x + 3 = 11，则 x 的值是？',
    options: {
      A: '2',
      B: '4',
      C: '5',
      D: '7',
    },
    correctAnswer: 'B',
    tags: ['一元一次方程', '解方程'],
    solution:
      '移项得 2x = 11 - 3 = 8，两边同除以 2 得 x = 4。因此选 B。',
  },
  {
    id: 'seed-2',
    stem: '一个正方形的周长是 20 cm，则它的面积是？',
    options: {
      A: '16 cm²',
      B: '20 cm²',
      C: '25 cm²',
      D: '100 cm²',
    },
    correctAnswer: 'C',
    tags: ['正方形', '周长与面积'],
    solution:
      '正方形周长 = 4 × 边长，故边长 = 20 ÷ 4 = 5 cm；面积 = 5² = 25 cm²。因此选 C。',
  },
  {
    id: 'seed-3',
    stem: '计算：(-3)² − 3² 的结果是？',
    options: {
      A: '0',
      B: '9',
      C: '-9',
      D: '18',
    },
    correctAnswer: 'A',
    tags: ['有理数运算', '乘方'],
    solution:
      '(-3)² = 9，3² = 9，所以 9 − 9 = 0。注意平方与负号的运算顺序。因此选 A。',
  },
]
