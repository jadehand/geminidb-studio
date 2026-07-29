import http from 'node:http'
import https from 'node:https'

const httpAgent = new http.Agent({ keepAlive:true, maxSockets:2 })
const httpsAgent = new https.Agent({ keepAlive:true, maxSockets:2 })
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const RETRYABLE_NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET'])

export class InfluxHttpError extends Error {
  constructor(message, statusCode, code) {
    super(message)
    this.name = 'InfluxHttpError'
    this.statusCode = statusCode
    this.code = code
    this.retryable = RETRYABLE_STATUS_CODES.has(statusCode) || RETRYABLE_NETWORK_CODES.has(code)
  }
}

function request(config, method, path, body = '', { signal } = {}) {
  const endpoint = new URL(config.endpoint)
  const isHttps = endpoint.protocol === 'https:'
  const transport = isHttps ? https : http
  const authorization = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol:endpoint.protocol,
      hostname:endpoint.hostname,
      port:endpoint.port || (isHttps ? 443 : 80),
      method,
      path:`${endpoint.pathname.replace(/\/$/, '')}${path}`,
      headers:{ Authorization:`Basic ${authorization}`, Accept:'application/json', ...(body ? { 'Content-Type':'text/plain; charset=utf-8', 'Content-Length':Buffer.byteLength(body) } : {}) },
      timeout:config.timeoutMs || 30000,
      rejectUnauthorized:!config.insecureSkipVerify,
      agent:isHttps ? httpsAgent : httpAgent,
      signal,
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const statusCode = response.statusCode || 500
        if (statusCode >= 400) return reject(new InfluxHttpError(parseError(text, statusCode), statusCode))
        resolve({ statusCode, text })
      })
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error(`GeminiDB Influx 请求超过 ${config.timeoutMs || 30000}ms`), { code:'ETIMEDOUT' })))
    req.on('error', error => {
      if (isHttps && /wrong version number|wrong version|tls_validate_record_header|tls_get_more_records|packet length too long/i.test(error.message)) {
        return reject(new Error('目标服务不是 HTTPS，可能只支持 HTTP。请在连接设置中将协议切换为 HTTP 后重试。'))
      }
      if (RETRYABLE_NETWORK_CODES.has(error.code)) return reject(new InfluxHttpError(error.message, undefined, error.code))
      reject(error)
    })
    if (body) req.write(body)
    req.end()
  })
}

function parseError(text, status) {
  try {
    const parsed = JSON.parse(text)
    return parsed.error || parsed.message || `GeminiDB Influx HTTP ${status}`
  } catch {
    return text || `GeminiDB Influx HTTP ${status}`
  }
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { throw new Error('GeminiDB Influx 返回了无法解析的 JSON') }
}

function resultError(payload) {
  return payload.results?.find(result => result.error)?.error
}

function queryPath(database, sql) {
  const params = new URLSearchParams({ q:sql, epoch:'ms' })
  if (database) params.set('db', database)
  return `/query?${params}`
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function parseDurationMs(value) {
  if (value === '0s') return 0
  const units = { u:0.001, µ:0.001, ms:1, s:1000, m:60000, h:3600000, d:86400000, w:604800000 }
  let total = 0
  let consumed = 0
  for (const match of String(value).matchAll(/(\d+(?:\.\d+)?)(ms|µ|u|s|m|h|d|w)/g)) {
    total += Number(match[1]) * units[match[2]]
    consumed += match[0].length
  }
  if (!consumed || consumed !== String(value).length || !Number.isSafeInteger(total)) throw new Error(`无法解析 RP 时长: ${value}`)
  return total
}

export async function influxQuery(config, database, sql) {
  const started = performance.now()
  const response = await request(config, 'GET', queryPath(database, sql))
  const payload = parseJson(response.text)
  const error = resultError(payload)
  if (error) throw new Error(error)
  const series = payload.results?.flatMap(result => result.series || []) || []
  const rows = series.flatMap(item => (item.values || []).map(values => Object.fromEntries(item.columns.map((column, index) => [column, values[index]]))))
  return { rows, series, durationMs:Math.round(performance.now() - started) }
}

export async function influxCommand(config, database, command) {
  const started = performance.now()
  const response = await request(config, 'GET', queryPath(database, command))
  const payload = parseJson(response.text)
  const error = resultError(payload)
  if (error) throw new Error(error)
  return { affectedRows:1, durationMs:Math.round(performance.now() - started), message:'INSERT 执行成功' }
}

export async function listDatabases(config) {
  const { series } = await influxQuery(config, '', 'SHOW DATABASES')
  const item = series[0]
  if (!item) return []
  const index = item.columns.indexOf('name')
  return item.values.map(value => String(value[index]))
}

export async function listMeasurements(config, database) {
  const { series } = await influxQuery(config, database, 'SHOW MEASUREMENTS')
  const item = series[0]
  if (!item) return []
  const index = item.columns.indexOf('name')
  return item.values.map(value => String(value[index]))
}

export async function getMeasurementSchema(config, database, measurement) {
  const quoted = quoteIdentifier(measurement)
  const [fieldResult, tagResult] = await Promise.all([influxQuery(config, database, `SHOW FIELD KEYS FROM ${quoted}`), influxQuery(config, database, `SHOW TAG KEYS FROM ${quoted}`)])
  const fields = fieldResult.rows.map(row => ({ name:String(row.fieldKey || ''), type:String(row.fieldType || 'unknown') })).filter(field => field.name)
  const tags = tagResult.rows.map(row => String(row.tagKey || '')).filter(Boolean)
  return { fields, tags }
}

export async function listRetentionPolicies(config, database) {
  const { rows } = await influxQuery(config, database, `SHOW RETENTION POLICIES ON ${quoteIdentifier(database)}`)
  return rows.map(row => ({ name:String(row.name), durationMs:parseDurationMs(String(row.duration)), isDefault:Boolean(row.default) }))
}

export async function listTagValues(config, database, measurement, tag, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Tag 候选值上限必须为正整数')
  const { rows } = await influxQuery(config, database, `SHOW TAG VALUES FROM ${quoteIdentifier(measurement)} WITH KEY = ${quoteIdentifier(tag)} LIMIT ${limit + 1}`)
  const values = rows.map(row => String(row.value)).slice(0, limit)
  return { values, truncated:rows.length > limit }
}

export async function influxWrite(config, database, lineProtocol, options = {}) {
  if (!database) throw new Error('写入前必须选择 database')
  if (!lineProtocol.trim()) throw new Error('WRITE 后必须提供 line protocol')
  const { precision = 'ns', retentionPolicy, signal } = typeof options === 'string' ? { precision:options } : options
  const started = performance.now()
  const params = new URLSearchParams({ db:database, ...(retentionPolicy ? { rp:retentionPolicy } : {}), precision })
  await request(config, 'POST', `/write?${params}`, lineProtocol, { signal })
  return { affectedRows:lineProtocol.trim().split(/\r?\n/).length, durationMs:Math.round(performance.now() - started), message:'line protocol 写入成功' }
}

export function closeInfluxAgents() {
  httpAgent.destroy()
  httpsAgent.destroy()
}

export function normalizeEndpoint(value) {
  const endpoint = new URL(value)
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('实例地址只支持 http:// 或 https://')
  if (!endpoint.port) endpoint.port = '8635'
  return endpoint.toString().replace(/\/$/, '')
}
