import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  keyboardEventToAccelerator,
  parseJoystickHotkey,
  parseWindowsHotkeyAccelerator,
  type HotkeyKeyboardEvent,
} from '../src/shared/overlay-hotkey'

function keyboardEvent(overrides: Partial<HotkeyKeyboardEvent>): HotkeyKeyboardEvent {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  }
}

assert.equal(keyboardEventToAccelerator(keyboardEvent({ key: 'm', code: 'KeyM' })), 'M')
assert.equal(keyboardEventToAccelerator(keyboardEvent({ key: 'F9', code: 'F9' })), 'F9')
assert.equal(keyboardEventToAccelerator(keyboardEvent({ key: 'Escape', code: 'Escape' })), 'Escape')
assert.equal(
  keyboardEventToAccelerator(keyboardEvent({ key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })),
  'Control+Alt+M',
)
assert.equal(
  keyboardEventToAccelerator(keyboardEvent({ key: 'm', code: 'KeyM', metaKey: true })),
  'Super+M',
)
assert.equal(
  keyboardEventToAccelerator(keyboardEvent({ key: 'End', code: 'Numpad1' })),
  'num1',
)
assert.equal(
  keyboardEventToAccelerator(keyboardEvent({ key: ';', code: 'Semicolon' })),
  'Semicolon',
)
assert.equal(
  keyboardEventToAccelerator(keyboardEvent({ key: '+', code: 'Equal', shiftKey: true })),
  'Shift+Plus',
)
assert.equal(keyboardEventToAccelerator(keyboardEvent({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null)

assert.deepEqual(parseWindowsHotkeyAccelerator('M'), { vkCode: 0x4D, mods: 0 })
assert.deepEqual(parseWindowsHotkeyAccelerator('F9'), { vkCode: 0x78, mods: 0 })
assert.deepEqual(parseWindowsHotkeyAccelerator('Control+Alt+M'), { vkCode: 0x4D, mods: 0x03 })
assert.deepEqual(parseWindowsHotkeyAccelerator('Super+M'), { vkCode: 0x4D, mods: 0x08 })
assert.deepEqual(parseWindowsHotkeyAccelerator('Semicolon'), { vkCode: 0xBA, mods: 0 })
assert.deepEqual(parseWindowsHotkeyAccelerator('Shift+Plus'), { vkCode: 0xBB, mods: 0x04 })
assert.deepEqual(parseWindowsHotkeyAccelerator('num1'), { vkCode: 0x61, mods: 0 })
assert.equal(parseWindowsHotkeyAccelerator('Control+Alt'), null)
assert.equal(parseWindowsHotkeyAccelerator('A+B'), null)
assert.equal(parseWindowsHotkeyAccelerator('UnsupportedKey'), null)

assert.deepEqual(parseJoystickHotkey('JOY:0:BUTTON:7'), { deviceIndex: 0, buttonIndex: 7 })
assert.equal(parseJoystickHotkey('JOY:0:AXIS:1'), null)

const repositoryRoot = path.resolve(process.cwd())
const hookSource = fs.readFileSync(path.join(repositoryRoot, 'electron', 'native', 'windows', 'keyboard-hook.cs'), 'utf8')
const mainSource = fs.readFileSync(path.join(repositoryRoot, 'electron', 'main.ts'), 'utf8')
assert.match(hookSource, /return CallNextHookEx\(_hookId, nCode, wParam, lParam\);/)
assert.doesNotMatch(hookSource, /return \(IntPtr\)1;/)
assert.doesNotMatch(mainSource, /globalShortcut/)

console.log('overlay hotkey integration checks passed')
