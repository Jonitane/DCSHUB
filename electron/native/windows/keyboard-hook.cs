using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Diagnostics;

public static class DcsHubKbdHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int WM_KEYUP = 0x0101;
  private const int WM_SYSKEYUP = 0x0105;
  private const int WM_QUIT = 0x0012;
  private const int VK_LSHIFT = 0xA0;
  private const int VK_RSHIFT = 0xA1;
  private const int VK_LCONTROL = 0xA2;
  private const int VK_RCONTROL = 0xA3;
  private const int VK_LMENU = 0xA4;
  private const int VK_RMENU = 0xA5;
  private const int VK_LWIN = 0x5B;
  private const int VK_RWIN = 0x5C;
  private const int MOD_ALT = 0x01;
  private const int MOD_CTRL = 0x02;
  private const int MOD_SHIFT = 0x04;
  private const int MOD_WIN = 0x08;
  private const int MOD_MASK = 0x0F;
  private const uint JOY_RETURNBUTTONS = 0x00000080;

  private static IntPtr _hookId = IntPtr.Zero;
  private static HookProc _proc;
  private static int _toggleVk;
  private static int _toggleMods;
  private static int _currentMods;
  private static bool _toggleDown;
  private static int _parentPid;

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG {
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int pt_x;
    public int pt_y;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct JOYINFOEX {
    public uint dwSize;
    public uint dwFlags;
    public uint dwXpos;
    public uint dwYpos;
    public uint dwZpos;
    public uint dwRpos;
    public uint dwUpos;
    public uint dwVpos;
    public uint dwButtons;
    public uint dwButtonNumber;
    public uint dwPOV;
    public uint dwReserved1;
    public uint dwReserved2;
  }

  public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError=true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll", SetLastError=true)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
  [DllImport("user32.dll")]
  private static extern bool TranslateMessage([In] ref MSG lpMsg);
  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage([In] ref MSG lpMsg);
  [DllImport("user32.dll")]
  private static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();
  [DllImport("winmm.dll")]
  private static extern uint joyGetPosEx(uint uJoyID, ref JOYINFOEX pji);

  private static void UpdateMod(int vkCode, bool isDown) {
    int mod = 0;
    if (vkCode == VK_LSHIFT || vkCode == VK_RSHIFT) mod = MOD_SHIFT;
    else if (vkCode == VK_LCONTROL || vkCode == VK_RCONTROL) mod = MOD_CTRL;
    else if (vkCode == VK_LMENU || vkCode == VK_RMENU) mod = MOD_ALT;
    else if (vkCode == VK_LWIN || vkCode == VK_RWIN) mod = MOD_WIN;
    if (mod == 0) return;
    if (isDown) _currentMods |= mod;
    else _currentMods &= ~mod;
  }

  private static void Emit(string action) {
    Console.Out.WriteLine(action);
    Console.Out.Flush();
  }

  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      int vkCode = Marshal.ReadInt32(lParam);
      int msg = wParam.ToInt32();
      bool isDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
      bool isUp = (msg == WM_KEYUP || msg == WM_SYSKEYUP);
      UpdateMod(vkCode, isDown);
      if (isDown && vkCode == _toggleVk && ((_currentMods & MOD_MASK) == _toggleMods)) {
        if (!_toggleDown) Emit("DOWN");
        _toggleDown = true;
        return (IntPtr)1;
      }
      if (isUp && vkCode == _toggleVk && _toggleDown) {
        _toggleDown = false;
        Emit("UP");
        return (IntPtr)1;
      }
    }
    return CallNextHookEx(_hookId, nCode, wParam, lParam);
  }

  private static bool IsParentAlive() {
    if (_parentPid <= 0) return true;
    try {
      Process p = Process.GetProcessById(_parentPid);
      return !p.HasExited;
    } catch {
      return false;
    }
  }

  public static void Start(string[] args) {
    if (args.Length < 2) return;
    if (string.Equals(args[0], "JOY", StringComparison.OrdinalIgnoreCase)) {
      if (args.Length < 4) return;
      StartJoystick(uint.Parse(args[1]), int.Parse(args[2]), int.Parse(args[3]));
      return;
    }
    _toggleVk = int.Parse(args[0]);
    _toggleMods = int.Parse(args[1]);
    _parentPid = args.Length >= 3 ? int.Parse(args[2]) : 0;
    _currentMods = 0;
    _toggleDown = false;
    _proc = HookCallback;
    _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, IntPtr.Zero, 0);
    if (_hookId == IntPtr.Zero) {
      Emit("HOOK_FAILED");
      return;
    }
    Emit("HOOK_READY");
    uint threadId = GetCurrentThreadId();

    Thread stdinMonitor = new Thread(() => {
      try { Console.In.ReadLine(); } catch { }
      try { PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero); } catch { }
    });
    stdinMonitor.IsBackground = true;
    stdinMonitor.Start();

    Thread parentMonitor = new Thread(() => {
      while (true) {
        Thread.Sleep(1000);
        if (!IsParentAlive()) {
          try { PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero); } catch { }
          return;
        }
      }
    });
    parentMonitor.IsBackground = true;
    parentMonitor.Start();

    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      TranslateMessage(ref msg);
      DispatchMessage(ref msg);
    }
    try { UnhookWindowsHookEx(_hookId); } catch { }
  }

  private static void StartJoystick(uint deviceId, int buttonIndex, int parentPid) {
    _parentPid = parentPid;
    if (buttonIndex < 0 || buttonIndex > 31) { Emit("HOOK_FAILED"); return; }
    uint mask = 1u << buttonIndex;
    bool wasDown = false;
    Emit("HOOK_READY");
    while (IsParentAlive()) {
      JOYINFOEX info = new JOYINFOEX();
      info.dwSize = (uint)Marshal.SizeOf(typeof(JOYINFOEX));
      info.dwFlags = JOY_RETURNBUTTONS;
      if (joyGetPosEx(deviceId, ref info) == 0) {
        bool down = (info.dwButtons & mask) != 0;
        if (down && !wasDown) Emit("DOWN");
        else if (!down && wasDown) Emit("UP");
        wasDown = down;
      } else if (wasDown) {
        wasDown = false;
        Emit("UP");
      }
      Thread.Sleep(10);
    }
  }
}
