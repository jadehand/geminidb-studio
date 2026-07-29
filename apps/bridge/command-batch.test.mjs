import assert from 'node:assert/strict'
import test from 'node:test'
import { commandKind, splitStatements, validateWriteBatch } from './command-batch.mjs'

test('splits statements without splitting quoted semicolons', () => {
  assert.deepEqual(
    splitStatements('INSERT m note="a;b" 1; INSERT m value=2i 2;'),
    ['INSERT m note="a;b" 1', 'INSERT m value=2i 2'],
  )
})

test('keeps escaped quotes and their semicolons inside a statement', () => {
  assert.deepEqual(
    splitStatements("INSERT m note='a\\';b' 1; INSERT m note=\"c\\\";d\" 2"),
    ["INSERT m note='a\\';b' 1", 'INSERT m note="c\\";d" 2'],
  )
})

test('omits blank statements and trims trailing delimiters', () => {
  assert.deepEqual(
    splitStatements(' ; INSERT m value=1; ;  INSERT m value=2  ; '),
    ['INSERT m value=1', 'INSERT m value=2'],
  )
})

test('rejects scripts with unterminated strings', () => {
  assert.throws(
    () => splitStatements("INSERT m note='unfinished; INSERT m value=2"),
    error => error.code === 'INVALID_COMMAND_SCRIPT',
  )
})

test('classifies queries, insert variants, write, and unsupported commands', () => {
  assert.equal(commandKind(' SELECT * FROM cpu'), 'query')
  assert.equal(commandKind('SHOW MEASUREMENTS'), 'query')
  assert.equal(commandKind('describe cpu'), 'query')
  assert.equal(commandKind('EXPLAIN SELECT * FROM cpu'), 'query')
  assert.equal(commandKind('insert cpu value=1'), 'insert')
  assert.equal(commandKind('INSERT INTO rp cpu value=1'), 'insert')
  assert.equal(commandKind('WRITE cpu value=1'), 'write')
  assert.equal(commandKind('DELETE FROM cpu'), 'unsupported')
})

test('accepts batches made only of supported write commands', () => {
  assert.deepEqual(
    validateWriteBatch('INSERT cpu value=1; WRITE cpu value=2'),
    {
      statements:['INSERT cpu value=1', 'WRITE cpu value=2'],
      kind:'write-batch',
    },
  )
})

test('rejects empty scripts and unsupported commands', () => {
  assert.throws(
    () => validateWriteBatch(' ; ; '),
    error => error.code === 'INVALID_COMMAND_SCRIPT',
  )
  assert.throws(
    () => validateWriteBatch('DELETE FROM cpu'),
    error => error.code === 'UNSUPPORTED_COMMAND',
  )
})

test('rejects query and write commands in the same script', () => {
  assert.throws(
    () => validateWriteBatch('SELECT * FROM cpu; INSERT cpu value=1'),
    error => error.code === 'MIXED_COMMAND_BATCH',
  )
})
