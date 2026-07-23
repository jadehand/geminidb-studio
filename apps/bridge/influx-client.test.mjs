import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { getMeasurementSchema, influxQuery, influxWrite, listDatabases, listMeasurements, normalizeEndpoint } from './influx-client.mjs'

async function fixture() {
  const requests = []
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture')
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      requests.push({ method: request.method, url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('utf8') })
      response.setHeader('Content-Type', 'application/json')
      if (url.pathname === '/write') { response.statusCode = 204; return response.end() }
      const query = url.searchParams.get('q')
      if (query === 'SHOW DATABASES') return response.end(JSON.stringify({ results: [{ series: [{ name: 'databases', columns: ['name'], values: [['_internal'], ['monitoring']] }] }] }))
      if (query === 'SHOW MEASUREMENTS') return response.end(JSON.stringify({ results: [{ series: [{ name: 'measurements', columns: ['name'], values: [['cpu_1784563200'], ['cpu_1784649600']] }] }] }))
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
