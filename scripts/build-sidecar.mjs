import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const targets = {
  'linux-x64': ['node22-linux-x64', 'x86_64-unknown-linux-gnu', ''],
  'linux-arm64': ['node22-linux-arm64', 'aarch64-unknown-linux-gnu', ''],
  'darwin-x64': ['node22-macos-x64', 'x86_64-apple-darwin', ''],
  'darwin-arm64': ['node22-macos-arm64', 'aarch64-apple-darwin', ''],
  'win32-x64': ['node22-win-x64', 'x86_64-pc-windows-msvc', '.exe'],
  'win32-arm64': ['node22-win-arm64', 'aarch64-pc-windows-msvc', '.exe']
}

const target = targets[`${process.platform}-${process.arch}`]
if (!target) throw new Error(`不支持的 sidecar 构建平台：${process.platform}-${process.arch}`)
const [pkgTarget, triple, extension] = target
const output = `src-tauri/binaries/geminidb-bridge-${triple}${extension}`
mkdirSync('src-tauri/binaries', { recursive: true })

const executable = process.platform === 'win32' ? 'node_modules/.bin/pkg.cmd' : 'node_modules/.bin/pkg'
const result = spawnSync(executable, ['apps/bridge/server.mjs', '--target', pkgTarget, '--output', output], {
  stdio: 'inherit',
  env: { ...process.env, PKG_CACHE_PATH: process.env.PKG_CACHE_PATH || join(tmpdir(), 'geminidb-studio-pkg-cache') }
})
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Bridge sidecar：${output}`)
