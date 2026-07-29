import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { executeWriteBatch, validateWriteBatchForSession } from './command-execution.mjs'

test('stops after the first failed statement and reports remaining work', async () => {
  const executed = []
  const result = await executeWriteBatch({
    script:'INSERT m value=1 1; INSERT m value=2 2; INSERT m value=3 3',
    session:{ environment:'dev' },
    database:'metrics',
    executeInsert:async statement => {
      executed.push(statement)
      if (executed.length === 2) throw new Error('upstream failed')
    },
    executeWrite:async () => assert.fail('unexpected WRITE'),
  })
  assert.deepEqual(executed, ['INSERT m value=1 1', 'INSERT m value=2 2'])
  assert.deepEqual(result.summary, { total:3, succeeded:1, failed:1, skipped:1 })
  assert.equal(result.failedIndex, 1)
  assert.equal(result.error, 'upstream failed')
})

test('rejects production before parsing or calling either executor', async () => {
  let calls = 0
  await assert.rejects(
    executeWriteBatch({
      script:'not a valid command',
      session:{ environment:'prod' },
      database:'metrics',
      executeInsert:async () => { calls++ },
      executeWrite:async () => { calls++ },
    }),
    error => error.code === 'PRODUCTION_READ_ONLY' && error.status === 403,
  )
  assert.equal(calls, 0)
})

test('marks malformed write scripts as client errors', async () => {
  await assert.rejects(
    executeWriteBatch({
      script:'not a valid command',
      session:{ environment:'dev' },
      database:'metrics',
      executeInsert:async () => assert.fail('unexpected INSERT'),
      executeWrite:async () => assert.fail('unexpected WRITE'),
    }),
    error => error.code === 'UNSUPPORTED_COMMAND' && error.status === 400,
  )
})

test('executes WRITE without its client prefix and reports success', async () => {
  const writes = []
  const result = await executeWriteBatch({
    script:'WRITE cpu,host=node-01 value=42 1',
    session:{ environment:'test' },
    database:'metrics',
    executeInsert:async () => assert.fail('unexpected INSERT'),
    executeWrite:async statement => writes.push(statement),
  })
  assert.deepEqual(writes, ['cpu,host=node-01 value=42 1'])
  assert.deepEqual(result, { summary:{ total:1, succeeded:1, failed:0, skipped:0 } })
})

test('validates three write statements without executing them', () => {
  const result = validateWriteBatchForSession({
    script:'INSERT m value=1 1; WRITE m value=2 2; INSERT INTO rp m value=3 3',
    session:{ environment:'dev' },
  })
  assert.deepEqual(result, { statementCount:3, kind:'write-batch' })
})

test('validation rejects production before parsing a malformed script', () => {
  assert.throws(
    () => validateWriteBatchForSession({ script:'not a valid command', session:{ environment:'prod' } }),
    error => error.code === 'PRODUCTION_READ_ONLY' && error.status === 403,
  )
})

test('validation rejects mixed read and write scripts as a client error', () => {
  assert.throws(
    () => validateWriteBatchForSession({ script:'SELECT * FROM m; WRITE m value=1 1', session:{ environment:'test' } }),
    error => error.code === 'MIXED_COMMAND_BATCH' && error.status === 400,
  )
})

test('server registers validation before execution without executors', () => {
  const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')
  const validationStart = source.indexOf("url.pathname==='/commands/validate'")
  const executionStart = source.indexOf("url.pathname==='/commands'")
  assert.ok(validationStart >= 0)
  assert.ok(validationStart < executionStart)
  const validationRoute = source.slice(validationStart, executionStart)
  assert.match(validationRoute, /validateWriteBatchForSession/)
  assert.doesNotMatch(validationRoute, /influxCommand|influxWrite|executeWriteBatch/)
})
