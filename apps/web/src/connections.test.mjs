import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateConnections, NEW_INFLUX_CONNECTION, removeMockConnections } from './connections.ts'
import { normalizeConnectionWritePolicy } from './write-policy.ts'

test('migration derives read-only state from the connection environment', () => {
  const production = normalizeConnectionWritePolicy({ ...NEW_INFLUX_CONNECTION, environment:'prod', readOnly:false })
  const testConnection = normalizeConnectionWritePolicy({ ...NEW_INFLUX_CONNECTION, environment:'test', readOnly:true })
  const development = normalizeConnectionWritePolicy({ ...NEW_INFLUX_CONNECTION, environment:'dev', readOnly:true })

  assert.equal(production.readOnly, true)
  assert.equal(testConnection.readOnly, false)
  assert.equal(development.readOnly, false)
})

test('migration removes legacy mocks and normalizes saved connections', () => {
  const legacyMock = { ...NEW_INFLUX_CONNECTION, id:'mock', mode:'mock', environment:'prod', readOnly:false }
  const legacyProduction = { ...NEW_INFLUX_CONNECTION, id:'prod', environment:'prod', readOnly:false }

  assert.deepEqual(migrateConnections([legacyMock, legacyProduction]), [{ ...legacyProduction, readOnly:true }])
})

test('首次启动不再创建 Mock 或预填用户名', () => {
  assert.equal(NEW_INFLUX_CONNECTION.mode, 'influx')
  assert.equal(NEW_INFLUX_CONNECTION.username, '')
  assert.equal(NEW_INFLUX_CONNECTION.endpoint, '')
  assert.equal(NEW_INFLUX_CONNECTION.autoLogin, false)
})

test('升级时移除旧 Mock 并保留真实连接', () => {
  const mock = { ...NEW_INFLUX_CONNECTION, id: 'mock', mode: 'mock' }
  const influx = { ...NEW_INFLUX_CONNECTION, id: 'prod', name: '生产库' }
  assert.deepEqual(removeMockConnections([mock, influx]), [influx])
})
