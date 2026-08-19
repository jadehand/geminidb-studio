import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Bridge exposes Claude assistant sessions without Agent runtime wiring',async()=>{
  const source=await readFile(new URL('./server.mjs',import.meta.url),'utf8')
  assert.match(source,/createClaudeAssistantApi/)
  assert.match(source,/createClaudeAssistantStore/)
  assert.match(source,/createClaudeCli/)
  assert.doesNotMatch(source,/createAgent|agentStreams|\/agent\//)
  assert.doesNotMatch(source,/agent:\{ready/)
})
