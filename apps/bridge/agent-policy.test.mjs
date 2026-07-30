import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertBudget,
  assertQuerySql,
  assertToolEnvironment,
  redactSensitive,
} from './agent-policy.mjs'
import {
  AGENT_LIMITS,
  AgentError,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
} from './agent-types.mjs'

test('allows read tools in dev and test but blocks prod and unknown environments', () => {
  assert.doesNotThrow(() => assertToolEnvironment({ environment:'dev', readOnly:false }, 'query_influxql'))
  assert.doesNotThrow(() => assertToolEnvironment({ environment:'test', readOnly:true }, 'query_influxql'))
  assert.throws(() => assertToolEnvironment({ environment:'prod', readOnly:false }, 'query_influxql'), error => error.code === 'AGENT_POLICY_DENIED')
  assert.throws(() => assertToolEnvironment({ environment:'staging', readOnly:false }, 'query_influxql'), error => error.code === 'AGENT_POLICY_DENIED')
  assert.throws(() => assertToolEnvironment({ readOnly:false }, 'query_influxql'), error => error.code === 'AGENT_POLICY_DENIED')
})

test('allows write tools only on writable dev and test connections', () => {
  assert.doesNotThrow(() => assertToolEnvironment({ environment:'dev', readOnly:false }, 'write_points'))
  assert.doesNotThrow(() => assertToolEnvironment({ environment:'test', readOnly:false }, 'write_points'))
  for (const tool of ['write_points', 'create_bulk_job']) {
    assert.throws(() => assertToolEnvironment({ environment:'dev', readOnly:true }, tool), error => error.code === 'AGENT_POLICY_DENIED')
    assert.throws(() => assertToolEnvironment({ environment:'test', readOnly:true }, tool), error => error.code === 'AGENT_POLICY_DENIED')
  }
  assert.throws(() => assertToolEnvironment({ environment:'prod', readOnly:false }, 'write_points'), error => error.code === 'AGENT_POLICY_DENIED')
  for (const readOnly of [undefined, null, 0, 'false']) {
    assert.throws(() => assertToolEnvironment({ environment:'dev', readOnly }, 'write_points'), error => error.code === 'AGENT_POLICY_DENIED')
    assert.doesNotThrow(() => assertToolEnvironment({ environment:'dev', readOnly }, 'query_influxql'))
  }
})

test('allows bulk data previews on read-only dev and test connections', () => {
  assert.doesNotThrow(() => assertToolEnvironment({ environment:'dev', readOnly:true }, 'preview_bulk_data'))
  assert.doesNotThrow(() => assertToolEnvironment({ environment:'test', readOnly:true }, 'preview_bulk_data'))
})

test('accepts one read-only InfluxQL statement and rejects mutation or a second statement', () => {
  assert.equal(assertQuerySql('SELECT mean(value) FROM "cpu" LIMIT 10'), 'SELECT mean(value) FROM "cpu" LIMIT 10')
  assert.throws(() => assertQuerySql('SELECT * FROM "cpu"; DROP MEASUREMENT "cpu"'), error => error.code === 'AGENT_POLICY_DENIED')
  assert.throws(() => assertQuerySql('SELECT * INTO "copy" FROM "cpu"'), error => error.code === 'AGENT_POLICY_DENIED')
  for (const sql of ['DELETE FROM "cpu"', 'ALTER RETENTION POLICY x', 'CREATE DATABASE x', 'GRANT ALL ON x TO y', 'REVOKE ALL ON x FROM y']) {
    assert.throws(() => assertQuerySql(sql), error => error.code === 'AGENT_POLICY_DENIED')
  }
})

test('handles comments and strings without allowing SQL bypasses', () => {
  assert.equal(assertQuerySql("SELECT 'DROP; DELETE' AS note FROM \"cpu\" -- harmless"), "SELECT 'DROP; DELETE' AS note FROM \"cpu\" -- harmless")
  assert.equal(assertQuerySql("EXPLAIN SELECT 'into' AS note FROM cpu"), "EXPLAIN SELECT 'into' AS note FROM cpu")
  assert.equal(assertQuerySql('SELECT "INTO; DROP" FROM "cpu" /* harmless ; DELETE */'), 'SELECT "INTO; DROP" FROM "cpu" /* harmless ; DELETE */')
  assert.throws(() => assertQuerySql('EXPLAIN SELECT * INTO copy FROM cpu'), error => error.code === 'AGENT_POLICY_DENIED')
  assert.throws(() => assertQuerySql('SELECT * FROM "cpu" /* comment */; /* hidden */ DROP MEASUREMENT "cpu"'), error => error.code === 'AGENT_POLICY_DENIED')
  assert.throws(() => assertQuerySql('SELECT * FROM "cpu" -- first statement\n; DELETE FROM "cpu"'), error => error.code === 'AGENT_POLICY_DENIED')
})

test('ignores InfluxQL regular expression contents while scanning SQL', () => {
  for (const sql of [
    'SELECT * FROM /INTO;\\/cpu/ WHERE host =~ /a\\/*;INTO/',
    'SHOW MEASUREMENTS WITH MEASUREMENT =~ /cpu;\\/\\*INTO/',
  ]) {
    assert.equal(assertQuerySql(sql), sql)
  }
  assert.equal(assertQuerySql('SELECT usage / 2 FROM cpu'), 'SELECT usage / 2 FROM cpu')
  assert.throws(() => assertQuerySql('EXPLAIN SELECT * INTO copy FROM /cpu/'), error => error.code === 'AGENT_POLICY_DENIED')
})

test('accepts SHOW, DESCRIBE, and EXPLAIN statements', () => {
  for (const sql of ['SHOW MEASUREMENTS', 'DESCRIBE "cpu"', 'EXPLAIN SELECT * FROM "cpu"']) {
    assert.equal(assertQuerySql(sql), sql)
  }
})

test('enforces fixed tool and time budgets', () => {
  assert.doesNotThrow(() => assertBudget({ toolCallCount:11, deadlineAt:10_000 }, 10_000))
  assert.throws(() => assertBudget({ toolCallCount:12, deadlineAt:10_000 }, 9_000), error => error.code === 'AGENT_BUDGET_EXCEEDED')
  assert.throws(() => assertBudget({ toolCallCount:3, deadlineAt:10_000 }, 10_001), error => error.code === 'AGENT_BUDGET_EXCEEDED')
})

test('rejects invalid budget inputs with a uniform AgentError', () => {
  const invalid = [
    [null, 0],
    [[], 0],
    [{ toolCallCount:-1, deadlineAt:10 }, 0],
    [{ toolCallCount:1.5, deadlineAt:10 }, 0],
    [{ toolCallCount:Infinity, deadlineAt:10 }, 0],
    [{ toolCallCount:1, deadlineAt:NaN }, 0],
    [{ toolCallCount:1, deadlineAt:10 }, Infinity],
  ]
  for (const [run, now] of invalid) {
    assert.throws(() => assertBudget(run, now), error => error instanceof AgentError && error.code === 'AGENT_BUDGET_INVALID')
  }
})

test('exports exact agent limits and terminal run statuses', () => {
  assert.deepEqual(AGENT_LIMITS, {
    maxToolCalls:12,
    maxRunMs:300_000,
    maxQueryRows:1_000,
    maxDirectWritePoints:1_000,
  })
  assert.deepEqual(TERMINAL_RUN_STATUSES, [
    'completed',
    'stopped',
    'budget_exceeded',
    'blocked',
    'failed',
    'interrupted',
  ])
  assert.ok(Object.isFrozen(TERMINAL_RUN_STATUSES))
  assert.equal(isTerminalRunStatus('completed'), true)
  assert.equal(isTerminalRunStatus('running'), false)
})

test('AgentError preserves status, code, message, and details', () => {
  const details = { tool:'write_points', reason:'read-only' }
  const error = new AgentError(403, 'AGENT_POLICY_DENIED', 'Write denied', details)

  assert.ok(error instanceof Error)
  assert.ok(error instanceof AgentError)
  assert.equal(error.name, 'AgentError')
  assert.equal(error.status, 403)
  assert.equal(error.code, 'AGENT_POLICY_DENIED')
  assert.equal(error.message, 'Write denied')
  assert.strictEqual(error.details, details)
})

test('recursively redacts exact sensitive keys and preserves token metrics', () => {
  assert.deepEqual(redactSensitive({
    password:'secret',
    nested:{ apiKey:'key', Authorization:'Bearer x', COOKIE:'a=b', inputTokens:42, outputTokens:7 },
    rows:[{ token:'t', secret:'s', sessionId:'id', host:'node-1', value:7 }],
  }), {
    password:'[REDACTED]',
    nested:{ apiKey:'[REDACTED]', Authorization:'[REDACTED]', COOKIE:'[REDACTED]', inputTokens:42, outputTokens:7 },
    rows:[{ token:'[REDACTED]', secret:'[REDACTED]', sessionId:'[REDACTED]', host:'node-1', value:7 }],
  })
})

test('redacts cycles without invoking getters or cloning non-plain instances', () => {
  class Custom {
    constructor() {
      this.token = 'preserved'
    }
  }
  const date = new Date('2026-01-01T00:00:00Z')
  const custom = new Custom()
  let getterCalls = 0
  const object = { date, custom, token:'secret' }
  Object.defineProperty(object, 'computed', {
    enumerable:true,
    get() {
      getterCalls += 1
      return 'secret'
    },
  })
  object.self = object
  const array = [object]
  array.push(array)

  const redacted = redactSensitive(array)
  assert.strictEqual(redacted[0].date, date)
  assert.strictEqual(redacted[0].custom, custom)
  assert.equal(redacted[0].token, '[REDACTED]')
  assert.equal(redacted[0].computed, '[Accessor]')
  assert.equal(redacted[0].self, '[Circular]')
  assert.equal(redacted[1], '[Circular]')
  assert.equal(getterCalls, 0)
  assert.doesNotThrow(() => JSON.stringify(redacted))
})
