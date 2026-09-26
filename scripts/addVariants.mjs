/**
 * 为题库每题写入变式验证题（在已有 guideSteps 上合并）。
 * node scripts/addVariants.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/questions.json')
const list = JSON.parse(fs.readFileSync(file, 'utf8'))

/** @type {Record<string, object>} */
const variants = {
  'seed-1': {
    stem: '变式：若方程 2x + 5 = 13，则 x 的值是？',
    options: { A: '3', B: '4', C: '5', D: '6' },
    correctAnswer: 'B',
    solution: '移项得 2x = 8，x = 4。',
  },
  'seed-2': {
    stem: '变式：一个正方形的周长是 24 cm，则它的面积是？',
    options: { A: '16 cm²', B: '36 cm²', C: '48 cm²', D: '64 cm²' },
    correctAnswer: 'B',
    solution: '边长 = 24÷4 = 6 cm，面积 = 36 cm²。',
  },
  'seed-3': {
    stem: '变式：计算 (-2)² − 2² 的结果是？',
    options: { A: '0', B: '4', C: '-4', D: '8' },
    correctAnswer: 'A',
    solution: '(-2)² = 4，2² = 4，4 − 4 = 0。',
  },
  'ext-1': {
    stem: '变式：若方程 3x − 2 = 13，则 x 的值是？',
    options: { A: '4', B: '5', C: '6', D: '7' },
    correctAnswer: 'B',
    solution: '3x = 15，x = 5。',
  },
  'ext-2': {
    stem: '变式：若方程 4x + 1 = 2x + 9，则 x 的值是？',
    options: { A: '3', B: '4', C: '5', D: '6' },
    correctAnswer: 'B',
    solution: '2x = 8，x = 4。',
  },
  'ext-3': {
    stem: '变式：若方程 3(x − 1) = x + 5，则 x 的值是？',
    options: { A: '3', B: '4', C: '5', D: '6' },
    correctAnswer: 'B',
    solution: '3x − 3 = x + 5，2x = 8，x = 4。',
  },
  'ext-4': {
    stem: '变式：若方程 x/2 + 1 = 5，则 x 的值是？',
    options: { A: '6', B: '7', C: '8', D: '9' },
    correctAnswer: 'C',
    solution: 'x/2 = 4，x = 8。',
  },
  'ext-5': {
    stem: '变式：一个正方形的面积是 36 cm²，则它的周长是？',
    options: { A: '12 cm', B: '18 cm', C: '24 cm', D: '36 cm' },
    correctAnswer: 'C',
    solution: '边长 = 6 cm，周长 = 24 cm。',
  },
  'ext-6': {
    stem: '变式：正方形边长扩大到原来的 3 倍，面积扩大到原来的多少倍？',
    options: { A: '3 倍', B: '6 倍', C: '9 倍', D: '12 倍' },
    correctAnswer: 'C',
    solution: '(3a)² = 9a²，扩大到 9 倍。',
  },
  'ext-7': {
    stem: '变式：一个正方形的周长是 28 cm，则它的面积是？',
    options: { A: '36 cm²', B: '49 cm²', C: '56 cm²', D: '64 cm²' },
    correctAnswer: 'B',
    solution: '边长 = 7 cm，面积 = 49 cm²。',
  },
  'ext-8': {
    stem: '变式：计算 (-3)³ − 3³ 的结果是？',
    options: { A: '0', B: '-54', C: '54', D: '-27' },
    correctAnswer: 'B',
    solution: '(-3)³ = -27，3³ = 27，-27 − 27 = -54。',
  },
  'ext-9': {
    stem: '变式：计算 (-5)² + (-1)³ 的结果是？',
    options: { A: '24', B: '25', C: '26', D: '-24' },
    correctAnswer: 'A',
    solution: '25 + (-1) = 24。',
  },
  'ext-10': {
    stem: '变式：计算 -2² + (-2)² 的结果是？',
    options: { A: '-8', B: '0', C: '4', D: '8' },
    correctAnswer: 'B',
    solution: '-2² = -4，(-2)² = 4，-4 + 4 = 0。',
  },
  'ext-11': {
    stem: '变式：计算 (-1)¹⁰ + (-1)¹¹ 的结果是？',
    options: { A: '-2', B: '-1', C: '0', D: '2' },
    correctAnswer: 'C',
    solution: '1 + (-1) = 0。',
  },
  'ext-12': {
    stem: '变式：若方程 3x + a = 11 的解是 x = 2，则 a 的值是？',
    options: { A: '3', B: '4', C: '5', D: '6' },
    correctAnswer: 'C',
    solution: '6 + a = 11，a = 5。',
  },
  'ext-13': {
    stem: '变式：长方形长 7 cm、宽 4 cm，面积是？',
    options: { A: '11 cm²', B: '22 cm²', C: '28 cm²', D: '56 cm²' },
    correctAnswer: 'C',
    solution: '7 × 4 = 28 cm²。',
  },
  'ext-14': {
    stem: '变式：长方形周长 26 cm，长 8 cm，面积是？',
    options: { A: '40 cm²', B: '48 cm²', C: '52 cm²', D: '64 cm²' },
    correctAnswer: 'A',
    solution: '宽 = 5 cm，面积 = 40 cm²。',
  },
  'ext-15': {
    stem: '变式：若 a = -3，则 a² − 2a 的值是？',
    options: { A: '3', B: '9', C: '15', D: '18' },
    correctAnswer: 'C',
    solution: '9 − 2×(-3) = 9 + 6 = 15。',
  },
}

for (const q of list) {
  const v = variants[q.id]
  if (v) q.variant = v
}

fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
console.log(`variants added for ${Object.keys(variants).length} questions`)
