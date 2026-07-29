import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { closeInfluxAgents, getMeasurementSchema, InfluxHttpError, influxCommand, influxQuery, influxWrite, listDatabases, listMeasurements, listRetentionPolicies, listTagValues, normalizeEndpoint } from './influx-client.mjs'

async function fixture() {
  const requests = []
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture')
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      requests.push({ method: request.method, url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('utf8') })
      response.setHeader('Content-Type', 'application/json')
      if (url.pathname === '/write') {
        if (url.searchParams.get('db') === 'too-many') { response.statusCode = 429; return response.end(JSON.stringify({ error: 'rate limited' })) }
        if (url.searchParams.get('db') === 'bad-write') { response.statusCode = 400; return response.end(JSON.stringify({ error: 'bad request' })) }
        if (url.searchParams.get('db') === 'slow-write') return
        if (url.searchParams.get('db') === 'reset-write') return request.socket.destroy()
        response.statusCode = 204; return response.end()
      }
      const query = url.searchParams.get('q')
      if (query === 'INSERT bad value=1') return response.end(JSON.stringify({ results: [{ error: 'invalid insert' }] }))
      if (query === 'SHOW DATABASES') return response.end(JSON.stringify({ results: [{ series: [{ name: 'databases', columns: ['name'], values: [['_internal'], ['monitoring']] }] }] }))
      if (query === 'SELECT value FROM cpu WHERE time = 1784995200000000000ns') return response.end(JSON.stringify({ results: [{ series: [{ name: 'cpu', columns: ['time', 'value'], values: [['1784995200000000000', 37.82]] }] }] }))
      if (query === 'SHOW MEASUREMENTS') return response.end(JSON.stringify({ results: [{ series: [{ name: 'measurements', columns: ['name'], values: [['cpu_1784563200'], ['cpu_1784649600']] }] }] }))
      if (query === 'SHOW RETENTION POLICIES ON "monitoring"') return response.end(JSON.stringify({ results: [{ series: [{ name: 'retention_policies', columns: ['name', 'duration', 'default'], values: [['autogen', '168h0m0s', true]] }] }] }))
      if (query === 'SHOW TAG VALUES FROM "cpu_1784995200" WITH KEY = "host" LIMIT 1001') return response.end(JSON.stringify({ results: [{ series: [{ name: 'cpu_1784995200', columns: ['key', 'value'], values: [['host', 'node-01'], ['host', 'node-02']] }] }] }))
      if (query?.startsWith('SHOW FIELD KEYS')) return response.end(JSON.stringify({ results: [{ series: [{ name: 'cpu', columns: ['fieldKey', 'fieldType'], values: [['value', 'float'], ['status', 'string']] }] }] }))
      if (query?.startsWith('SHOW TAG KEYS')) return response.end(JSON.stringify({ results: [{ series: [{ name: 'cpu', columns: ['tagKey'], values: [['host'], ['region']] }] }] }))
      response.end(JSON.stringify({ results: [{ series: [{ name: 'cpu', columns: ['time', 'host', 'value'], values: [[1784649600000, 'node-01', 37.82]] }] }] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, requests, endpoint: `http://127.0.0.1:${address.port}` }
}

test('Influx 1.x 查询、目录、认证和写入协议', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 2000, insecureSkipVerify: false }
  assert.deepEqual(await listDatabases(config), ['_internal', 'monitoring'])
  assert.deepEqual(await listMeasurements(config, 'monitoring'), ['cpu_1784563200', 'cpu_1784649600'])
  assert.deepEqual(await getMeasurementSchema(config, 'monitoring', 'cpu_1784563200'), { fields:[{name:'value',type:'float'},{name:'status',type:'string'}], tags:['host','region'] })
  const result = await influxQuery(config, 'monitoring', 'SELECT value FROM cpu LIMIT 1')
  assert.deepEqual(result.rows, [{ time: 1784649600000, host: 'node-01', value: 37.82 }])
  const write = await influxWrite(config, 'monitoring', 'cpu,host=node-01 value=37.82 1784649600000000000')
  assert.equal(write.affectedRows, 1)
  assert.equal(upstream.requests[0].authorization, `Basic ${Buffer.from('rwuser:secret').toString('base64')}`)
  assert.equal(upstream.requests.at(-1).url.pathname, '/write')
  assert.equal(upstream.requests.at(-1).body, 'cpu,host=node-01 value=37.82 1784649600000000000')
})

test('实例地址自动补默认端口并限制协议', () => {
  assert.equal(normalizeEndpoint('http://192.0.2.10'), 'http://192.0.2.10:8635')
  assert.equal(normalizeEndpoint('https://192.0.2.10'), 'https://192.0.2.10:8635')
  assert.throws(() => normalizeEndpoint('ftp://192.0.2.10'), /只支持/)
})

test('HTTPS 连接到 HTTP 服务时给出协议切换提示', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const endpoint = upstream.endpoint.replace(/^http:/, 'https:')
  await assert.rejects(
    listDatabases({ endpoint, username:'rwuser', password:'secret', timeoutMs:2000, insecureSkipVerify:true }),
    /目标服务不是 HTTPS.*切换为 HTTP/
  )
})

test('tls_get_more_records:packet length too long 也给出协议切换提示', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const endpoint = upstream.endpoint.replace(/^http:/, 'https:')
  await assert.rejects(
    listDatabases({ endpoint, username:'rwuser', password:'secret', timeoutMs:2000, insecureSkipVerify:true }),
    /目标服务不是 HTTPS.*切换为 HTTP/
  )
})

test('新版 Node 的 HTTPS 到 HTTP 错误也给出协议切换提示', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const endpoint = upstream.endpoint.replace(/^http:/, 'https:')
  await assert.rejects(
    listDatabases({ endpoint, username:'rwuser', password:'secret', timeoutMs:2000, insecureSkipVerify:true }),
    /目标服务不是 HTTPS.*切换为 HTTP/
  )
})

test('bulk generation reads retention policies and tag values', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 2000, insecureSkipVerify: false }
  assert.deepEqual(await listRetentionPolicies(config, 'monitoring'), [{ name:'autogen', durationMs:604800000, isDefault:true }])
  assert.deepEqual(await listTagValues(config, 'monitoring', 'cpu_1784995200', 'host', 1000), { values:['node-01', 'node-02'], truncated:false })
})

test('bulk writes use RP and milliseconds with typed HTTP errors', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 2000, insecureSkipVerify: false }
  await influxWrite(config, 'monitoring', 'cpu value=1 1', { precision:'ms', retentionPolicy:'autogen' })
  assert.equal(upstream.requests.at(-1).url.search, '?db=monitoring&rp=autogen&precision=ms')
  await assert.rejects(influxWrite(config, 'too-many', 'cpu value=1 1'), error => error instanceof InfluxHttpError && error.statusCode === 429 && error.retryable === true)
  await assert.rejects(influxWrite(config, 'bad-write', 'cpu value=1 1'), error => error instanceof InfluxHttpError && error.statusCode === 400 && error.retryable === false)
})

test('INSERT commands use the query endpoint and accept result responses without a series', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 2000, insecureSkipVerify: false }
  const result = await influxCommand(config, 'monitoring', 'INSERT cpu value=1')
  assert.equal(result.affectedRows, 1)
  assert.equal(result.message, 'INSERT 执行成功')
  assert.equal(upstream.requests.at(-1).method, 'GET')
  assert.equal(upstream.requests.at(-1).url.pathname, '/query')
  assert.equal(upstream.requests.at(-1).url.searchParams.get('db'), 'monitoring')
  assert.equal(upstream.requests.at(-1).url.searchParams.get('q'), 'INSERT cpu value=1')
})

test('INSERT commands surface an upstream result error', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 2000, insecureSkipVerify: false }
  await assert.rejects(influxCommand(config, 'monitoring', 'INSERT bad value=1'), /invalid insert/)
})

test('an aborted bulk write destroys its request', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 2000, insecureSkipVerify: false }
  const controller = new AbortController()
  const write = influxWrite(config, 'slow-write', 'cpu value=1 1', { signal:controller.signal })
  controller.abort()
  await assert.rejects(write, /abort|aborted/i)
})

test('a request timeout is a retryable Influx error', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 20, insecureSkipVerify: false }
  await assert.rejects(influxWrite(config, 'slow-write', 'cpu value=1 1'), error => error instanceof InfluxHttpError && error.retryable === true && error.code === 'ETIMEDOUT')
})

test('a connection reset is a retryable Influx error', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 2000, insecureSkipVerify: false }
  await assert.rejects(influxWrite(config, 'reset-write', 'cpu value=1 1'), error => error instanceof InfluxHttpError && error.retryable === true && error.code === 'ECONNRESET')
})

test.after(() => closeInfluxAgents())

test('influxQuery requests nanosecond epochs without changing the millisecond default', async t => {
  const upstream = await fixture()
  t.after(() => upstream.server.close())
  const config = { endpoint: upstream.endpoint, username: 'rwuser', password: 'secret', timeoutMs: 2000, insecureSkipVerify: false }

  const nanoseconds = await influxQuery(config, 'monitoring', 'SELECT value FROM cpu WHERE time = 1784995200000000000ns', { epoch:'ns' })
  assert.equal(nanoseconds.rows[0].time, '1784995200000000000')
  assert.equal(upstream.requests.at(-1).url.searchParams.get('epoch'), 'ns')

  await influxQuery(config, 'monitoring', 'SELECT value FROM cpu LIMIT 1')
  assert.equal(upstream.requests.at(-1).url.searchParams.get('epoch'), 'ms')
})
