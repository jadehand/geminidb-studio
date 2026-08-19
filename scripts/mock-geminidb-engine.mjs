const PRECISION_MULTIPLIER={ns:1n,u:1_000n,us:1_000n,ms:1_000_000n,s:1_000_000_000n,m:60_000_000_000n,h:3_600_000_000_000n}

export class MockGeminiDbError extends Error {
  constructor(message,status=400) {
    super(message)
    this.name='MockGeminiDbError'
    this.status=status
  }
}

const invalid=message=>new MockGeminiDbError(message)

function splitOutside(value,delimiter,{quotes=false}={}) {
  const parts=[]
  let current='',escaped=false,quoted=false
  for(const character of value) {
    if(escaped){current+=character;escaped=false;continue}
    if(character==='\\'){current+=character;escaped=true;continue}
    if(quotes&&character==='"'){current+=character;quoted=!quoted;continue}
    if(character===delimiter&&!quoted){parts.push(current);current='';continue}
    current+=character
  }
  if(escaped||quoted)throw invalid('Line Protocol 包含未结束的转义或字符串')
  parts.push(current)
  return parts
}

function lineSegments(line) {
  const parts=[]
  let current='',escaped=false,quoted=false
  for(const character of line.trim()) {
    if(escaped){current+=character;escaped=false;continue}
    if(character==='\\'){current+=character;escaped=true;continue}
    if(character==='"'){current+=character;quoted=!quoted;continue}
    if(/\s/.test(character)&&!quoted){if(current){parts.push(current);current=''};continue}
    current+=character
  }
  if(escaped||quoted)throw invalid('Line Protocol 包含未结束的转义或字符串')
  if(current)parts.push(current)
  if(parts.length<2||parts.length>3)throw invalid('Line Protocol 必须包含 Measurement、Field 和可选时间戳')
  return parts
}

function unescapeIdentifier(value,label) {
  if(!value)throw invalid(`${label}不能为空`)
  let result='',escaped=false
  for(const character of value) {
    if(escaped){result+=character;escaped=false}
    else if(character==='\\')escaped=true
    else result+=character
  }
  if(escaped||!result||/[\0\r\n]/.test(result))throw invalid(`${label}无效`)
  return result
}

function assignment(value,label) {
  let escaped=false,quoted=false
  for(let index=0;index<value.length;index++) {
    const character=value[index]
    if(escaped){escaped=false;continue}
    if(character==='\\'){escaped=true;continue}
    if(character==='"'){quoted=!quoted;continue}
    if(character==='='&&!quoted)return[value.slice(0,index),value.slice(index+1)]
  }
  throw invalid(`${label}必须使用 key=value`)
}

function parseQuotedString(value) {
  if(value.length<2||value[0]!=='"'||value.at(-1)!=='"')throw invalid('字符串 Field 必须使用双引号闭合')
  let result='',escaped=false
  for(const character of value.slice(1,-1)) {
    if(escaped){result+=character;escaped=false}
    else if(character==='\\')escaped=true
    else if(character==='"')throw invalid('字符串 Field 包含未转义的双引号')
    else result+=character
  }
  if(escaped)throw invalid('字符串 Field 包含未结束的转义')
  return result
}

function parseFieldValue(value) {
  if(!value)throw invalid('Field 值不能为空')
  if(value.startsWith('"'))return{value:parseQuotedString(value),type:'string'}
  if(/^(?:true|false)$/i.test(value))return{value:value.toLowerCase()==='true',type:'boolean'}
  if(/^-?(?:0|[1-9]\d*)i$/.test(value)) {
    const integer=Number(value.slice(0,-1))
    if(!Number.isSafeInteger(integer))throw invalid('整数 Field 超出安全范围')
    return{value:integer,type:'integer'}
  }
  if(/^-?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    const number=Number(value)
    if(!Number.isFinite(number))throw invalid('浮点 Field 必须是有限数字')
    return{value:number,type:'float'}
  }
  throw invalid(`不支持的 Field 值：${value}`)
}

function timestampNs(value,precision,nowNs) {
  if(value===undefined)return String(nowNs())
  if(!/^-?(?:0|[1-9]\d*)$/.test(value))throw invalid('时间戳必须是十进制整数')
  const multiplier=PRECISION_MULTIPLIER[precision]
  if(!multiplier)throw invalid(`不支持的写入精度：${precision}`)
  return String(BigInt(value)*multiplier)
}

function parseLine(line,{precision,nowNs}) {
  const [head,fieldText,timestamp]=lineSegments(line)
  const [rawMeasurement,...rawTags]=splitOutside(head,',')
  const measurement=unescapeIdentifier(rawMeasurement,'Measurement')
  const tags={}
  for(const rawTag of rawTags) {
    const [rawKey,rawValue]=assignment(rawTag,'Tag')
    const key=unescapeIdentifier(rawKey,'Tag Key')
    const value=unescapeIdentifier(rawValue,'Tag Value')
    if(Object.hasOwn(tags,key))throw invalid(`Tag 重复：${key}`)
    tags[key]=value
  }
  const fields={},types={}
  for(const rawField of splitOutside(fieldText,',',{quotes:true})) {
    const [rawKey,rawValue]=assignment(rawField,'Field')
    const key=unescapeIdentifier(rawKey,'Field Key')
    const parsed=parseFieldValue(rawValue)
    if(Object.hasOwn(fields,key))throw invalid(`Field 重复：${key}`)
    fields[key]=parsed.value
    types[key]=parsed.type
  }
  if(!Object.keys(fields).length)throw invalid('至少需要一个 Field')
  return{measurement,tags,fields,types,timestampNs:timestampNs(timestamp,precision,nowNs)}
}

function quotedIdentifier(value) {
  const text=String(value).trim()
  if(text.startsWith('"')) {
    if(!text.endsWith('"'))throw invalid('InfluxQL 标识符未闭合')
    return text.slice(1,-1).replace(/\\([\\"])/g,'$1')
  }
  if(!/^[A-Za-z_][\w.-]*$/.test(text))throw invalid(`InfluxQL 标识符无效：${text}`)
  return text
}

function series(name,columns,values) {return{name,columns,values}}
const result=entry=>({results:[entry]})

function scalar(value) {
  const text=value.trim()
  if((text.startsWith("'")&&text.endsWith("'"))||(text.startsWith('"')&&text.endsWith('"')))return text.slice(1,-1).replace(/\\(['"\\])/g,'$1')
  if(/^(?:true|false)$/i.test(text))return text.toLowerCase()==='true'
  if(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))return Number(text)
  throw invalid(`不支持的 WHERE 值：${value}`)
}

function boundNs(value,unit='ns') {
  const multiplier=PRECISION_MULTIPLIER[unit]
  if(!multiplier||!/^\d+$/.test(value))throw invalid('时间条件无效')
  return BigInt(value)*multiplier
}

export function createMockGeminiDbEngine({nowNs=()=>String(BigInt(Date.now())*1_000_000n)}={}) {
  const databases=new Map()
  const getDatabase=(name,{create=false}={})=>{
    if(!databases.has(name)&&create)databases.set(name,new Map())
    return databases.get(name)
  }
  const getMeasurement=(database,name,{create=false}={})=>{
    const tables=getDatabase(database,{create})
    if(!tables)return undefined
    if(!tables.has(name)&&create)tables.set(name,{points:new Map(),fieldTypes:new Map(),tagKeys:new Set()})
    return tables.get(name)
  }

  function write(database,body,{precision='ns'}={}) {
    if(typeof database!=='string'||!database.trim())throw invalid('写入必须指定 database')
    if(typeof body!=='string'||!body.trim())throw invalid('写入内容不能为空')
    if(!Object.hasOwn(PRECISION_MULTIPLIER,precision))throw invalid(`不支持的写入精度：${precision}`)
    const parsed=body.split(/\r?\n/).filter(line=>line.trim()).map(line=>parseLine(line,{precision,nowNs}))
    const pendingTypes=new Map()
    for(const point of parsed) {
      const table=getMeasurement(database,point.measurement)
      for(const [field,type] of Object.entries(point.types)) {
        const key=`${point.measurement}\0${field}`
        const existing=pendingTypes.get(key)||table?.fieldTypes.get(field)
        if(existing&&existing!==type)throw invalid(`Field 类型冲突：${field} 已是 ${existing}，不能写入 ${type}`)
        pendingTypes.set(key,type)
      }
    }
    for(const point of parsed) {
      const table=getMeasurement(database,point.measurement,{create:true})
      for(const tag of Object.keys(point.tags))table.tagKeys.add(tag)
      for(const [field,type] of Object.entries(point.types))table.fieldTypes.set(field,type)
      const sortedTags=Object.fromEntries(Object.entries(point.tags).sort(([a],[b])=>a.localeCompare(b)))
      const identity=JSON.stringify([point.measurement,point.timestampNs,Object.entries(sortedTags)])
      const existing=table.points.get(identity)
      table.points.set(identity,{timestampNs:point.timestampNs,tags:sortedTags,fields:{...(existing?.fields||{}),...point.fields}})
    }
    return parsed.length
  }

  function query(database,influxql,{epoch='ms'}={}) {
    if(!['ms','ns'].includes(epoch))throw invalid('Mock 查询仅支持 ms 或 ns epoch')
    const sql=String(influxql||'').trim().replace(/;$/,'').trim()
    if(!sql)throw invalid('InfluxQL 不能为空')
    if(/^SHOW DATABASES$/i.test(sql)) {
      const values=[...databases.keys()].sort().map(name=>[name])
      return result(values.length?{series:[series('databases',['name'],values)]}:{})
    }
    if(/^SHOW MEASUREMENTS$/i.test(sql)) {
      const values=[...(getDatabase(database)?.keys()||[])].sort().map(name=>[name])
      return result(values.length?{series:[series('measurements',['name'],values)]}:{})
    }
    let match=sql.match(/^SHOW FIELD KEYS FROM\s+(.+)$/i)
    if(match) {
      const name=quotedIdentifier(match[1]),table=getMeasurement(database,name)
      const values=[...(table?.fieldTypes||[])].sort(([a],[b])=>a.localeCompare(b))
      return result(values.length?{series:[series(name,['fieldKey','fieldType'],values)]}:{})
    }
    match=sql.match(/^SHOW TAG KEYS FROM\s+(.+)$/i)
    if(match) {
      const name=quotedIdentifier(match[1]),table=getMeasurement(database,name)
      const values=[...(table?.tagKeys||[])].sort().map(tag=>[tag])
      return result(values.length?{series:[series(name,['tagKey'],values)]}:{})
    }
    match=sql.match(/^SHOW RETENTION POLICIES ON\s+(.+)$/i)
    if(match) {
      quotedIdentifier(match[1])
      return result({series:[series('retention_policies',['name','duration','default'],[['autogen','0s',true]])]})
    }
    match=sql.match(/^SHOW TAG VALUES FROM\s+((?:"(?:\\.|[^"])*)"|[^\s]+)\s+WITH KEY\s*=\s*((?:"(?:\\.|[^"])*)"|[^\s]+)(?:\s+LIMIT\s+(\d+))?$/i)
    if(match) {
      const name=quotedIdentifier(match[1]),tag=quotedIdentifier(match[2]),limit=Number(match[3]||1000),table=getMeasurement(database,name)
      if(!Number.isSafeInteger(limit)||limit<1)throw invalid('LIMIT 必须是正整数')
      const values=[...new Set([...(table?.points.values()||[])].map(point=>point.tags[tag]).filter(value=>value!==undefined))].sort().slice(0,limit).map(value=>[tag,value])
      return result(values.length?{series:[series(name,['key','value'],values)]}:{})
    }
    match=sql.match(/^INSERT(?:\s+INTO)?\s+(.+)$/i)
    if(match){write(database,match[1],{precision:'ns'});return result({})}

    match=sql.match(/^SELECT\s+(.+?)\s+FROM\s+((?:"(?:\\.|[^"])*)"|[^\s]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+time\s+(ASC|DESC))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?$/i)
    if(!match)throw invalid('Mock GeminiDB 仅支持基础 SELECT、目录查询和写入命令')
    const [,projection,rawName,where='',direction='ASC',rawLimit='1000',rawOffset='0']=match
    if(projection.trim()!=='*'&&projection.split(',').some(item=>!/^(?:"(?:\\.|[^"])*"|[A-Za-z_][\w.-]*)$/.test(item.trim())))throw invalid('Mock GeminiDB 不支持聚合、表达式或函数列')
    const name=quotedIdentifier(rawName),table=getMeasurement(database,name)
    const limit=Number(rawLimit),offset=Number(rawOffset)
    if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(offset)||offset<0)throw invalid('LIMIT/OFFSET 无效')
    const conditions=where?where.split(/\s+AND\s+/i).map(condition=>condition.trim()):[]
    let points=[...(table?.points.values()||[])].filter(point=>conditions.every(condition=>{
      let conditionMatch=condition.match(/^time\s*(>=|<=|>|<|=)\s*(\d+)(ns|ms|s)?$/i)
      if(conditionMatch) {
        const current=BigInt(point.timestampNs),target=boundNs(conditionMatch[2],(conditionMatch[3]||'ns').toLowerCase())
        return conditionMatch[1]==='>='?current>=target:conditionMatch[1]==='<='?current<=target:conditionMatch[1]==='>'?current>target:conditionMatch[1]==='<'?current<target:current===target
      }
      conditionMatch=condition.match(/^((?:"(?:\\.|[^"])*)"|[A-Za-z_][\w.-]*)\s*(=|!=)\s*(.+)$/)
      if(!conditionMatch)throw invalid(`Mock GeminiDB 不支持 WHERE 条件：${condition}`)
      const key=quotedIdentifier(conditionMatch[1]),current=point.tags[key]??point.fields[key],target=scalar(conditionMatch[3])
      return conditionMatch[2]==='='?current===target:current!==target
    }))
    points.sort((left,right)=>{
      const order=BigInt(left.timestampNs)<BigInt(right.timestampNs)?-1:BigInt(left.timestampNs)>BigInt(right.timestampNs)?1:JSON.stringify(left.tags).localeCompare(JSON.stringify(right.tags))
      return direction.toUpperCase()==='DESC'?-order:order
    })
    points=points.slice(offset,offset+limit)
    if(!points.length)return result({})
    const allColumns=['time',...[...(table?.tagKeys||[])].sort(),...[...(table?.fieldTypes.keys()||[])].sort()]
    const columns=projection.trim()==='*'?allColumns:['time',...projection.split(',').map(quotedIdentifier).filter(column=>column!=='time')]
    const values=points.map(point=>columns.map(column=>column==='time'
      ? epoch==='ns'?point.timestampNs:Number(BigInt(point.timestampNs)/1_000_000n)
      : point.tags[column]??point.fields[column]??null))
    return result({series:[series(name,columns,values)]})
  }

  function snapshot() {
    return Object.fromEntries([...databases].sort(([a],[b])=>a.localeCompare(b)).map(([database,tables])=>[
      database,Object.fromEntries([...tables].sort(([a],[b])=>a.localeCompare(b)).map(([name,table])=>[
        name,[...table.points.values()].sort((a,b)=>BigInt(a.timestampNs)<BigInt(b.timestampNs)?-1:1).map(point=>({timestampNs:point.timestampNs,tags:{...point.tags},fields:{...point.fields}})),
      ])),
    ]))
  }

  return{write,query,snapshot}
}
