import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('./api.ts', import.meta.url), 'utf8')
const bridgeServer = fs.readFileSync(new URL('../../bridge/server.mjs', import.meta.url), 'utf8')

test('bulk API client exposes exact metadata and job routes', () => {
  for (const method of [
    'retentionPolicies', 'tagValues', 'previewBulkJob', 'createBulkJob',
    'activeBulkJob', 'bulkJob', 'resumeBulkJob', 'cancelBulkJob',
  ]) assert.match(source, new RegExp(`\\b${method}\\s*:`))
  assert.match(source, /request<[^>]+>\(`\/retention-policies\?database=\$\{encodeURIComponent\(database\)\}`/)
  assert.match(source, /request<[^>]+>\(`\/tag-values\?database=\$\{encodeURIComponent\(database\)\}&measurement=\$\{encodeURIComponent\(measurement\)\}&tag=\$\{encodeURIComponent\(tag\)\}`/)
  assert.match(source, /request<[^>]+>\('\/bulk-jobs\/preview'/)
  assert.match(source, /request<[^>]+>\('\/bulk-jobs'/)
  assert.match(source, /request<[^>]+>\('\/bulk-jobs\/active'/)
  assert.match(source, /encodeURIComponent\(id\)/)
  assert.match(source, /\/resume/)
  assert.match(source, /\/cancel/)
  assert.match(bridgeServer, /pathname==='\/retention-policies'[\s\S]*listRetentionPolicies\(current,database\)/)
  assert.match(bridgeServer, /pathname==='\/tag-values'[\s\S]*listTagValues\(current,database,measurement,tag,1000\)/)
})

test('bulk client posts JSON plans and preserves bridge error details', () => {
  assert.match(source, /body:JSON\.stringify\(plan\)/)
  assert.match(source, /createBulkJob:\s*\(input:[\s\S]*previewId:string[\s\S]*body:JSON\.stringify\(input\)/)
  assert.match(source, /details\??\s*:/)
  assert.match(source, /environment\??:\s*'prod'\|'test'\|'dev'/)
})
