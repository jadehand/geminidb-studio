# Write Policy and INSERT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production connections unconditionally read-only while allowing validated single- and multi-statement `INSERT`, `INSERT INTO`, and `WRITE` execution in test and development.

**Architecture:** Centralize environment-derived write policy in pure web and Bridge modules, then move command parsing and sequential execution out of `server.mjs`. The Bridge remains authoritative; the web UI only provides early feedback and execution summaries.

**Tech Stack:** Node.js ESM, React 19, TypeScript, built-in Node test runner, GeminiDB Influx HTTP query/write APIs

## Global Constraints

- `prod` is always read-only.
- `test` and `dev` are writable.
- Environment, not the stored `readOnly` checkbox, is the source of truth.
- Multi-statement writes stop on the first failure and never claim transaction or rollback support.
- Mixed read/write scripts are not supported.
- Existing single `SELECT`, `SHOW`, `DESCRIBE`, and `EXPLAIN` execution remains unchanged.
- Never push.

---

### Task 1: Environment-Derived Write Policy

**Files:**
- Create: `apps/web/src/write-policy.ts`
- Create: `apps/web/src/write-policy.test.mjs`
- Create: `apps/bridge/write-policy.mjs`
- Create: `apps/bridge/write-policy.test.mjs`
- Modify: `apps/web/src/connections.ts`
- Modify: `apps/web/src/connections.test.mjs`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/bridge/server.mjs`

**Interfaces:**
- Web produces: `effectiveReadOnly(environment): boolean` and `normalizeConnectionWritePolicy(connection): Connection`.
- Bridge produces: `isEnvironmentWritable(environment): boolean` and `assertEnvironmentWritable(session)`.

- [ ] **Step 1: Write failing web and Bridge policy tests**

```js
test('only production is read-only', () => {
  assert.equal(effectiveReadOnly('prod'), true)
  assert.equal(effectiveReadOnly('test'), false)
  assert.equal(effectiveReadOnly('dev'), false)
})

test('bridge rejects production writes', () => {
  assert.throws(
    () => assertEnvironmentWritable({ environment:'prod' }),
    error => error.code === 'PRODUCTION_READ_ONLY',
  )
})
```

Add a connection migration test proving `{ environment:'prod', readOnly:false }` normalizes to `readOnly:true`, while test/dev normalize to false.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/web/src/write-policy.test.mjs apps/bridge/write-policy.test.mjs apps/web/src/connections.test.mjs`

Expected: FAIL because policy modules do not exist.

- [ ] **Step 3: Implement both pure policy modules**

Web:

```ts
export function effectiveReadOnly(environment: Connection['environment']) {
  return (environment ?? 'dev') === 'prod'
}

export function normalizeConnectionWritePolicy(connection: Connection): Connection {
  return { ...connection, environment:connection.environment ?? 'dev', readOnly:effectiveReadOnly(connection.environment) }
}
```

Bridge:

```js
export function isEnvironmentWritable(environment) {
  return environment === 'test' || environment === 'dev'
}

export function assertEnvironmentWritable(session) {
  if (isEnvironmentWritable(session?.environment)) return
  const error = new Error('生产环境连接为只读，禁止写入')
  error.status = 403
  error.code = 'PRODUCTION_READ_ONLY'
  throw error
}
```

- [ ] **Step 4: Wire connection migration and form behavior**

Normalize loaded and saved connections. When the environment select changes, derive `readOnly` immediately. Replace the editable read-only checkbox with a non-interactive policy row showing either “生产环境 · 强制只读” or “测试/开发环境 · 允许写入”.

In Bridge login, ignore the client-supplied `readOnly` flag and derive it from normalized environment.

- [ ] **Step 5: Run tests and commit**

Run: `node --test apps/web/src/write-policy.test.mjs apps/bridge/write-policy.test.mjs apps/web/src/connections.test.mjs`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/write-policy.ts apps/web/src/write-policy.test.mjs apps/bridge/write-policy.mjs apps/bridge/write-policy.test.mjs apps/web/src/connections.ts apps/web/src/connections.test.mjs apps/web/src/App.tsx apps/bridge/server.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: enforce environment write policy"
```

### Task 2: Statement Parser and Write Classification

**Files:**
- Create: `apps/bridge/command-batch.mjs`
- Create: `apps/bridge/command-batch.test.mjs`

**Interfaces:**
- Produces: `splitStatements(script): string[]`.
- Produces: `commandKind(statement): 'query'|'insert'|'write'|'unsupported'`.
- Produces: `validateWriteBatch(script): { statements: string[]; kind: 'write-batch' }`.

- [ ] **Step 1: Write failing parser tests**

```js
test('splits statements without splitting quoted semicolons', () => {
  assert.deepEqual(
    splitStatements('INSERT m note="a;b" 1; INSERT m value=2i 2;'),
    ['INSERT m note="a;b" 1', 'INSERT m value=2i 2'],
  )
})

test('accepts insert variants and write but rejects mixed scripts', () => {
  assert.equal(commandKind('insert cpu value=1'), 'insert')
  assert.equal(commandKind('INSERT INTO rp cpu value=1'), 'insert')
  assert.equal(commandKind('WRITE cpu value=1'), 'write')
  assert.throws(
    () => validateWriteBatch('SELECT * FROM cpu; INSERT cpu value=1'),
    error => error.code === 'MIXED_COMMAND_BATCH',
  )
})
```

Also test escaped quotes, trailing semicolons, blank statements, and unterminated strings.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/bridge/command-batch.test.mjs`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement a deterministic scanner**

Scan one character at a time while tracking single quote, double quote, and backslash escape state. Split only on semicolons outside quotes. Reject unterminated strings with code `INVALID_COMMAND_SCRIPT`.

Classify with anchored expressions:

```js
const QUERY = /^(select|show|describe|explain)\b/i
const INSERT = /^insert(?:\s+into\b)?\s+/i
const WRITE = /^write\s+/i
```

`validateWriteBatch` rejects empty input, unsupported commands, and mixed query/write batches.

- [ ] **Step 4: Run tests and commit**

Run: `node --test apps/bridge/command-batch.test.mjs`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/bridge/command-batch.mjs apps/bridge/command-batch.test.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: parse write command batches"
```

### Task 3: Bridge Sequential Batch Execution

**Files:**
- Create: `apps/bridge/command-execution.mjs`
- Create: `apps/bridge/command-execution.test.mjs`
- Modify: `apps/bridge/influx-client.mjs`
- Modify: `apps/bridge/influx-client.test.mjs`
- Modify: `apps/bridge/server.mjs`

**Interfaces:**
- Consumes: `validateWriteBatch`, `assertEnvironmentWritable`.
- Produces: `executeWriteBatch({ script, session, database, executeInsert, executeWrite })`.
- Produces: `influxCommand(config, database, command)` for `INSERT`/`INSERT INTO`.
- Adds: `POST /commands` with `{ database, script }`.

- [ ] **Step 1: Write failing stop-on-error tests**

```js
test('stops after the first failed statement and reports remaining work', async () => {
  const executed = []
  const result = await executeWriteBatch({
    script:'INSERT m value=1 1; INSERT m value=2 2; INSERT m value=3 3',
    session:{ environment:'dev' },
    database:'metrics',
    executeInsert:async statement => {
      executed.push(statement)
      if (executed.length === 2) throw new Error('upstream failed')
    },
    executeWrite:async () => assert.fail('unexpected WRITE'),
  })
  assert.deepEqual(executed, ['INSERT m value=1 1', 'INSERT m value=2 2'])
  assert.deepEqual(result.summary, { total:3, succeeded:1, failed:1, skipped:1 })
})
```

Add tests for production rejection before any executor call and for successful `WRITE`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/bridge/command-execution.test.mjs`

Expected: FAIL because the executor does not exist.

- [ ] **Step 3: Implement `influxCommand`**

Reuse the `/query` HTTP path with the configured Database and return:

```js
{ affectedRows:1, durationMs, message:'INSERT 执行成功' }
```

Parse upstream `results[].error` exactly as `influxQuery` does. Do not treat the absence of a result series as an error.

- [ ] **Step 4: Implement sequential execution and route**

`executeWriteBatch` validates environment before parsing/execution. For each statement:

- `INSERT`/`INSERT INTO` calls `influxCommand`.
- `WRITE` strips the client prefix and calls `influxWrite`.
- On failure, returns stable summary plus the failing statement index and message.

Add authenticated `POST /commands` handling in `server.mjs`. Keep `/query` for one query command. Update the existing `execute()` path so all write kinds call `assertEnvironmentWritable`.

- [ ] **Step 5: Run Bridge tests**

Run: `node --test apps/bridge/command-batch.test.mjs apps/bridge/command-execution.test.mjs apps/bridge/influx-client.test.mjs`

Expected: PASS.

Run: `npm run test:bridge`

Expected: all Bridge tests PASS.

- [ ] **Step 6: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/bridge/command-execution.mjs apps/bridge/command-execution.test.mjs apps/bridge/influx-client.mjs apps/bridge/influx-client.test.mjs apps/bridge/server.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: execute insert command batches"
```

### Task 4: Web Write-Batch Confirmation and Results

**Files:**
- Create: `apps/web/src/write-command.ts`
- Create: `apps/web/src/write-command.test.mjs`
- Create: `apps/web/src/WriteCommandDialog.tsx`
- Create: `apps/web/src/write-command-dialog.test.mjs`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/connection-dialog.css`
- Modify: `apps/web/src/types.ts`

**Interfaces:**
- Produces: `isWriteScript(sql): boolean`.
- Adds: `bridge.executeCommands(database, script, signal)`.
- Consumes Bridge result `{ summary, failedIndex?, error? }`.

- [ ] **Step 1: Write failing command detection and dialog tests**

Test `INSERT`, `INSERT INTO`, and `WRITE` as write scripts, while `SELECT` remains false. Structural dialog test must find Database, command count, cancel, and execute actions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/web/src/write-command.test.mjs apps/web/src/write-command-dialog.test.mjs`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement API and confirmation state**

Add:

```ts
executeCommands: (database: string, script: string, signal?: AbortSignal) =>
  request<CommandBatchResponse>('/commands', {
    method:'POST',
    body:JSON.stringify({ database, script }),
    signal,
  })
```

In `runQuery`, route write scripts to an application dialog before execution. The dialog displays the active Database and server-validated statement count. Production connections show an immediate read-only toast and never open the dialog.

- [ ] **Step 4: Render exact execution summary**

On success or partial failure, use:

```text
成功 N 条 · 失败 N 条 · 未执行 N 条
```

Add one execution-history entry for the whole script, with partial failure recorded as error. Do not claim rollback.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `npm run test:web`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/write-command.ts apps/web/src/write-command.test.mjs apps/web/src/WriteCommandDialog.tsx apps/web/src/write-command-dialog.test.mjs apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/connection-dialog.css apps/web/src/types.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: run insert scripts from query editor"
```

### Task 5: Write Policy Regression Gate

**Files:**
- Verify only.

**Interfaces:**
- Produces a verified write-policy and INSERT milestone.

- [ ] **Step 1: Run all automated checks**

Run: `npm run test:web`

Expected: PASS.

Run: `npm run test:bridge`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Manually verify environments**

Run: `npm run desktop`

Verify:

1. Production connection form shows forced read-only.
2. Production `INSERT`, `WRITE`, and bulk entry are blocked.
3. Test/dev can run one `INSERT`.
4. A three-statement script stops after a forced failure and reports remaining statements.
5. A normal `SELECT` still uses the existing query path.

- [ ] **Step 3: Confirm clean worktree**

Run: `& 'C:\Program Files\Git\cmd\git.exe' status --short`

Expected: no output.
