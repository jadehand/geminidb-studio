import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForCurrentSchema } from './schema-context.ts'

test('ignores a deferred schema response after its connection context changes', async () => {
  let releaseSchema
  const deferredSchema = new Promise(resolve => { releaseSchema = resolve })
  const requestContext = { connectionId: 'connection-a', database: 'metrics', sessionGeneration: 4, requestId: 8 }
  let currentContext = requestContext

  const result = waitForCurrentSchema(
    () => deferredSchema,
    requestContext,
    context => context.connectionId === currentContext.connectionId
      && context.database === currentContext.database
      && context.sessionGeneration === currentContext.sessionGeneration
      && context.requestId === currentContext.requestId,
  )

  currentContext = { ...currentContext, database: 'other_metrics', requestId: 9 }
  releaseSchema({ fields: [{ name: 'value', type: 'float' }], tags: [] })

  assert.equal(await result, null)
})
