import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const apiSource = readFileSync(new URL('./api.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

test('bridge client validates and executes write command batches', () => {
  assert.match(apiSource, /validateCommands:\s*\(script: string, signal\?: AbortSignal\)\s*=>\s*request<CommandBatchValidation>\('\/commands\/validate'/)
  assert.match(apiSource, /executeCommands:\s*\(database: string, script: string, signal\?: AbortSignal\)\s*=>\s*request<CommandBatchResponse>\('\/commands'/)
  assert.match(apiSource, /body:JSON\.stringify\(\{ database, script \}\)/)
})

test('query editor validates writes before showing confirmation and keeps production read-only', () => {
  assert.match(appSource, /isWriteScript\(command\)/)
  assert.match(appSource, /effectiveReadOnly\(connection\.environment\)[\s\S]{0,160}不能执行写入/)
  assert.match(appSource, /await bridge\.validateCommands\(command, controller\.signal\)/)
  assert.match(appSource, /connectionId:connection\.id, database, environment:connection\.environment/)
  assert.match(appSource, /setWriteConfirmation\(confirmation\)/)
  assert.match(appSource, /<WriteCommandDialog[\s\S]*database=\{writeConfirmation\.database\}[\s\S]*statementCount=\{writeConfirmation\.statementCount\}/)
})

test('confirmed write batch uses one command request and records partial failure as an error', () => {
  const writeExecution = appSource.slice(appSource.indexOf('async function executeWriteCommand'), appSource.indexOf('function cancelQuery'))
  assert.match(writeExecution, /bridge\.executeCommands\(snapshot\.database, command, controller\.signal\)/)
  assert.match(writeExecution, /formatCommandSummary\(data\.summary\)/)
  assert.match(writeExecution, /const partialFailure = data\.summary\.failed > 0/)
  assert.match(writeExecution, /partialFailure \? 'error' : 'success'/)
  assert.match(writeExecution, /addHistory\(command, duration,/)
})
