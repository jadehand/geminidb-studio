import { closeSync, openSync, readSync, writeSync } from 'node:fs'

const WINDOWS_GUI_SUBSYSTEM = 2

export function peSubsystemOffset(header) {
  if (header.length < 0x40 || header.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('不是有效的 Windows PE 文件：缺少 MZ 头')
  }
  const peOffset = header.readUInt32LE(0x3c)
  const optionalHeader = peOffset + 24
  if (peOffset + 26 > header.length || header.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('不是有效的 Windows PE 文件：缺少 PE 头')
  }
  const magic = header.readUInt16LE(optionalHeader)
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('不支持的 PE Optional Header')
  return optionalHeader + 68
}

export function setWindowsGuiSubsystem(path) {
  const handle = openSync(path, 'r+')
  try {
    const header = Buffer.alloc(4096)
    const bytes = readSync(handle, header, 0, header.length, 0)
    const offset = peSubsystemOffset(header.subarray(0, bytes))
    const value = Buffer.alloc(2)
    value.writeUInt16LE(WINDOWS_GUI_SUBSYSTEM)
    writeSync(handle, value, 0, value.length, offset)
  } finally {
    closeSync(handle)
  }
}

export function readWindowsSubsystem(path) {
  const handle = openSync(path, 'r')
  try {
    const header = Buffer.alloc(4096)
    const bytes = readSync(handle, header, 0, header.length, 0)
    const offset = peSubsystemOffset(header.subarray(0, bytes))
    return header.readUInt16LE(offset)
  } finally {
    closeSync(handle)
  }
}
