import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { executeSingleQuery, executeWriteBatch, validateWriteBatchForSession } from './command-execution.mjs'

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

test('single-query execution rejects query scripts containing writes before upstream', async () => {
  for (const script of ['SELECT * FROM m; INSERT m value=1 1', 'SHOW MEASUREMENTS; WRITE m value=1 1']) {
    let upstreamCalls = 0
    await assert.rejects(
      executeSingleQuery({ script, executeQuery:async () => { upstreamCalls++ } }),
      error => error.code === 'MIXED_COMMAND_BATCH' && error.status === 400,
    )
    assert.equal(upstreamCalls, 0)
  }
})

test('single-query execution rejects multiple queries before upstream', async () => {
  let upstreamCalls = 0
  await assert.rejects(
    executeSingleQuery({ script:'SELECT * FROM m; SELECT * FROM n', executeQuery:async () => { upstreamCalls++ } }),
    error => error.code === 'MULTI_STATEMENT_QUERY_UNSUPPORTED' && error.status === 400,
  )
  assert.equal(upstreamCalls, 0)
})

test('single-query execution rejects direct writes and empty scripts', async () => {
  for (const [script, code] of [['WRITE m value=1 1', 'WRITE_REQUIRES_COMMANDS_ENDPOINT'], [' ; ', 'EMPTY_SQL']]) {
    await assert.rejects(
      executeSingleQuery({ script, executeQuery:async () => assert.fail('unexpected upstream query') }),
      error => error.code === code && error.status === 400,
    )
  }
})

test('single-query execution forwards one query and preserves the response shape', async () => {
  const queries = []
  const result = await executeSingleQuery({
    script:' SELECT value FROM cpu LIMIT 1; ',
    executeQuery:async statement => {
      queries.push(statement)
      return { rows:[{ value:42 }], durationMs:7 }
    },
  })
  assert.deepEqual(queries, ['SELECT value FROM cpu LIMIT 1'])
  assert.deepEqual(result, { rows:[{ value:42 }], rowCount:1, durationMs:7, hasMore:false })
})

test('server query route uses the single-query guard', () => {
  const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')
  const queryStart = source.indexOf("url.pathname==='/query'")
  const nextRoute = source.indexOf("url.pathname==='/claude/probe'", queryStart)
  assert.ok(queryStart >= 0)
  assert.ok(nextRoute > queryStart)
  assert.match(source.slice(queryStart, nextRoute), /executeSingleQuery/)
})
