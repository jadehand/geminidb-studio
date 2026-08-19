import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('personal notes is an independent workspace with safe preview and query handoff',()=>{
  const app=fs.readFileSync(new URL('./App.tsx',import.meta.url),'utf8')
  const workspace=fs.readFileSync(new URL('./NotesWorkspace.tsx',import.meta.url),'utf8')
  const desktop=fs.readFileSync(new URL('./desktop.ts',import.meta.url),'utf8')
  assert.match(app,/个人笔记/)
  assert.match(workspace,/保存当前 SQL/)
  assert.match(workspace,/放入新查询/)
  assert.doesNotMatch(workspace,/dangerouslySetInnerHTML/)
  for (const command of ['authorize_notes_directory','list_notes','write_note','rename_note','delete_note']) assert.match(desktop,new RegExp(command))
})

test('personal notes lives in the tool rail with a deliberate empty and reading layout',()=>{
  const app=fs.readFileSync(new URL('./App.tsx',import.meta.url),'utf8')
  const workspace=fs.readFileSync(new URL('./NotesWorkspace.tsx',import.meta.url),'utf8')
  const css=fs.readFileSync(new URL('./notes-workspace.css',import.meta.url),'utf8')

  assert.doesNotMatch(app,/className="primary-workspaces"/)
  assert.match(app,/title="个人笔记"/)
  assert.match(workspace,/notes-empty-card/)
  assert.match(workspace,/更换目录/)
  assert.match(css,/\.app\.notes-active>\.left-sidebar/)
  assert.match(css,/\.notes-preview-content/)
  assert.match(css,/\.notes-workspace\.notes-empty\{grid-template-columns:1fr\}/)
  assert.match(css,/:root\[data-theme="dark"\] \.notes-preview/)
})
