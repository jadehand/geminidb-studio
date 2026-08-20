import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveWorkspaceTabName } from './workspace-tab-rename.ts'

test('inline tab rename trims committed names and keeps the original on cancel or blank input',()=>{
  assert.equal(resolveWorkspaceTabName('查询 2','  每日巡检  ','commit'),'每日巡检')
  assert.equal(resolveWorkspaceTabName('查询 2','新名称','cancel'),'查询 2')
  assert.equal(resolveWorkspaceTabName('查询 2','   ','commit'),'查询 2')
})
