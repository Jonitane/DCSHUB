import { execFile, spawn, type ChildProcess } from 'node:child_process'

export function isImageRunning(imageName: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if ((error as Error).name === 'AbortError') reject(error)
        else resolve(false)
        return
      }
      resolve(stdout.split(/\r?\n/).some((line) => {
        const match = line.match(/^"([^"]+)"/)
        return match?.[1].toLowerCase() === imageName.toLowerCase()
      }))
    })
  })
}

export function isPidRunning(pid: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else resolve(false)
        return
      }
      resolve(stdout.split(/\r?\n/).some((line) => {
        const fields = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1])
        return fields.length >= 2 && Number(fields[1]) === pid
      }))
    })
  })
}

/**
 * Reserved for a process tree whose exact PID is owned by DCSHUB: either an
 * internal helper/worker, or the final fallback for user-added software after
 * its graceful window and tray exits have both failed. Built-in vendor
 * integrations must use their native exit adapters instead.
 */
export function terminateProcessTree(pid: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.trim())
    })
  })
}

/** See terminateProcessTree. This is limited to a known DCSHUB-owned worker. */
export function terminateImageTrees(imageName: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('taskkill.exe', ['/IM', imageName, '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.trim())
    })
  })
}

/**
 * Asks every titled top-level window owned by an executable to close through
 * WM_CLOSE. This follows the same application-controlled path as its close
 * button: the process may save state, veto the request, or intentionally move
 * to the tray. It never terminates the process.
 */
export function requestImageWindowClose(imageName: string, signal?: AbortSignal): Promise<boolean> {
  const encodedImageName = Buffer.from(imageName, 'utf8').toString('base64')
  const script = `
$targetName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedImageName}'))
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DcsHubGracefulWindowCloser {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  private const uint Close = 0x0010;

  public static int CloseAll(int[] processIds) {
    var targets = new HashSet<uint>();
    foreach (var id in processIds) targets.Add((uint)id);
    var requested = 0;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (!targets.Contains(processId) || GetWindowTextLength(hWnd) == 0) return true;
      var className = new StringBuilder(128);
      GetClassName(hWnd, className, className.Capacity);
      var value = className.ToString();
      if (value.Equals("IME", StringComparison.OrdinalIgnoreCase)
          || value.Equals("MSCTFIME UI", StringComparison.OrdinalIgnoreCase)
          || value.IndexOf("TrayIconMessageWindow", StringComparison.OrdinalIgnoreCase) >= 0) return true;
      if (PostMessage(hWnd, Close, IntPtr.Zero, IntPtr.Zero)) requested++;
      return true;
    }, IntPtr.Zero);
    return requested;
  }
}
'@
$pids=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $targetName } | ForEach-Object { [int]$_.ProcessId })
if($pids.Count -gt 0) {
  $count=[DcsHubGracefulWindowCloser]::CloseAll($pids)
  if($count -gt 0) { Write-Output 'REQUESTED'; exit 0 }
}
Write-Output 'NO_WINDOW'
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.includes('REQUESTED'))
    })
  })
}

/**
 * Opens a Qt 5 QSystemTrayIcon menu through the tray icon's own callback
 * window, then invokes an exact Exit item. This avoids mouse coordinates and
 * Windows 11's tray-overflow UI while still executing the application's own
 * QAction shutdown handler.
 */
export function requestQtTrayExit(
  imageName: string,
  exitLabels: string[],
  timeoutMs = 2_000,
  signal?: AbortSignal,
): Promise<boolean> {
  const encodedImageName = Buffer.from(imageName, 'utf8').toString('base64')
  const encodedExitLabels = Buffer.from(JSON.stringify(exitLabels), 'utf8').toString('base64')
  const timeout = Math.max(500, Math.round(timeoutMs))
  const script = `
$targetName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedImageName}'))
$exitLabels=@([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedExitLabels}')) | ConvertFrom-Json)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DcsHubQtTrayMenu {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder value, int maxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder value, int maxCount);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetMenuString(IntPtr menu, uint item, StringBuilder value, int maxCount, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetSubMenu(IntPtr menu, int position);
  [DllImport("user32.dll")] private static extern uint GetMenuItemID(IntPtr menu, int position);
  [DllImport("user32.dll")] private static extern bool EndMenu();
  private const uint QtTrayCallback = 0x8000 + 101;
  private const int ContextMenu = 0x007B;
  private const uint MenuGetHandle = 0x01E1;
  private const uint Command = 0x0111;
  private const uint ByPosition = 0x0400;
  private const uint InvalidItem = 0xffffffff;

  private static string Normalize(string value) {
    var tab = value.IndexOf('\t');
    if (tab >= 0) value = value.Substring(0, tab);
    return value.Replace("&", "").Trim();
  }

  private static bool FindCommand(IntPtr menu, HashSet<string> labels, out uint commandId) {
    commandId = InvalidItem;
    var count = GetMenuItemCount(menu);
    for (var position = 0; position < count; position++) {
      var submenu = GetSubMenu(menu, position);
      if (submenu != IntPtr.Zero && FindCommand(submenu, labels, out commandId)) return true;
      var text = new StringBuilder(512);
      GetMenuString(menu, (uint)position, text, text.Capacity, ByPosition);
      var id = GetMenuItemID(menu, position);
      if (id != InvalidItem && labels.Contains(Normalize(text.ToString()))) {
        commandId = id;
        return true;
      }
    }
    return false;
  }

  private static IntPtr FindPopup(HashSet<uint> targets) {
    var popup = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (!targets.Contains(processId)) return true;
      var className = new StringBuilder(64);
      GetClassName(hWnd, className, className.Capacity);
      if (className.ToString().Equals("#32768", StringComparison.Ordinal)) {
        popup = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return popup;
  }

  public static bool OpenAndInvoke(int[] processIds, string[] exitLabels, int timeoutMs) {
    var targets = new HashSet<uint>();
    foreach (var id in processIds) targets.Add((uint)id);
    var labels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var label in exitLabels) labels.Add(Normalize(label));
    var trayWindow = IntPtr.Zero;
    Point cursor;
    GetCursorPos(out cursor);
    long packedPosition = ((long)(cursor.Y & 0xffff) << 16) | (uint)(cursor.X & 0xffff);
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (!targets.Contains(processId)) return true;
      var className = new StringBuilder(256);
      var title = new StringBuilder(256);
      GetClassName(hWnd, className, className.Capacity);
      GetWindowText(hWnd, title, title.Capacity);
      if (className.ToString().IndexOf("TrayIconMessageWindow", StringComparison.OrdinalIgnoreCase) >= 0
          || title.ToString().Equals("QTrayIconMessageWindow", StringComparison.OrdinalIgnoreCase)) {
        trayWindow = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    if (trayWindow == IntPtr.Zero || !PostMessage(trayWindow, QtTrayCallback, new IntPtr(packedPosition), new IntPtr(ContextMenu))) return false;

    var deadline = Environment.TickCount64 + timeoutMs;
    while (Environment.TickCount64 < deadline) {
      var popup = FindPopup(targets);
      if (popup != IntPtr.Zero) {
        var menu = SendMessage(popup, MenuGetHandle, IntPtr.Zero, IntPtr.Zero);
        uint commandId;
        if (menu != IntPtr.Zero && FindCommand(menu, labels, out commandId)) {
          // Leave Qt's native popup loop, then deliver the exact QAction command
          // to the same hidden tray callback window that owns the menu.
          EndMenu();
          Thread.Sleep(25);
          return PostMessage(trayWindow, Command, new IntPtr((long)commandId), IntPtr.Zero);
        }
      }
      Thread.Sleep(30);
    }
    EndMenu();
    return false;
  }
}
'@
$pids=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $targetName } | ForEach-Object { [int]$_.ProcessId })
if($pids.Count -gt 0 -and [DcsHubQtTrayMenu]::OpenAndInvoke($pids, [string[]]$exitLabels, ${timeout})) { Write-Output 'INVOKED'; exit 0 }
Write-Output 'EXIT_NOT_FOUND'
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.includes('INVOKED'))
    })
  })
}

/**
 * Requests Qt's own application-termination path through the hidden
 * QSystemTrayIcon callback window. Qt handles WM_CLOSE on this window with
 * QWindowSystemInterface::handleApplicationTermination(), so this is not the
 * main-window "hide to tray" action and does not bypass application cleanup.
 */
export function requestQtTrayWindowClose(
  imageName: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const encodedImageName = Buffer.from(imageName, 'utf8').toString('base64')
  const script = `
$targetName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedImageName}'))
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DcsHubQtTrayClose {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder value, int maxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder value, int maxCount);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  private const uint Close = 0x0010;

  public static bool Request(int[] processIds) {
    var targets = new HashSet<uint>();
    foreach (var id in processIds) targets.Add((uint)id);
    var requested = false;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (!targets.Contains(processId)) return true;
      var className = new StringBuilder(256);
      var title = new StringBuilder(256);
      GetClassName(hWnd, className, className.Capacity);
      GetWindowText(hWnd, title, title.Capacity);
      if (className.ToString().IndexOf("TrayIconMessageWindow", StringComparison.OrdinalIgnoreCase) >= 0
          || title.ToString().Equals("QTrayIconMessageWindow", StringComparison.OrdinalIgnoreCase)) {
        requested = PostMessage(hWnd, Close, IntPtr.Zero, IntPtr.Zero) || requested;
      }
      return true;
    }, IntPtr.Zero);
    return requested;
  }
}
'@
$pids=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $targetName } | ForEach-Object { [int]$_.ProcessId })
if($pids.Count -gt 0 -and [DcsHubQtTrayClose]::Request($pids)) { Write-Output 'REQUESTED'; exit 0 }
Write-Output 'TRAY_WINDOW_NOT_FOUND'
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.includes('REQUESTED'))
    })
  })
}

/**
 * Invokes an application's own tray Exit command. Tray applications often
 * treat WM_CLOSE as "hide", so their menu is the only supported graceful
 * shutdown entry point. The lookup is restricted to a matching tray icon and
 * exact menu labels; failure is reported without falling back to taskkill.
 */
export function requestTrayExit(
  trayNameIncludes: string[],
  exitLabels: string[],
  timeoutMs = 5_000,
  signal?: AbortSignal,
): Promise<boolean> {
  const encodedTrayNames = Buffer.from(JSON.stringify(trayNameIncludes), 'utf8').toString('base64')
  const encodedExitLabels = Buffer.from(JSON.stringify(exitLabels), 'utf8').toString('base64')
  const timeout = Math.max(500, Math.round(timeoutMs))
  const script = `
$trayNames=@([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTrayNames}')) | ConvertFrom-Json)
$exitLabels=@([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedExitLabels}')) | ConvertFrom-Json)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DcsHubTrayMouse {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  private const uint RightDown = 0x0008;
  private const uint RightUp = 0x0010;
  private const uint LeftDown = 0x0002;
  private const uint LeftUp = 0x0004;

  public static Point Cursor() { Point point; GetCursorPos(out point); return point; }
  public static void Restore(Point point) { SetCursorPos(point.X, point.Y); }
  public static void RightClick(int x, int y) { SetCursorPos(x, y); mouse_event(RightDown, 0, 0, 0, UIntPtr.Zero); mouse_event(RightUp, 0, 0, 0, UIntPtr.Zero); }
  public static void LeftClick(int x, int y) { SetCursorPos(x, y); mouse_event(LeftDown, 0, 0, 0, UIntPtr.Zero); mouse_event(LeftUp, 0, 0, 0, UIntPtr.Zero); }
}
'@
function Get-AllElements {
  $root=[System.Windows.Automation.AutomationElement]::RootElement
  return $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
}
function Find-TrayIcon {
  $all=Get-AllElements
  foreach($element in $all) {
    try {
      if($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) { continue }
      if(-not $element.Current.ClassName.StartsWith('SystemTray.',[StringComparison]::OrdinalIgnoreCase)) { continue }
      if($element.Current.IsOffscreen) { continue }
      $name=$element.Current.Name
      foreach($needle in $trayNames) {
        if($name -and $name.IndexOf([string]$needle,[StringComparison]::OrdinalIgnoreCase) -ge 0) { return $element }
      }
    } catch {}
  }
  return $null
}
function Open-TrayOverflow {
  $all=Get-AllElements
  foreach($element in $all) {
    try {
      if($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) { continue }
      $name=$element.Current.Name
      if($name -eq '显示隐藏的图标' -or $name -eq 'Show hidden icons') {
        $pattern=$null
        if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
          ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
          return $true
        }
      }
    } catch {}
  }
  return $false
}
function Find-ExitItem {
  $all=Get-AllElements
  foreach($element in $all) {
    try {
      if($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::MenuItem) { continue }
      if($element.Current.IsOffscreen) { continue }
      $name=$element.Current.Name.Trim()
      foreach($label in $exitLabels) {
        if($name.Equals([string]$label,[StringComparison]::OrdinalIgnoreCase)) { return $element }
      }
    } catch {}
  }
  return $null
}
$deadline=(Get-Date).AddMilliseconds(${timeout})
$icon=Find-TrayIcon
if(-not $icon) {
  [void](Open-TrayOverflow)
  Start-Sleep -Milliseconds 300
}
do {
  $icon=Find-TrayIcon
  if($icon) { break }
  Start-Sleep -Milliseconds 100
} while((Get-Date) -lt $deadline)
if(-not $icon) { Write-Output 'ICON_NOT_FOUND'; exit 0 }
$cursor=[DcsHubTrayMouse]::Cursor()
try {
  $rect=$icon.Current.BoundingRectangle
  [DcsHubTrayMouse]::RightClick([int]($rect.Left + $rect.Width / 2),[int]($rect.Top + $rect.Height / 2))
  Start-Sleep -Milliseconds 250
  do {
    $item=Find-ExitItem
    if($item) { break }
    Start-Sleep -Milliseconds 80
  } while((Get-Date) -lt $deadline)
  if(-not $item) { Write-Output 'EXIT_NOT_FOUND'; exit 0 }
  $pattern=$null
  if($item.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
    ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
  } else {
    $rect=$item.Current.BoundingRectangle
    [DcsHubTrayMouse]::LeftClick([int]($rect.Left + $rect.Width / 2),[int]($rect.Top + $rect.Height / 2))
  }
  Write-Output 'INVOKED'
} finally {
  [DcsHubTrayMouse]::Restore($cursor)
}
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.includes('INVOKED'))
    })
  })
}

/**
 * Restores the first titled top-level window owned by an executable and brings
 * it above the Hub. Enumerating native windows is more reliable than
 * Process.MainWindowHandle for Electron and Qt apps whose window was hidden at
 * startup or is currently parked in the system tray.
 */
export function showImageWindow(imageName: string, timeoutMs = 5_000, signal?: AbortSignal, titleIncludes = ''): Promise<boolean> {
  const encodedImageName = Buffer.from(imageName, 'utf8').toString('base64')
  const encodedTitle = Buffer.from(titleIncludes, 'utf8').toString('base64')
  const timeout = Math.max(0, Math.round(timeoutMs))
  const script = `
$targetName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedImageName}'))
$targetTitle=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTitle}'))
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DcsHubWindowActivator {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

  private static readonly IntPtr TopMost = new IntPtr(-1);
  private static readonly IntPtr NotTopMost = new IntPtr(-2);
  private const uint NoMove = 0x0002;
  private const uint NoSize = 0x0001;
  private const uint ShowWindow = 0x0040;

  public static bool ShowAny(int[] processIds, string titleIncludes) {
    var targets = new HashSet<uint>();
    foreach (var id in processIds) targets.Add((uint)id);
    var shown = false;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (!targets.Contains(processId) || GetWindowTextLength(hWnd) == 0) return true;
      var title = new StringBuilder(GetWindowTextLength(hWnd) + 1);
      GetWindowText(hWnd, title, title.Capacity);
      var value = title.ToString();
      if (value.Equals("TtkMonitorWindow", StringComparison.OrdinalIgnoreCase)
          || value.Equals("Default IME", StringComparison.OrdinalIgnoreCase)
          || value.Equals("MSCTFIME UI", StringComparison.OrdinalIgnoreCase)) return true;
      if (!String.IsNullOrEmpty(titleIncludes) && value.IndexOf(titleIncludes, StringComparison.OrdinalIgnoreCase) < 0) return true;
      ShowWindowAsync(hWnd, 9);
      SetWindowPos(hWnd, TopMost, 0, 0, 0, 0, NoMove | NoSize | ShowWindow);
      SetWindowPos(hWnd, NotTopMost, 0, 0, 0, 0, NoMove | NoSize | ShowWindow);
      SetForegroundWindow(hWnd);
      shown = true;
      return false;
    }, IntPtr.Zero);
    return shown;
  }
}
'@
$deadline=(Get-Date).AddMilliseconds(${timeout})
do {
  $pids=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $targetName } | ForEach-Object { [int]$_.ProcessId })
  if($pids.Count -gt 0 -and [DcsHubWindowActivator]::ShowAny($pids,$targetTitle)) { Write-Output 'SHOWN'; exit 0 }
  if((Get-Date) -ge $deadline) { break }
  Start-Sleep -Milliseconds 100
} while($true)
Write-Output 'NOT_FOUND'
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.includes('SHOWN'))
    })
  })
}

/** Waits for a real top-level window, then minimizes it without changing how
 * the application itself is created. This is safer for generic integrations
 * than SW_HIDE because many Electron and Qt apps initialize services from the
 * first visible-window event. */
export function minimizeImageWindows(imageName: string, timeoutMs = 8_000, signal?: AbortSignal): Promise<boolean> {
  const encodedImageName = Buffer.from(imageName, 'utf8').toString('base64')
  const timeout = Math.max(0, Math.round(timeoutMs))
  const script = `
$targetName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedImageName}'))
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DcsHubWindowMinimizer {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

  public static bool MinimizeAny(int[] processIds) {
    var targets = new HashSet<uint>();
    foreach (var id in processIds) targets.Add((uint)id);
    var minimized = false;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (targets.Contains(processId) && GetWindowTextLength(hWnd) > 0) {
        ShowWindowAsync(hWnd, 6);
        minimized = true;
      }
      return true;
    }, IntPtr.Zero);
    return minimized;
  }
}
'@
$deadline=(Get-Date).AddMilliseconds(${timeout})
do {
  $pids=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $targetName } | ForEach-Object { [int]$_.ProcessId })
  if($pids.Count -gt 0 -and [DcsHubWindowMinimizer]::MinimizeAny($pids)) { Write-Output 'MINIMIZED'; exit 0 }
  if((Get-Date) -ge $deadline) { break }
  Start-Sleep -Milliseconds 120
} while($true)
Write-Output 'NOT_FOUND'
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.includes('MINIMIZED'))
    })
  })
}

/**
 * Keeps minimizing titled windows created by the launched process, its child
 * process tree, and the selected executable image during the whole startup
 * period. It continues after splash screens so later main windows are covered.
 */
export function startProcessTreeMinimizeWatcher(rootPid: number, imageName: string, durationMs = 15_000): ChildProcess {
  const encodedImageName = Buffer.from(imageName, 'utf8').toString('base64')
  const duration = Math.max(1_000, Math.round(durationMs))
  const script = `
$targetName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedImageName}'))
$rootPid=${Math.max(0, Math.trunc(rootPid))}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DcsHubProcessTreeMinimizer {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

  public static void MinimizeAll(int[] processIds) {
    var targets = new HashSet<uint>();
    foreach (var id in processIds) targets.Add((uint)id);
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (targets.Contains(processId) && IsWindowVisible(hWnd) && GetWindowTextLength(hWnd) > 0) ShowWindowAsync(hWnd, 6);
      return true;
    }, IntPtr.Zero);
  }
}
'@
$known=New-Object 'System.Collections.Generic.HashSet[int]'
[void]$known.Add($rootPid)
$deadline=(Get-Date).AddMilliseconds(${duration})
while((Get-Date) -lt $deadline) {
  $processes=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $changed=$true
  while($changed) {
    $changed=$false
    foreach($process in $processes) {
      if(($known.Contains([int]$process.ParentProcessId) -or $process.Name -ieq $targetName) -and -not $known.Contains([int]$process.ProcessId)) {
        [void]$known.Add([int]$process.ProcessId)
        $changed=$true
      }
    }
  }
  [DcsHubProcessTreeMinimizer]::MinimizeAll(@($known))
  Start-Sleep -Milliseconds 80
}
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  const watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
    windowsHide: true,
    stdio: 'ignore',
  })
  watcher.unref()
  return watcher
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function waitForPidExit(pid: number, timeoutMs = 4_000, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!await isPidRunning(pid, signal)) return true
    await delay(100, signal)
  }
  return !await isPidRunning(pid, signal)
}

export async function waitForImage(imageName: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isImageRunning(imageName, signal)) return true
    await delay(150, signal)
  }
  return isImageRunning(imageName, signal)
}

export async function waitForImageExit(imageName: string, timeoutMs = 4_000, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!await isImageRunning(imageName, signal)) return true
    await delay(100, signal)
  }
  return !await isImageRunning(imageName, signal)
}
