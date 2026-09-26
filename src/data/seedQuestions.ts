import type { Question } from '../types'

/** 与 data/questions.json 中 seed 题保持一致（含 guideSteps） */
export const seedQuestions: Question[] = [
  {
    id: 'seed-1',
    stem: '若方程 2x + 3 = 11，则 x 的值是？',
    options: { A: '2', B: '4', C: '5', D: '7' },
    correctAnswer: 'B',
    tags: ['一元一次方程', '解方程'],
    solution: '移项得 2x = 11 - 3 = 8，两边同除以 2 得 x = 4。因此选 B。',
    guideSteps: [
      {
        id: 'mid',
        ask: '先别求 x。方程两边同时减去 3 后，2x 等于多少？',
        expectedAnswers: ['8', '2x=8', '2x = 8'],
        hintAsk: '更简单：11 减 3 等于多少？',
      },
      {
        id: 'final',
        ask: '对，2x = 8。两边再同时除以 2，x 等于多少？',
        expectedAnswers: ['4', 'x=4', 'x = 4', 'B'],
        hintAsk: '8 除以 2 等于多少？',
      },
    ],
    variant: {
      stem: '变式：若方程 2x + 5 = 13，则 x 的值是？',
      options: { A: '3', B: '4', C: '5', D: '6' },
      correctAnswer: 'B',
      solution: '移项得 2x = 8，x = 4。',
    },
  },
  {
    id: 'seed-2',
    stem: '一个正方形的周长是 20 cm，则它的面积是？',
    options: { A: '16 cm²', B: '20 cm²', C: '25 cm²', D: '100 cm²' },
    correctAnswer: 'C',
    tags: ['正方形', '周长与面积'],
    solution:
      '正方形周长 = 4 × 边长，故边长 = 20 ÷ 4 = 5 cm；面积 = 5² = 25 cm²。因此选 C。',
    guideSteps: [
      {
        id: 'side',
        ask: '先别急着求面积。正方形周长 = 4 × 边长，边长是多少 cm？',
        expectedAnswers: ['5', '5cm', '5 cm'],
        hintAsk: '更简单：20 ÷ 4 等于多少？',
      },
      {
        id: 'area',
        ask: '边长是 5 cm。面积 = 边长 × 边长，等于多少？',
        expectedAnswers: ['25', '25cm²', '25 cm²', 'C'],
        hintAsk: '5 × 5 等于多少？',
      },
    ],
    variant: {
      stem: '变式：一个正方形的周长是 24 cm，则它的面积是？',
      options: { A: '16 cm²', B: '36 cm²', C: '48 cm²', D: '64 cm²' },
      correctAnswer: 'B',
      solution: '边长 = 24÷4 = 6 cm，面积 = 36 cm²。',
    },
  },
  {
    id: 'seed-3',
    stem: '计算：(-3)² − 3² 的结果是？',
    options: { A: '0', B: '9', C: '-9', D: '18' },
    correctAnswer: 'A',
    tags: ['有理数运算', '乘方'],
    solution: '(-3)² = 9，3² = 9，所以 9 − 9 = 0。注意平方与负号的运算顺序。因此选 A。',
    guideSteps: [
      {
        id: 'left',
        ask: '先算 (-3)²，结果是多少？',
        expectedAnswers: ['9'],
        hintAsk: '(-3)×(-3) 等于多少？',
      },
      {
        id: 'final',
        ask: '(-3)² = 9，3² 也是 9。那么 9 − 9 等于多少？',
        expectedAnswers: ['0', 'A'],
        hintAsk: '同一个数减自己，结果是多少？',
      },
    ],
    variant: {
      stem: '变式：计算 (-2)² − 2² 的结果是？',
      options: { A: '0', B: '4', C: '-4', D: '8' },
      correctAnswer: 'A',
      solution: '(-2)² = 4，2² = 4，4 − 4 = 0。',
    },
  },
]
