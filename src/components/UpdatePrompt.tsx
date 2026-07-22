import { useEffect, useState } from 'react'
import { CloudDownload, ExternalLink, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UPDATE_AVAILABLE_EVENT } from '@/lib/update-events'
import type { MajorUpdateInfo } from '@/shared/update-contracts'

export default function UpdatePrompt() {
  const [update, setUpdate] = useState<MajorUpdateInfo | null>(null)

  useEffect(() => {
    const receiveUpdate = (event: Event) => setUpdate((event as CustomEvent<MajorUpdateInfo>).detail)
    window.addEventListener(UPDATE_AVAILABLE_EVENT, receiveUpdate)
    let cancelled = false
    void window.electronAPI?.updates.check().then((result) => {
      if (!cancelled && result.status === 'available') setUpdate(result.update)
    }).catch(() => { /* Startup checks stay silent when GitHub is unavailable. */ })
    return () => {
      cancelled = true
      window.removeEventListener(UPDATE_AVAILABLE_EVENT, receiveUpdate)
    }
  }, [])

  const openDownload = async () => {
    if (update) await window.electronAPI?.updates.openDownload(update.downloadUrl)
    setUpdate(null)
  }

  return <Dialog open={Boolean(update)} onOpenChange={(open) => { if (!open) setUpdate(null) }}>
    <DialogContent className="max-w-2xl overflow-hidden border-primary/30 bg-background/95 p-0 shadow-2xl">
      <div className="border-b border-primary/15 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent px-6 py-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-xl"><span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25"><Sparkles className="size-5 text-primary" /></span>发现 DCSHUB 推送更新</DialogTitle>
          <DialogDescription className="pt-2"><span>当前版本</span> {update?.currentVersion} · <span>最新版本</span> <span className="font-semibold text-primary">{update?.latestVersion}</span></DialogDescription>
        </DialogHeader>
      </div>
      <div className="space-y-3 px-6 py-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><CloudDownload className="size-4 text-primary" />{update?.title || '更新内容'}</div>
        <div data-i18n-ignore="true" className="max-h-[48vh] overflow-y-auto rounded-xl border border-border/40 bg-card/65 px-5 py-4 text-sm leading-7 text-foreground/90">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            h1: ({ children }) => <h3 className="mb-3 text-base font-semibold">{children}</h3>,
            h2: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-semibold text-primary first:mt-0">{children}</h3>,
            h3: ({ children }) => <h4 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
            a: ({ children }) => <span className="font-medium text-primary">{children}</span>,
          }}>{update?.releaseNotes || ''}</ReactMarkdown>
        </div>
      </div>
      <DialogFooter className="gap-2 border-t border-border/35 bg-card/35 px-6 py-4">
        <Button variant="outline" onClick={() => setUpdate(null)}>稍后再说</Button>
        <Button className="gap-2" onClick={() => void openDownload()}><ExternalLink className="size-4" />前往更新</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
