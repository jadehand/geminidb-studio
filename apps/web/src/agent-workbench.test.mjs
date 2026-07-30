import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = name => readFile(new URL(name, import.meta.url), 'utf8')

test('Agent 工作台由会话、对话、执行与安全三个聚焦区域组成', async () => {
  const [workbench, sessions, conversation, execution] = await Promise.all([
    read('./AgentWorkbench.tsx'), read('./AgentSessionList.tsx'),
    read('./AgentConversation.tsx'), read('./AgentExecutionPanel.tsx'),
  ])
  assert.match(workbench, /AgentSessionList/)
  assert.match(workbench, /AgentConversation/)
  assert.match(workbench, /AgentExecutionPanel/)
  assert.doesNotMatch(`${sessions}${conversation}${execution}`, /agentBridge\./)
  assert.match(execution, /停止任务/)
  assert.match(execution, /工具调用/)
  assert.match(execution, /05:00/)
  assert.match(`${conversation}${execution}`, /aria-live="polite"/)
})

test('上下文使用连接、Database 和 RP 下拉框且运行中禁止第二个 Run', async () => {
  const source = await read('./AgentWorkbench.tsx')
  assert.match(source, /连接<select/)
  assert.match(source, /Database<select/)
  assert.match(source, /RP<select/)
  assert.match(source, /activeStatuses/)
  assert.match(source, /context\.connected/)
  assert.match(source, /disabled=\{!activeId \|\| active \|\| busy\}/)
})

test('SSE 副作用集中在 Workbench 并在切换与卸载时取消', async () => {
  const source = await read('./AgentWorkbench.tsx')
  assert.match(source, /agentBridge\.subscribe/)
  assert.match(source, /seen\.current\.has/)
  assert.match(source, /return \(\) => \{ cancelled = true; unsubscribe\(\) \}/)
})

test('布局遵循桌面三栏和窄屏抽屉约定', async () => {
  const css = await read('./agent-workbench.css')
  assert.match(css, /grid-template-columns:190px minmax\(480px,1fr\) 320px/)
  assert.match(css, /max-width:1100px/)
  assert.match(css, /max-width:760px/)
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.match(css, /\.agent-execution\.open/)
  assert.match(css, /\.agent-sessions\.open/)
  assert.match(css, /data-theme="dark"/)
})

test('App 提供持久化的查询窗口与 Agent 一级工作区', async () => {
  const source = await read('./App.tsx')
  assert.match(source, /type PrimaryWorkspace = 'query' \| 'agent'/)
  assert.match(source, /gdb\.primaryWorkspace/)
  assert.match(source, />查询与数据</)
  assert.match(source, />Agent 工作台</)
  assert.match(source, /<AgentWorkbench/)
  assert.match(source, /agent-active/)
  assert.match(source, /WorkspaceTab/)
  assert.match(source, /MeasurementDataView/)
})

test('查询上下文可发送到 Agent 且 Agent SQL 始终新建查询页签', async () => {
  const [app, workbench, conversation] = await Promise.all([
    read('./App.tsx'), read('./AgentWorkbench.tsx'), read('./AgentConversation.tsx'),
  ])
  assert.match(app, /发送当前查询/)
  assert.match(app, /function openAgent\(/)
  assert.match(app, /sql,error:lastError,database,measurement:selectedTable,schema/)
  assert.match(app, /openQueryTab\(command\)/)
  assert.match(workbench, /AgentLaunchContext/)
  assert.match(workbench, /onLaunchConsumed/)
  assert.match(conversation, /initialDraft/)
  assert.match(conversation, /在查询窗口打开/)
  assert.doesNotMatch(conversation, /runQuery|execute/)
})

test('工作台说明 Provider 状态和本地历史隐私边界', async () => {
  const [workbench, execution] = await Promise.all([
    read('./AgentWorkbench.tsx'), read('./AgentExecutionPanel.tsx'),
  ])
  assert.match(workbench, /endpoint:'https:\/\/api\.anthropic\.com'/)
  assert.match(workbench, /fallbackToApi:true/)
  assert.match(execution, /Claude CLI/)
  assert.match(execution, /Anthropic API/)
  assert.match(execution, /查询结果最多 1000 行，可能包含业务数据/)
  assert.match(execution, /密码、API Key 和连接凭据不会发送/)
})
