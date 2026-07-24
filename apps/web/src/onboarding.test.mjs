import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const model=readFileSync(new URL('./onboarding.ts',import.meta.url),'utf8')
const app=readFileSync(new URL('./App.tsx',import.meta.url),'utf8')
const component=readFileSync(new URL('./FeatureTour.tsx',import.meta.url),'utf8')

test('首次导览覆盖核心查询流程和实用技巧',()=>{
  for(const target of ['database-switcher','catalog','query-editor','execute-query','query-results','result-actions','time-converter']){
    assert.match(model,new RegExp(`target: '${target}'`))
    assert.match(app,new RegExp(`data-tour="${target}"`))
  }
  assert.match(model,/Ctrl \+ Space/)
  assert.match(model,/CSV、Excel、JSON/)
  assert.match(model,/UTC、北京时间和 Unix 时间戳/)
})

test('导览可跳过、完成、前后导航并显示进度',()=>{
  assert.match(component,/onClick=\{onSkip\}>跳过/)
  assert.match(component,/开始使用/)
  assert.match(component,/上一步/)
  assert.match(component,/\{index \+ 1\} \/ \{steps\.length\}/)
  assert.match(component,/event\.key === 'Escape'/)
})

test('现有用户不会被强制重复引导，并提供重新查看入口',()=>{
  assert.match(model,/return databaseHintSeen \? 'completed' : 'new'/)
  assert.match(app,/title="重新查看功能导览"/)
  assert.match(model,/gdb\.onboarding\.v1\.status/)
})
