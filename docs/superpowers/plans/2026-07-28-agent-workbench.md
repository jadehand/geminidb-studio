# GeminiDB Studio Agent Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 GeminiDB Studio v0.5.0 中增加本地持久化的独立 Agent 工作台，使 Claude 可以聊天，并在 Bridge 的固定安全边界内自主查询、写入和调用批量造数。

**Architecture:** Web 端提供会话、对话、计划和执行轨迹界面；Node Bridge 提供持久化会话 API、SSE 事件流、Claude CLI/API Provider Adapter、受控 Orchestrator、Policy Guard 和固定 Tool Registry。Claude 只返回结构化回复或工具请求，Bridge 持有连接凭据并执行所有 GeminiDB 操作。

**Tech Stack:** React 19、TypeScript、Vite、Node.js ESM、Node `http`/`fs`/`child_process`、Tauri 2、Claude CLI、Anthropic Messages API、Node test runner。

## Global Constraints

- 基线版本为 `0.5.0`，不得回退现有查询、SQL 格式化、DataGrip 快捷键、诊断查询、结果导出和批量造数能力。
- Agent GeminiDB 工具仅允许 `environment === "dev"` 或 `environment === "test"`；生产、未知环境和环境缺失均禁止。
- 现有批量造数继续仅允许 `environment === "test"`，不得因 Agent 接入放宽。
- 每个 Run 最多 12 次工具调用、5 分钟墙钟时间、单次查询最多 1000 行。
- `write_points` 单次最多写入 1000 点；批量造数继续限制 10 万点和 1 万时间线。
- Bridge 首期全局最多运行一个 Agent Run。
- Claude CLI 优先，Anthropic API 只在新 Run 开始时作为备用；Run 中途不得切换 Provider。
- Claude CLI 原生工具、文件访问和会话持久化必须关闭。
- Claude 不得接触 endpoint、用户名、密码、Session ID、API Key 或任意 Shell。
- 完整查询结果允许进入模型上下文和本地会话，但敏感键必须递归过滤。
- 所有非终态 Run 在 Bridge 重启后变为 `interrupted`，不得自动继续写入。
- 不新增运行时 npm 依赖；优先使用 Node 标准库和现有项目代码。
- 不占用、停止或重启 `127.0.0.1:8080`；本地自测使用现有 Vite 配置或其他空闲端口。

---

## File Map

**Bridge 新增文件**

- `apps/bridge/agent-types.mjs`：状态、常量、错误码和输入归一化。
- `apps/bridge/agent-policy.mjs`：环境、SQL、预算、工具参数和敏感字段策略。
- `apps/bridge/agent-store.mjs`：会话、消息、Run 和事件的原子本地持久化。
- `apps/bridge/agent-providers.mjs`：Claude CLI 与 Anthropic API 的统一 Provider Adapter。
- `apps/bridge/agent-tools.mjs`：固定 Tool Registry 及 GeminiDB/bulk 适配。
- `apps/bridge/agent-orchestrator.mjs`：结构化模型循环、状态机、取消和预算。
- `apps/bridge/agent-api.mjs`：REST 与 SSE 路由。

**Bridge 新增测试**

- `apps/bridge/agent-policy.test.mjs`
- `apps/bridge/agent-store.test.mjs`
- `apps/bridge/agent-providers.test.mjs`
- `apps/bridge/agent-tools.test.mjs`
- `apps/bridge/agent-orchestrator.test.mjs`
- `apps/bridge/agent-api.test.mjs`

**Bridge 修改文件**

- `apps/bridge/server.mjs`：装配 Agent Store、Tool Registry、Orchestrator 和 API。
- `apps/bridge/influx-client.mjs`：导出受控点写入所需的现有能力，不新增绕过路径。
- `scripts/dev-desktop.mjs`：为开发 Bridge 注入数据目录。
- `src-tauri/src/lib.rs`：为生产 sidecar 传递 `--data-dir`。

**Web 新增文件**

- `apps/web/src/agent-types.ts`
- `apps/web/src/agent-api.ts`
- `apps/web/src/agent-api-client.test.mjs`
- `apps/web/src/AgentWorkbench.tsx`
- `apps/web/src/AgentSessionList.tsx`
- `apps/web/src/AgentConversation.tsx`
- `apps/web/src/AgentExecutionPanel.tsx`
- `apps/web/src/agent-workbench.css`
- `apps/web/src/agent-workbench.test.mjs`

**Web 修改文件**

- `apps/web/src/App.tsx`：一级工作区导航、上下文联动和 Agent 页面挂载。
- `apps/web/src/api.ts`：导出通用 Bridge 请求能力供 Agent 客户端复用。
- `apps/web/src/types.ts`：只补充查询窗口联动所需类型，不放 Agent 领域模型。
- `apps/web/src/diagnostic-provider.ts`：保持现有诊断接口并适配共享 Provider 状态。
- `apps/web/src/styles.css`
- `apps/web/src/theme.css`
- `apps/web/src/responsive-layout.css`

---

### Task 1: Agent 领域常量与安全策略

**Files:**
- Create: `apps/bridge/agent-types.mjs`
- Create: `apps/bridge/agent-policy.mjs`
- Create: `apps/bridge/agent-policy.test.mjs`

**Interfaces:**
- Produces: `AGENT_LIMITS`、`TERMINAL_RUN_STATUSES`、`AgentError`、`assertToolEnvironment(session, tool)`、`assertQuerySql(sql)`、`assertBudget(run, now)`、`redactSensitive(value)`。
- Consumes: Bridge session 形状 `{ environment, readOnly }`。

- [ ] **Step 1: 写环境、SQL、预算和脱敏失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertBudget,
  assertQuerySql,
  assertToolEnvironment,
  redactSensitive,
} from './agent-policy.mjs'

test('allows read tools in dev and test but blocks prod and unknown environments', () => {
  assert.doesNotThrow(() => assertToolEnvironment({ environment:'dev', readOnly:false }, 'query_influxql'))
  assert.doesNotThrow(() => assertToolEnvironment({ environment:'test', readOnly:false }, 'query_influxql'))
  assert.throws(() => assertToolEnvironment({ environment:'prod', readOnly:false }, 'query_influxql'), error => error.code === 'AGENT_POLICY_DENIED')
  assert.throws(() => assertToolEnvironment({ readOnly:false }, 'query_influxql'), error => error.code === 'AGENT_POLICY_DENIED')
})

test('blocks write tools on read-only connections', () => {
  assert.throws(() => assertToolEnvironment({ environment:'test', readOnly:true }, 'write_points'), error => error.code === 'AGENT_POLICY_DENIED')
})

test('accepts one read-only InfluxQL statement and rejects mutation or a second statement', () => {
  assert.equal(assertQuerySql('SELECT mean(value) FROM "cpu" LIMIT 10'), 'SELECT mean(value) FROM "cpu" LIMIT 10')
  assert.throws(() => assertQuerySql('SELECT * FROM "cpu"; DROP MEASUREMENT "cpu"'), error => error.code === 'AGENT_POLICY_DENIED')
  assert.throws(() => assertQuerySql('SELECT * INTO "copy" FROM "cpu"'), error => error.code === 'AGENT_POLICY_DENIED')
  assert.throws(() => assertQuerySql('DELETE FROM "cpu"'), error => error.code === 'AGENT_POLICY_DENIED')
})

test('enforces fixed tool and time budgets', () => {
  assert.throws(() => assertBudget({ toolCallCount:12, deadlineAt:10_000 }, 9_000), error => error.code === 'AGENT_BUDGET_EXCEEDED')
  assert.throws(() => assertBudget({ toolCallCount:3, deadlineAt:10_000 }, 10_001), error => error.code === 'AGENT_BUDGET_EXCEEDED')
})

test('recursively removes sensitive values without removing ordinary token metrics', () => {
  assert.deepEqual(redactSensitive({
    password:'secret',
    nested:{ apiKey:'key', Authorization:'Bearer x', inputTokens:42 },
    rows:[{ host:'node-1', value:7 }],
  }), {
    password:'[REDACTED]',
    nested:{ apiKey:'[REDACTED]', Authorization:'[REDACTED]', inputTokens:42 },
    rows:[{ host:'node-1', value:7 }],
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test apps/bridge/agent-policy.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现固定常量、错误类型和纯策略函数**

```js
export const AGENT_LIMITS = Object.freeze({
  maxToolCalls: 12,
  maxRunMs: 5 * 60 * 1000,
  maxQueryRows: 1_000,
  maxDirectWritePoints: 1_000,
})

export const TERMINAL_RUN_STATUSES = new Set([
  'completed', 'stopped', 'budget_exceeded', 'blocked', 'failed', 'interrupted',
])

export class AgentError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}
```

在 `agent-policy.mjs` 中定义只读工具集合、写入工具集合、SQL 首关键字和禁止关键字。先剥离字符串及注释再检查分号和关键字；禁止 `SELECT INTO`。`redactSensitive` 只按完整键名大小写不敏感匹配 `password|apiKey|authorization|cookie|token|secret|sessionId`，不要误删 `inputTokens` 和 `outputTokens`。

- [ ] **Step 4: 运行策略测试**

Run: `node --test apps/bridge/agent-policy.test.mjs`

Expected: 5 tests PASS。

- [ ] **Step 5: 提交策略基础**

```bash
git add apps/bridge/agent-types.mjs apps/bridge/agent-policy.mjs apps/bridge/agent-policy.test.mjs
git commit -m "feat(agent): add fixed policy guard"
```

**Rollback:** 回滚该提交不会影响现有 Bridge 路由，因为尚未装配新模块。

---

### Task 2: 本地 Agent Store 与中断恢复

**Files:**
- Create: `apps/bridge/agent-store.mjs`
- Create: `apps/bridge/agent-store.test.mjs`
- Modify: `scripts/dev-desktop.mjs`
- Modify: `src-tauri/src/lib.rs`
- Test: `scripts/sidecar-config.test.mjs`

**Interfaces:**
- Consumes: `TERMINAL_RUN_STATUSES`、`AgentError`。
- Produces: `createAgentStore({ dataDir, now })`，包含 `init()`、`createSession()`、`listSessions()`、`getSession()`、`updateSession()`、`appendMessage()`、`createRun()`、`updateRun()`、`appendEvent()`、`eventsAfter()`、`deleteSession()`。

- [ ] **Step 1: 写原子存储和恢复测试**

使用 `mkdtemp(join(tmpdir(), 'gdb-agent-store-'))` 创建隔离目录，覆盖：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentStore } from './agent-store.mjs'

test('persists sessions, messages, runs and ordered events across store instances', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gdb-agent-store-'))
  const first = createAgentStore({ dataDir, now:() => 100 })
  await first.init()
  const session = await first.createSession({ connectionId:'c1', environment:'test', database:'db1', retentionPolicy:'autogen' })
  const run = await first.createRun(session.id, { provider:'cli', model:'claude', deadlineAt:300_100 })
  await first.appendMessage(session.id, { role:'user', content:'查询 cpu' })
  await first.appendEvent(session.id, run.id, { type:'run.status', payload:{ status:'planning' } })

  const second = createAgentStore({ dataDir, now:() => 200 })
  await second.init()
  assert.equal((await second.getSession(session.id)).messages[0].content, '查询 cpu')
  assert.equal((await second.eventsAfter(session.id, 0))[0].sequence, 1)
})

test('marks non-terminal runs interrupted during initialization', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gdb-agent-store-'))
  const store = createAgentStore({ dataDir, now:() => 500 })
  await store.init()
  const session = await store.createSession({ connectionId:'c1', environment:'dev', database:'db1', retentionPolicy:'autogen' })
  await store.createRun(session.id, { provider:'api', model:'claude', deadlineAt:5_000 })
  const reopened = createAgentStore({ dataDir, now:() => 900 })
  await reopened.init()
  assert.equal((await reopened.getSession(session.id)).runs[0].status, 'interrupted')
})
```

另写损坏 JSON 被移动为 `.corrupt-<timestamp>`、删除会话清理目录、缺少 `dataDir` 抛 `AGENT_STORE_UNAVAILABLE` 的测试。

- [ ] **Step 2: 运行 Store 测试并确认失败**

Run: `node --test apps/bridge/agent-store.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现版本化目录和原子 JSON 文件**

目录结构固定为：

```text
<dataDir>/agent/v1/
  index.json
  sessions/<sessionId>.json
```

每次写入执行：

```js
const temporary = `${target}.${randomUUID()}.tmp`
await writeFile(temporary, JSON.stringify(value), { encoding:'utf8', mode:0o600 })
await rename(temporary, target)
```

`index.json` 只保存会话摘要；会话文件保存消息、Runs 和事件。初始化时把非终态 Run 改为 `interrupted` 并追加 `run.status` 事件。

- [ ] **Step 4: 为开发与 Tauri sidecar 传递数据目录**

`scripts/dev-desktop.mjs` 使用：

```js
const bridgeDataDir = process.env.GEMINIDB_STUDIO_DATA_DIR || join(tmpdir(), 'geminidb-studio-dev')
const bridge = spawn(process.execPath, ['apps/bridge/server.mjs', '--data-dir', bridgeDataDir], {
  stdio:'inherit',
  env:{ ...process.env, GEMINIDB_STUDIO_DATA_DIR:bridgeDataDir },
})
```

`src-tauri/src/lib.rs` 在 `start_bridge` 中取得 `app.path().app_data_dir()`，创建目录并向 sidecar 追加 `--data-dir` 参数。失败时返回用户可读中文错误，不以 cwd 代替。

- [ ] **Step 5: 更新 sidecar 配置测试**

在 `scripts/sidecar-config.test.mjs` 断言 Rust 源码包含 `app_data_dir()` 和 `--data-dir`，同时保持 `.sidecar("geminidb-bridge")` 断言。

- [ ] **Step 6: 运行 Store 和 sidecar 测试**

Run: `node --test apps/bridge/agent-store.test.mjs scripts/sidecar-config.test.mjs`

Expected: 全部 PASS，临时测试目录中没有残留 `.tmp` 文件。

- [ ] **Step 7: 提交持久化基础**

```bash
git add apps/bridge/agent-store.mjs apps/bridge/agent-store.test.mjs scripts/dev-desktop.mjs src-tauri/src/lib.rs scripts/sidecar-config.test.mjs
git commit -m "feat(agent): persist sessions in app data"
```

**Rollback:** 回滚该提交恢复原 sidecar 参数；Store 尚未挂载，不迁移或删除用户数据。

---

### Task 3: 抽取 Claude Provider Adapter 并保持诊断兼容

**Files:**
- Create: `apps/bridge/agent-providers.mjs`
- Create: `apps/bridge/agent-providers.test.mjs`
- Modify: `apps/bridge/server.mjs`
- Test: `apps/bridge/server-body.test.mjs`

**Interfaces:**
- Produces: `createAgentProvider({ runProcess, fetchImpl })`，包含 `probe(settings)`、`complete(request, signal)`。
- `complete` 返回 `{ kind, content, callId?, tool?, input?, usage? }`。
- 保留现有 `askClaude` 诊断输出 `ClaudeDiagnosis`。

- [ ] **Step 1: 写 CLI 结构化响应与 API tool_use 转换测试**

```js
const toolSchemas = [{
  name:'get_schema',
  description:'Read the current Measurement schema.',
  input_schema:{
    type:'object',
    additionalProperties:false,
    required:['measurement'],
    properties:{ measurement:{ type:'string' } },
  },
}]

test('CLI disables native tools and normalizes a structured tool request', async () => {
  const calls = []
  const provider = createAgentProvider({
    runProcess:async (command, args, input) => {
      calls.push({ command, args, input })
      return { stdout:JSON.stringify({ structured_output:{
        kind:'tool_call', callId:'call-1', tool:'get_schema', input:{ measurement:'cpu' },
      } }), stderr:'' }
    },
    fetchImpl:async () => { throw new Error('must not use API') },
  })
  const result = await provider.complete({ provider:'cli', settings:{ cliPath:'claude' }, messages:[], tools:toolSchemas }, new AbortController().signal)
  assert.equal(result.tool, 'get_schema')
  assert.ok(calls[0].args.includes('--tools'))
  assert.ok(calls[0].args.includes(''))
  assert.ok(calls[0].args.includes('--no-session-persistence'))
})

test('API normalizes Anthropic tool_use blocks', async () => {
  const provider = createAgentProvider({
    runProcess:async () => { throw new Error('must not use CLI') },
    fetchImpl:async () => new Response(JSON.stringify({
      content:[{ type:'text', text:'先读取结构' }, { type:'tool_use', id:'toolu_1', name:'get_schema', input:{ measurement:'cpu' } }],
      usage:{ input_tokens:10, output_tokens:4 },
    }), { status:200, headers:{ 'content-type':'application/json' } }),
  })
  const result = await provider.complete({ provider:'api', settings:{ endpoint:'https://api.anthropic.com', apiKey:'key', model:'claude-sonnet-4-5' }, messages:[], tools:toolSchemas }, new AbortController().signal)
  assert.deepEqual(result.usage, { inputTokens:10, outputTokens:4 })
  assert.equal(result.callId, 'toolu_1')
})
```

补充 CLI 未登录探测、无效 JSON、API HTTP 错误、超时和 AbortSignal 取消测试。

- [ ] **Step 2: 运行 Provider 测试并确认失败**

Run: `node --test apps/bridge/agent-providers.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 从 `server.mjs` 抽取进程和 API 调用**

移动并泛化现有 `runProcess`、`probeClaude`、CLI JSON 提取和 Anthropic fetch。定义 Agent 响应 JSON Schema，枚举只允许：

```json
{
  "kind": "assistant_message | tool_call | final",
  "content": "string",
  "callId": "string",
  "tool": "registered tool name",
  "input": {}
}
```

`tool_call` 必须同时具备 `callId`、`tool` 和对象类型 `input`。CLI 参数继续包含：

```text
-p --tools "" --permission-mode dontAsk --no-session-persistence --output-format json --json-schema <schema>
```

- [ ] **Step 4: 让现有 `/claude/probe` 与 `/ask` 复用 Adapter**

保留原路由、错误码、诊断 Schema 和前端响应形状。诊断请求仍明确不发送查询结果；Agent 的完整结果发送规则不反向改变诊断功能。

- [ ] **Step 5: 运行 Provider 与现有诊断测试**

Run: `node --test apps/bridge/agent-providers.test.mjs apps/bridge/server-body.test.mjs apps/web/src/diagnostics.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 6: 运行完整 Bridge 测试**

Run: `npm run test:bridge`

Expected: PASS，现有 HTTPS→HTTP 友好错误测试保持通过。

- [ ] **Step 7: 提交 Provider 抽取**

```bash
git add apps/bridge/agent-providers.mjs apps/bridge/agent-providers.test.mjs apps/bridge/server.mjs
git commit -m "refactor(agent): share Claude provider adapter"
```

**Rollback:** 回滚后恢复 `server.mjs` 内原诊断实现；不涉及持久化数据格式。

---

### Task 4: 只读 Tool Registry

**Files:**
- Create: `apps/bridge/agent-tools.mjs`
- Create: `apps/bridge/agent-tools.test.mjs`

**Interfaces:**
- Consumes: `assertToolEnvironment`、`assertQuerySql`、`redactSensitive`、现有 Influx client 函数。
- Produces: `createAgentTools({ influx, bulkApi, resolveSession })`，返回 `{ schemas, execute(name, input, context) }`。
- `context` 为 `{ agentSession, bridgeSession, signal }`。

- [ ] **Step 1: 写工具 Schema、上下文绑定和 1000 行截断测试**

```js
const bridgeSession = Object.freeze({
  environment:'test',
  readOnly:false,
  endpoint:'http://127.0.0.1:8635',
  username:'rwuser',
})
const context = Object.freeze({
  agentSession:{ id:'agent-1', database:'bound-db', retentionPolicy:'autogen' },
  bridgeSession,
  signal:new AbortController().signal,
})

test('query tool ignores model connection fields and caps rows at 1000', async () => {
  const tools = createAgentTools({
    influx:{
      execute:async (session, database, sql) => ({
        rows:Array.from({ length:1_050 }, (_, index) => ({ index, password:`p-${index}` })),
        rowCount:1_050,
        durationMs:12,
      }),
    },
    resolveSession:() => bridgeSession,
  })
  const result = await tools.execute('query_influxql', {
    database:'attacker-db',
    endpoint:'http://attacker',
    sql:'SELECT * FROM "cpu"',
  }, context)
  assert.equal(result.rows.length, 1_000)
  assert.equal(result.truncated, true)
  assert.equal(result.rows[0].password, '[REDACTED]')
  assert.equal(result.database, 'bound-db')
})
```

为 `list_databases`、`list_measurements`、`get_schema`、`verify_data` 写映射测试；为未知工具、生产环境、多语句查询和已失效 Bridge session 写拒绝测试。

- [ ] **Step 2: 运行 Tool Registry 测试并确认失败**

Run: `node --test apps/bridge/agent-tools.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现只读工具 JSON Schema**

每个 schema 使用 `additionalProperties:false`。模型不传 Database 和连接信息：

```js
{
  name:'query_influxql',
  description:'Execute one read-only InfluxQL statement in the session-bound Database.',
  input_schema:{
    type:'object',
    additionalProperties:false,
    required:['sql'],
    properties:{ sql:{ type:'string', minLength:1, maxLength:100_000 } },
  },
}
```

Tool Registry 从 `agentSession.database` 和已解析 Bridge session 读取目标。所有返回值先经过 `redactSensitive`。

- [ ] **Step 4: 运行 Tool Registry 测试**

Run: `node --test apps/bridge/agent-tools.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 5: 提交只读工具**

```bash
git add apps/bridge/agent-tools.mjs apps/bridge/agent-tools.test.mjs
git commit -m "feat(agent): add controlled read tools"
```

**Rollback:** 回滚后 Agent 尚无工具可调用；现有查询 API 不受影响。

---

### Task 5: Orchestrator 状态机、预算与取消

**Files:**
- Create: `apps/bridge/agent-orchestrator.mjs`
- Create: `apps/bridge/agent-orchestrator.test.mjs`

**Interfaces:**
- Consumes: Agent Store、Provider Adapter、Tool Registry、`AGENT_LIMITS`、Policy Guard。
- Produces: `createAgentOrchestrator({ store, provider, tools, now })`，包含 `start(sessionId, message, settings)`、`stop(sessionId)`、`hasActiveRun()`。

- [ ] **Step 1: 写聊天、工具循环、全局串行和预算测试**

```js
test('completes a chat response without using tools', async () => {
  const provider = createQueuedProvider([
    { kind:'final', content:'InfluxQL 使用类 SQL 语法。' },
  ])
  const tools = createRecordingTools()
  const orchestrator = createAgentOrchestrator({ store, provider, tools, now:() => Date.now() })
  const result = await orchestrator.start(session.id, 'InfluxQL 是什么？', claudeSettings)
  assert.equal(result.status, 'completed')
  assert.equal(tools.calls.length, 0)
})

test('executes a proposed tool and returns its result to the model', async () => {
  const provider = createQueuedProvider([
    { kind:'tool_call', callId:'c1', tool:'get_schema', input:{ measurement:'cpu' }, content:'先读取结构' },
    { kind:'final', content:'cpu 有 usage 字段。' },
  ])
  const tools = createRecordingTools({ get_schema:{ fields:[{ name:'usage', type:'float' }], tags:['host'] } })
  const orchestrator = createAgentOrchestrator({ store, provider, tools, now:() => Date.now() })
  const result = await orchestrator.start(session.id, '检查 cpu', claudeSettings)
  assert.equal(result.status, 'completed')
  assert.equal(tools.calls[0].name, 'get_schema')
  assert.match(provider.requests[1].messages.at(-1).content, /usage/)
})

test('stops before the thirteenth tool call', async () => {
  let callId = 0
  const provider = createQueuedProvider([], () => ({
    kind:'tool_call',
    callId:`call-${++callId}`,
    tool:'get_schema',
    input:{ measurement:'cpu' },
  }))
  const tools = createRecordingTools({ get_schema:{ fields:[], tags:[] } })
  const orchestrator = createAgentOrchestrator({ store, provider, tools, now:() => Date.now() })
  const result = await orchestrator.start(session.id, '循环', claudeSettings)
  assert.equal(result.status, 'budget_exceeded')
  assert.equal(tools.calls.length, 12)
})
```

测试文件内定义确定性 fixture：

```js
const claudeSettings = Object.freeze({ cliPath:'claude', endpoint:'https://api.anthropic.com', model:'claude-sonnet-4-5', fallbackToApi:true })

function createQueuedProvider(initial, fallback) {
  const responses = [...initial]
  return {
    requests:[],
    async complete(request) {
      this.requests.push(request)
      return responses.shift() ?? fallback()
    },
  }
}

function createRecordingTools(results = {}) {
  return {
    calls:[],
    async execute(name, input) {
      this.calls.push({ name, input })
      return results[name] ?? {}
    },
  }
}
```

补充 5 分钟截止、相同失败只重试一次、未知工具变 `blocked`、AbortSignal 传播、第二会话并发返回 `AGENT_RUN_CONFLICT`、Provider 中途失败不切换测试。

- [ ] **Step 2: 运行 Orchestrator 测试并确认失败**

Run: `node --test apps/bridge/agent-orchestrator.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现单 Run 循环**

核心顺序固定：

```text
append user message
create run(planning)
select provider once
while budget available:
  call provider
  if assistant_message: append message and continue
  if final: append message, set completed, exit
  if tool_call:
    append requested event
    assert budget and policy
    execute tool with run AbortSignal
    append tool result and completed event
if budget exhausted: set budget_exceeded
```

每次工具调用前递增计数并持久化；这样进程崩溃不会重复使用同一预算。`stop()` 先设置停止标志，再 abort 当前 Controller，最后保存 `stopped`。

- [ ] **Step 4: 运行 Orchestrator 测试**

Run: `node --test apps/bridge/agent-orchestrator.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 5: 组合运行 Agent Bridge 单元测试**

Run: `node --test apps/bridge/agent-policy.test.mjs apps/bridge/agent-store.test.mjs apps/bridge/agent-providers.test.mjs apps/bridge/agent-tools.test.mjs apps/bridge/agent-orchestrator.test.mjs`

Expected: 全部 PASS，无未处理 Promise rejection。

- [ ] **Step 6: 提交 Orchestrator**

```bash
git add apps/bridge/agent-orchestrator.mjs apps/bridge/agent-orchestrator.test.mjs
git commit -m "feat(agent): orchestrate bounded tool runs"
```

**Rollback:** 回滚只移除未挂载的运行循环；Store 中的数据仍可保留并由后续版本读取。

---

### Task 6: Agent REST API 与 SSE 续传

**Files:**
- Create: `apps/bridge/agent-api.mjs`
- Create: `apps/bridge/agent-api.test.mjs`
- Modify: `apps/bridge/server.mjs`

**Interfaces:**
- Consumes: Agent Store、Orchestrator、Provider probe、当前 Bridge session。
- Produces: `createAgentApi({ store, orchestrator, provider, resolveConnection })` 和 `handle({ request, response, pathname, method, session, payload, searchParams })`。

- [ ] **Step 1: 写会话 CRUD、消息启动、停止和 SSE 测试**

覆盖：

```text
POST   /agent/sessions
GET    /agent/sessions
GET    /agent/sessions/:id
PATCH  /agent/sessions/:id
DELETE /agent/sessions/:id
POST   /agent/sessions/:id/messages
POST   /agent/sessions/:id/stop
GET    /agent/sessions/:id/events?after=4
POST   /agent/provider/probe
```

SSE 测试必须断言：

```text
id: 5
event: run.status
data: {"status":"running"}
```

并断言 `after=4` 不重发 1 至 4。删除活动会话返回 `409 AGENT_RUN_CONFLICT`，删除终态会话返回 `204`。

- [ ] **Step 2: 运行 API 测试并确认失败**

Run: `node --test apps/bridge/agent-api.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现路由与结构化错误**

API 只接受当前 Bearer session；创建 Agent Session 时从当前 Bridge session 生成不可伪造的 `connectionIdentity`，而不是信任请求中的连接凭据。消息接口立即返回：

```json
{ "runId": "uuid", "status": "planning" }
```

Orchestrator 在后台 Promise 中运行，所有 rejection 转成持久化 `run.status` 和 `tool.failed`，不得产生未处理 rejection。

- [ ] **Step 4: 实现 SSE keepalive 和续传**

- 首次连接先发送 `eventsAfter(after)`。
- 新事件通过 Store 订阅器推送。
- 每 15 秒发送 `: keepalive\n\n`。
- request `close` 后清理订阅器和 timer。
- SSE 只读取已持久化事件，不作为唯一状态源。

- [ ] **Step 5: 在 `server.mjs` 装配 Agent**

解析 `--data-dir` 或 `GEMINIDB_STUDIO_DATA_DIR`，初始化 Store 后创建 Provider、Tools、Orchestrator 和 API。Agent Store 初始化失败时：

- `/health` 仍返回 Bridge 状态并增加 `agent:{ ready:false, message }`。
- 现有查询与批量造数 API 继续可用。
- `/agent/*` 返回 `503 AGENT_STORE_UNAVAILABLE`。

- [ ] **Step 6: 运行 API 和完整 Bridge 测试**

Run: `node --test apps/bridge/agent-api.test.mjs && npm run test:bridge`

Expected: 全部 PASS；Node 进程测试结束后无悬挂 SSE timer。

- [ ] **Step 7: 提交 Bridge Agent API**

```bash
git add apps/bridge/agent-api.mjs apps/bridge/agent-api.test.mjs apps/bridge/server.mjs
git commit -m "feat(agent): expose sessions and event stream"
```

**Rollback:** 回滚路由装配即可禁用 Agent；现有 `/health`、`/query`、`/ask` 和 `/bulk-jobs` 保持可用。

---

### Task 7: 前端 Agent 类型与 API 客户端

**Files:**
- Create: `apps/web/src/agent-types.ts`
- Create: `apps/web/src/agent-api.ts`
- Create: `apps/web/src/agent-api-client.test.mjs`
- Modify: `apps/web/src/api.ts`

**Interfaces:**
- Produces: `agentBridge.listSessions()`、`createSession()`、`getSession()`、`sendMessage()`、`stop()`、`deleteSession()`、`probeProvider()`、`subscribe(sessionId, after, handlers)`。
- Produces TypeScript 类型 `AgentSessionSummary`、`AgentSessionDetail`、`AgentRun`、`AgentMessage`、`AgentEvent`、`AgentBudget`。

- [ ] **Step 1: 写 REST 和 SSE 客户端测试**

通过注入 `fetchImpl` 和 `eventSourceFactory` 测试：

- Bearer session 与现有 Bridge request 一致。
- `sendMessage` 返回 `runId`。
- SSE 收到事件后更新最后 sequence。
- 断开后以 `after=<lastSequence>` 重连。
- 调用 unsubscribe 后不再重连。
- 结构化 Bridge 错误转换为现有 `BridgeError`。

- [ ] **Step 2: 运行客户端测试并确认失败**

Run: `node --test apps/web/src/agent-api-client.test.mjs`

Expected: FAIL，错误包含模块不存在。

- [ ] **Step 3: 从 `api.ts` 导出受控请求和 Session getter**

不要复制 `sessionId` 状态。导出：

```ts
export function bridgeRequest<T>(path:string, init?:RequestInit):Promise<T>
export function currentBridgeSessionId():string
export function bridgeApiBase():string
```

现有 `bridge` 方法继续调用同一个函数。

- [ ] **Step 4: 实现 Agent 类型和客户端**

`subscribe` 在 Tauri/浏览器中使用 fetch streaming，而不是原生 `EventSource`，因为 SSE 需要 Authorization header。逐行解析 `id:`、`event:` 和 `data:`，只在空行时发布完整事件。退避固定为 500ms、1s、2s、5s，成功收到事件后重置。

- [ ] **Step 5: 运行 API 客户端和现有 API 测试**

Run: `node --test apps/web/src/agent-api-client.test.mjs apps/web/src/bulk-api-client.test.mjs apps/web/src/endpoint.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 6: 提交前端 API 客户端**

```bash
git add apps/web/src/agent-types.ts apps/web/src/agent-api.ts apps/web/src/agent-api-client.test.mjs apps/web/src/api.ts
git commit -m "feat(agent): add web session client"
```

**Rollback:** 回滚不会改变 `App.tsx`，现有页面仍使用原 `bridge` API。

---

### Task 8: 独立 Agent 工作台 UI

**Files:**
- Create: `apps/web/src/AgentWorkbench.tsx`
- Create: `apps/web/src/AgentSessionList.tsx`
- Create: `apps/web/src/AgentConversation.tsx`
- Create: `apps/web/src/AgentExecutionPanel.tsx`
- Create: `apps/web/src/agent-workbench.css`
- Create: `apps/web/src/agent-workbench.test.mjs`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/theme.css`
- Modify: `apps/web/src/responsive-layout.css`

**Interfaces:**
- Consumes: `agentBridge`、Agent 类型、当前连接列表、Database、RP 和通知函数。
- Produces: `<AgentWorkbench context onOpenSql onNotify />`。

- [ ] **Step 1: 写结构和交互契约测试**

使用项目现有源码结构测试模式，断言：

- `App.tsx` 有 `query | agent` 工作区状态。
- 一级导航存在“查询窗口”“Agent 工作台”“批量造数”。
- `AgentWorkbench` 渲染会话区、对话区、执行与安全区。
- 顶部连接、Database、RP 使用 `<select>`。
- 右侧始终存在“停止任务”按钮和 `工具调用 x / 12`、`运行时间 / 05:00`。
- `aria-live="polite"` 用于消息和工具状态。
- 活动 Run 时发送按钮不会创建第二 Run。

- [ ] **Step 2: 运行 UI 契约测试并确认失败**

Run: `node --test apps/web/src/agent-workbench.test.mjs`

Expected: FAIL，错误指出组件或导航不存在。

- [ ] **Step 3: 在 `App.tsx` 增加一级工作区导航**

新增：

```ts
type PrimaryWorkspace = 'query' | 'agent'
const [primaryWorkspace, setPrimaryWorkspace] = useState<PrimaryWorkspace>(() =>
  load('gdb.primaryWorkspace', 'query')
)
```

导航切换写入 `gdb.primaryWorkspace`。查询工作区保留当前 editor/results DOM；仅当 `primaryWorkspace === 'agent'` 时渲染 Agent 工作区，切回查询时不清空 SQL 和结果。

- [ ] **Step 4: 实现工作台状态加载与 SSE 合并**

`AgentWorkbench`：

1. 初次进入加载会话列表和 Provider 状态。
2. 选择会话后读取详情，再从最后 sequence 建立 SSE。
3. `message.completed` 追加消息；`plan.updated` 替换当前计划；`budget.updated` 更新预算。
4. SSE 重连时按 event ID 去重。
5. 卸载或切换会话时取消订阅。

- [ ] **Step 5: 实现三个聚焦子组件**

- `AgentSessionList` 只处理新建、切换、重命名和删除。
- `AgentConversation` 只处理消息、计划、输入和 SQL 操作。
- `AgentExecutionPanel` 只处理 Provider、预算、轨迹和停止。

禁止把 API 调用分散到三个展示组件；所有副作用留在 `AgentWorkbench`。

- [ ] **Step 6: 实现与现有风格一致的 CSS**

- 复用现有颜色变量，不硬编码新的主题色。
- 桌面三栏宽度：会话 `190px`、中央 `minmax(480px,1fr)`、执行 `320px`。
- 小于 `1100px` 时执行区变抽屉。
- 小于 `760px` 时会话区也变抽屉。
- 消息区可滚动，顶部上下文和底部输入固定。
- `prefers-reduced-motion` 下禁用抽屉动画。

- [ ] **Step 7: 运行 UI、主题和响应式测试**

Run: `node --test apps/web/src/agent-workbench.test.mjs apps/web/src/theme.test.mjs apps/web/src/workspace.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 8: 运行 TypeScript 检查和构建**

Run: `npm run check && npm run build`

Expected: PASS，无未使用类型、无 CSS 导入错误。

- [ ] **Step 9: 提交 Agent 工作台**

```bash
git add apps/web/src/AgentWorkbench.tsx apps/web/src/AgentSessionList.tsx apps/web/src/AgentConversation.tsx apps/web/src/AgentExecutionPanel.tsx apps/web/src/agent-workbench.css apps/web/src/agent-workbench.test.mjs apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/theme.css apps/web/src/responsive-layout.css
git commit -m "feat(agent): add independent workbench"
```

**Rollback:** 回滚该提交移除入口，Bridge Agent API 仍可保留但不会影响查询页面。

---

### Task 9: 受控直接写入和批量造数工具

**Files:**
- Modify: `apps/bridge/agent-tools.mjs`
- Modify: `apps/bridge/agent-tools.test.mjs`
- Modify: `apps/bridge/influx-client.mjs`
- Test: `apps/bridge/influx-client.test.mjs`
- Test: `apps/bridge/bulk-api.test.mjs`

**Interfaces:**
- Adds tools: `write_points`、`preview_bulk_data`、`create_bulk_job`、`get_bulk_job`。
- Consumes: 现有 `influxWrite`、`createBulkApi`、`createBulkJobManager`。

- [ ] **Step 1: 写直接写入边界测试**

覆盖：

- dev/test 可写连接最多 1000 条 Line Protocol。
- 1001 条返回 `AGENT_TOOL_INPUT_INVALID`。
- 只读、prod、未知环境返回 `AGENT_POLICY_DENIED`。
- 每一行必须非空且总请求体大小限制为 2 MB。
- 模型无法覆盖 Database 和 RP。
- 写入成功后返回 `pointCount`、`durationMs`，不回显完整写入体。

- [ ] **Step 2: 写造数工具复用测试**

覆盖：

- dev 环境调用 `preview_bulk_data` 被现有 bulk 规则拒绝。
- test 可写连接能够预览。
- `create_bulk_job` 只接受 Store 中当前 Run 自己获得且未过期的 `previewId`。
- 模型不能把 `acknowledgeCreate`、`acknowledgeOverwrite` 设置为 `true` 绕过 preview 返回的 required acknowledgements。
- `get_bulk_job` 只能读取当前连接身份的任务。

- [ ] **Step 3: 运行工具测试并确认失败**

Run: `node --test apps/bridge/agent-tools.test.mjs`

Expected: FAIL，写入和造数工具未注册。

- [ ] **Step 4: 暴露最小写入适配**

在 `influx-client.mjs` 保持现有 `influxWrite(config, database, body, options)`，不创建第二套 HTTP 写入。Tool Registry 把已校验行用 `\n` 拼接，并固定：

```js
{
  retentionPolicy:agentSession.retentionPolicy,
  precision:'ms',
  signal:context.signal,
}
```

- [ ] **Step 5: 接入 bulk preview 与 job manager**

Tool Registry 通过依赖注入调用现有 bulk API，不复制计划校验。把 previewId 与 `{ sessionId, runId }` 绑定在当前 Run 的工具结果元数据中；执行工具校验绑定关系后才调用 `/bulk-jobs` 对应逻辑。

- [ ] **Step 6: 运行写入、造数和工具测试**

Run: `node --test apps/bridge/agent-tools.test.mjs apps/bridge/influx-client.test.mjs apps/bridge/bulk-api.test.mjs apps/bridge/bulk-jobs.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 7: 提交写入工具**

```bash
git add apps/bridge/agent-tools.mjs apps/bridge/agent-tools.test.mjs apps/bridge/influx-client.mjs apps/bridge/influx-client.test.mjs
git commit -m "feat(agent): add controlled write and bulk tools"
```

**Rollback:** 回滚该提交后 Agent 退回只读能力；现有批量造数 UI 与 API 不变。

---

### Task 10: 查询窗口联动、Provider 设置与隐私提示

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/AgentWorkbench.tsx`
- Modify: `apps/web/src/AgentConversation.tsx`
- Modify: `apps/web/src/agent-workbench.css`
- Modify: `apps/web/src/diagnostic-provider.ts`
- Modify: `apps/web/src/ai-diagnostics.css`
- Test: `apps/web/src/agent-workbench.test.mjs`
- Test: `apps/web/src/diagnostics.test.mjs`

**Interfaces:**
- Adds: `AgentLaunchContext = { sql, error, database, measurement, schema }`。
- Adds callback: `onOpenSql(sql:string):void`。

- [ ] **Step 1: 写查询到 Agent 和 Agent 到查询的测试**

断言：

- 查询窗口“诊断查询”旁新增“发送到 Agent”入口。
- 点击后打开 Agent 工作台，并建立包含 SQL、错误和 Schema 的用户消息草稿。
- Agent SQL 代码块的“在查询窗口打开”创建新查询页签。
- 不替换原页签，不自动执行 SQL。

- [ ] **Step 2: 写 Provider 与隐私文案测试**

断言设置界面显示：

```text
Claude CLI 优先
Anthropic API 备用
查询结果最多 1000 行，可能包含业务数据
API 模式会把结果发送到配置的 Anthropic Endpoint
密码、API Key 和连接凭据不会发送
```

Provider 状态显示当前 Run 固定使用的 `Claude CLI` 或 `Anthropic API`。

- [ ] **Step 3: 运行测试并确认失败**

Run: `node --test apps/web/src/agent-workbench.test.mjs apps/web/src/diagnostics.test.mjs`

Expected: FAIL，缺少联动入口和新隐私文案。

- [ ] **Step 4: 实现双向联动**

复用现有 `openQueryTab(command)`。新增 `openAgent(context)`，只切换工作区并传递一次性草稿；草稿被 Agent 输入框消费后清除，避免重新进入时重复发送。

- [ ] **Step 5: 更新 Claude 设置**

保留现有 CLI path、API endpoint、API Key、model、maxTokens 字段。Provider 选择从互斥 `provider` 改为策略配置：

```ts
type ClaudeSettings = {
  cliPath:string
  endpoint:string
  model:string
  maxTokens:number
  fallbackToApi:boolean
}
```

读取旧 `{ provider:'cli'|'api' }` 时迁移：

- `cli` → `fallbackToApi:true`
- `api` → 保留 API 配置，并在 CLI probe 失败后使用 API

不删除现有凭据。

- [ ] **Step 6: 运行前端测试和检查**

Run: `npm run test:web && npm run check`

Expected: 全部 PASS。

- [ ] **Step 7: 提交联动和设置**

```bash
git add apps/web/src/App.tsx apps/web/src/AgentWorkbench.tsx apps/web/src/AgentConversation.tsx apps/web/src/agent-workbench.css apps/web/src/diagnostic-provider.ts apps/web/src/ai-diagnostics.css apps/web/src/agent-workbench.test.mjs apps/web/src/diagnostics.test.mjs
git commit -m "feat(agent): connect workbench with query context"
```

**Rollback:** 回滚后工作台仍可独立使用，查询诊断恢复原设置行为。

---

### Task 11: 安全、恢复与端到端回归

**Files:**
- Modify: `apps/bridge/agent-api.test.mjs`
- Modify: `apps/bridge/agent-orchestrator.test.mjs`
- Modify: `apps/bridge/agent-policy.test.mjs`
- Modify: `apps/web/src/agent-workbench.test.mjs`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Validates all public behavior; does not create new runtime interfaces.

- [ ] **Step 1: 增加恶意输入安全矩阵**

表驱动测试至少包含：

```js
[
  ['prod query', { environment:'prod' }, 'query_influxql', { sql:'SELECT * FROM "cpu"' }],
  ['unknown environment', {}, 'get_schema', { measurement:'cpu' }],
  ['read-only write', { environment:'test', readOnly:true }, 'write_points', { lines:['cpu value=1 1'] }],
  ['multi statement', { environment:'test' }, 'query_influxql', { sql:'SHOW MEASUREMENTS; DROP DATABASE x' }],
  ['select into', { environment:'dev' }, 'query_influxql', { sql:'SELECT * INTO x FROM y' }],
  ['unknown tool', { environment:'test' }, 'run_shell', { command:'whoami' }],
]
```

每项都断言无 Influx 或 child process 调用，并返回稳定 Agent 错误码。

- [ ] **Step 2: 增加持久化隐私和删除测试**

执行包含 `password`、`apiKey`、`token` 的查询结果后读取测试目录文件，断言敏感值不存在、普通 1000 行结果存在。删除会话后断言对应文件不存在且列表无摘要。

- [ ] **Step 3: 增加中断与停止测试**

- 模拟 Provider 正在等待时调用 stop，断言 signal aborted、状态 `stopped`。
- 模拟写入第一批成功后停止，断言不回滚第一批且不调度第二批。
- 模拟 Store 中 `running` Run 后重新 init，断言 `interrupted` 且无工具调用。
- 模拟 SSE 断线重连，断言事件无丢失、无重复。

- [ ] **Step 4: 运行所有 Agent 测试**

Run:

```bash
node --test \
  apps/bridge/agent-policy.test.mjs \
  apps/bridge/agent-store.test.mjs \
  apps/bridge/agent-providers.test.mjs \
  apps/bridge/agent-tools.test.mjs \
  apps/bridge/agent-orchestrator.test.mjs \
  apps/bridge/agent-api.test.mjs \
  apps/web/src/agent-api-client.test.mjs \
  apps/web/src/agent-workbench.test.mjs
```

Expected: 全部 PASS。

- [ ] **Step 5: 更新用户文档**

README 增加：

- Agent 工作台入口和用途。
- Claude CLI 优先、API 备用配置。
- 开发/测试限制和固定预算。
- 完整结果最多 1000 行及本地明文持久化提示。
- 停止和重启后的中断语义。

CHANGELOG 在 `0.5.0` 未发布区增加 Agent 工作台，不改版本号。

- [ ] **Step 6: 运行完整交付门禁**

Run:

```bash
npm run check
npm run test:web
npm run test:bridge
npm run build
```

Expected: 四条命令全部退出码 0。

- [ ] **Step 7: 做浏览器人工验收**

使用非 `8080` 的空闲端口启动开发服务，验证：

1. 查询与 Agent 工作区切换不丢 SQL。
2. 普通聊天无工具轨迹。
3. 查询任务显示计划、完整结果分析和预算变化。
4. 测试连接造数先预览后执行。
5. dev 连接允许直接最多 1000 点写入，但 bulk 仍被拒绝。
6. prod 和只读写入明确拒绝。
7. 停止按钮立即生效。
8. 刷新后历史会话恢复。
9. 深色、浅色和窄屏布局可用。

停止自测服务时只终止本次自建端口对应的进程，绝不操作 `127.0.0.1:8080`。

- [ ] **Step 8: 提交文档与回归保障**

```bash
git add apps/bridge/agent-api.test.mjs apps/bridge/agent-orchestrator.test.mjs apps/bridge/agent-policy.test.mjs apps/web/src/agent-workbench.test.mjs README.md CHANGELOG.md
git commit -m "test(agent): cover safety and recovery flows"
```

**Rollback:** 回滚该提交只移除补充测试和文档；如前序功能需要整体撤销，按 Task 10 至 Task 1 的提交逆序回滚。

---

## Final Review Checklist

- [ ] Agent 普通聊天不会隐式访问 GeminiDB。
- [ ] 自动任务只能使用固定注册工具。
- [ ] CLI 原生工具、文件访问、Shell 和会话持久化被禁用。
- [ ] Provider 只在新 Run 开始时选择，Run 中途不回退。
- [ ] Bridge 全局最多一个活动 Agent Run。
- [ ] 开发和测试允许 Agent 只读工具；写入还需非只读连接。
- [ ] 批量造数继续只允许测试连接。
- [ ] 查询最多 1000 行，直接写入最多 1000 点。
- [ ] 12 次工具调用和 5 分钟预算在 Bridge 强制执行。
- [ ] 敏感字段在模型上下文和本地文件中均被过滤。
- [ ] 活动 Run 重启后变为 `interrupted` 且不续跑。
- [ ] SSE 可以按 sequence 断线续传。
- [ ] 查询窗口与 Agent 双向传递 SQL 时不自动执行。
- [ ] 现有 `/ask`、`/query` 和 `/bulk-jobs` 行为无回归。
- [ ] `npm run check`、`npm run test:web`、`npm run test:bridge`、`npm run build` 全部通过。
