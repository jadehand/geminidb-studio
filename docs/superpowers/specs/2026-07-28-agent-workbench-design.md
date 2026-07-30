# GeminiDB Studio Agent 工作台设计规格

## 1. 文档状态

- 日期：`2026-07-28`
- 基线版本：`0.5.0`
- 状态：用户已确认总体方案，待用户复核书面规格
- 目标用户：使用 GeminiDB Influx 进行开发、测试、查询分析和测试数据构造的工程人员
- 视觉方案：独立 Agent 工作台，作为左侧一级入口，与查询窗口、批量造数并列

## 2. 背景

GeminiDB Studio v0.5.0 已具备连接管理、InfluxQL 查询、Schema 浏览、查询诊断和批量造数能力。现有 Claude 能力仅针对单条 SQL 做一次性诊断：

- Claude CLI 使用 `claude -p`，明确禁用原生工具和会话持久化。
- Anthropic API 只发送一次用户消息并返回固定诊断结构。
- Claude 不参与多轮任务规划，也不能调用 GeminiDB 查询、写入或造数能力。
- 查询诊断位于查询窗口侧边抽屉，不适合展示长任务的计划、工具轨迹、预算和恢复状态。

本功能将这些独立能力组合为受控 Agent：用户既可以和 Claude 多轮聊天，也可以让 Agent 在 GeminiDB Studio 的权限边界内自主完成 GeminiDB 相关任务。

## 3. 目标与非目标

### 3.1 目标

1. 提供独立的多轮 Agent 工作台和本地会话历史。
2. 支持普通聊天、SQL 生成与解释、Schema 分析和错误诊断。
3. 支持 Agent 自主完成“规划、查询、分析、写入或造数、验证”的闭环任务。
4. Claude CLI 优先，CLI 不可用时使用用户配置的 Anthropic API。
5. 所有工具由 Studio Bridge 受控执行，Claude 不直接访问 Shell、凭据或数据库连接。
6. 自动化工具只用于开发和测试连接，并受固定预算、工具白名单和审计约束。
7. 查询结果可完整发送给 Claude并保存到本地会话，但单次最多 1000 行。
8. 保持现有查询窗口、查询诊断和批量造数功能兼容。

### 3.2 非目标

1. 不允许 Agent 执行任意 Shell、读写任意本地文件或安装软件。
2. 不允许删除 Database、删除 Measurement、修改 Retention Policy 或执行管理命令。
3. 不允许在生产连接上调用 GeminiDB 工具。
4. 不提供云端会话同步、多人协作或远程任务队列。
5. 不保证 Studio 关闭后任务继续运行。
6. 不自动恢复中断的写入任务。
7. 不支持第三方模型提供商或通用 MCP 工具市场。

## 4. 已确认的产品决策

| 决策项 | 选择 |
| --- | --- |
| 交互模式 | 普通聊天 + 完全自动执行 |
| 工作台位置 | 左侧一级入口的独立 Agent 工作台 |
| 自动化环境 | 仅开发和测试 |
| 自动化能力 | 查询、写入、批量造数 |
| 安全预算 | 最多 12 次工具调用、5 分钟、单次查询最多 1000 行 |
| 造数上限 | 复用现有 10 万点、1 万时间线上限 |
| 会话存储 | 本地持久化 |
| 模型接入 | Claude CLI 优先，Anthropic API 备用 |
| 工具控制 | Studio/Bridge 受控执行 |
| 数据发送 | 最多 1000 行完整查询结果 |

## 5. 用户体验

### 5.1 工作台布局

Agent 工作台作为应用一级工作区：

1. **左侧会话区**
   - 新建任务。
   - 展示本地历史会话、状态和更新时间。
   - 支持切换、重命名和删除会话。
2. **中央对话区**
   - 展示用户消息、Claude 回复、执行计划和任务结论。
   - 输入框同时支持普通问答和目标型任务。
   - SQL 代码块支持复制和“在查询窗口打开”。
3. **右侧执行区**
   - 展示当前模型通道、运行状态、安全预算和工具执行轨迹。
   - 提供始终可见的停止按钮。
   - 展示环境限制、失败原因和预算耗尽原因。
4. **顶部上下文栏**
   - 选择连接、Database 和 Retention Policy。
   - 展示连接环境和只读状态。
   - 上下文切换只影响后续消息，不隐式重新执行旧任务。

视觉样式必须复用现有主题变量、表单、按钮、边框、间距和深浅主题，不引入独立设计系统。

### 5.2 普通聊天与自动执行

用户不需要预先切换模式。Orchestrator 根据 Claude 的结构化响应处理：

- `assistant_message`：只回复，不调用工具。
- `tool_call`：进入受控工具执行。
- `final`：结束当前运行并给出结论。

聊天问题可以读取已缓存的当前上下文说明，但只要需要实时 Schema、查询结果或写入，必须显式产生工具调用并计入预算。

### 5.3 查询窗口联动

- 查询窗口可将当前 SQL、错误、选中 Measurement 和 Schema 发送到 Agent 新会话或当前会话。
- Agent 生成的 SQL 可在查询窗口新页签打开。
- 第一阶段保留现有“诊断查询”入口，内部逐步复用新的 Provider Adapter。
- Agent 不直接覆盖查询编辑器内容，也不自动执行发送回查询窗口的 SQL。

### 5.4 停止与恢复

- 用户停止后，Bridge 终止当前模型请求和可取消的查询/造数操作，不再调度下一次工具调用。
- 已完成的写入不回滚。
- Studio 或 Bridge 重启后，所有 `planning`、`running`、`verifying` 状态改为 `interrupted`。
- 中断会话可继续聊天，但不会自动续跑旧工具调用；用户必须明确发起继续任务。

## 6. 总体架构

```text
Agent Workbench
  ├─ Agent API Client
  └─ SSE Event Client
          │
          ▼
Bridge Agent API
  ├─ Agent Orchestrator
  ├─ Provider Adapter
  │    ├─ Claude CLI
  │    └─ Anthropic API
  ├─ Policy Guard
  ├─ Tool Registry
  │    ├─ Influx Client
  │    └─ Bulk Job Manager
  └─ Local Agent Store
```

### 6.1 Agent Orchestrator

`agent-orchestrator.mjs` 负责：

- 组装系统约束、会话历史、当前上下文和工具定义。
- 调用 Provider Adapter。
- 解析统一的结构化响应。
- 调用 Policy Guard 校验工具请求。
- 执行工具并把结果回传 Claude。
- 维护计划、预算、运行状态、取消信号和最终结论。
- 将消息、状态和事件写入 Agent Store，并发布 SSE 事件。

每个会话同一时间最多一个活动 Run。首期 Bridge 全局最多运行一个 Agent Run，包括聊天、查询、写入和造数；其他会话发送消息时返回 `AGENT_RUN_CONFLICT`。该限制降低连接、预算和持久化并发复杂度，后续版本再单独设计只读并发。

### 6.2 Provider Adapter

`agent-providers.mjs` 输出统一结果：

```ts
type AgentModelResponse =
  | { kind: 'assistant_message'; content: string; usage?: TokenUsage }
  | { kind: 'tool_call'; callId: string; tool: AgentToolName; input: unknown; content?: string; usage?: TokenUsage }
  | { kind: 'final'; content: string; usage?: TokenUsage }
```

#### Claude CLI

- 继续使用无 Shell 插值的 `spawn(command, args, { shell: false })`。
- 禁用 Claude CLI 原生工具、文件访问和会话持久化。
- 每轮通过 `claude -p` 发送完整受控上下文。
- 使用 JSON Schema 约束 CLI 只返回统一响应结构。
- CLI 只“提出”工具调用，不直接执行任何命令。

#### Anthropic API

- 使用 Messages API 的工具定义和 `tool_use` 响应。
- API Key 通过现有凭据存储读取，不进入消息、日志或本地 Agent Store。
- Endpoint 必须使用 HTTPS。

#### 回退规则

1. 创建新 Run 时先探测 CLI。
2. CLI 未安装、未登录或无法启动时，如果 API 配置有效则使用 API。
3. Run 已开始后不在中途切换 Provider，避免上下文和工具调用 ID 不一致。
4. 当前 Run 因 Provider 失败结束后，下一次用户消息可以使用备用 Provider。
5. 实际 Provider 和模型必须写入 Run 审计。

### 6.3 Tool Registry

`agent-tools.mjs` 只暴露固定工具：

| 工具 | 说明 | 类型 |
| --- | --- | --- |
| `list_databases` | 列出当前连接可见 Database | 只读 |
| `list_measurements` | 列出指定 Database 的 Measurement | 只读 |
| `get_schema` | 获取 Measurement 的 Field 和 Tag | 只读 |
| `query_influxql` | 执行受限 InfluxQL 查询 | 只读 |
| `write_points` | 写入受限 Line Protocol | 写入 |
| `preview_bulk_data` | 创建批量造数权威预览 | 只读 |
| `create_bulk_job` | 根据有效 previewId 启动造数 | 写入 |
| `get_bulk_job` | 获取造数任务状态 | 只读 |
| `verify_data` | 写入后执行受限抽样查询 | 只读 |

Claude 不得传入 endpoint、用户名、密码、sessionId 或连接凭据。工具上下文由 Bridge 根据 Agent Session 绑定的当前登录会话解析。

## 7. 安全策略

### 7.1 环境与连接

- GeminiDB 工具只允许 `environment === "dev"` 或 `environment === "test"`。
- `prod`、环境缺失或未知环境禁止所有 Agent 工具；仍允许不访问实时数据库的普通聊天。
- `readOnly === true` 时仅允许只读工具。
- 写入工具必须再次校验当前 Bridge session 存在、环境允许且连接可写。
- 前端禁用不是安全边界，所有规则必须在 Bridge 重复校验。

### 7.2 SQL 白名单

`query_influxql` 和 `verify_data` 仅允许单条：

- `SELECT`
- `SHOW`
- `DESCRIBE`
- `EXPLAIN`

拒绝多语句、注释隐藏的第二语句、`INTO`、`DROP`、`DELETE`、`ALTER`、`CREATE`、`GRANT`、`REVOKE` 和其他管理命令。

`write_points` 只接受结构化 Line Protocol 数据和当前绑定目标，不接受任意 InfluxQL。首期单次直接写入最多 1000 点，与现有造数单批上限一致；超过该值必须使用批量造数工具。

### 7.3 固定预算

每个 Run 固定：

- 最多 12 次工具调用。
- 最长 5 分钟墙钟时间。
- 单次查询最多返回 1000 行。
- 相同失败最多自动重试一次。
- 造数继续遵守 10 万点和 1 万时间线上限。

模型调用不计入工具次数，但计入 5 分钟。达到任一预算后：

1. 不再执行新的工具调用。
2. 当前可取消操作收到取消信号。
3. Run 状态变为 `budget_exceeded`。
4. 保存当前成果并要求 Claude 或本地模板生成简要结束说明。

### 7.4 提示词注入与参数校验

- Schema、查询结果、错误和用户输入均标记为不可信数据。
- 模型输出必须通过 JSON Schema 和工具参数 Schema。
- 未注册工具、额外敏感参数、超长字符串和非法枚举一律拒绝。
- Tool Registry 不根据模型输出动态加载代码或命令。
- Policy Guard 的拒绝结果进入审计，但不向模型暴露凭据或内部堆栈。

### 7.5 数据发送与敏感信息

用户已选择允许发送完整查询结果，规则如下：

- 每次最多 1000 行。
- 结果截断时附带 `truncated: true`。
- `password`、`apiKey`、`authorization`、`cookie`、`token`、`secret` 等敏感键在进入模型上下文前递归过滤。
- 数据发送提示必须在 Agent 设置和工作台中可见。
- CLI 数据留在本机 Claude 进程边界；API 数据会发送到用户配置的 Anthropic Endpoint。

## 8. 运行状态与错误处理

### 8.1 Run 状态

```text
idle
  └─ planning
       ├─ running
       │    ├─ verifying
       │    │    └─ completed
       │    ├─ completed
       │    ├─ stopped
       │    ├─ budget_exceeded
       │    ├─ blocked
       │    └─ failed
       └─ failed
```

Bridge 重启恢复时，非终态统一转换为 `interrupted`。

### 8.2 错误分类

- `AGENT_PROVIDER_UNAVAILABLE`：CLI 与 API 均不可用。
- `AGENT_MODEL_INVALID_RESPONSE`：模型响应不符合结构。
- `AGENT_TOOL_UNKNOWN`：请求了未注册工具。
- `AGENT_TOOL_INPUT_INVALID`：工具参数校验失败。
- `AGENT_POLICY_DENIED`：环境、连接或操作被策略拒绝。
- `AGENT_BUDGET_EXCEEDED`：工具次数或时间超限。
- `AGENT_RUN_CONFLICT`：会话已有活动 Run。
- `AGENT_SESSION_NOT_FOUND`：本地会话不存在。
- `AGENT_INTERRUPTED`：Bridge 重启导致任务中断。

错误响应必须包含稳定 `code`、用户可读 `message` 和 `requestId`，不得返回凭据、模型原始内部提示或堆栈。

## 9. 本地持久化

### 9.1 存储位置

`agent-store.mjs` 使用 GeminiDB Studio 应用数据目录，而不是浏览器 `localStorage`：

- Tauri 启动 sidecar 时通过 `--data-dir <app_data_dir>` 显式传入平台应用数据目录。
- 开发脚本通过 `GEMINIDB_STUDIO_DATA_DIR` 覆盖目录；测试必须使用临时目录。
- Bridge 启动时如果两者都缺失则拒绝启用持久化 Agent API，不回退到当前工作目录或用户主目录。
- 文件目录按版本隔离，例如 `<data-dir>/agent/v1/`。

### 9.2 数据模型

```ts
type AgentSession = {
  id: string
  title: string
  connectionId: string
  environment: 'dev' | 'test'
  database: string
  retentionPolicy: string
  status: AgentRunStatus
  createdAt: number
  updatedAt: number
}

type AgentMessage = {
  id: string
  sessionId: string
  runId?: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  result?: unknown
  usage?: TokenUsage
  createdAt: number
}

type AgentRun = {
  id: string
  sessionId: string
  provider: 'cli' | 'api'
  model: string
  status: AgentRunStatus
  plan: AgentPlanStep[]
  budget: { toolCalls: number; maxToolCalls: 12; startedAt: number; deadlineAt: number }
  stopReason?: string
  createdAt: number
  updatedAt: number
}

type AgentToolEvent = {
  id: string
  sequence: number
  sessionId: string
  runId: string
  tool: AgentToolName
  inputSummary: unknown
  status: 'requested' | 'running' | 'succeeded' | 'failed' | 'blocked'
  durationMs?: number
  rowCount?: number
  errorCode?: string
  createdAt: number
}
```

### 9.3 写入策略

- 每次状态变化先写临时文件，再原子替换正式文件。
- 查询结果可以完整保存，但不得保存凭据。
- 造数任务只保存计划、预览样本、统计和错误，不保存全部生成 Line Protocol。
- 删除会话时删除对应消息、Run、工具事件和查询结果。
- 启动时检测损坏文件；无法解析的文件隔离并生成空索引，不静默覆盖原文件。
- 首期不提供存储加密，因此界面必须提示本地历史可能包含业务数据。

## 10. Bridge API

### 10.1 会话

```text
POST   /agent/sessions
GET    /agent/sessions
GET    /agent/sessions/:id
PATCH  /agent/sessions/:id
DELETE /agent/sessions/:id
```

创建会话请求：

```json
{
  "connectionId": "connection-id",
  "database": "monitoring",
  "retentionPolicy": "autogen"
}
```

Bridge 不信任 `connectionId` 本身；必须将其解析为当前登录 Session 中已知的连接身份。

### 10.2 消息和运行

```text
POST /agent/sessions/:id/messages
POST /agent/sessions/:id/stop
GET  /agent/sessions/:id/events?after=<sequence>
```

发送消息立即返回：

```json
{
  "runId": "run-id",
  "status": "planning"
}
```

`GET events` 使用 SSE，事件包含递增 `sequence`：

- `message.delta`
- `message.completed`
- `plan.updated`
- `run.status`
- `tool.requested`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `budget.updated`

客户端断线后使用最后序号续传。服务端需要保留已持久化事件，SSE 不是唯一数据来源。

### 10.3 Provider

```text
POST /agent/provider/probe
```

返回 CLI 和 API 可用性、实际首选通道和用户可读状态。API Key 不通过该接口返回。

## 11. 前端模块

新增：

- `apps/web/src/AgentWorkbench.tsx`
- `apps/web/src/AgentSessionList.tsx`
- `apps/web/src/AgentConversation.tsx`
- `apps/web/src/AgentExecutionPanel.tsx`
- `apps/web/src/agent-api.ts`
- `apps/web/src/agent-types.ts`
- `apps/web/src/agent-workbench.css`

修改：

- `App.tsx`：增加 `query | agent` 工作区路由状态和导航入口。
- `api.ts`：保留通用 Bridge request；Agent 的 SSE 与会话方法放在独立 `agent-api.ts`。
- `types.ts`：现有查询和诊断类型保持不变，Agent 类型不继续堆叠到该文件。
- `diagnostic-provider.ts`：后续复用 Provider Adapter 状态，不改变现有诊断交互。
- `styles.css`、`theme.css`、`responsive-layout.css`：增加工作台布局适配。

窄屏时：

- 会话区收起为抽屉。
- 执行区收起为右侧抽屉。
- 中央对话区保持主要操作区域。
- 停止按钮仍需在顶部可访问。

## 12. 现有功能复用与迁移

### 12.1 查询能力

复用 `influx-client.mjs` 的 Database、Measurement、Schema 和查询函数。Agent 工具不得绕过现有超时、HTTPS/HTTP 错误提示和 Session 校验。

### 12.2 批量造数

复用：

- `bulk-plan.mjs`
- `bulk-api.mjs`
- `bulk-jobs.mjs`
- `bulk-generator.mjs`

Agent 必须先调用 `preview_bulk_data`，再使用有效 `previewId` 调用 `create_bulk_job`。Agent 不能伪造确认参数绕过 Bridge 的 RP、Schema、点数和时间线上限。

批量造数当前只允许 `test` 环境。Agent 总体允许 `dev` 和 `test`，但调用造数工具时继续遵守批量造数现有的更严格规则；是否将造数放宽到 `dev` 是独立产品变更，不在本规格内。

### 12.3 查询诊断

现有 `/ask` 和查询诊断 UI 首期保留。Provider 的进程调用和 API 调用逻辑迁移到共享 Adapter 后，`/ask` 继续输出 `ClaudeDiagnosis`，避免查询窗口回归。

## 13. 测试策略

### 13.1 单元测试

- Orchestrator 状态迁移和 12 次工具预算。
- 5 分钟截止时间和取消传播。
- SQL 白名单、多语句及注释绕过。
- 环境、只读连接和写入权限。
- 工具 JSON Schema 和未知工具拒绝。
- 敏感字段递归过滤。
- CLI 响应和 API `tool_use` 统一转换。
- Provider 探测和下一 Run 回退。
- 原子写入、损坏文件隔离和中断状态修复。

### 13.2 Bridge 集成测试

- 创建、列出、恢复、更新和删除会话。
- 普通聊天不调用工具。
- 查询工具最多返回 1000 行。
- 写入后自动验证。
- 造数预览、执行、进度和停止。
- SSE 事件顺序和断线续传。
- 生产、未知环境、只读连接、删除语句和 RP 修改均被拒绝。
- Bridge 重启后活动 Run 变为 `interrupted`。

### 13.3 前端测试

- 工作区导航、会话列表和上下文选择。
- 多轮消息、计划更新和工具轨迹。
- CLI/API 当前通道展示。
- 预算展示、停止按钮和终态提示。
- 查询窗口向 Agent 发送上下文。
- Agent SQL 在查询窗口新页签打开。
- 会话删除前提示本地完整结果将被删除。
- 深浅主题和窄屏布局。

### 13.4 回归测试

- `npm run check`
- `npm run test:web`
- `npm run test:bridge`
- `npm run build`

现有查询窗口、SQL 格式化、DataGrip 快捷键、查询诊断、结果导出和批量造数必须保持通过。

## 14. 验收标准

1. 用户可以创建本地持久化会话并连续多轮聊天。
2. 用户可以要求 Agent 生成、解释和优化 InfluxQL，而不执行数据库工具。
3. Agent 可以在开发或测试连接上自主完成查询、分析、受控写入和验证。
4. Agent 可以调用现有批量造数预览与任务接口，并实时展示进度。
5. 完整查询结果最多 1000 行发送给 Claude，敏感键已过滤。
6. Claude CLI 可用时优先使用；新 Run 中 CLI 不可用时回退到 API。
7. 所有工具均由 Bridge 白名单执行，Claude 无法访问 Shell 和凭据。
8. 达到 12 次工具调用或 5 分钟后立即停止调度新工具。
9. 用户可随时停止任务，已写入数据不回滚。
10. Studio 重启后可查看历史，原活动任务显示“已中断”且不自动续跑。
11. 生产连接、未知环境、只读写入、删除和管理操作均被 Bridge 拒绝。
12. 每次工具调用都可在右侧轨迹中查看，并存在本地审计记录。
13. 现有查询、诊断和批量造数测试无回归。

## 15. 实施顺序建议

1. 抽取 Provider Adapter，保持现有诊断测试通过。
2. 实现 Agent Store、领域类型和状态机。
3. 实现 Policy Guard 与只读工具。
4. 实现 Orchestrator、CLI/API 结构化循环和 SSE。
5. 实现 Agent 工作台与查询窗口联动。
6. 接入写入和批量造数工具。
7. 完成安全、恢复、端到端和回归测试。

正式实施前必须另行编写逐步实现计划，明确每一步的测试先行顺序、文件修改范围和回滚点。
