import { randomUUID as defaultRandomUUID } from 'node:crypto'
import { iteratePlanLines } from './bulk-generator.mjs'
import {
  compareTargetSchema,
  estimatePlan,
  validateRetentionPolicy,
} from './bulk-plan.mjs'
import { isEnvironmentWritable } from './write-policy.mjs'

const PREVIEW_TTL_MS = 15 * 60 * 1_000
const SAMPLE_LIMIT = 20

function apiError(status, code, message, details) {
  return { status, body:{ code, message, ...(details === undefined ? {} : { details }) } }
}

function connectionIdentity(session, database) {
  if (!session?.bulkIdentity || !database) return null
  return `${session.bulkIdentity}\u0000${database}`
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function fingerprint(value) {
  return JSON.stringify(stableValue(value))
}

function authorizationError(session) {
  if (!isEnvironmentWritable(session?.environment)) {
    return apiError(403, 'BULK_WRITABLE_ENV_REQUIRED', 'Only test or development connections may generate bulk data')
  }
  if (session?.readOnly !== false) {
    return apiError(403, 'BULK_WRITE_CONNECTION_REQUIRED', 'A writable connection is required for bulk generation')
  }
  return null
}

function validationError(error) {
  return apiError(422, 'BULK_PLAN_INVALID', '生成计划不可执行', {
    issues:[{ code:String(error?.code ?? 'BULK_PLAN_INVALID'), message:String(error?.message ?? 'Invalid bulk plan') }],
  })
}

function notFound() {
  return apiError(404, 'BULK_JOB_NOT_FOUND', 'Bulk job does not exist for this connection')
}

function publicPreview(preview) {
  return {
    previewId:preview.id,
    expiresAt:preview.expiresAt,
    pointCount:preview.plan.pointCount,
    maxNewSeries:preview.plan.maxNewSeries,
    targets:preview.plan.targets.map(target => ({
      date:target.date,
      measurement:target.measurement,
      exists:Object.hasOwn(preview.targets, target.measurement),
    })),
    requiredAcknowledgements:acknowledgementsNeeded(preview),
    warnings:preview.warnings,
    samples:preview.samples,
  }
}

function publicJob(job) {
  if (!job) return job
  const { connectionIdentity: _connectionIdentity, ...result } = job
  return result
}

async function loadRemoteState(influx, session, input, now) {
  if (!input || typeof input !== 'object' || typeof input.database !== 'string' || !input.database.trim()) {
    throw new Error('database is required')
  }
  const database = input.database.trim()
  const tables = await influx.listMeasurements(session, database)
  const sourceMeasurement = String(input.sourceMeasurement ?? '')
  if (!sourceMeasurement || !tables.includes(sourceMeasurement)) throw new Error('source measurement does not exist')
  const prefix = String(input.prefix ?? '').trim()
  if (!prefix || !sourceMeasurement.startsWith(`${prefix}_`)) {
    throw Object.assign(new Error('prefix does not match the selected source measurement'), { code:'PREFIX_MISMATCH' })
  }
  const retentionPolicies = await influx.listRetentionPolicies(session, database)
  const requestedRp = typeof input.retentionPolicy === 'string' ? input.retentionPolicy : ''
  const retentionPolicy = requestedRp
    ? retentionPolicies.find(policy => policy.name === requestedRp)
    : retentionPolicies.find(policy => policy.isDefault)
  if (!retentionPolicy) throw Object.assign(new Error('retention policy does not exist'), { code:'RP_MISSING' })
  const sourceSchema = await influx.getMeasurementSchema(session, database, sourceMeasurement)
  const plan = estimatePlan({ ...input, database, retentionPolicy:retentionPolicy.name, schema:sourceSchema })
  validateRetentionPolicy(retentionPolicy, plan.targets.flatMap(target => target.timestamps), now)

  const targets = {}
  const warnings = []
  for (const target of plan.targets) {
    if (!tables.includes(target.measurement)) continue
    const targetSchema = await influx.getMeasurementSchema(session, database, target.measurement)
    const comparison = compareTargetSchema(sourceSchema, targetSchema)
    if (comparison.conflicts.length) {
      throw Object.assign(new Error('target schema field type conflicts with source schema'), { code:'SCHEMA_TYPE_CONFLICT' })
    }
    targets[target.measurement] = targetSchema
    warnings.push(...comparison.warnings.map(warning => ({ ...warning, measurement:target.measurement })))
  }
  return { database, tables:[...tables].sort(), retentionPolicy, sourceMeasurement, sourceSchema, targets, plan, warnings }
}

function sampleLines(plan, seed) {
  const samples = []
  let index = 0
  for (const lineProtocol of iteratePlanLines(plan, seed)) {
    samples.push({ index, lineProtocol })
    index += 1
    if (samples.length === SAMPLE_LIMIT) break
  }
  return samples
}

function acknowledgementsNeeded(preview) {
  const required = new Set()
  for (const target of preview.plan.targets) {
    required.add(Object.hasOwn(preview.targets, target.measurement) ? 'acknowledgeOverwrite' : 'acknowledgeCreate')
  }
  return [...required]
}

export function createBulkApi({ jobManager, influx, now = () => Date.now(), randomUUID = defaultRandomUUID } = {}) {
  if (!jobManager || !influx) throw new TypeError('jobManager and influx are required')
  const previews = new Map()

  async function createPreview(session, payload) {
    const denied = authorizationError(session)
    if (denied) return denied
    try {
      const remote = await loadRemoteState(influx, session, payload, now())
      const identity = connectionIdentity(session, remote.database)
      if (!identity) return apiError(401, 'BULK_SESSION_REQUIRED', 'A live connection session is required')
      const id = String(randomUUID())
      const preview = {
        id,
        identity,
        seed:String(randomUUID()),
        expiresAt:now() + PREVIEW_TTL_MS,
        remoteFingerprint:fingerprint({
          database:remote.database,
          tables:remote.tables,
          retentionPolicy:remote.retentionPolicy,
          sourceMeasurement:remote.sourceMeasurement,
          sourceSchema:remote.sourceSchema,
          targets:remote.targets,
        }),
        ...remote,
      }
      preview.samples = sampleLines(preview.plan, preview.seed)
      previews.set(identity, preview)
      return { status:200, body:publicPreview(preview) }
    } catch (error) {
      return validationError(error)
    }
  }

  async function execute(session, payload) {
    const denied = authorizationError(session)
    if (denied) return denied
    const previewId = typeof payload?.previewId === 'string' ? payload.previewId : ''
    const database = typeof payload?.database === 'string' ? payload.database.trim() : ''
    const candidates = [...previews.values()].filter(preview => preview.id === previewId)
    const preview = candidates[0]
    if (!preview || preview.expiresAt <= now()) return apiError(409, 'BULK_PREVIEW_REQUIRED', 'A valid bulk preview is required')
    const identity = connectionIdentity(session, preview.database)
    if (!identity || preview.identity !== identity || (database && database !== preview.database)) return apiError(409, 'BULK_PREVIEW_REQUIRED', 'A valid bulk preview is required')
    const acknowledgements = acknowledgementsNeeded(preview)
    const missingAcknowledgements = acknowledgements.filter(name => payload?.[name] !== true)
    if (missingAcknowledgements.length) {
      return apiError(
        409,
        'BULK_ACKNOWLEDGEMENT_REQUIRED',
        'Required create or overwrite acknowledgement is missing',
        { acknowledgements:missingAcknowledgements },
      )
    }
    let current
    try {
      current = await loadRemoteState(influx, session, { ...preview.plan, database:preview.database, sourceMeasurement:preview.sourceMeasurement, retentionPolicy:preview.retentionPolicy.name }, now())
    } catch {
      return apiError(409, 'STALE_BULK_PREVIEW', 'Remote state changed since preview')
    }
    const currentFingerprint = fingerprint({
      database:current.database, tables:current.tables, retentionPolicy:current.retentionPolicy,
      sourceMeasurement:current.sourceMeasurement, sourceSchema:current.sourceSchema, targets:current.targets,
    })
    if (currentFingerprint !== preview.remoteFingerprint) return apiError(409, 'STALE_BULK_PREVIEW', 'Remote state changed since preview')
    try {
      const job = jobManager.start({ id:String(randomUUID()), connectionIdentity:identity, plan:preview.plan, seed:preview.seed })
      previews.delete(identity)
      return { status:200, body:publicJob(job) }
    } catch (error) {
      return apiError(409, String(error?.code ?? 'BULK_JOB_ACTIVE'), String(error?.message ?? 'Bulk job cannot start'))
    }
  }

  function ownedJob(session, id) {
    const job = jobManager.get(id)
    if (!job || job.connectionIdentity !== connectionIdentity(session, job.connectionIdentity?.split('\u0000').at(-1))) return null
    return job
  }

  async function handle({ method, pathname, session, payload }) {
    if (pathname !== '/bulk-jobs' && !pathname.startsWith('/bulk-jobs/')) return null
    if (method === 'POST' && pathname === '/bulk-jobs/preview') return createPreview(session, payload)
    if (method === 'POST' && pathname === '/bulk-jobs') return execute(session, payload)
    if (method === 'GET' && pathname === '/bulk-jobs/active') {
      const job = jobManager.active()
      if (!job || !ownedJob(session, job.id)) return notFound()
      return { status:200, body:publicJob(job) }
    }
    const match = pathname.match(/^\/bulk-jobs\/([^/]+)(?:\/(resume|cancel))?$/)
    if (!match) return apiError(404, 'BULK_ROUTE_NOT_FOUND', 'Bulk route does not exist')
    const [, id, action] = match
    const job = ownedJob(session, id)
    if (!job) return notFound()
    if (method === 'GET' && !action) return { status:200, body:publicJob(job) }
    if (method === 'POST' && action === 'resume') {
      try {
        return { status:200, body:publicJob(jobManager.resume(id)) }
      } catch {
        return apiError(409, 'BULK_JOB_NOT_PAUSED', 'Only paused jobs can resume')
      }
    }
    if (method === 'POST' && action === 'cancel') return { status:200, body:publicJob(await jobManager.cancel(id)) }
    return apiError(404, 'BULK_ROUTE_NOT_FOUND', 'Bulk route does not exist')
  }

  return Object.freeze({ handle })
}
