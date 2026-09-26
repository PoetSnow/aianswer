import type { Connect } from 'vite'

export declare const QUESTIONS_PATH: string

export declare function validateQuestions(raw: unknown): unknown[]
export declare function readQuestionsFile(): unknown[]
export declare function writeQuestionsFile(questions: unknown): unknown[]
export declare function readRequestBody(req: NodeJS.ReadableStream): Promise<string>
export declare function sendJson(
  res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void },
  status: number,
  body: unknown,
): void
export declare const questionsApiMiddleware: Connect.NextHandleFunction
