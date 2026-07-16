import assert from 'node:assert/strict'
import { normalizeLanguage, translateStaticText } from '../src/lib/i18n-core'

assert.equal(normalizeLanguage(null), 'zh-CN')
assert.equal(normalizeLanguage('zh-CN'), 'zh-CN')
assert.equal(normalizeLanguage('en-US'), 'en-US')
assert.equal(normalizeLanguage('fr-FR'), 'zh-CN')

assert.equal(translateStaticText('仪表板', 'zh-CN'), '仪表板')
assert.equal(translateStaticText('仪表板', 'en-US'), 'Dashboard')
assert.equal(translateStaticText('  一键启动  ', 'en-US'), '  Launch All  ')
assert.equal(translateStaticText('已选择 4 个模块', 'en-US'), '4 modules selected')
assert.equal(translateStaticText('检查更新 · V1.7', 'en-US'), 'Check for Updates · V1.7')
assert.equal(translateStaticText('启动 VoxBind', 'en-US'), 'Start VoxBind')
assert.equal(translateStaticText('用户自定义名称', 'en-US'), '用户自定义名称')

console.log('i18n integration: ok')
