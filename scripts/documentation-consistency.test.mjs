import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('current documentation matches the development and test bulk policy', async () => {
  const [readme, architecture, bulkEntry] = await Promise.all([
    readFile(new URL('README.md', root), 'utf8'),
    readFile(new URL('docs/architecture/overview.md', root), 'utf8'),
    readFile(new URL('apps/web/src/bulk-data.ts', root), 'utf8'),
  ])

  assert.match(readme, /开发或测试实例/)
  assert.match(readme, /开发和测试环境支持受控查询、Line Protocol 写入与批量造数/)
  assert.doesNotMatch(readme, /生产、开发或只读连接不会开放入口/)
  assert.doesNotMatch(readme, /批量造数继续只允许测试环境/)
  assert.match(architecture, /\| 开发 \| 是 \| 是 \| 是 \|/)
  assert.match(architecture, /\| 测试 \| 是 \| 是 \| 是 \|/)
  assert.match(architecture, /\| 生产 \| 是 \| 否 \| 否 \|/)
  assert.match(bulkEntry, /environment !== 'test' && context\.connection\?\.environment !== 'dev'/)
})

test('documentation separates current architecture from historical plans', async () => {
  const index = await readFile(new URL('docs/README.md', root), 'utf8')

  assert.match(index, /architecture\//)
  assert.match(index, /archive\/plans\//)
  assert.match(index, /archive\/specs\//)
  assert.match(index, /archive\/releases\//)
})

test('current documentation describes only the local Claude assistant architecture', async () => {
  const [readme, architecture, learningCenter] = await Promise.all([
    readFile(new URL('README.md', root), 'utf8'),
    readFile(new URL('docs/architecture/overview.md', root), 'utf8'),
    readFile(new URL('docs/architecture/learning-center-design.md', root), 'utf8'),
  ])

  assert.match(readme, /本地 Claude 助手/)
  assert.match(readme, /普通聊天/)
  assert.match(readme, /搜索、重命名和删除/)
  assert.match(readme, /不会自动执行 SQL/)
  assert.doesNotMatch(readme, /## Agent 工作台|Anthropic API|ANTHROPIC_API_KEY|\/agent\/\*/)
  assert.match(architecture, /Claude CLI/)
  assert.match(architecture, /本地 Claude 助手会话存储/)
  assert.doesNotMatch(architecture, /Anthropic API|Agent 工作台|agent-\*|Agent 数据库工具/)
  assert.match(learningCenter, /Claude 助手/)
  assert.doesNotMatch(learningCenter, /Agent 工作台|`agent` 工作区|进入 Agent/)
})

test('README documents the development-only in-memory Mock GeminiDB',async()=>{
  const readme=await readFile(new URL('README.md',root),'utf8')
  for(const text of ['npm run dev:mock','http://127.0.0.1:8765','用户名：`demo`','密码：`demo`','进程退出后数据清空'])assert.match(readme,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
  assert.match(readme,/不会进入正式安装包/)
  assert.match(readme,/不能替代真实 GeminiDB/)
})
