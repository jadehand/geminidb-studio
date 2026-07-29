import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMeasurementDataQuery, flattenMeasurementSeries, parseMeasurementDataOptions } from './measurement-data.mjs'

test('builds a latest-page query with one extra row', () => {
  assert.equal(
    buildMeasurementDataQuery({ measurement:'cpu_1784995200', limit:50, offset:0, startNs:null, endNs:null }),
    'SELECT * FROM "cpu_1784995200" ORDER BY time DESC LIMIT 51 OFFSET 0',
  )
})

test('adds exact nanosecond bounds to a custom range query', () => {
  assert.equal(
    buildMeasurementDataQuery({
      measurement:'cpu_1784995200', limit:100, offset:100,
      startNs:'1784995200000000000', endNs:'1784998800000000000',
    }),
    'SELECT * FROM "cpu_1784995200" WHERE time >= 1784995200000000000ns AND time <= 1784998800000000000ns ORDER BY time DESC LIMIT 201 OFFSET 0',
  )
})

test('uses a bounded per-series fetch size and rejects an unsafe fetch size', () => {
  assert.equal(
    buildMeasurementDataQuery({ measurement:'cpu', limit:50, offset:200, startNs:null, endNs:null }),
    'SELECT * FROM "cpu" ORDER BY time DESC LIMIT 251 OFFSET 0',
  )
  assert.throws(() => buildMeasurementDataQuery({ measurement:'cpu', limit:500, offset:Number.MAX_SAFE_INTEGER, startNs:null, endNs:null }), /fetch limit/i)
})

test('escapes measurement identifiers and rejects unsafe page parameters', () => {
  assert.equal(
    buildMeasurementDataQuery({ measurement:'cpu"\\latest', limit:50, offset:0, startNs:null, endNs:null }),
    'SELECT * FROM "cpu\\"\\\\latest" ORDER BY time DESC LIMIT 51 OFFSET 0',
  )

  for (const options of [
    { measurement:'cpu', limit:49, offset:0, startNs:null, endNs:null },
    { measurement:'cpu', limit:50, offset:-1, startNs:null, endNs:null },
    { measurement:'cpu', limit:50, offset:1.5, startNs:null, endNs:null },
    { measurement:'cpu', limit:50, offset:0, startNs:'1', endNs:null },
    { measurement:'cpu', limit:50, offset:0, startNs:'1ns', endNs:'2' },
    { measurement:'cpu', limit:50, offset:0, startNs:'3', endNs:'2' },
    { measurement:'', limit:50, offset:0, startNs:null, endNs:null },
  ]) assert.throws(() => buildMeasurementDataQuery(options))
})

test('flattens series into complete tag and field point records without losing nanoseconds', () => {
  const result = flattenMeasurementSeries({
    measurement:'cpu_1784995200',
    schema:{ tags:['host', 'region'], fields:[{ name:'value', type:'float' }, { name:'status', type:'string' }, { name:'count', type:'integer' }] },
    series:[
      {
        name:'cpu_1784995200', tags:{ host:'node-01' },
        columns:['time', 'region', 'value', 'status'],
        values:[
          ['1784998800000000001', 'cn-north', 37.82, 'ok'],
          ['1784998800000000000', 'cn-north', 38.1, null],
        ],
      },
      {
        name:'cpu_1784995200', tags:{ host:'node-02', region:'cn-south' },
        columns:['time', 'value'],
        values:[['1784998799999999999', 11]],
      },
    ],
    limit:2,
  })

  assert.deepEqual(result, {
    points:[
      {
        id:'cpu_1784995200:0:0', measurement:'cpu_1784995200',
        timestampNs:'1784998800000000001', time:'1784998800000000001',
        tags:{ host:'node-01', region:'cn-north' },
        fields:{ value:37.82, status:'ok', count:null },
      },
      {
        id:'cpu_1784995200:0:1', measurement:'cpu_1784995200',
        timestampNs:'1784998800000000000', time:'1784998800000000000',
        tags:{ host:'node-01', region:'cn-north' },
        fields:{ value:38.1, status:null, count:null },
      },
    ],
    hasMore:true,
  })
})

test('globally pages interleaved series without losing points', () => {
  const input = {
    measurement:'cpu', schema:{ tags:['host'], fields:[{ name:'value', type:'float' }] },
    series:[
      { name:'cpu', tags:{ host:'a' }, columns:['time', 'value'], values:[['90071992547409935', 5], ['90071992547409933', 3], ['90071992547409931', 1]] },
      { name:'cpu', tags:{ host:'b' }, columns:['time', 'value'], values:[['90071992547409934', 4], ['90071992547409932', 2], ['90071992547409930', 0]] },
    ], limit:2,
  }
  const first = flattenMeasurementSeries({ ...input, offset:0 })
  const second = flattenMeasurementSeries({ ...input, offset:2 })
  assert.deepEqual(first.points.map(point => point.timestampNs), ['90071992547409935', '90071992547409934'])
  assert.deepEqual(second.points.map(point => point.timestampNs), ['90071992547409933', '90071992547409932'])
  assert.equal(first.hasMore, true)
  assert.equal(second.hasMore, true)
})

test('keeps series tags authoritative when a Field shares a tag name', () => {
  const result = flattenMeasurementSeries({
    measurement:'cpu', limit:50, offset:0,
    schema:{ tags:['host'], fields:[{ name:'host', type:'string' }, { name:'value', type:'float' }] },
    series:[{ name:'cpu', tags:{ host:'node-01' }, columns:['time', 'host', 'value'], values:[['1784998800000000001', 'field-host', 1]] }],
  })
  assert.deepEqual(result.points[0].tags, { host:'node-01' })
  assert.deepEqual(result.points[0].fields, { host:'field-host', value:1 })
})

test('rejects duplicate or missing required measurement data URL parameters', () => {
  assert.deepEqual(
    parseMeasurementDataOptions(new URLSearchParams('database=metrics&measurement=cpu&limit=50&offset=0')),
    { database:'metrics', measurement:'cpu', limit:50, offset:0, startNs:null, endNs:null },
  )
  assert.throws(() => parseMeasurementDataOptions(new URLSearchParams('database=metrics&database=other&measurement=cpu')), /once/i)
  assert.throws(() => parseMeasurementDataOptions(new URLSearchParams('database=metrics&measurement=cpu&startNs=1&startNs=2')), /once/i)
  assert.throws(() => parseMeasurementDataOptions(new URLSearchParams('database=metrics&measurement=cpu&limit=1e2')), /decimal/i)
  assert.throws(() => parseMeasurementDataOptions(new URLSearchParams('database=metrics')), /required/i)
})
