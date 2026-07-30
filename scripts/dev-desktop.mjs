import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const dataDir = process.env.GEMINIDB_STUDIO_DATA_DIR || join(tmpdir(), 'geminidb-studio-dev')
const bridge = spawn(process.execPath, ['apps/bridge/server.mjs', '--data-dir', dataDir], {
  stdio: 'inherit',
  env: { ...process.env, GEMINIDB_STUDIO_DATA_DIR: dataDir },
})
const web = spawn(npm, ['run', 'dev:web'], { stdio: 'inherit' })

function stop(signal = 'SIGTERM') {
  bridge.kill(signal)
  web.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop())
bridge.on('exit', code => { stop(); process.exit(code ?? 1) })
web.on('exit', code => { stop(); process.exit(code ?? 1) })
