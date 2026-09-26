import type { Connect } from 'vite'

export declare function readRequestBody(req: NodeJS.ReadableStream): Promise<Buffer>
export declare const llmProxyMiddleware: Connect.NextHandleFunction
