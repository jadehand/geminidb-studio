import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createClaudeSettingsStore } from './claude-settings.mjs'

test('Claude CLI path persists locally and blank restores automatic detection',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'gdb-claude-settings-'))
  t.after(()=>import('node:fs/promises').then(({rm})=>rm(dataDir,{recursive:true,force:true})))
  const first=createClaudeSettingsStore({dataDir,fallbackCommand:'claude'})
  await first.init()
  assert.deepEqual(first.get(),{cliPath:''})
  assert.equal(first.command(),'claude')
  await first.update({cliPath:' C:/Tools/claude.exe '})
  assert.equal(first.command(),'C:/Tools/claude.exe')

  const restored=createClaudeSettingsStore({dataDir,fallbackCommand:'claude'})
  await restored.init()
  assert.deepEqual(restored.get(),{cliPath:'C:/Tools/claude.exe'})
  await restored.update({cliPath:''})
  assert.equal(restored.command(),'claude')
  assert.equal(JSON.parse(await readFile(join(dataDir,'claude-assistant','settings.json'),'utf8')).cliPath,'')
})

test('Claude settings reject unsupported fields and unsafe path text',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'gdb-claude-settings-'))
  t.after(()=>import('node:fs/promises').then(({rm})=>rm(dataDir,{recursive:true,force:true})))
  const store=createClaudeSettingsStore({dataDir})
  await store.init()
  assert.throws(()=>store.update({cliPath:'bad\npath'}),error=>error.code==='CLAUDE_SETTINGS_INVALID')
  await assert.rejects(()=>store.update({cliPath:'claude',extra:true}),error=>error.code==='CLAUDE_SETTINGS_INVALID')
})
