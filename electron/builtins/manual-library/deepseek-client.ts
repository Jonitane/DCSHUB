import type {
  ManualAiProvider,
  ManualAiThinkingLevel,
  ManualOnlineSearchSource,
} from '../../../src/shared/manual-library-contracts'

type FetchLike = typeof fetch
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface ManualAiConnection {
  provider: ManualAiProvider
  apiKey: string
  baseUrl: string
  model: string
  thinkingLevel: ManualAiThinkingLevel
}

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  search_info?: { search_results?: Array<{ title?: string; url?: string; link?: string }> }
  error?: { message?: string }
}

interface AnthropicContentBlock {
  type?: string
  text?: string
  url?: string
  title?: string
  citations?: Array<{ url?: string; title?: string }>
  content?: AnthropicContentBlock[]
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  error?: { message?: string }
}

interface ModelListResponse {
  data?: Array<{ id?: string }>
  error?: { message?: string }
}

export const MANUAL_AI_PROVIDER_NAMES: Record<ManualAiProvider, string> = {
  deepseek: 'DeepSeek',
  siliconflow: '硅基流动',
  qwen: 'Qwen（阿里云百炼）',
}

export const MANUAL_AI_DEFAULT_BASE_URLS: Record<ManualAiProvider, string> = {
  deepseek: 'https://api.deepseek.com',
  siliconflow: 'https://api.siliconflow.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

export const MANUAL_AI_DEFAULT_MODELS: Record<ManualAiProvider, { local: string; online: string }> = {
  deepseek: { local: 'deepseek-v4-flash', online: 'deepseek-v4-pro' },
  siliconflow: { local: 'Qwen/Qwen3-32B', online: 'Qwen/Qwen3-32B' },
  qwen: { local: 'qwen-plus', online: 'qwen-plus' },
}

export const MANUAL_AI_FALLBACK_MODELS: Record<ManualAiProvider, string[]> = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  siliconflow: ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3.2', 'Pro/deepseek-ai/DeepSeek-V3.2'],
  qwen: ['qwen-plus', 'qwen-flash', 'qwen-max'],
}

export function providerSupportsOnlineSearch(provider: ManualAiProvider): boolean {
  return provider === 'deepseek' || provider === 'qwen'
}

function thinkingBudget(level: ManualAiThinkingLevel): number | null {
  if (level === 'off') return null
  return level === 'low' ? 1_024 : level === 'medium' ? 4_096 : level === 'high' ? 8_192 : 16_384
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function addMarkdownSources(answer: string, sources: Map<string, ManualOnlineSearchSource>): void {
  for (const match of answer.matchAll(/\[([^\]]{1,180})\]\((https:\/\/[^)\s]+)\)/g)) {
    sources.set(match[2], { title: match[1].trim() || match[2], url: match[2] })
  }
}

/**
 * Provider-neutral manual AI client. The historical class name is retained so
 * older imports and cached renderer code continue to work during upgrades.
 */
export class DeepSeekClient {
  constructor(private readonly fetchImpl: FetchLike) {}

  async chat(
    connection: ManualAiConnection,
    messages: ChatMessage[],
    maxTokens: number,
    json = false,
    allowThinking = true,
  ): Promise<string> {
    const budget = allowThinking ? thinkingBudget(connection.thinkingLevel) : null
    const body: Record<string, unknown> = {
      model: connection.model,
      messages,
      max_tokens: maxTokens,
      stream: false,
      temperature: 0,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }
    if (connection.provider === 'deepseek') {
      body.thinking = { type: 'disabled' }
    } else {
      body.enable_thinking = budget !== null
      if (budget !== null) body.thinking_budget = budget
    }
    const response = await this.fetchWithTimeout(`${cleanBaseUrl(connection.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.apiKey}` },
      body: JSON.stringify(body),
    }, 90_000)
    const payload = await response.json() as OpenAiResponse
    if (!response.ok) throw new Error(payload.error?.message || `${MANUAL_AI_PROVIDER_NAMES[connection.provider]} 请求失败（HTTP ${response.status}）`)
    const content = payload.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error(`${MANUAL_AI_PROVIDER_NAMES[connection.provider]} 返回了空内容`)
    return content
  }

  async onlineSearch(connection: ManualAiConnection, question: string, system: string): Promise<{ answer: string; sources: ManualOnlineSearchSource[] }> {
    if (!providerSupportsOnlineSearch(connection.provider)) throw new Error(`${MANUAL_AI_PROVIDER_NAMES[connection.provider]} 当前不提供原生联网搜索，请在设置中为“联网搜索”选择 DeepSeek 或 Qwen`)
    if (connection.provider === 'deepseek') return this.deepSeekOnlineSearch(connection, question, system)
    return this.qwenOnlineSearch(connection, question, system)
  }

  async listModels(connection: ManualAiConnection): Promise<string[]> {
    if (connection.provider === 'deepseek') return [...MANUAL_AI_FALLBACK_MODELS.deepseek]
    try {
      const suffix = connection.provider === 'siliconflow' ? '/models?type=text&sub_type=chat' : '/models'
      const response = await this.fetchWithTimeout(`${cleanBaseUrl(connection.baseUrl)}${suffix}`, {
        headers: { Authorization: `Bearer ${connection.apiKey}` },
      }, 30_000)
      const payload = await response.json() as ModelListResponse
      if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`)
      const models = [...new Set((payload.data || []).map((item) => item.id?.trim()).filter((id): id is string => Boolean(id)))]
      return models.length > 0 ? models.sort((left, right) => left.localeCompare(right, 'en')) : [...MANUAL_AI_FALLBACK_MODELS[connection.provider]]
    } catch {
      return [...MANUAL_AI_FALLBACK_MODELS[connection.provider]]
    }
  }

  private async deepSeekOnlineSearch(connection: ManualAiConnection, question: string, system: string): Promise<{ answer: string; sources: ManualOnlineSearchSource[] }> {
    const response = await this.fetchWithTimeout(`${cleanBaseUrl(connection.baseUrl)}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': connection.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        max_tokens: 6_000,
        thinking: { type: 'enabled', budget_tokens: 12_000 },
        output_config: { effort: 'max' },
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        tool_choice: { type: 'auto' },
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
      }),
    }, 180_000)
    const payload = await response.json() as AnthropicResponse
    if (!response.ok) throw new Error(payload.error?.message || `DeepSeek 在线搜索失败（HTTP ${response.status}）`)
    const textBlocks: string[] = []
    const sources = new Map<string, ManualOnlineSearchSource>()
    const visit = (blocks: AnthropicContentBlock[] | undefined) => {
      for (const block of blocks || []) {
        if (block.type === 'text' && block.text?.trim()) textBlocks.push(block.text.trim())
        if (block.url?.startsWith('https://')) sources.set(block.url, { url: block.url, title: block.title?.trim() || block.url })
        for (const citation of block.citations || []) if (citation.url?.startsWith('https://')) sources.set(citation.url, { url: citation.url, title: citation.title?.trim() || citation.url })
        visit(block.content)
      }
    }
    visit(payload.content)
    const answer = textBlocks.join('\n\n').trim().replace(/\n{3,}/g, '\n\n')
    if (!answer) throw new Error('DeepSeek 在线搜索没有返回可用答案')
    addMarkdownSources(answer, sources)
    return { answer, sources: [...sources.values()].slice(0, 20) }
  }

  private async qwenOnlineSearch(connection: ManualAiConnection, question: string, system: string): Promise<{ answer: string; sources: ManualOnlineSearchSource[] }> {
    const budget = thinkingBudget(connection.thinkingLevel)
    const response = await this.fetchWithTimeout(`${cleanBaseUrl(connection.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.apiKey}` },
      body: JSON.stringify({
        model: connection.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: question }],
        max_tokens: 6_000,
        stream: false,
        enable_search: true,
        search_options: { forced_search: true, enable_source: true, enable_citation: true, citation_format: '[ref_<number>]', search_strategy: 'max' },
        enable_thinking: budget !== null,
        ...(budget !== null ? { thinking_budget: budget } : {}),
      }),
    }, 180_000)
    const payload = await response.json() as OpenAiResponse
    if (!response.ok) throw new Error(payload.error?.message || `Qwen 在线搜索失败（HTTP ${response.status}）`)
    const answer = payload.choices?.[0]?.message?.content?.trim() || ''
    if (!answer) throw new Error('Qwen 在线搜索没有返回可用答案')
    const sources = new Map<string, ManualOnlineSearchSource>()
    for (const item of payload.search_info?.search_results || []) {
      const url = item.url || item.link
      if (url?.startsWith('https://')) sources.set(url, { url, title: item.title?.trim() || url })
    }
    addMarkdownSources(answer, sources)
    return { answer, sources: [...sources.values()].slice(0, 20) }
  }

  private fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    return this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  }
}
