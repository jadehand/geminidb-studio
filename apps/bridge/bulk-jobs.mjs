import { batchLines, iteratePlanLines } from './bulk-generator.mjs'

const BATCH_SIZE = 1_000
const MAX_IN_FLIGHT_PER_DATE = 2
const RETRY_DELAYS = Object.freeze([250, 500, 1_000])
const UNFINISHED = new Set(['running', 'paused', 'cancelling'])

function jobError(message, code) {
  return Object.assign(new Error(message), { code })
}

function isRetryable(error) {
  if (error?.retryable === true) return true
  return [429, 500, 502, 503, 504].includes(Number(error?.statusCode))
}

function publicError(error) {
  if (!error) return null
  const code = error.code ?? error.statusCode ?? 'BULK_WRITE_FAILED'
  return Object.freeze({
    code: String(code),
    message: String(error.message ?? 'Bulk write failed'),
  })
}

function tagCombinationCount(tags) {
  return tags.reduce((count, tag) => count * tag.values.length, 1)
}

function totalsForPlan(plan) {
  const combinations = tagCombinationCount(plan.tags)
  let totalPoints = 0
  let totalBatches = 0
  for (const target of plan.targets) {
    const points = target.timestamps.length * combinations
    totalPoints += points
    totalBatches += Math.ceil(points / BATCH_SIZE)
  }
  return { totalPoints, totalBatches }
}

function snapshot(job) {
  return Object.freeze({
    id: job.id,
    connectionIdentity: job.connectionIdentity,
    status: job.status,
    currentMeasurement: job.currentMeasurement,
    completedPoints: job.completedPoints,
    totalPoints: job.totalPoints,
    completedBatches: job.completedBatches,
    totalBatches: job.totalBatches,
    retryCount: job.retryCount,
    lastError: job.lastError,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
  })
}

function linesForTarget(plan, target, seed, dateIndex) {
  return iteratePlanLines(
    { ...plan, targets: [target] },
    `${seed}:${dateIndex}`,
  )
}

export function createBulkJobManager({
  writeBatch,
  now = () => Date.now(),
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  randomJitter = () => 0,
} = {}) {
  if (typeof writeBatch !== 'function') throw new TypeError('writeBatch is required')

  const jobs = new Map()
  let activeJobId = null

  function touch(job) {
    job.updatedAt = now()
  }

  function setTerminal(job, status, error = null) {
    if (job.status === 'cancelled') return
    job.status = status
    job.lastError = publicError(error)
    job.currentMeasurement = null
    touch(job)
    if (activeJobId === job.id) activeJobId = null
  }

  async function writeWithRetry(job, request) {
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      if (job.abortController.signal.aborted || job.status !== 'running') {
        throw Object.assign(new Error('Bulk job cancelled'), { name: 'AbortError' })
      }
      try {
        await writeBatch({ ...request, signal: job.abortController.signal })
        return
      } catch (error) {
        if (job.abortController.signal.aborted || error?.name === 'AbortError') throw error
        if (!isRetryable(error)) throw error
        if (attempt === RETRY_DELAYS.length) {
          throw Object.assign(error, { bulkRetryExhausted: true })
        }
        job.retryCount += 1
        touch(job)
        const jitter = Number(randomJitter())
        await sleep(RETRY_DELAYS[attempt] + (Number.isFinite(jitter) ? Math.max(0, jitter) : 0))
      }
    }
  }

  async function runDate(job, target, dateIndex) {
    const iterator = batchLines(linesForTarget(job.plan, target, job.seed, dateIndex), BATCH_SIZE)
    let nextBatchIndex = 0

    async function worker() {
      while (job.status === 'running' && !job.abortController.signal.aborted) {
        const current = iterator.next()
        if (current.done) return
        const batchIndex = nextBatchIndex
        nextBatchIndex += 1
        const key = `${dateIndex}:${batchIndex}`
        if (job.completedBatchKeys.has(key)) continue
        const body = current.value.join('\n')
        try {
          await writeWithRetry(job, {
            connectionIdentity: job.connectionIdentity,
            measurement: target.measurement,
            dateIndex,
            batchIndex,
            body,
            pointCount: current.value.length,
          })
          if (job.status === 'cancelled') return
          job.completedBatchKeys.add(key)
          job.completedBatches += 1
          job.completedPoints += current.value.length
          touch(job)
        } catch (error) {
          if (job.abortController.signal.aborted || error?.name === 'AbortError') return
          if (error?.bulkRetryExhausted) {
            job.status = 'paused'
            job.lastError = publicError(error)
            touch(job)
            return
          }
          setTerminal(job, 'failed', error)
          return
        }
      }
    }

    await Promise.all(Array.from({ length: MAX_IN_FLIGHT_PER_DATE }, () => worker()))
  }

  async function run(job) {
    try {
      for (let dateIndex = 0; dateIndex < job.plan.targets.length; dateIndex += 1) {
        if (job.status !== 'running' || job.abortController.signal.aborted) break
        const target = job.plan.targets[dateIndex]
        job.currentMeasurement = target.measurement
        touch(job)
        await runDate(job, target, dateIndex)
      }
      if (job.status === 'running') setTerminal(job, 'succeeded')
    } catch (error) {
      if (job.abortController.signal.aborted || error?.name === 'AbortError') {
        if (job.status !== 'cancelled') {
          job.status = 'cancelled'
          job.currentMeasurement = null
          touch(job)
        }
      } else {
        setTerminal(job, 'failed', error)
      }
    } finally {
      if (!UNFINISHED.has(job.status) && activeJobId === job.id) activeJobId = null
    }
  }

  function launch(job) {
    job.runner = Promise.resolve().then(() => run(job))
  }

  function start({ id, connectionIdentity, plan, seed }) {
    const activeJob = activeJobId ? jobs.get(activeJobId) : null
    if (activeJob && UNFINISHED.has(activeJob.status)) {
      throw jobError('Another bulk job is active', 'BULK_JOB_ACTIVE')
    }
    if (!id || jobs.has(id)) throw jobError('Bulk job id is invalid or already exists', 'BULK_JOB_INVALID')
    if (!connectionIdentity || !plan || typeof seed !== 'string') {
      throw jobError('Bulk job input is incomplete', 'BULK_JOB_INVALID')
    }
    const totals = totalsForPlan(plan)
    const timestamp = now()
    const job = {
      id,
      connectionIdentity,
      plan,
      seed,
      status: 'running',
      currentMeasurement: null,
      completedPoints: 0,
      totalPoints: totals.totalPoints,
      completedBatches: 0,
      totalBatches: totals.totalBatches,
      retryCount: 0,
      lastError: null,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedBatchKeys: new Set(),
      abortController: new AbortController(),
      runner: null,
    }
    jobs.set(id, job)
    activeJobId = id
    launch(job)
    return snapshot(job)
  }

  function active() {
    if (!activeJobId) return null
    const job = jobs.get(activeJobId)
    return job && UNFINISHED.has(job.status) ? snapshot(job) : null
  }

  function get(id) {
    const job = jobs.get(id)
    return job ? snapshot(job) : null
  }

  function resume(id) {
    const job = jobs.get(id)
    if (!job || job.status !== 'paused') throw jobError('Only paused jobs can resume', 'BULK_JOB_NOT_PAUSED')
    const other = activeJobId ? jobs.get(activeJobId) : null
    if (other && other.id !== id && UNFINISHED.has(other.status)) {
      throw jobError('Another bulk job is active', 'BULK_JOB_ACTIVE')
    }
    job.status = 'running'
    job.lastError = null
    job.abortController = new AbortController()
    activeJobId = id
    touch(job)
    launch(job)
    return snapshot(job)
  }

  async function cancel(id) {
    const job = jobs.get(id)
    if (!job) return null
    if (job.status === 'cancelled') return snapshot(job)
    if (!UNFINISHED.has(job.status)) return snapshot(job)
    job.status = 'cancelling'
    touch(job)
    job.abortController.abort()
    job.status = 'cancelled'
    job.currentMeasurement = null
    touch(job)
    if (activeJobId === id) activeJobId = null
    await Promise.resolve()
    return snapshot(job)
  }

  async function shutdown(timeoutMs = 5_000) {
    const job = activeJobId ? jobs.get(activeJobId) : null
    if (!job || !UNFINISHED.has(job.status)) return
    await cancel(job.id)
    if (!job.runner || timeoutMs <= 0) return
    await Promise.race([
      job.runner,
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ])
  }

  return Object.freeze({ start, active, get, resume, cancel, shutdown })
}
