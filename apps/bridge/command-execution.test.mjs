import assert from 'node:assert/strict'
import test from 'node:test'
import { executeWriteBatch } from './command-execution.mjs'

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
