import http from 'node:http'
import https from 'node:https'

function request(config, method, path, body = '') {
  const endpoint = new URL(config.endpoint)
  const transport = endpoint.protocol === 'https:' ? https : http
  const authorization = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  return new Promise((resolve, reject) => {
    const req = transport.request({ protocol:endpoint.protocol, hostname:endpoint.hostname, port:endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80), method, path:`${endpoint.pathname.replace(/\/$/, '')}${path}`, headers:{ Authorization:`Basic ${authorization}`, Accept:'application/json', ...(body ? { 'Content-Type':'text/plain; charset=utf-8', 'Content-Length':Buffer.byteLength(body) } : {}) }, timeout:config.timeoutMs || 30000, rejectUnauthorized:!config.insecureSkipVerify }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => { const text=Buffer.concat(chunks).toString('utf8'); if ((response.statusCode || 500) >= 400) return reject(new Error(parseError(text,response.statusCode))); resolve({statusCode:response.statusCode,text}) })
    })
    req.on('timeout', () => req.destroy(new Error(`GeminiDB Influx 请求超过 ${config.timeoutMs || 30000}ms`)))
    req.on('error', error => {
      if (endpoint.protocol === 'https:' && /wrong version number|wrong version|tls_validate_record_header/i.test(error.message)) {
        return reject(new Error('目标服务不是 HTTPS，可能只支持 HTTP。请在连接设置中将协议切换为 HTTP 后重试。'))
      }
      reject(error)
    })
    if (body) req.write(body)
    req.end()
  })
}
function parseError(text,status){try{const parsed=JSON.parse(text);return parsed.error||parsed.message||`GeminiDB Influx HTTP ${status}`}catch{return text||`GeminiDB Influx HTTP ${status}`}}
function parseJson(text){try{return JSON.parse(text)}catch{throw new Error('GeminiDB Influx 返回了无法解析的 JSON')}}
function queryPath(database,sql){const params=new URLSearchParams({q:sql,epoch:'ms'});if(database)params.set('db',database);return `/query?${params}`}

export async function influxQuery(config,database,sql){const started=performance.now(),response=await request(config,'GET',queryPath(database,sql)),payload=parseJson(response.text),error=payload.results?.find(result=>result.error)?.error;if(error)throw new Error(error);const series=payload.results?.flatMap(result=>result.series||[])||[],rows=series.flatMap(item=>(item.values||[]).map(values=>Object.fromEntries(item.columns.map((column,index)=>[column,values[index]]))));return{rows,series,durationMs:Math.round(performance.now()-started)}}
export async function listDatabases(config){const{series}=await influxQuery(config,'','SHOW DATABASES'),item=series[0];if(!item)return[];const index=item.columns.indexOf('name');return item.values.map(value=>String(value[index]))}
export async function listMeasurements(config,database){const{series}=await influxQuery(config,database,'SHOW MEASUREMENTS'),item=series[0];if(!item)return[];const index=item.columns.indexOf('name');return item.values.map(value=>String(value[index]))}
export async function getMeasurementSchema(config,database,measurement){const escaped=measurement.replaceAll('"','\\"'),[fieldResult,tagResult]=await Promise.all([influxQuery(config,database,`SHOW FIELD KEYS FROM "${escaped}"`),influxQuery(config,database,`SHOW TAG KEYS FROM "${escaped}"`)]),fields=fieldResult.rows.map(row=>({name:String(row.fieldKey||''),type:String(row.fieldType||'unknown')})).filter(field=>field.name),tags=tagResult.rows.map(row=>String(row.tagKey||'')).filter(Boolean);return{fields,tags}}
export async function influxWrite(config,database,lineProtocol,precision='ns'){if(!database)throw new Error('写入前必须选择 database');if(!lineProtocol.trim())throw new Error('WRITE 后必须提供 line protocol');const started=performance.now(),params=new URLSearchParams({db:database,precision});await request(config,'POST',`/write?${params}`,lineProtocol);return{affectedRows:lineProtocol.trim().split(/\r?\n/).length,durationMs:Math.round(performance.now()-started),message:'line protocol 写入成功'}}
export function normalizeEndpoint(value){const endpoint=new URL(value);if(!['http:','https:'].includes(endpoint.protocol))throw new Error('实例地址只支持 http:// 或 https://');if(!endpoint.port)endpoint.port='8635';return endpoint.toString().replace(/\/$/,'')}
