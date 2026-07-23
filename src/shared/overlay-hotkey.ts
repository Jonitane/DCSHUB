export interface HotkeyKeyboardEvent {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export interface ParsedWindowsHotkey {
  vkCode: number
  mods: number
}

export interface ParsedJoystickHotkey {
  deviceIndex: number
  buttonIndex: number
}

const WINDOWS_VK_BY_KEY: Readonly<Record<string, number>> = {
  escape: 0x1B,
  esc: 0x1B,
  tab: 0x09,
  space: 0x20,
  spacebar: 0x20,
  enter: 0x0D,
  return: 0x0D,
  backspace: 0x08,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  delete: 0x2E,
  insert: 0x2D,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  capslock: 0x14,
  numlock: 0x90,
  scrolllock: 0x91,
  pause: 0x13,
  printscreen: 0x2C,
  nummult: 0x6A,
  numadd: 0x6B,
  numsub: 0x6D,
  numdec: 0x6E,
  numdiv: 0x6F,
  semicolon: 0xBA,
  plus: 0xBB,
  equal: 0xBB,
  comma: 0xBC,
  minus: 0xBD,
  period: 0xBE,
  slash: 0xBF,
  backquote: 0xC0,
  leftbracket: 0xDB,
  backslash: 0xDC,
  rightbracket: 0xDD,
  quote: 0xDE,
}

export function keyboardEventToAccelerator(event: HotkeyKeyboardEvent): string | null {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')

  let key = event.key
  const code = event.code

  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null

  if (code.startsWith('Numpad')) {
    const num = code.replace('Numpad', '')
    if (/^[0-9]$/.test(num)) key = `num${num}`
    else if (code === 'NumpadAdd') key = 'numadd'
    else if (code === 'NumpadSubtract') key = 'numsub'
    else if (code === 'NumpadMultiply') key = 'nummult'
    else if (code === 'NumpadDivide') key = 'numdiv'
    else if (code === 'NumpadDecimal') key = 'numdec'
    else if (code === 'NumpadEnter') key = 'Enter'
    else return null
  } else if (key === ' ' || code === 'Space') key = 'Space'
  else if (key === 'Escape' || key === 'Esc') key = 'Escape'
  else if (key === 'Enter' || key === 'Return') key = 'Enter'
  else if (key === 'ArrowUp') key = 'Up'
  else if (key === 'ArrowDown') key = 'Down'
  else if (key === 'ArrowLeft') key = 'Left'
  else if (key === 'ArrowRight') key = 'Right'
  else if (['Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'CapsLock', 'NumLock', 'ScrollLock', 'Pause', 'PrintScreen'].includes(key)) {
    // Keep the canonical DOM key name.
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    // Keep F1-F24 as-is.
  } else if (/^[a-zA-Z]$/.test(key)) key = key.toUpperCase()
  else if (/^[0-9]$/.test(key)) {
    // Keep 0-9 as-is.
  } else if (key === '+') key = 'Plus'
  else if (key === '=' || code === 'Equal') key = 'Equal'
  else if (key === '-' || code === 'Minus') key = 'Minus'
  else if (key === ',' || code === 'Comma') key = 'Comma'
  else if (key === '.' || code === 'Period') key = 'Period'
  else if (key === '/' || code === 'Slash') key = 'Slash'
  else if (key === '\\' || code === 'Backslash') key = 'Backslash'
  else if (key === ';' || code === 'Semicolon') key = 'Semicolon'
  else if (key === "'" || code === 'Quote') key = 'Quote'
  else if (key === '[' || code === 'BracketLeft') key = 'LeftBracket'
  else if (key === ']' || code === 'BracketRight') key = 'RightBracket'
  else if (key === '`' || code === 'Backquote') key = 'Backquote'
  else return null

  parts.push(key)
  return parts.join('+')
}

export function parseWindowsHotkeyAccelerator(accelerator: string): ParsedWindowsHotkey | null {
  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase())
  let mods = 0
  let key = ''
  for (const part of parts) {
    if (!part) continue
    if (part === 'ctrl' || part === 'control' || part === 'cmd' || part === 'command' || part === 'commandorcontrol') mods |= 0x02
    else if (part === 'shift') mods |= 0x04
    else if (part === 'alt' || part === 'option') mods |= 0x01
    else if (part === 'super' || part === 'meta' || part === 'win' || part === 'windows') mods |= 0x08
    else if (key) return null
    else key = part
  }
  if (!key) return null

  let vkCode = WINDOWS_VK_BY_KEY[key] ?? 0
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) vkCode = 0x6F + Number.parseInt(key.slice(1), 10)
  else if (/^[a-z]$/.test(key)) vkCode = key.toUpperCase().charCodeAt(0)
  else if (/^[0-9]$/.test(key)) vkCode = 0x30 + Number.parseInt(key, 10)
  else if (/^num[0-9]$/.test(key)) vkCode = 0x60 + Number.parseInt(key.slice(3), 10)

  return vkCode ? { vkCode, mods } : null
}

export function parseJoystickHotkey(hotkey: string): ParsedJoystickHotkey | null {
  const match = /^JOY:(\d+):BUTTON:(\d+)$/i.exec(hotkey)
  if (!match) return null
  return {
    deviceIndex: Number.parseInt(match[1], 10),
    buttonIndex: Number.parseInt(match[2], 10),
  }
}
