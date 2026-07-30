import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inspectInfluxQL, lineDiff, localFix } from './diagnostics.ts'

test('识别并修复常见 MySQL 风格语法',()=>{
  const sql='SELECT * FROM `metrics` WHERE `timestamp` >= NOW() - INTERVAL 1 HOUR;'
  const issues=inspectInfluxQL(sql,{fields:[],tags:[]})
  assert.ok(issues.some(issue=>issue.message.includes('反引号')))
  assert.match(localFix(sql),/WHERE "time" >= now\(\) - 1h$/i)
})

test('生成可读的逐行差异',()=>assert.match(lineDiff('SELECT *\nLIMIT 10','SELECT value\nLIMIT 100'),/^- SELECT \*/m))

test('旧 Provider 设置迁移为 CLI 优先和 API 备用策略',async()=>{
  const source=await readFile(new URL('./diagnostic-provider.ts',import.meta.url),'utf8')
  assert.match(source,/migrateClaudeSettings/)
  assert.match(source,/provider: _legacyProvider/)
  assert.match(source,/fallbackToApi:settings\.fallbackToApi \?\? true/)
  assert.match(source,/provider:'cli'/)
  assert.match(source,/provider:'api'/)
})
