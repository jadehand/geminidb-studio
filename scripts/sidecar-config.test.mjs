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
