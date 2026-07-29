import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('catalog group double-click keeps query generation but suppresses it for a data tab',async()=>{
  const source=await readFile(new URL('./App.tsx',import.meta.url),'utf8')

  assert.match(source,/function queryGroup\(prefix: string, group: string\[\]\) \{ if\(!activeQueryTab\)return;const command=multiTableQuery\(group\);if\(!command\)return toast\('当前日期范围没有天表'\);setSql\(command\);toast\(`已生成 \$\{prefix\} 的 \$\{group\.length\} 张天表查询`\) \}/)
  assert.match(source,/onDoubleClick=\{\(\)=>queryGroup\(prefix,group\)\}/)
})
