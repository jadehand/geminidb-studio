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

test('allocates a unique measurement data tab id when a query tab occupies the deterministic id',()=>{
  const base='measurement-data:["c1","metrics","cpu_1784995200"]'
  const existing=[{kind:'query',id:base,name:'query',sql:'SHOW DATABASES'}]

  const opened=workspaceTabs.openMeasurementDataTab(existing,{
    connectionId:'c1',database:'metrics',measurement:'cpu_1784995200',
  })
  const reopened=workspaceTabs.openMeasurementDataTab(opened.tabs,{
    connectionId:'c1',database:'metrics',measurement:'cpu_1784995200',
  })

  assert.equal(opened.activeId,`${base}-2`)
  assert.deepEqual(opened.tabs.map(tab=>tab.id),[base,`${base}-2`])
  assert.equal(reopened.activeId,`${base}-2`)
  assert.equal(reopened.tabs.length,2)
})

test('closing the only measurement data tab creates and activates a default query tab',()=>{
  const result=workspaceTabs.closeWorkspaceTab([{
    kind:'measurement-data',id:'data-1',name:'cpu · 数据',connectionId:'c1',database:'metrics',measurement:'cpu',
  }],'data-1','data-1')

  assert.deepEqual(result,{tabs:[{kind:'query',id:'query-1',name:'查询 1',sql:'SHOW DATABASES'}],activeId:'query-1'})
})

test('closing the only query tab resets it instead of removing it',()=>{
  const result=workspaceTabs.closeWorkspaceTab([{kind:'query',id:'query-9',name:'custom',sql:'SELECT 1'}],'query-9','query-9')

  assert.deepEqual(result,{tabs:[{kind:'query',id:'query-9',name:'查询 1',sql:''}],activeId:'query-9'})
})

test('closing the unique query in a multi-tab workspace leaves the active data tab',()=>{
  const tabs=[
    {kind:'measurement-data',id:'data-1',name:'cpu · 数据',connectionId:'c1',database:'metrics',measurement:'cpu'},
    {kind:'query',id:'query-1',name:'query 1',sql:'SHOW DATABASES'},
  ]

  assert.deepEqual(workspaceTabs.closeWorkspaceTab(tabs,'query-1','query-1'),{
    tabs:[tabs[0]],activeId:'data-1',
  })
})

test('closing a query between data tabs selects its preceding data neighbor',()=>{
  const tabs=[
    {kind:'measurement-data',id:'data-1',name:'cpu · 数据',connectionId:'c1',database:'metrics',measurement:'cpu'},
    {kind:'query',id:'query-1',name:'query 1',sql:'SHOW DATABASES'},
    {kind:'measurement-data',id:'data-2',name:'mem · 数据',connectionId:'c1',database:'metrics',measurement:'mem'},
  ]

  assert.equal(workspaceTabs.closeWorkspaceTab(tabs,'query-1','query-1').activeId,'data-1')
})

test('closing an active tab selects its previous neighbor without changing an inactive selection',()=>{
  const tabs=[
    {kind:'query',id:'query-1',name:'query 1',sql:'one'},
    {kind:'measurement-data',id:'data-1',name:'cpu · 数据',connectionId:'c1',database:'metrics',measurement:'cpu'},
    {kind:'query',id:'query-2',name:'query 2',sql:'two'},
  ]

  assert.equal(workspaceTabs.closeWorkspaceTab(tabs,'data-1','data-1').activeId,'query-1')
  assert.equal(workspaceTabs.closeWorkspaceTab(tabs,'data-1','query-1').activeId,'data-1')
})
