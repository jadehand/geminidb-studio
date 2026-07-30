import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { KNOWLEDGE_ENTRIES, searchKnowledge } from './knowledge-base.ts'

test('offline knowledge base covers GeminiDB compatibility and core InfluxQL categories', () => {
  assert.ok(KNOWLEDGE_ENTRIES.length >= 60)
  assert.ok(KNOWLEDGE_ENTRIES.some(item => item.title.includes('GeminiDB') && item.content.includes('Flux')))
  for (const category of ['产品与模型','数据建模','写入数据','查询基础','Schema 探索','聚合分析','时间处理','数据管理','性能实践','排错指南']) {
    assert.ok(KNOWLEDGE_ENTRIES.some(item => item.category === category), category)
  }
})

test('high-value searches return actionable concept, syntax, example, and pitfalls', () => {
  for (const query of ['插入','insert','measurement','tag field','时间戳','类型冲突','高基数','保留策略','慢查询']) {
    const matches=searchKnowledge(KNOWLEDGE_ENTRIES,query)
    assert.ok(matches.length >= 2, `${query}: ${matches.length}`)
    assert.ok(matches.some(item => item.example&&item.syntax), query)
  }
  const insert=searchKnowledge(KNOWLEDGE_ENTRIES,'插入一条数据')[0]
  assert.match(insert.example,/^INSERT /)
  assert.match(insert.content,/Field Set/)
  const measurement=searchKnowledge(KNOWLEDGE_ENTRIES,'Measurement 完整理解')[0]
  assert.ok(measurement.tips?.length >= 2)
})

test('knowledge search matches title, content, syntax, keywords and category case-insensitively', () => {
  assert.ok(searchKnowledge(KNOWLEDGE_ENTRIES, 'show tag values').some(item => item.title.includes('Tag Value')))
  assert.ok(searchKnowledge(KNOWLEDGE_ENTRIES, 'MEAN').some(item => item.example.includes('MEAN')))
  assert.ok(searchKnowledge(KNOWLEDGE_ENTRIES, 'schema 探索').length > 0)
  assert.deepEqual(searchKnowledge(KNOWLEDGE_ENTRIES, 'definitely-not-a-command'), [])
})

test('App exposes a third local knowledge tool and opens examples in a query tab', async () => {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(source, /switchTool\('knowledge'\)/)
  assert.match(source, /title="语法知识库"/)
  assert.match(source, /<KnowledgeBasePanel/)
  assert.match(source, /onInsert=\{openKnowledgeSql\}/)
})

test('knowledge examples substitute the selected measurement without executing', async () => {
  const { knowledgeExample } = await import('./knowledge-base.ts')
  const select = KNOWLEDGE_ENTRIES.find(item => item.id === 'select-basic')
  assert.match(knowledgeExample(select, 'cpu_day'), /FROM "cpu_day"/)
  assert.doesNotMatch(knowledgeExample(select, 'cpu_day'), /\$measurement/)
})

test('concept knowledge uses article content without query actions', async () => {
  const panel = await readFile(new URL('./KnowledgeBasePanel.tsx', import.meta.url), 'utf8')
  const concepts = KNOWLEDGE_ENTRIES.filter(item => item.kind === 'concept')

  assert.ok(concepts.length >= 8)
  assert.ok(concepts.every(item => item.content.length >= 60))
  assert.match(panel, /item\.kind==='concept'\?'概念知识':'语法示例'/)
  assert.match(panel, /item\.kind!=='concept'&&/)
  assert.match(panel, /插入到新查询/)
  assert.doesNotMatch(panel, /在新查询页签打开/)
})
