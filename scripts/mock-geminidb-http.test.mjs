import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { getMeasurementSchema, influxCommand, influxQuery, influxWrite, listDatabases, listMeasurements, listRetentionPolicies, listTagValues } from '../apps/bridge/influx-client.mjs'
import { createMockGeminiDbServer } from './mock-geminidb.mjs'

function request(endpoint,path,{authorization,method='GET',body=''}={}) {
  const url=new URL(path,endpoint)
  return new Promise((resolve,reject)=>{
    const current=http.request(url,{method,headers:{...(authorization?{Authorization:authorization}:{}),...(body?{'Content-Length':Buffer.byteLength(body)}:{})}},response=>{
      const chunks=[]
      response.on('data',chunk=>chunks.push(chunk))
      response.on('end',()=>resolve({status:response.statusCode,text:Buffer.concat(chunks).toString('utf8')}))
    })
    current.on('error',reject)
    if(body)current.write(body)
    current.end()
  })
}

async function fixture(t,{seed=false}={}) {
  const mock=createMockGeminiDbServer({port:0,seed})
  await mock.listen()
  t.after(()=>mock.close())
  return mock
}

test('HTTP server binds locally, exposes health, and enforces demo Basic Auth',async t=>{
  const mock=await fixture(t)
  const endpoint=mock.address()
  assert.match(endpoint,/^http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal((await request(endpoint,'/health')).status,200)
  assert.equal((await request(endpoint,'/query?q=SHOW+DATABASES')).status,401)
  const wrong=Buffer.from('demo:wrong').toString('base64')
  assert.equal((await request(endpoint,'/query?q=SHOW+DATABASES',{authorization:`Basic ${wrong}`})).status,401)
  const missing=await request(endpoint,'/missing',{authorization:`Basic ${Buffer.from('demo:demo').toString('base64')}`})
  assert.equal(missing.status,404)
})

test('real Bridge Influx client completes catalog query write and INSERT flows',async t=>{
  const mock=await fixture(t)
  mock.engine.write('monitoring',[
    'cpu_1787068800,host=node-01,region=north usage=37.5,status="ok" 1787068800000000001',
    'cpu_1787068800,host=node-02,region=north usage=38.5,status="warn" 1787068860000000002',
  ].join('\n'))
  const config={endpoint:mock.address(),username:'demo',password:'demo',timeoutMs:2000,insecureSkipVerify:false}

  assert.deepEqual(await listDatabases(config),['monitoring'])
  assert.deepEqual(await listMeasurements(config,'monitoring'),['cpu_1787068800'])
  assert.deepEqual(await getMeasurementSchema(config,'monitoring','cpu_1787068800'),{
    fields:[{name:'status',type:'string'},{name:'usage',type:'float'}],tags:['host','region'],
  })
  assert.deepEqual(await listRetentionPolicies(config,'monitoring'),[{name:'autogen',durationMs:0,isDefault:true}])
  assert.deepEqual(await listTagValues(config,'monitoring','cpu_1787068800','host',1000),{values:['node-01','node-02'],truncated:false})

  const selected=await influxQuery(config,'monitoring','SELECT * FROM "cpu_1787068800" ORDER BY time DESC LIMIT 1',{epoch:'ns'})
  assert.equal(selected.rows[0].time,'1787068860000000002')
  await influxWrite(config,'monitoring','cpu_1787068800,host=node-03,region=north usage=39.5,status="ok" 1787068920000',{precision:'ms',retentionPolicy:'autogen'})
  await influxCommand(config,'monitoring','INSERT cpu_1787068800,host=node-04,region=north usage=40.5,status="ok" 1787068980000000004')
  const after=await influxQuery(config,'monitoring','SELECT * FROM "cpu_1787068800" ORDER BY time DESC LIMIT 10',{epoch:'ns'})
  assert.deepEqual(after.rows.map(row=>row.host),['node-04','node-03','node-02','node-01'])
})

test('seed mode provides an immediately browsable day-table database',async t=>{
  const mock=await fixture(t,{seed:true})
  const config={endpoint:mock.address(),username:'demo',password:'demo',timeoutMs:2000,insecureSkipVerify:false}
  assert.deepEqual(await listDatabases(config),['monitoring'])
  const measurements=await listMeasurements(config,'monitoring')
  assert.equal(measurements.length,1)
  assert.match(measurements[0],/^studio_demo_\d{10}$/)
  const schema=await getMeasurementSchema(config,'monitoring',measurements[0])
  assert.deepEqual(schema,{fields:[{name:'healthy',type:'boolean'},{name:'status',type:'string'},{name:'usage',type:'float'}],tags:['host','region']})
})
