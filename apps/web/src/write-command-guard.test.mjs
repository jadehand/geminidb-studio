import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createWriteExecutionLock, isWriteConfirmationCurrent, isWriteExecutionCurrent } from './write-command-guard.ts'

test('write confirmation is invalid after changing connection, database, or effective policy', () => {
  const confirmation = { command:'INSERT cpu value=1 1', statementCount:1, connectionId:'dev-1', database:'metrics', environment:'dev', sessionGeneration:4 }
  const current = { id:'dev-1', environment:'dev' }
  assert.equal(isWriteConfirmationCurrent(confirmation, { connection:current, database:'metrics', sessionGeneration:4 }), true)
  assert.equal(isWriteConfirmationCurrent(confirmation, { connection:{ ...current, id:'test-1' }, database:'metrics', sessionGeneration:4 }), false)
  assert.equal(isWriteConfirmationCurrent(confirmation, { connection:current, database:'other_metrics', sessionGeneration:4 }), false)
  assert.equal(isWriteConfirmationCurrent(confirmation, { connection:{ ...current, environment:'prod' }, database:'metrics', sessionGeneration:4 }), false)
  assert.equal(isWriteConfirmationCurrent(confirmation, { connection:current, database:'metrics', sessionGeneration:5 }), false)
})

test('write execution lock only permits one in-flight batch', () => {
  const lock = createWriteExecutionLock()
  assert.equal(lock.tryAcquire(), true)
  assert.equal(lock.tryAcquire(), false)
  lock.release()
  assert.equal(lock.tryAcquire(), true)
})

test('old write completion is ignored after execution token or context version changes', () => {
  const execution = { command:'INSERT cpu value=1 1', statementCount:1, connectionId:'dev-1', database:'metrics', environment:'dev', sessionGeneration:4, executionId:7, contextVersion:11 }
  const current = { connection:{ id:'dev-1', environment:'dev' }, database:'metrics', sessionGeneration:4, executionId:7, contextVersion:11 }
  assert.equal(isWriteExecutionCurrent(execution, current), true)
  assert.equal(isWriteExecutionCurrent(execution, { ...current, executionId:8 }), false)
  assert.equal(isWriteExecutionCurrent(execution, { ...current, contextVersion:12 }), false)
})

test('app aborts and invalidates validation on context changes and guards execution', () => {
  const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(source, /const validationAbort = useRef<AbortController \| null>\(null\)/)
  assert.match(source, /const validationRequest = useRef\(0\)/)
  assert.match(source, /const writeAbort = useRef<AbortController \| null>\(null\)/)
  assert.match(source, /const writeExecutionRequest = useRef\(0\)/)
  assert.match(source, /const writeContextVersion = useRef\(0\)/)
  assert.match(source, /const writeExecutionLock = useRef\(createWriteExecutionLock\(\)\)/)
  assert.match(source, /const connectionSession = useRef\(0\)/)
  assert.match(source, /const sessionGeneration = \+\+connectionSession\.current/)
  assert.match(source, /validationAbort\.current\?\.abort\(\)/)
  assert.match(source, /const requestId = \+\+validationRequest\.current/)
  assert.match(source, /isWriteConfirmationCurrent\(confirmation, \{ connection:currentConnectionRef\.current, database:databaseRef\.current, sessionGeneration:connectionSession\.current \}\)/)
  assert.match(source, /writeExecutionLock\.current\.tryAcquire\(\)/)
  assert.match(source, /writeExecutionLock\.current\.release\(\)/)
  assert.match(source, /bridge\.executeCommands\(snapshot\.database, command, controller\.signal\)/)
  assert.match(source, /executing=\{running\}/)
})

test('write execution uses its own abort ref and snapshot database for history', () => {
  const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const writeExecution = source.slice(source.indexOf('async function executeWriteCommand'), source.indexOf('async function runQuery'))
  assert.match(writeExecution, /writeAbort\.current = controller/)
  assert.doesNotMatch(writeExecution, /queryAbort\.current = controller/)
  assert.match(writeExecution, /isWriteExecutionCurrent\(snapshot,/)
  assert.match(writeExecution, /addHistory\([^\n]+snapshot\.database\)/)
  assert.match(writeExecution, /writeAbort\.current === controller/)
  assert.match(source, /writeAbort\.current\?\.abort\(\)/)
})
