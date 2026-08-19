import assert from 'node:assert/strict'
import test from 'node:test'

import { createMockGeminiDbEngine } from './mock-geminidb-engine.mjs'

function firstSeries(payload) {return payload.results[0].series?.[0]}

test('writes typed Line Protocol atomically and merges an identical point',()=>{
  const engine=createMockGeminiDbEngine({nowNs:()=> '1787068800000000000'})
  engine.write('monitoring','cpu\\ load,host=node\\ 01,region=cn-north-4 usage=37.5,count=2i,healthy=true,status="ok" 1787068800000000001',{precision:'ns'})
  engine.write('monitoring','cpu\\ load,region=cn-north-4,host=node\\ 01 usage=41.25,new_field="added" 1787068800000000001',{precision:'ns'})

  const snapshot=engine.snapshot()
  assert.equal(snapshot.monitoring['cpu load'].length,1)
  assert.deepEqual(snapshot.monitoring['cpu load'][0],{
    timestampNs:'1787068800000000001',tags:{host:'node 01',region:'cn-north-4'},
    fields:{usage:41.25,count:2,healthy:true,status:'ok',new_field:'added'},
  })

  assert.throws(()=>engine.write('monitoring','valid value=1i 1\nbroken',{precision:'ns'}),/必须包含/)
  assert.equal(engine.snapshot().monitoring.valid,undefined)
})

test('supports write precisions and rejects invalid Field values',()=>{
  const engine=createMockGeminiDbEngine({nowNs:()=> '99'})
  engine.write('db','m value=1i 1787068800000',{precision:'ms'})
  engine.write('db','m value=2i 1787068801',{precision:'s'})
  engine.write('db','m value=3i',{precision:'ns'})
  assert.deepEqual(engine.snapshot().db.m.map(point=>point.timestampNs),[
    '99','1787068800000000000','1787068801000000000',
  ])
  for(const line of ['m value=NaN 1','m value=1u 1','m value="unterminated 1','m value= 1'])
    assert.throws(()=>engine.write('db',line,{precision:'ns'}))
})

test('serves catalog, schema, retention policy, and tag values',()=>{
  const engine=createMockGeminiDbEngine()
  engine.write('monitoring','cpu_1787068800,host=node-01,region=north usage=37.5,count=2i,status="ok" 1787068800000000001')
  engine.write('monitoring','cpu_1787068800,host=node-02,region=north usage=38.5,count=3i,status="warn" 1787068860000000002')

  assert.deepEqual(firstSeries(engine.query('','SHOW DATABASES')).values,[['monitoring']])
  assert.deepEqual(firstSeries(engine.query('monitoring','SHOW MEASUREMENTS')).values,[['cpu_1787068800']])
  assert.deepEqual(firstSeries(engine.query('monitoring','SHOW FIELD KEYS FROM "cpu_1787068800"')).values,[
    ['count','integer'],['status','string'],['usage','float'],
  ])
  assert.deepEqual(firstSeries(engine.query('monitoring','SHOW TAG KEYS FROM "cpu_1787068800"')).values,[['host'],['region']])
  assert.deepEqual(firstSeries(engine.query('monitoring','SHOW TAG VALUES FROM "cpu_1787068800" WITH KEY = "host" LIMIT 2')).values,[['host','node-01'],['host','node-02']])
  assert.deepEqual(firstSeries(engine.query('monitoring','SHOW RETENTION POLICIES ON "monitoring"')).values,[['autogen','0s',true]])
})

test('selects exact time ranges with deterministic order pagination and epochs',()=>{
  const engine=createMockGeminiDbEngine()
  engine.write('monitoring',[
    'cpu_1787068800,host=node-01 usage=1i 1787068800000000001',
    'cpu_1787068800,host=node-02 usage=2i 1787068860000000002',
    'cpu_1787068800,host=node-03 usage=3i 1787068920000000003',
  ].join('\n'))
  const sql='SELECT * FROM "cpu_1787068800" WHERE time >= 1787068800000000001ns AND time <= 1787068920000000003ns ORDER BY time DESC LIMIT 2 OFFSET 1'
  const ns=firstSeries(engine.query('monitoring',sql,{epoch:'ns'}))
  assert.deepEqual(ns.columns,['time','host','usage'])
  assert.deepEqual(ns.values,[
    ['1787068860000000002','node-02',2],
    ['1787068800000000001','node-01',1],
  ])
  const ms=firstSeries(engine.query('monitoring','SELECT * FROM "cpu_1787068800" ORDER BY time ASC LIMIT 1',{epoch:'ms'}))
  assert.equal(ms.values[0][0],1787068800000)
  assert.throws(()=>engine.query('monitoring','SELECT mean(usage) FROM "cpu_1787068800"'),/不支持/)
})

test('INSERT accepts Studio Line Protocol commands and writes return empty results',()=>{
  const engine=createMockGeminiDbEngine()
  assert.deepEqual(engine.query('monitoring','INSERT cpu_1787068800,host=node-04 usage=9i 1787068980000000004'),{results:[{}]})
  assert.deepEqual(engine.query('monitoring','INSERT INTO cpu_1787068800,host=node-05 usage=10i 1787069040000000005'),{results:[{}]})
  assert.equal(engine.snapshot().monitoring.cpu_1787068800.length,2)
})
