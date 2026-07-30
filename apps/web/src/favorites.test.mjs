import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { updateFavorite } from './favorites.ts'

test('editing a favorite keeps its id and updates only the selected item', () => {
  const favorites = [
    { id:'one', name:'旧名称', sql:'SHOW DATABASES', database:'db_old' },
    { id:'two', name:'保持不变', sql:'SHOW MEASUREMENTS', database:'db_two' },
  ]

  assert.deepEqual(updateFavorite(favorites, {
    id:'one',
    name:'新名称',
    sql:'SELECT * FROM cpu LIMIT 10',
    database:'db_new',
  }), [
    { id:'one', name:'新名称', sql:'SELECT * FROM cpu LIMIT 10', database:'db_new' },
    favorites[1],
  ])
})

test('favorite list exposes a separate edit action that does not trigger row loading', async () => {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(source, /aria-label=\{`编辑收藏 \$\{item\.name\}`\}/)
  assert.match(source, /e\.stopPropagation\(\);\s*onEditFavorite\(item\)/)
  assert.match(source, /编辑收藏/)
})
