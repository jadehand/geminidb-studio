import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { readWindowsSubsystem, setWindowsGuiSubsystem } from './pe-subsystem.mjs'

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

const require = createRequire(import.meta.url)
const pkgRoot = dirname(require.resolve('@yao-pkg/pkg/package.json'))
const pkgCli = join(pkgRoot, 'lib-es5', 'bin.js')
const result = spawnSync(process.execPath, [pkgCli, 'apps/bridge/server.mjs', '--target', pkgTarget, '--output', output], {
  stdio: 'inherit',
  env: { ...process.env, PKG_CACHE_PATH: process.env.PKG_CACHE_PATH || join(tmpdir(), 'geminidb-studio-pkg-cache') }
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
if (statSync(output).size === 0) throw new Error(`Bridge sidecar 产物为空：${output}`)
if (process.platform === 'win32') {
  setWindowsGuiSubsystem(output)
  if (readWindowsSubsystem(output) !== 2) throw new Error('Bridge Sidecar 不是 Windows GUI 子系统')
}
console.log(`Bridge sidecar：${output}`)
