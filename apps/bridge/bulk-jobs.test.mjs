import assert from 'node:assert/strict'
import test from 'node:test'
import { createBulkJobManager } from './bulk-jobs.mjs'

function plan(dates = ['2026-07-25', '2026-07-26'], pointsPerDate = 1_001) {
  return {
    targets: dates.map((date, dateIndex) => ({
      date,
      measurement: `cpu_${dateIndex}`,
      timestamps: Array.from({ length: pointsPerDate }, (_, index) => index + dateIndex * 10_000),
    })),
    tags: [],
    fields: [{ name: 'value', type: 'integer', generator: { kind: 'fixed', value: 1 } }],
    constraints: [],
  }
}

async function waitFor(manager, id, status) {
  for (let index = 0; index < 200; index += 1) {
    const snapshot = manager.get(id)
    if (snapshot?.status === status) return snapshot
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail(`job ${id} did not reach ${status}`)
}

async function waitForSnapshot(manager, id, predicate) {
  for (let index = 0; index < 200; index += 1) {
    const snapshot = manager.get(id)
    if (snapshot && predicate(snapshot)) return snapshot
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail(`job ${id} did not reach the expected snapshot`)
}

test('schedules batches in date order with no more than two in flight', async () => {
  const writes = []
  let active = 0
  let peak = 0
  const manager = createBulkJobManager({
    writeBatch: async request => {
      active += 1
      peak = Math.max(peak, active)
      writes.push({ measurement: request.measurement, batchIndex: request.batchIndex, body: request.body })
      await new Promise(resolve => setImmediate(resolve))
      active -= 1
    },
  })

  const started = manager.start({ id: 'success', connectionIdentity: 'conn-a', plan: plan(), seed: 'seed' })
  assert.equal(started.status, 'running')
  const finished = await waitFor(manager, 'success', 'succeeded')

  assert.equal(finished.completedPoints, 2_002)
  assert.equal(finished.completedBatches, 4)
  assert.equal(peak, 2)
  assert.deepEqual(writes.map(write => write.measurement), ['cpu_0', 'cpu_0', 'cpu_1', 'cpu_1'])
  assert.deepEqual(writes.map(write => write.batchIndex), [0, 1, 0, 1])
  assert.ok(writes.every(write => write.body.split('\n').length <= 1_000))
  assert.equal(manager.active(), null)
  assert.throws(() => { finished.status = 'paused' }, TypeError)
})

test('retries allowed failures, pauses after the fourth failure, and resumes exact bytes', async () => {
  const writes = []
  const delays = []
  let failures = 4
  const manager = createBulkJobManager({
    writeBatch: async request => {
      writes.push(request.body)
      if (failures > 0) {
        failures -= 1
        throw Object.assign(new Error('temporary'), { statusCode: 503 })
      }
    },
    sleep: async delay => { delays.push(delay) },
    randomJitter: () => 0,
  })
  const started = manager.start({ id: 'resume', connectionIdentity: 'conn-a', plan: plan(['2026-07-25'], 2), seed: 'seed' })
  await waitFor(manager, started.id, 'paused')
  assert.deepEqual(delays, [250, 500, 1_000])
  assert.equal(manager.get(started.id).retryCount, 3)
  assert.equal(writes.length, 4)
  assert.throws(() => manager.start({ id: 'second', connectionIdentity: 'conn-a', plan: plan(['2026-07-26'], 1), seed: 'other' }), error => error.code === 'BULK_JOB_ACTIVE')

  manager.resume(started.id)
  const finished = await waitFor(manager, started.id, 'succeeded')
  assert.equal(finished.completedBatches, 1)
  assert.equal(writes[0], writes.at(-1))

  const failedManager = createBulkJobManager({ writeBatch: async () => { throw Object.assign(new Error('bad request'), { statusCode: 400 }) } })
  const failed = failedManager.start({ id: 'failed', connectionIdentity: 'conn-b', plan: plan(['2026-07-25'], 1), seed: 'seed' })
  assert.equal((await waitFor(failedManager, failed.id, 'failed')).lastError.code, '400')

  let misleadingAttempts = 0
  const misleadingManager = createBulkJobManager({
    writeBatch: async () => {
      misleadingAttempts += 1
      throw Object.assign(new Error('bad request'), { statusCode: 400, retryable: true })
    },
  })
  const misleading = misleadingManager.start({ id: 'misleading', connectionIdentity: 'conn-c', plan: plan(['2026-07-25'], 1), seed: 'seed' })
  assert.equal((await waitFor(misleadingManager, misleading.id, 'failed')).lastError.code, '400')
  assert.equal(misleadingAttempts, 1)
})

test('records a later in-flight success while paused and skips it on resume', async () => {
  let releaseSecond
  const secondMayFinish = new Promise(resolve => { releaseSecond = resolve })
  const writes = []
  let firstFailures = 4
  const manager = createBulkJobManager({
    writeBatch: async request => {
      writes.push({ batchIndex: request.batchIndex, body: request.body })
      if (request.batchIndex === 0 && firstFailures > 0) {
        firstFailures -= 1
        throw Object.assign(new Error('temporary'), { retryable: true })
      }
      if (request.batchIndex === 1) await secondMayFinish
    },
    sleep: async () => {},
    randomJitter: () => 0,
  })

  const started = manager.start({
    id: 'in-flight',
    connectionIdentity: 'conn-a',
    plan: plan(['2026-07-25'], 1_001),
    seed: 'seed',
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(manager.get(started.id).status, 'running')
  releaseSecond()
  await waitFor(manager, started.id, 'paused')
  await waitForSnapshot(manager, started.id, snapshot => snapshot.completedBatches === 1)

  manager.resume(started.id)
  const finished = await waitFor(manager, started.id, 'succeeded')
  assert.equal(finished.completedBatches, 2)
  assert.equal(writes.filter(write => write.batchIndex === 1).length, 1)
  assert.equal(writes.filter(write => write.batchIndex === 0).length, 5)
  assert.equal(writes.find(write => write.batchIndex === 0).body, writes.at(-1).body)
})

test('does not expose paused until every old in-flight write has settled', async () => {
  let releaseSecond
  const secondMayFinish = new Promise(resolve => { releaseSecond = resolve })
  const calls = []
  let firstFailures = 4
  const manager = createBulkJobManager({
    writeBatch: async request => {
      calls.push(request.batchIndex)
      if (request.batchIndex === 0 && firstFailures > 0) {
        firstFailures -= 1
        throw Object.assign(new Error('temporary'), { retryable: true })
      }
      if (request.batchIndex === 1) await secondMayFinish
    },
    sleep: async () => {},
    randomJitter: () => 0,
  })
  const started = manager.start({
    id: 'pause-barrier',
    connectionIdentity: 'conn-a',
    plan: plan(['2026-07-25'], 1_001),
    seed: 'seed',
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(manager.get(started.id).status, 'running')
  assert.throws(() => manager.resume(started.id), error => error.code === 'BULK_JOB_NOT_PAUSED')

  releaseSecond()
  await waitFor(manager, started.id, 'paused')
  manager.resume(started.id)
  const finished = await waitFor(manager, started.id, 'succeeded')
  assert.equal(finished.completedBatches, finished.totalBatches)
  assert.deepEqual(calls, [0, 1, 0, 0, 0, 0])
})

test('cancel aborts in-flight writes, is idempotent, and shutdown resolves after cancellation', async () => {
  let aborted = false
  const manager = createBulkJobManager({
    writeBatch: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }, { once: true })
    }),
  })
  const started = manager.start({ id: 'cancel', connectionIdentity: 'conn-a', plan: plan(['2026-07-25'], 2_001), seed: 'seed' })
  await new Promise(resolve => setImmediate(resolve))
  await manager.cancel(started.id)
  const cancelled = manager.get(started.id)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(aborted, true)
  await manager.cancel(started.id)

  const second = createBulkJobManager({ writeBatch: () => new Promise(() => {}) })
  second.start({ id: 'shutdown', connectionIdentity: 'conn-a', plan: plan(['2026-07-25'], 1), seed: 'seed' })
  await second.shutdown({ timeoutMs:0 })
  assert.equal(second.get('shutdown').status, 'cancelled')
})
