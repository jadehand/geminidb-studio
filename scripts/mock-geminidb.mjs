import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { createMockGeminiDbEngine, MockGeminiDbError } from './mock-geminidb-engine.mjs'

const MAX_BODY_BYTES=1_048_576

function json(response,status,payload,headers={}) {
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers})
  response.end(JSON.stringify(payload))
}

function authorized(request,username,password) {
  const expected=Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`)
  const received=Buffer.from(String(request.headers.authorization||''))
  return received.length===expected.length&&timingSafeEqual(received,expected)
}

async function body(request) {
  const chunks=[]
  let size=0
  for await(const chunk of request) {
    size+=chunk.length
    if(size>MAX_BODY_BYTES)throw new MockGeminiDbError('请求内容不能超过 1 MiB',413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function beijingDayStartMs(now=Date.now()) {
  const offset=8*60*60*1000
  return Math.floor((now+offset)/86_400_000)*86_400_000-offset
}

export function seedMockGeminiDb(engine,{now=Date.now()}={}) {
  const dayStart=beijingDayStartMs(now)
  const suffix=Math.floor(dayStart/1000)
  const measurement=`studio_demo_${suffix}`
  const points=[
    {minutes:5,host:'node-01',region:'cn-north-4',usage:37.5,healthy:true,status:'ok'},
    {minutes:10,host:'node-02',region:'cn-north-4',usage:42.25,healthy:true,status:'ok'},
    {minutes:15,host:'node-03',region:'cn-east-3',usage:81.75,healthy:false,status:'warning'},
  ]
  engine.write('monitoring',points.map(point=>{
    const timestamp=BigInt(dayStart+point.minutes*60_000)*1_000_000n
    return `${measurement},host=${point.host},region=${point.region} usage=${point.usage},healthy=${point.healthy},status="${point.status}" ${timestamp}`
  }).join('\n'))
  return{database:'monitoring',measurement}
}

export function createMockGeminiDbServer({
  host='127.0.0.1',port=8765,username='demo',password='demo',seed=true,engine=createMockGeminiDbEngine(),
}={}) {
  if(host!=='127.0.0.1')throw new TypeError('Mock GeminiDB 只允许监听 127.0.0.1')
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw new TypeError('Mock GeminiDB 端口无效')
  if(seed)seedMockGeminiDb(engine)
  const server=http.createServer(async(request,response)=>{
    try{
      const url=new URL(request.url||'/',`http://${host}:${port||8765}`)
      if(url.pathname==='/health'&&request.method==='GET')return json(response,200,{status:'ok',mode:'mock-influx',storage:'memory'})
      if(!authorized(request,username,password))return json(response,401,{error:'Mock GeminiDB 用户名或密码错误'},{'WWW-Authenticate':'Basic realm="Mock GeminiDB"'})
      if(url.pathname==='/query'&&request.method==='GET') {
        const query=url.searchParams.get('q')||''
        const database=url.searchParams.get('db')||''
        const epoch=url.searchParams.get('epoch')||'ms'
        return json(response,200,engine.query(database,query,{epoch}))
      }
      if(url.pathname==='/write'&&request.method==='POST') {
        const database=url.searchParams.get('db')||''
        const precision=url.searchParams.get('precision')||'ns'
        engine.write(database,await body(request),{precision})
        response.writeHead(204)
        return response.end()
      }
      return json(response,404,{error:'Mock GeminiDB 接口不存在'})
    }catch(error){
      const status=error instanceof MockGeminiDbError?error.status:500
      return json(response,status,{error:error instanceof Error?error.message:'Mock GeminiDB 请求失败'})
    }
  })
  return{
    engine,
    listen:()=>new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolveListen()})}),
    close:()=>new Promise((resolveClose,reject)=>{if(!server.listening)return resolveClose();server.close(error=>error?reject(error):resolveClose())}),
    address:()=>{const address=server.address();if(!address||typeof address==='string')throw new Error('Mock GeminiDB 尚未启动');return`http://${address.address}:${address.port}`},
  }
}

function argument(name) {
  const index=process.argv.indexOf(name)
  return index<0?'':String(process.argv[index+1]||'')
}

async function main() {
  const port=Number(argument('--port')||process.env.MOCK_GEMINIDB_PORT||8765)
  const mock=createMockGeminiDbServer({port})
  await mock.listen()
  console.log(`Mock GeminiDB listening on ${mock.address()}`)
  console.log('连接配置：地址 http://127.0.0.1:'+port+'，用户名 demo，密码 demo，环境 dev')
  const shutdown=()=>void mock.close().finally(()=>process.exit(0))
  process.once('SIGINT',shutdown)
  process.once('SIGTERM',shutdown)
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))await main()
