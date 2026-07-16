import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import type { ModuleLogEntry, ModuleLogLevel, ModuleManifest } from '../../../src/shared/module-contracts'
import type { ModuleDriver, ModuleHealth } from '../../modules/types'
import { isImageRunning, showImageWindow, terminateImageTrees, terminateProcessTree, waitForImage, waitForImageExit, waitForPidExit } from '../windows-process'

const MODULE_ID = 'dcs-eye-mouse'
const WORKER_NAME = 'DCS EyeMouse Worker.exe'
const GUI_NAME = 'DCS EyeMouse.exe'
const CONFIG_NAME = 'config.json'

const AUTO_SETTING_KEYS = [
  'mode', 'move', 'always_active', 'require_dcs', 'invert_x', 'invert_y',
  'deadzone_deg', 'max_deg', 'h_fov_deg', 'v_fov_deg', 'dynamic_smoothing',
  'absolute_near_smoothing', 'absolute_far_smoothing', 'absolute_fast_radius_px',
  'target_median_window', 'target_median_reset_px', 'target_dejitter_px',
  'absolute_min_move_px', 'absolute_max_hz', 'freeze_on_fast_target',
  'freeze_target_delta_px', 'freeze_ms', 'gaze_lock', 'gaze_lock_radius_px',
  'gaze_lock_ms', 'gaze_unlock_radius_px', 'fine_tune_lock',
  'fine_tune_radius_px', 'fine_tune_saccade_px', 'fine_tune_smoothing',
] as const

const NEGATABLE_BOOLEAN_SETTINGS = new Set(['require_dcs', 'fine_tune_lock'])
const BLINK_TRIGGER_ARGS = [
  '--blink-trigger',
  '--blink-good-tracking-state', '2',
  '--blink-double-window-ms', '650',
  '--blink-cooldown-ms', '850',
  '--blink-min-edge-gap-ms', '100',
  '--blink-post-stable-samples', '1',
  '--blink-post-timeout-ms', '1000',
  '--blink-foveated-fallback',
  '--blink-foveated-stable-good-samples', '2',
  '--blink-foveated-min-drop-ms', '20',
  '--blink-foveated-max-drop-ms', '320',
]

interface EyeMouseProfile {
  name?: string
  auto_settings?: Record<string, unknown>
}

interface EyeMouseConfig {
  hold_key?: string
  pause_key?: string
  active_profile?: string
  profiles?: Record<string, EyeMouseProfile>
}

function candidateInstallations(): string[] {
  return [...new Set([
    process.env.DCS_EYEMOUSE_HOME,
    'G:\\AI Documents\\DCS EyeMouse',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'DCS EyeMouse') : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate)))]
}

function findInstallation(): string | null {
  return candidateInstallations().find((candidate) => (
    fs.existsSync(path.join(candidate, WORKER_NAME)) && fs.existsSync(path.join(candidate, CONFIG_NAME))
  )) || null
}

function readVersion(installDir: string | null): string {
  if (!installDir) return 'unknown'
  try {
    const firstLine = fs.readFileSync(path.join(installDir, 'VERSION.txt'), 'utf8').split(/\r?\n/, 1)[0]
    return firstLine.replace(/^DCS EyeMouse\s*/i, '').trim() || 'unknown'
  } catch { return 'unknown' }
}

function createManifest(installDir: string | null, executableOverride?: string | null): ModuleManifest {
  return {
    id: MODULE_ID,
    displayName: 'DCS EyeMouse',
    description: 'DCS VR 眼动光标辅助 · 按键与双眨触发',
    version: readVersion(installDir),
    icon: 'Eye',
    brandLogo: '/modules/dcs-eye-mouse-icon.png',
    backgroundImage: '/modules/dcs-eye-mouse-bg.webp',
    executablePath: executableOverride || (installDir ? path.join(installDir, fs.existsSync(path.join(installDir, GUI_NAME)) ? GUI_NAME : WORKER_NAME) : undefined),
    integrationKind: 'builtin',
    dependencies: [],
    capabilities: { lifecycle: true, settings: false, showWindow: true, logs: true },
    stopPolicy: 'always',
    timeouts: { discoverMs: 5_000, startMs: 12_000, stopMs: 8_000, showWindowMs: 10_000 },
    actionLabels: { start: '启动', stop: '停止' },
  }
}

function runningImageNames(): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      const names = new Set<string>()
      stdout.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^"([^"]+)"/)
        if (match) names.add(match[1].toLowerCase())
      })
      resolve(names)
    })
  })
}

function appendSettingArg(args: string[], name: string, value: unknown): void {
  const flag = `--${name.replaceAll('_', '-')}`
  if (typeof value === 'boolean') {
    if (value) args.push(flag)
    else if (NEGATABLE_BOOLEAN_SETTINGS.has(name)) args.push(`--no-${name.replaceAll('_', '-')}`)
    return
  }
  if (typeof value === 'string' || typeof value === 'number') {
    args.push(flag, name === 'target_median_window' ? String(Math.max(1, Math.round(Number(value)))) : String(value))
  }
}

export function createEyeMouseDriver(executableOverride?: string | null): ModuleDriver {
  const overrideDirectory = executableOverride ? path.dirname(executableOverride) : null
  const installDir = overrideDirectory
    ? fs.existsSync(path.join(overrideDirectory, WORKER_NAME)) && fs.existsSync(path.join(overrideDirectory, CONFIG_NAME)) ? overrideDirectory : null
    : findInstallation()
  const manifest = createManifest(installDir, executableOverride)
  const logListeners = new Set<(entry: ModuleLogEntry) => void>()
  let child: ChildProcess | null = null
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let stopRequested = false
  let lastSelfCheckAt = 0

  async function stopOwnedWorker(signal?: AbortSignal): Promise<void> {
    if (!child) return
    const process = child
    const pid = process.pid
    if (!pid || process.exitCode !== null) {
      if (child === process) child = null
      return
    }

    stopRequested = true
    emit('info', '[APP] 正在停止。')

    let terminateError: unknown = null
    try {
      await terminateProcessTree(pid, signal)
    } catch (error) {
      terminateError = error
    }

    const exited = await waitForPidExit(pid, 4_000, signal)
    if (!exited) {
      const details = terminateError instanceof Error ? `：${terminateError.message}` : ''
      throw new Error(`EyeMouse Worker 进程树未能停止${details}`)
    }
    if (child === process) child = null
  }

  function emit(level: ModuleLogLevel, message: string): void {
    const line = message.trim()
    if (!line) return
    const entry: ModuleLogEntry = { moduleId: MODULE_ID, level, message: line, timestamp: Date.now() }
    logListeners.forEach((listener) => listener(entry))
  }

  function emitWorkerLine(source: 'stdout' | 'stderr', line: string): void {
    // eslint-disable-next-line no-control-regex -- ANSI escape sequences begin with the ESC control character.
    const text = line.replace(new RegExp('\\u001B\\[[0-?]*[ -/]*[@-~]', 'g'), '').trim()
    if (/No Pimax\/Tobii eye-tracking device URL was enumerated/i.test(text)) {
      emit('warn', '[提示] 没有检测到 Pimax/Tobii 眼动设备。这不是手感、校准或方案参数问题，而是 Pimax Play/Tobii 底层没有把眼追设备枚举出来。')
      if (Date.now() - lastSelfCheckAt > 4_000) void emitEyeTrackingSelfCheck()
      return
    }
    if (!/^\[(?:FATAL|EYE-(?:WARN|FAIL)|提示|自检|诊断|建议)\]/i.test(text)) return
    const level: ModuleLogLevel = source === 'stderr' || /^\[(?:FATAL|EYE-FAIL)\]/i.test(text)
      ? 'error'
      : /^\[(?:WARN|EYE-WARN|提示|诊断|建议)\]/i.test(text) ? 'warn' : 'info'
    emit(level, text)
  }

  async function emitEyeTrackingSelfCheck(): Promise<void> {
    lastSelfCheckAt = Date.now()
    try {
      const images = await runningImageNames()
      const has = (...names: string[]) => names.some((name) => images.has(name.toLowerCase()))
      const pimaxClient = has('PimaxClient.exe')
      const pimaxMainService = has('pi_server.exe', 'PiService.exe', 'PimaxService.exe')
      const tobiiShell = [...images].some((name) => /^platform_runtime_vr4.*_service\.exe$/i.test(name))
      const xr5Runtime = has('platform_runtime_XR5EYECHIP_WIN10_x64.exe')
      const gazeService = has('vrss_gaze_provider.exe')
      const status = (running: boolean) => running ? '已运行' : '未运行'

      emit('info', '[自检] Pimax/Tobii 眼追运行状态：')
      emit('info', `[自检] Pimax 客户端：${status(pimaxClient)}`)
      emit('info', `[自检] Pimax 主服务：${status(pimaxMainService)}`)
      emit('info', `[自检] Tobii/Pimax 服务壳：${status(tobiiShell)}`)
      emit('info', `[自检] XR5 眼追芯片运行时：${status(xr5Runtime)}`)
      emit('info', `[自检] Pimax 注视服务：${status(gazeService)}`)

      if (tobiiShell && !xr5Runtime) {
        emit('warn', '[诊断] Tobii/Pimax 服务壳在运行，但 XR5 眼追芯片运行时未运行；这会导致 Stream Engine 枚举不到眼追设备。')
        emit('warn', '[建议] 在 Pimax Play 里关闭再开启眼动追踪；若还不行，退出 DCS 后重启 Pimax Play，或重新插拔头显 USB/供电。')
      } else if (!pimaxClient && !pimaxMainService) {
        emit('warn', '[诊断] Pimax 客户端和主服务均未运行，眼追设备无法正常初始化。')
        emit('warn', '[建议] 请先启动 Pimax Play，确认头显和眼动追踪均已连接。')
      }
    } catch (error) {
      emit('warn', `[自检] 无法读取 Pimax/Tobii 运行状态：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function consumeChunk(source: 'stdout' | 'stderr', chunk: Buffer): void {
    const combined = (source === 'stdout' ? stdoutBuffer : stderrBuffer) + chunk.toString('utf8')
    const lines = combined.split(/\r?\n/)
    const remainder = lines.pop() || ''
    if (source === 'stdout') stdoutBuffer = remainder
    else stderrBuffer = remainder
    lines.forEach((line) => emitWorkerLine(source, line))
  }

  async function loadConfig(): Promise<EyeMouseConfig> {
    if (!installDir) throw new Error('未找到 DCS EyeMouse 安装目录')
    try { return JSON.parse(await readFile(path.join(installDir, CONFIG_NAME), 'utf8')) as EyeMouseConfig }
    catch (error) { throw new Error(`无法读取 EyeMouse 配置：${error instanceof Error ? error.message : String(error)}`) }
  }

  async function buildWorkerArgs(): Promise<string[]> {
    if (!installDir) throw new Error('未找到 DCS EyeMouse 安装目录')
    const config = await loadConfig()
    const profileId = config.active_profile || 'profile1'
    const profile = config.profiles?.[profileId]
    if (!profile) throw new Error(`EyeMouse 配置中不存在方案：${profileId}`)
    const settings: Record<string, unknown> = { ...(profile.auto_settings || {}), mode: 'absolute', always_active: false, move: true }
    const args = ['dcs_eye_mouse.py', '--hold-key', config.hold_key || '', '--pause-key', config.pause_key || '']
    AUTO_SETTING_KEYS.forEach((key) => appendSettingArg(args, key, settings[key]))
    args.push(
      '--calibration', path.join(installDir, 'profiles', profileId, 'calibration.json'),
      '--quick-calibration', path.join(installDir, 'profiles', profileId, 'quick_calibration.json'),
      ...BLINK_TRIGGER_ARGS,
    )
    return args
  }

  async function discover(signal?: AbortSignal): Promise<ModuleHealth> {
    if (!installDir) return { installState: 'not-installed', runState: 'stopped', details: '未找到 DCS EyeMouse Worker.exe 与 config.json' }
    const ownedRunning = child !== null && child.exitCode === null && !child.killed
    const running = ownedRunning || await isImageRunning(WORKER_NAME, signal)
    return { installState: 'installed', runState: running ? 'running' : 'stopped' }
  }

  return {
    manifest,
    discover,
    async start(signal?: AbortSignal) {
      if (!installDir) throw new Error('未找到 DCS EyeMouse 安装目录')
      if (await isImageRunning(WORKER_NAME, signal)) throw new Error('DCS EyeMouse Worker 已由外部进程启动')
      const workerPath = path.join(installDir, WORKER_NAME)
      const args = await buildWorkerArgs()
      stopRequested = false
      emit('info', '[APP] 设置已读取。')
      emit('info', '[APP] 正在启动：按键 + 双眨触发。')
      await emitEyeTrackingSelfCheck()
      child = spawn(workerPath, args, {
        cwd: installDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
      })
      child.stdout?.on('data', (chunk: Buffer) => consumeChunk('stdout', chunk))
      child.stderr?.on('data', (chunk: Buffer) => consumeChunk('stderr', chunk))
      child.on('error', (error) => emit('error', `[APP] Worker 启动错误：${error.message}`))
      const startedProcess = child
      child.on('close', (code, closeSignal) => {
        if (stdoutBuffer) emitWorkerLine('stdout', stdoutBuffer)
        if (stderrBuffer) emitWorkerLine('stderr', stderrBuffer)
        stdoutBuffer = ''; stderrBuffer = ''
        if (stopRequested) emit('info', '[APP] 已停止。')
        else {
          const exitCode = code ?? closeSignal ?? 'unknown'
          emit(code === 0 ? 'info' : 'error', `[APP] 进程已退出：${exitCode}${code === 0 ? '' : '（启动失败或运行错误）'}`)
        }
        if (child === startedProcess) child = null
      })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (child?.exitCode !== null) reject(new Error(`Worker 启动后立即退出，code=${child?.exitCode}`))
          else resolve()
        }, 700)
        child?.once('error', (error) => { clearTimeout(timer); reject(error) })
      })
    },
    async stop(signal?: AbortSignal) {
      if (child && child.exitCode === null) {
        await stopOwnedWorker(signal)
      }
      if (!await isImageRunning(WORKER_NAME, signal)) return
      await terminateImageTrees(WORKER_NAME, signal)
      if (!await waitForImageExit(WORKER_NAME, 4_000, signal)) throw new Error('EyeMouse Worker 进程未能停止')
    },
    async showWindow(signal?: AbortSignal) {
      if (!installDir) throw new Error('未找到 DCS EyeMouse 安装目录')
      const panelTitle = 'DCS EyeMouse 控制面板'
      if (await showImageWindow(GUI_NAME, 300, signal, panelTitle)) return
      {
        const guiPath = path.join(installDir, GUI_NAME)
        if (!fs.existsSync(guiPath)) throw new Error(`未找到 ${GUI_NAME}`)
        signal?.throwIfAborted()
        const gui = spawn(guiPath, [], { cwd: installDir, detached: true, stdio: 'ignore' })
        gui.unref()
        if (!await waitForImage(GUI_NAME, 2_000, signal)) throw new Error('DCS EyeMouse 窗口启动失败')
      }
      if (!await showImageWindow(GUI_NAME, 5_000, signal, panelTitle)) throw new Error('未找到 DCS EyeMouse 主窗口')
    },
    subscribeLogs(listener) {
      logListeners.add(listener)
      return () => { logListeners.delete(listener) }
    },
    async dispose() {
      try { await stopOwnedWorker() } catch { /* App shutdown is best-effort after the owned PID was targeted. */ }
      logListeners.clear()
    },
  }
}
