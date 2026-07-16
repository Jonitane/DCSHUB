import type { ModuleRunState } from '@/shared/module-contracts'

interface RunStatePresentation {
  label: string
  badgeClassName: string
  dotClassName: string
}

const RUN_STATE_PRESENTATIONS: Record<ModuleRunState | 'unknown', RunStatePresentation> = {
  unknown: {
    label: '未知',
    badgeClassName: 'border-slate-400/40 bg-slate-500/20 text-slate-200',
    dotClassName: 'bg-slate-500',
  },
  stopped: {
    label: '已停止',
    badgeClassName: 'border-red-400/50 bg-red-500/20 text-red-200',
    dotClassName: 'bg-red-500',
  },
  starting: {
    label: '启动中',
    badgeClassName: 'border-amber-400/50 bg-amber-500/20 text-amber-200',
    dotClassName: 'bg-amber-400',
  },
  running: {
    label: '运行中',
    badgeClassName: 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200',
    dotClassName: 'bg-emerald-500',
  },
  degraded: {
    label: '运行受限',
    badgeClassName: 'border-amber-400/50 bg-amber-500/20 text-amber-200',
    dotClassName: 'bg-amber-400',
  },
  stopping: {
    label: '停止中',
    badgeClassName: 'border-amber-400/50 bg-amber-500/20 text-amber-200',
    dotClassName: 'bg-amber-400',
  },
  failed: {
    label: '异常',
    badgeClassName: 'border-red-400/50 bg-red-500/20 text-red-200',
    dotClassName: 'bg-red-500',
  },
}

export function getRunStatePresentation(state?: ModuleRunState): RunStatePresentation {
  return RUN_STATE_PRESENTATIONS[state ?? 'unknown']
}
