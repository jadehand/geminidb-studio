import assert from 'node:assert/strict'
import test from 'node:test'
import { NEW_INFLUX_CONNECTION, removeMockConnections } from './connections.ts'

test('首次启动不再创建 Mock 或预填用户名', () => {
  assert.equal(NEW_INFLUX_CONNECTION.mode, 'influx')
  assert.equal(NEW_INFLUX_CONNECTION.username, '')
  assert.equal(NEW_INFLUX_CONNECTION.autoLogin, false)
})

test('升级时移除旧 Mock 并保留真实连接', () => {
  const mock = { ...NEW_INFLUX_CONNECTION, id: 'mock', mode: 'mock' }
  const influx = { ...NEW_INFLUX_CONNECTION, id: 'prod', name: '生产库' }
  assert.deepEqual(removeMockConnections([mock, influx]), [influx])
})
