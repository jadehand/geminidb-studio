import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = file => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

test('bulk generation entry is grouped after the database switcher and uses an external wizard', () => {
  const app = source('App.tsx')
  assert.match(app, /import BulkDataWizard from '\.\/BulkDataWizard'/)
  assert.ok(app.indexOf('database-switcher') < app.indexOf('bulk-entry'))
  assert.match(app, /className="bulk-entry"[^>]*style=\{\{ marginLeft:24 \}\}/)
  assert.doesNotMatch(app, /tool-rail[\s\S]{0,500}bulk-entry/)
})

test('wizard exposes the agreed four-step navigation labels', () => {
  const wizard = source('BulkDataWizard.tsx')
  for (const label of ['目标与 RP', '时间与天表', '字段与约束', '预览与执行']) assert.match(wizard, new RegExp(label))
})

test('wizard offers writable test and development connections but disables production', () => {
  const wizard = source('BulkDataWizard.tsx')
  assert.match(wizard, /item\.environment === 'test' \|\| item\.environment === 'dev'/)
  assert.match(wizard, /测试、开发可写/)
})
