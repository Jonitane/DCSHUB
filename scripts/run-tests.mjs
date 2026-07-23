import { spawn } from 'node:child_process'

const suites = [
  'test:core-architecture',
  'test:core-native',
  'test:dcs-launch',
  'test:mod-manager',
  'test:software-catalog',
  'test:srs',
  'test:i18n',
  'test:update',
  'test:logging',
  'test:vr-overlay',
  'test:manual-library',
]

function runSuite(name) {
  return new Promise((resolve) => {
    const executable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm'
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', `npm.cmd run ${name}`] : ['run', name]
    const child = spawn(executable, args, {
      stdio: 'inherit',
      windowsHide: true,
    })
    child.on('error', (error) => resolve({ name, code: 1, error }))
    child.on('exit', (code) => resolve({ name, code: code ?? 1 }))
  })
}

const results = await Promise.all(suites.map(runSuite))
const failed = results.filter((result) => result.code !== 0)
if (failed.length > 0) {
  console.error(`\n${failed.length} test suite(s) failed:`)
  for (const result of failed) console.error(`- ${result.name}${result.error ? `: ${result.error.message}` : ''}`)
  process.exitCode = 1
} else {
  console.log(`\nAll ${results.length} test suites passed.`)
}
