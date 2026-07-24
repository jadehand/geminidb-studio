import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Rust 使用 externalBin 的文件名启动 Sidecar', async () => {
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
  const rust = await readFile('src-tauri/src/lib.rs', 'utf8')

  assert.deepEqual(config.bundle.externalBin, ['binaries/geminidb-bridge'])
  assert.match(rust, /\.sidecar\("geminidb-bridge"\)/)
  assert.doesNotMatch(rust, /\.sidecar\("binaries\/geminidb-bridge"\)/)
})

test('桌面端只允许将查询结果导出为受支持的文件类型', async () => {
  const permissions = JSON.parse(await readFile('src-tauri/capabilities/default.json', 'utf8'))
  const rust = await readFile('src-tauri/src/lib.rs', 'utf8')

  assert.ok(permissions.permissions.includes('dialog:allow-open'))
  assert.match(rust, /\.plugin\(tauri_plugin_dialog::init\(\)\)/)
  assert.match(rust, /fn export_result_file\(/)
  assert.match(rust, /matches!\(extension, "csv" \| "xls" \| "json"\)/)
  assert.match(rust, /export_result_file,/)
})
