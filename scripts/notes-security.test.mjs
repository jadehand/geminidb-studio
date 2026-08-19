import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8')
test('desktop notes stay inside one authorized markdown root',()=>{
  assert.match(source,/Component::Normal/)
  assert.match(source,/eq_ignore_ascii_case\("md"\)/)
  assert.match(source,/file_type\(\)\.is_symlink/)
  assert.match(source,/starts_with\(root\)/)
  assert.match(source,/MAX_NOTE_BYTES/)
})
test('all note commands are registered',()=>{
  for(const command of ['authorize_notes_directory','list_notes','write_note','rename_note','delete_note'])assert.match(source,new RegExp(command))
})
