import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

test('新建连接使用中性名称示例并展示完整 HTTP 地址示例', () => {
  assert.match(source, /placeholder="例如：生产环境"/)
  assert.match(source, /placeholder="例如：http:\/\/192\.168\.1\.10:8635"/)
  assert.doesNotMatch(source, /生产监控库/)
})
