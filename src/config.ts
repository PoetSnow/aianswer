/** LLM 配置：通过 Vite 环境变量注入，切勿把真实密钥写进仓库。 */
export const llmConfig = {
  baseUrl: (import.meta.env.VITE_LLM_BASE_URL as string | undefined)?.replace(/\/$/, '') || 'https://api.deepseek.com/v1',
  apiKey: (import.meta.env.VITE_LLM_API_KEY as string | undefined) || '',
  model: (import.meta.env.VITE_LLM_MODEL as string | undefined) || 'deepseek-chat',
}

export function isLlmConfigured(): boolean {
  return Boolean(llmConfig.apiKey && llmConfig.baseUrl && llmConfig.model)
}
