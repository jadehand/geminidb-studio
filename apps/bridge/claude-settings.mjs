import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export class ClaudeSettingsError extends Error {
  constructor(message) {
    super(message)
    this.name='ClaudeSettingsError'
    this.status=400
    this.code='CLAUDE_SETTINGS_INVALID'
  }
}

function normalizeCliPath(value) {
  if(typeof value!=='string')throw new ClaudeSettingsError('Claude CLI 路径必须是字符串')
  const path=value.trim()
  if(path.length>2048)throw new ClaudeSettingsError('Claude CLI 路径过长')
  if(/[\0\r\n]/.test(path))throw new ClaudeSettingsError('Claude CLI 路径包含无效字符')
  return path
}

export function createClaudeSettingsStore({dataDir,fallbackCommand='claude'}={}) {
  if(typeof dataDir!=='string'||!dataDir.trim())throw new TypeError('dataDir is required')
  const root=join(dataDir,'claude-assistant')
  const settingsPath=join(root,'settings.json')
  let settings={cliPath:''}
  let queue=Promise.resolve()
  const save=async()=>{
    const temporary=`${settingsPath}.${randomUUID()}.tmp`
    await writeFile(temporary,`${JSON.stringify(settings,null,2)}\n`,'utf8')
    await rename(temporary,settingsPath)
  }
  return{
    async init() {
      await mkdir(root,{recursive:true})
      try{
        const parsed=JSON.parse(await readFile(settingsPath,'utf8'))
        settings={cliPath:normalizeCliPath(parsed?.cliPath??'')}
      }catch(error){
        if(error?.code!=='ENOENT') {
          try{await rename(settingsPath,`${settingsPath}.${Date.now()}.corrupt`)}catch{}
        }
        settings={cliPath:''}
        await save()
      }
      return this
    },
    get(){return{...settings}},
    command(){return settings.cliPath||fallbackCommand},
    update(value) {
      if(!value||typeof value!=='object'||Array.isArray(value))return Promise.reject(new ClaudeSettingsError('Claude 设置无效'))
      const keys=Object.keys(value)
      if(keys.length!==1||keys[0]!=='cliPath')return Promise.reject(new ClaudeSettingsError('Claude 设置包含不支持的字段'))
      const next={cliPath:normalizeCliPath(value.cliPath)}
      const pending=queue.then(async()=>{settings=next;await save();return{...settings}})
      queue=pending.catch(()=>{})
      return pending
    },
  }
}
