import test from 'node:test'
import assert from 'node:assert/strict'

const workspaceTabs=await import('./workspace-tabs.ts')

test('reuses an existing measurement data tab for the same connection database and measurement',()=>{
  const existing=[{
    kind:'measurement-data',id:'data-1',name:'cpu_1784995200 · 数据',
    connectionId:'c1',database:'metrics',measurement:'cpu_1784995200',
  }]

  const result=workspaceTabs.openMeasurementDataTab(existing,{
    connectionId:'c1',database:'metrics',measurement:'cpu_1784995200',
  })

  assert.equal(result.tabs.length,1)
  assert.equal(result.activeId,'data-1')
})

test('creates a measurement data tab with the measurement data title',()=>{
  const result=workspaceTabs.openMeasurementDataTab([],{
    connectionId:'c1',database:'metrics',measurement:'cpu_1784995200',
  })

  assert.deepEqual(result.tabs,[{
    kind:'measurement-data',id:'measurement-data:["c1","metrics","cpu_1784995200"]',name:'cpu_1784995200 · 数据',
    connectionId:'c1',database:'metrics',measurement:'cpu_1784995200',
  }])
  assert.equal(result.activeId,'measurement-data:["c1","metrics","cpu_1784995200"]')
})
