# GeminiDB Studio v0.7.1

GeminiDB Studio 是一个面向 GeminiDB Influx 的本地桌面数据库客户端，提供连接管理、InfluxQL 查询、数据浏览与编辑、批量造数、结果导出和本地 Claude 辅助诊断。

## 核心能力

- **连接数据库**：管理多个 GeminiDB Influx 连接，区分开发、测试和生产环境。
- **浏览数据目录**：按 Database、Measurement 前缀和具体天表浏览数据结构。
- **查询与分析**：使用带补全和语法提示的 Monaco 编辑器执行 InfluxQL。
- **查看与修改数据**：分页查看 Measurement 数据，并在线修改可写的 Field。
- **写入与造数**：在非生产环境执行 Line Protocol 写入和批量生成测试数据。
- **导出结果**：将查询结果复制或导出为 CSV、Excel、JSON。
- **Claude 辅助**：通过本机 Claude CLI 进行普通聊天和 SQL 诊断。
- **本地工具**：提供查询历史、收藏、个人笔记、知识库、学习中心和时间戳转换。

## 核心使用流程

### 1. 管理连接

- 保存和管理多个 GeminiDB Influx 连接，支持自动登录。
- 支持 HTTP/HTTPS、负载均衡地址和自签名证书测试模式。
- 连接可以标记为开发、测试或生产环境；生产环境默认只读，也可以手动将其他连接设为只读。
- 删除连接时使用应用内确认弹窗展示连接名称和地址，取消按钮为默认焦点，并支持 `Esc` 取消。

### 2. 浏览 Database 与 Measurement

- 切换 Database，并按 Measurement 前缀和具体天表分级展示目录。
- 支持目录展开、折叠和刷新。
- 自动读取 Field Key、字段类型、Tag Key、Tag Value 和 Retention Policy。
- 选择具体 Measurement 后可以：
  - 查看数据
  - 新建查询
  - 查看 Schema

### 3. 查询与查看数据

- 查看 Measurement 数据时默认按时间倒序加载最新 50 条。
- 支持切换时间范围、每页数量和分页。
- 支持搜索结果、列排序、调整列宽和缩放表格。
- 横向滚动时固定时间列及其列头，缺失的 Field 保持空白显示。
- 普通查询结果、聚合结果和表达式结果保持只读。

### 4. 编辑、写入与导出

- 仅在“查看数据”页面支持在线编辑：双击 Field 单元格修改已有值或补充缺失值，再通过顶部提交按钮统一写入。
- 时间和 Tag 不可编辑；GeminiDB Influx 不支持单独删除一个 Field。
- 开发和测试环境支持单条 Line Protocol 写入，生产或只读连接禁止写入。
- 支持复制查询结果，以及导出 CSV、Excel、JSON；桌面版可以选择导出目录。

## 查询编辑器

- 基于 Monaco Editor，提供 InfluxQL 语法高亮。
- 支持关键字、函数、Measurement、Field 和 Tag 自动补全。
- 提示常见 MySQL 语法误用；GeminiDB Influx 不支持传统的 `INSERT INTO ... VALUES ...`。
- 支持多查询页签、双击重命名和草稿自动保存。
- 使用 `Ctrl/Cmd + Enter` 执行选区或全文，运行中可以手动取消。
- 支持查询历史、执行消息和收藏。

Line Protocol 写入示例：

```text
WRITE cpu,host=node-01 usage=37.82 1784649600000000000
```

写入前会确认目标 Database 和完整 Line Protocol，不支持多语句脚本和事务。

开发和测试环境支持受控查询、Line Protocol 写入与批量造数；生产环境保持只读。

## 扩展能力

### 批量造数

批量造数仅在开发或测试实例开放，用于生成可控的时序测试数据：

1. 选择 Database、Retention Policy、Measurement 前缀和基准 Schema。
2. 选择最多 30 个日期，并配置每日时间范围和采样间隔。
3. 配置 Tag、整数、浮点、布尔、字符串生成器及字段约束。
4. 预览目标天表、点数、序列数、样本数据和 Line Protocol，确认风险后执行。

执行规则：

- 单次最多生成 100,000 个点和 10,000 个序列，最小采样间隔为 1 秒。
- 数据按 1,000 行分批写入，每个日期最多同时发送 2 批。
- 支持进度显示、取消、失败重试和从失败批次继续。
- 草稿与最近 20 条任务历史保存在本机；应用重启后不能恢复未完成任务。
- 写入已有目标时，相同时间戳、Tag 和 Field 组合可能覆盖已有值，因此需要额外确认。

### 本地 Claude 助手

- 只调用本机 Claude CLI，不提供远程模型回退、自动化工具或数据库执行能力。
- 支持普通聊天，也可以诊断当前 SQL、最近错误和 Schema。
- 普通聊天默认不携带数据库上下文，SQL、错误和 Schema 必须由用户主动选择。
- Claude 生成的 InfluxQL 只能复制或打开到新查询页签，不会自动执行 SQL，也不会修改数据库。
- 支持停止生成、失败重试，以及本地会话的搜索、重命名和删除。
- 数据库密码、Token 和连接凭据不会写入聊天历史，也不会发送给 Claude。

本机需要安装并登录 Claude Code：

```bash
claude --version
claude auth status
```

默认执行命令为 `claude`。如果它不在 `PATH` 中，可以在启动 Bridge 前通过 `GEMINIDB_CLAUDE_CLI` 指定完整路径。

### 个人工具

- Markdown 个人笔记与本地笔记目录。
- 知识库和学习中心。
- 北京时间与 Unix 时间戳转换。
- 深色界面、新手引导和本地偏好保存。

## 安全边界

- Bridge 只监听 `127.0.0.1`，前端不直接连接数据库。
- Tauri 只允许启动和终止声明过的 Bridge sidecar，不开放任意 Shell 命令。
- Bridge 登录会话中的数据库认证信息只保存在内存中，Bridge 重启后失效。
- 桌面版密码使用系统 Keyring；浏览器开发模式仅使用当前页面会话的 `sessionStorage`。
- 前端和 Bridge 都会阻止生产或只读连接执行写入。
- `SELECT` 必须包含时间范围，以避免无界扫描；前端查询超过 30 秒会自动取消。
- Claude 没有数据库工具，不能自动查询、写入或批量造数。
- “忽略 TLS 证书校验”只应在自签名证书测试环境中使用。

## 架构与技术栈

```text
用户
 ├─ React + TypeScript：界面、查询编辑器、结果表格和交互状态
 ├─ Tauri + Rust：桌面窗口、系统凭据、文件操作和 Bridge 生命周期
 └─ Node.js Bridge：本地业务后端，负责查询、写入、安全校验和 Claude 调用
       ├─ GeminiDB Influx：远程时序数据库
       └─ Claude CLI：本机聊天与 SQL 诊断
```

| 层级 | 技术 | 职责 |
| --- | --- | --- |
| Web 前端 | React、TypeScript、Vite、Monaco Editor | 页面、编辑器、结果表格和交互状态 |
| 本地业务后端 | Node.js ESM Bridge | 数据库连接、查询、写入、Schema、批量任务和 Claude 调用 |
| 桌面原生层 | Tauri v2、Rust | 窗口、文件、系统 Keyring 和 Bridge sidecar 生命周期 |
| 远程数据层 | GeminiDB Influx | InfluxQL 查询和 Line Protocol 时序数据存储 |

前端通过本机 HTTP 调用 Bridge，通过 Tauri 命令使用系统能力。数据库访问统一经过 Bridge，Claude 也不会直接操作数据库。

## 本地启动

### Web 开发模式

首次启动或依赖发生变化时，在 PowerShell 中进入包含 `package.json` 的源码根目录：

```powershell
Set-Location "你的源码目录\geminidb-studio"
npm install
```

然后打开两个 PowerShell 窗口，分别启动 Bridge 和 Web：

```powershell
# 窗口一：启动本地 Bridge
npm run dev:bridge
```

```powershell
# 窗口二：启动 Web
npm run dev:web
```

浏览器访问 `http://127.0.0.1:8791`。关闭时，在两个 PowerShell 窗口中分别按 `Ctrl + C`；如果询问是否终止批处理操作，输入 `Y`。

- Web：`http://127.0.0.1:8791`
- Bridge：`http://127.0.0.1:8790`

### Tauri 桌面模式

安装 Tauri 对应平台的系统依赖和 Rust stable 后运行：

```bash
npm install
npm run desktop
```

该命令会启动本地 Bridge 和 Vite，然后打开桌面窗口。关闭桌面窗口后，如果启动命令仍在运行，请回到 PowerShell 按 `Ctrl + C`。生产构建会使用 `@yao-pkg/pkg` 将 Bridge 与 Node.js 22 Runtime 封装为 sidecar，最终用户无需单独安装 Node.js。

```bash
npm run desktop:info
npm run build:sidecar
npm run desktop:build
```

sidecar 支持 Windows、macOS、Linux 的 x64/arm64 目标命名和映射；安装包需要在对应目标系统上构建，并按发布要求配置平台签名。

## 连接 GeminiDB Influx

1. 启动 Bridge 和 Web，打开“管理连接”。
2. 连接模式选择“GeminiDB Influx”。
3. 实例地址填写 `https://<负载均衡地址>:8635`；未启用 SSL 时使用 `http://`。
4. 输入实例实际配置的数据库用户名和密码。
5. 仅在自签名证书测试环境中启用“忽略 TLS 证书校验”。

Bridge 登录时通过 `SHOW DATABASES` 验证连接，并使用 InfluxDB 1.x HTTP API 执行后续查询与写入。

## 验证与发布

```bash
npm run check
npm run build
npm run test:web
npm run test:bridge
npm run desktop:info
curl http://127.0.0.1:8790/health
```

仓库内置 `.github/workflows/build-windows.yml`：

- 在 GitHub Actions 中手动运行可以生成 MSI 和 NSIS Artifacts。
- 推送 `v*` Tag 会自动构建 Windows x64 安装包并创建 GitHub Release。
- 未配置代码签名证书时，Windows 可能显示 SmartScreen“未知发布者”提示。

## Bridge API

Bridge 保持 `/login`、`/databases`、`/tables`、`/schema`、`/query`、`/ask`，并提供 `/retention-policies`、`/tag-values`、`/bulk-jobs/*`、`/claude/probe` 和 `/claude/sessions/*` 接口。

`/schema` 使用 `SHOW FIELD KEYS` 和 `SHOW TAG KEYS` 读取 Measurement 结构；Influx HTTP 适配器位于 `apps/bridge/influx-client.mjs`。
