import { useEffect, useMemo, useState } from 'react'
import { Bot, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type {
  ManualAiProvider,
  ManualAiStage,
  ManualAiStageSettings,
  ManualAiThinkingLevel,
  ManualLibraryOverview,
} from '@/shared/manual-library-contracts'

const PROVIDERS: ManualAiProvider[] = ['deepseek', 'siliconflow', 'qwen']
const PROVIDER_NAMES: Record<ManualAiProvider, string> = {
  deepseek: 'DeepSeek',
  siliconflow: '硅基流动',
  qwen: 'Qwen（阿里云百炼）',
}
const THINKING_NAMES: Record<ManualAiThinkingLevel, string> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  max: 'MAX',
}

interface Props {
  overview: ManualLibraryOverview | null
  onOverviewChange: (overview: ManualLibraryOverview) => void
  onboarding?: boolean
}

function StageEditor({
  stage,
  title,
  overview,
  value,
  onChange,
  models,
  busy,
  onLoadModels,
  onSave,
}: {
  stage: ManualAiStage
  title: string
  overview: ManualLibraryOverview
  value: ManualAiStageSettings
  onChange: (value: ManualAiStageSettings) => void
  models: string[]
  busy: boolean
  onLoadModels: () => void
  onSave: () => void
}) {
  const availableProviders = overview.ai.providers.filter((provider) => provider.configured && (stage === 'local' || provider.supportsOnlineSearch))
  const deepSeek = value.provider === 'deepseek'
  return <div className="rounded-xl border border-border/40 bg-background/38 p-3.5">
    <div className="-mx-3.5 -mt-3.5 mb-3 flex items-center justify-between gap-3 rounded-t-xl border-b border-border/35 bg-background/60 p-3.5"><div><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[10px] text-muted-foreground">{stage === 'local' ? '用于手册检索理解、答案生成和证据核对' : '仅在用户主动点击“在线搜索”时调用'}</p></div><Button size="sm" variant="outline" onClick={onSave} disabled={busy || availableProviders.length === 0}>应用</Button></div>
    {availableProviders.length === 0 ? <p className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">{stage === 'online' ? '请先配置 DeepSeek 或 Qwen，硅基流动当前没有原生联网搜索。' : '请先在上方配置至少一个 API 供应商。'}</p> : <div className="grid gap-3 lg:grid-cols-3">
      <div className="space-y-1.5"><Label>供应商</Label><Select value={value.provider} onValueChange={(provider) => {
        const nextProvider = provider as ManualAiProvider
        const current = stage === 'local' ? overview.ai.local : overview.ai.online
        const defaultModel = nextProvider === 'deepseek' ? (stage === 'local' ? 'deepseek-v4-flash' : 'deepseek-v4-pro') : nextProvider === 'qwen' ? 'qwen-plus' : 'Qwen/Qwen3-32B'
        onChange({ provider: nextProvider, model: current.provider === nextProvider ? current.model : defaultModel, thinkingLevel: nextProvider === 'deepseek' ? (stage === 'local' ? 'off' : 'max') : value.thinkingLevel })
      }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{availableProviders.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><div className="flex items-center justify-between"><Label>模型</Label>{!deepSeek && <button type="button" className="text-[10px] text-primary hover:underline" onClick={onLoadModels}>读取列表</button>}</div><Input value={value.model} list={`${stage}-${value.provider}-models`} disabled={deepSeek} onChange={(event) => onChange({ ...value, model: event.target.value })} /><datalist id={`${stage}-${value.provider}-models`}>{models.map((model) => <option key={model} value={model} />)}</datalist></div>
      <div className="space-y-1.5"><Label>思考强度</Label><Select value={value.thinkingLevel} onValueChange={(level) => { if (!deepSeek) onChange({ ...value, thinkingLevel: level as ManualAiThinkingLevel }) }}><SelectTrigger disabled={deepSeek}><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(THINKING_NAMES) as ManualAiThinkingLevel[]).map((level) => <SelectItem key={level} value={level}>{THINKING_NAMES[level]}</SelectItem>)}</SelectContent></Select></div>
    </div>}
    {deepSeek && <p className="mt-2 text-[10px] leading-5 text-muted-foreground">DeepSeek 使用 DCSHUB 验证过的默认配置：本地 V4 Flash 无思考，联网 V4 Pro MAX；无需手动选择模型。</p>}
  </div>
}

export default function ManualAiSettingsPanel({ overview, onOverviewChange, onboarding = false }: Props) {
  const bridge = window.electronAPI?.manualLibrary
  const [provider, setProvider] = useState<ManualAiProvider>('deepseek')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [models, setModels] = useState<Partial<Record<ManualAiProvider, string[]>>>({})
  const [local, setLocal] = useState<ManualAiStageSettings | null>(null)
  const [online, setOnline] = useState<ManualAiStageSettings | null>(null)
  const providerStatus = useMemo(() => overview?.ai.providers.find((item) => item.id === provider), [overview, provider])

  useEffect(() => {
    if (!overview) return
    setLocal(overview.ai.local)
    setOnline(overview.ai.online)
  }, [overview])
  useEffect(() => { setBaseUrl(providerStatus?.baseUrl || '') }, [providerStatus])

  const run = async (name: string, task: () => Promise<void>) => {
    if (!bridge) return
    setBusy(name)
    try { await task() } catch (reason) { toast.error('AI 配置失败', { description: reason instanceof Error ? reason.message : String(reason) }) } finally { setBusy(null) }
  }
  const saveProvider = () => run('provider-save', async () => {
    const next = await bridge!.configureAiProvider(provider, apiKey, baseUrl || undefined)
    onOverviewChange(next)
    setApiKey('')
    toast.success(`${PROVIDER_NAMES[provider]} 已连接，API Key 已加密保存`)
  })
  const testProvider = () => run('provider-test', async () => { toast.success((await bridge!.testAiProvider(provider)).message) })
  const clearProvider = () => run('provider-clear', async () => {
    onOverviewChange(await bridge!.clearAiProvider(provider))
    toast.success(`${PROVIDER_NAMES[provider]} API Key 已清除`)
  })
  const loadModels = (target: ManualAiProvider) => run(`models-${target}`, async () => {
    const next = await bridge!.listAiProviderModels(target)
    setModels((current) => ({ ...current, [target]: next }))
    toast.success(`已读取 ${next.length} 个可用模型`)
  })
  const saveStage = (stage: ManualAiStage, value: ManualAiStageSettings) => run(`stage-${stage}`, async () => {
    const next = await bridge!.setAiStageSettings(stage, value)
    onOverviewChange(next)
    toast.success(`${stage === 'local' ? '本地搜索' : '联网搜索'}模型已更新`)
  })

  if (!overview || !local || !online) return null
  return <div className="space-y-3">
    <div className="rounded-xl border border-border/40 bg-background/45 p-4 shadow-sm">
      <div className="-mx-4 -mt-4 mb-4 flex items-center gap-2 rounded-t-xl border-b border-border/40 bg-background/75 px-4 py-3.5 text-sm font-semibold"><KeyRound className="size-4 text-primary" />API 供应商</div>
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
        <div className="space-y-1.5"><Label>供应商</Label><Select value={provider} onValueChange={(value) => setProvider(value as ManualAiProvider)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PROVIDERS.map((item) => <SelectItem key={item} value={item}>{PROVIDER_NAMES[item]}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label>API Key</Label><Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerStatus?.configured ? '已安全保存；留空表示不更换' : '请输入 API Key'} /></div>
        <div className="flex items-end gap-2"><Button onClick={() => void saveProvider()} disabled={busy !== null || apiKey.trim().length < 10}>{busy === 'provider-save' ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{providerStatus?.configured ? '更换密钥' : '测试并保存'}</Button></div>
      </div>
      {provider !== 'deepseek' && <div className="mt-3 space-y-1.5"><Label>API 地址</Label><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /><p className="text-[10px] text-muted-foreground">Qwen 不同地域或工作空间可能使用不同地址，可粘贴百炼控制台提供的 OpenAI 兼容 Base URL。</p></div>}
      {providerStatus?.configured && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-3"><ShieldCheck className="size-4 text-emerald-400" /><span className="mr-auto text-xs">API Key 已安全保存</span><Button size="sm" variant="outline" onClick={() => void testProvider()} disabled={busy !== null}>{busy === 'provider-test' ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}测试</Button><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void clearProvider()} disabled={busy !== null}><Trash2 className="size-3.5" />清除</Button></div>}
      <p className="mt-3 text-[10px] leading-5 text-muted-foreground">密钥使用 Windows 当前用户凭据加密保存。硅基流动支持本地手册问答；联网搜索需选择 DeepSeek 或 Qwen 的原生搜索能力。</p>
    </div>
    {!onboarding && <div className="rounded-xl border border-border/40 bg-background/45 p-4 shadow-sm"><div className="-mx-4 -mt-4 mb-4 flex items-center gap-2 rounded-t-xl border-b border-border/40 bg-background/75 px-4 py-3.5 text-sm font-semibold"><Bot className="size-4 text-primary" />模型与思考配置</div><div className="grid gap-3 xl:grid-cols-2"><StageEditor stage="local" title="本地手册搜索" overview={overview} value={local} onChange={setLocal} models={models[local.provider] || []} busy={busy !== null} onLoadModels={() => void loadModels(local.provider)} onSave={() => void saveStage('local', local)} /><StageEditor stage="online" title="联网搜索" overview={overview} value={online} onChange={setOnline} models={models[online.provider] || []} busy={busy !== null} onLoadModels={() => void loadModels(online.provider)} onSave={() => void saveStage('online', online)} /></div></div>}
  </div>
}
