import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Rust 使用 externalBin 的文件名启动 Sidecar', async () => {
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
  const rust = await readFile('src-tauri/src/lib.rs', 'utf8')

  assert.deepEqual(config.bundle.externalBin, ['binaries/geminidb-bridge'])
  assert.match(rust, /\.sidecar\("geminidb-bridge"\)/)
  assert.match(rust, /app\.path\(\)\.app_data_dir\(\)/)
  assert.match(rust, /"--data-dir"/)
  assert.doesNotMatch(rust, /data_dir\.to_string_lossy/)
  assert.match(rust, /data_dir\s*\.\s*to_str\(\)/)
  assert.match(rust, /GeminiDB Studio 数据目录不是有效的 UTF-8 路径，无法启动 Bridge/)
  assert.doesNotMatch(rust, /\.sidecar\("binaries\/geminidb-bridge"\)/)
})

test('开发模式为 Bridge 传递独立数据目录', async () => {
  const script = await readFile('scripts/dev-desktop.mjs', 'utf8')

  assert.match(script, /import \{ join \} from 'node:path'/)
  assert.match(script, /import \{ tmpdir \} from 'node:os'/)
  assert.match(script, /GEMINIDB_STUDIO_DATA_DIR/)
  assert.match(script, /join\(tmpdir\(\), 'geminidb-studio-dev'\)/)
  assert.match(script, /\['apps\/bridge\/server\.mjs', '--data-dir', dataDir\]/)
  assert.match(script, /env: \{ \.\.\.process\.env, GEMINIDB_STUDIO_DATA_DIR: dataDir \}/)
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
