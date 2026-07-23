Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DcsHubFocusTarget {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  public static void Restore(IntPtr target) {
    if (target == IntPtr.Zero) return;
    IntPtr foreground = GetForegroundWindow();
    uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, IntPtr.Zero);
    uint currentThread = GetCurrentThreadId();
    bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
    try {
      ShowWindowAsync(target, 5);
      BringWindowToTop(target);
      SetForegroundWindow(target);
    } finally {
      if (attached) AttachThreadInput(currentThread, foregroundThread, false);
    }
  }
}
'@
$process = Get-Process -Name 'DCS' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($process) { [DcsHubFocusTarget]::Restore($process.MainWindowHandle) }
