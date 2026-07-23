import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionForTransport, endpointProtocol, withEndpointProtocol } from './endpoint.ts'

test('协议切换保留主机、端口和路径', () => {
  assert.equal(withEndpointProtocol('https://192.0.2.10:8635/influx', 'http'), 'http://192.0.2.10:8635/influx')
  assert.equal(withEndpointProtocol('http://192.0.2.10:8635', 'https'), 'https://192.0.2.10:8635')
  assert.equal(endpointProtocol(' HTTPS://example.test:8635 '), 'https')
})

test('HTTP 连接强制关闭 TLS 证书忽略选项', () => {
  const base = { id:'1', name:'test', mode:'influx', endpoint:'http://192.0.2.10:8635', username:'rwuser', autoLogin:false, readOnly:false, insecureSkipVerify:true }
  assert.equal(connectionForTransport(base).insecureSkipVerify, false)
  assert.equal(connectionForTransport({...base,endpoint:'https://192.0.2.10:8635'}).insecureSkipVerify, true)
})
