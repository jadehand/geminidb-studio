import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMeasurementDataQuery, flattenMeasurementSeries } from './measurement-data.mjs'

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
    'SELECT * FROM "cpu_1784995200" WHERE time >= 1784995200000000000ns AND time <= 1784998800000000000ns ORDER BY time DESC LIMIT 101 OFFSET 100',
  )
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
