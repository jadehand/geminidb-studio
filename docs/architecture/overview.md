# GeminiDB Studio 架构概览

## 1. 进程与信任 seam

```text
React Web
   │ localhost HTTP
   ▼
Node Bridge Sidecar
   ├── GeminiDB Influx HTTP API
   ├── Claude CLI
   └── 本地 Claude 助手会话存储
   ▲
   │ 生命周期、导出目录、窗口关闭
Tauri Desktop
```

- Web 负责交互、临时视图状态和早期提示，不是安全 seam。
- Bridge 是数据库权限、环境策略、写入校验、Claude CLI 调用和聊天持久化的权威执行层。
- Tauri 只提供声明过的桌面能力并管理 Bridge Sidecar，不开放任意 Shell。
- GeminiDB Influx 与本机 Claude CLI 都属于外部依赖；凭据不得进入 Web 持久化、Claude 助手历史、CLI 上下文或日志。

## 2. 顶层目录

| 路径 | 所有权 |
|---|---|
| `apps/web/` | React/Vite 工作台 |
| `apps/bridge/` | 本地 Bridge、Influx 适配器、Claude 助手与批量任务 |
| `src-tauri/` | 桌面外壳、Sidecar 生命周期和平台能力 |
| `scripts/` | 构建、开发启动和版本一致性检查 |
| `docs/architecture/` | 当前架构事实 |
| `docs/archive/` | 历史计划、规格和旧版本资料 |

## 3. Bridge 模块规则

`server.mjs` 是组合层，只负责：

1. 初始化模块及其依赖；
2. 校验本地来源和请求体；
3. 路由到领域模块；
4. 协调关闭和资源释放。

业务规则应放在对应深模块中：

- `claude-cli.mjs`：本机 CLI 探测、受限调用、取消、超时和输出限制。
- `claude-assistant-*`：聊天 HTTP 接口和本机会话持久化。
- `claude-diagnostics.mjs`：兼容查询诊断接口。
- `bulk-*`：计划、预览、生成、任务状态和执行。
- `measurement-*`：分页读取和受控 Field 更新。
- `command-*`：命令解析、校验和顺序执行。
- `influx-client.mjs`：GeminiDB Influx HTTP adapter。

生产 adapter 和测试替身通过同一 interface 注入。不要把领域逻辑重新堆回 `server.mjs`。

## 4. Web 模块规则

Web 按业务功能形成 locality：

- 查询与工作区；
- 连接与目录；
- Measurement 数据查看和编辑；
- 批量造数；
- 查询窗口内的 Claude 助手抽屉；
- 离线知识库；
- 通用桌面、存储、主题和导出能力。

新增功能应优先形成“状态/规则模块 + 聚焦视图”，避免继续向 `App.tsx` 添加跨流程状态。只有至少两个功能真实复用的代码才进入 shared；不要建立泛化的 `utils` 垃圾桶。

`App.tsx` 的目标职责是组合一级工作区、连接各 controller interface 和挂载全局弹窗。连接登录、查询执行、写入确认、Measurement 草稿与关闭顺序应逐步收进独立 controller。

## 5. HTTP seam

Web 与 Bridge 之间的 DTO、状态枚举和错误码属于跨进程 interface。修改时必须：

1. Bridge 做运行时校验；
2. Web 保持对应静态类型；
3. 同时更新双方契约测试；
4. 不向客户端返回凭据、连接参数或未脱敏的 Provider 错误。

Claude 助手会话使用稳定的本地所有者保存，但 HTTP 接口仍要求有效的 Bridge 登录会话。普通聊天不附带数据库上下文；只有用户显式勾选或点击“诊断当前查询”时，Web 才发送 SQL、错误或 Schema。CLI 返回的 SQL 只能复制或打开到新查询，不能自动执行。

## 6. 环境策略

| 环境 | 查询 | 受控写入 | 批量造数 |
|---|---:|---:|---:|
| 开发 | 是 | 是 | 是 |
| 测试 | 是 | 是 | 是 |
| 生产 | 是 | 否 | 否 |
| 未知/只读 | 视连接状态 | 否 | 否 |

前端置灰仅用于解释原因。Bridge 必须独立重复校验。

Claude 助手没有数据库工具，因此不参与环境写入策略；它只能返回文本建议。

## 7. 验证基线

结构或行为变更至少运行：

```bash
npm run test:web
npm run test:bridge
npm run check
npm run build
```

目录迁移应使用独立提交；不要在同一提交中同时移动文件、重写 interface 和改变产品行为。
