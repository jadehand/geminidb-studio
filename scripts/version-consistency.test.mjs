import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const expectedVersion = '0.5.0'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('all release metadata reports version 0.5.0', async () => {
  const [packageJson, packageLock, cargoToml, tauriConfig, bridgeServer] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('package-lock.json').then(JSON.parse),
    read('src-tauri/Cargo.toml'),
    read('src-tauri/tauri.conf.json').then(JSON.parse),
    read('apps/bridge/server.mjs'),
  ])

  assert.equal(packageJson.version, expectedVersion, 'package.json')
  assert.equal(packageLock.version, expectedVersion, 'package-lock.json top level')
  assert.equal(packageLock.packages[''].version, expectedVersion, 'package-lock.json root package')
  assert.match(cargoToml, /^version = "0\.5\.0"$/m, 'src-tauri/Cargo.toml')
  assert.equal(tauriConfig.version, expectedVersion, 'src-tauri/tauri.conf.json')
  assert.match(bridgeServer, /version:'0\.5\.0'/, 'Bridge /health')
})
