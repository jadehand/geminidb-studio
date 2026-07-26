# GeminiDB Studio MVP

本地 GeminiDB 可视化查询工作台，通过 Bridge 连接真实 GeminiDB Influx（InfluxDB 1.x HTTP API）实例。

## 启动

```bash
npm install
npm run dev:bridge
npm run dev:web
```

- Web：http://127.0.0.1:8791
- Bridge：http://127.0.0.1:8790

两个服务均不会使用 `127.0.0.1:8080`。

## 桌面客户端（Tauri v2）

项目已包含 `src-tauri/` 桌面外壳。安装 Tauri 对应平台的系统依赖和 Rust stable 后运行：

```bash
npm install
npm run desktop
```

该命令会自动启动本地 Bridge（`8790`）和 Vite（`8791`），随后打开 GeminiDB Studio 桌面窗口。查看环境诊断：

```bash
npm run desktop:info
```

Node Bridge 已接入 Tauri sidecar：生产构建会先运行 `npm run build:sidecar`，将 Bridge 和 Node 22 Runtime 封装为当前平台的独立二进制，再随客户端一起打包。客户端启动后会自动拉起 sidecar、等待健康检查，并在窗口退出时终止它，最终用户不需要安装 Node.js。

```bash
npm run build:sidecar  # 只构建当前平台 Bridge sidecar
npm run desktop:build # 构建当前平台安装包
```

sidecar 构建脚本支持 Windows、macOS、Linux 的 x64/arm64 命名和目标映射。安装包仍需在对应目标系统上构建并完成平台签名；本宿主机缺少 Rust/Cargo 和 WebKit2GTK，因此本次只完成并实测了 Linux x64 sidecar，没有伪造未编译的 `.msi/.dmg`。

## Windows 安装包

仓库内置 `.github/workflows/build-windows.yml`，无需在本机安装 Rust：

1. 将源码推送到 GitHub 仓库。
2. 打开 **Actions → Build Windows installers → Run workflow**。
3. 构建成功后，在该次运行页底部的 **Artifacts** 下载：
   - `geminidb-studio-windows-x64-msi`
   - `geminidb-studio-windows-x64-nsis`

MSI 适合企业管理和批量部署；NSIS 产物是普通用户双击安装的 `setup.exe`。未配置代码签名证书时，Windows 可能显示 SmartScreen 未知发布者提示，但不影响内部测试安装。

## 验证

```bash
npm run check
npm run build
npm run test:bridge
npm run desktop:info
curl http://127.0.0.1:8790/health
```

## 连接真实 GeminiDB Influx

1. 启动 Bridge 和 Web。
2. 打开“管理连接”。
3. 连接模式选择“GeminiDB Influx”。
4. 实例地址填写 `https://<负载均衡地址>:8635`；未启用 SSL 时使用 `http://`。
5. 输入该实例实际配置的数据库用户名和密码；客户端不会预填或猜测账号。
6. 仅在自签名证书测试环境中启用“忽略 TLS 证书校验”。

Bridge 在登录时执行 `SHOW DATABASES` 验证连接，随后使用：

- `SHOW DATABASES` 加载 database。
- `SHOW MEASUREMENTS` 加载当前 database 的 measurement。
- `/query` 执行 InfluxQL 查询。
- `/write` 写入 line protocol。

编辑器中的写入格式：

```text
WRITE cpu,host=node-01 usage=37.82 1784649600000000000
```

GeminiDB Influx 不支持传统 SQL `INSERT INTO ... VALUES ...`。Bridge 会返回迁移提示，不会把这类语句发送到云端。

## 批量造数（0.5.0）

批量造数用于向 GeminiDB Influx 的测试实例生成可控的时序测试数据。先在“管理连接”中把连接环境设为“测试环境”，并确保连接不是只读模式；生产、开发或只读连接不会开放入口。

向导按四步完成配置：

1. 选择 Database、Retention Policy、Measurement 前缀和基准 Schema。
2. 通过日历选择最多 7 个日期，并设置每日时间范围与采样间隔。
3. 为 Tag 和 Field 选择生成方式，按需增加字段间或字段与固定值之间的约束。
4. 检查目标天表、点数、序列数、样本表和 Line Protocol，完成风险确认后执行。

“待创建”表示目标日期对应的天表当前不存在。执行时不单独发送建表语句：GeminiDB Influx 会在首批 Line Protocol 写入时按 Measurement 名称建立目标。选择已有目标时，写入相同时间戳、Tag 组合和 Field 可能覆盖已有 Field 值，因此必须额外确认。Retention Policy 会随每个写入请求传给 GeminiDB；请在预览页再次核对。

硬限制与执行语义：

- 单次最多选择 7 天、生成 100,000 个点和 10,000 个序列。
- 最小采样间隔为 1 秒；写入按 1,000 行分批，每个日期最多同时发送 2 批。
- 任务失败后可从失败批次继续，取消仅阻止后续批次；已成功写入的数据不会回滚。
- 草稿和最近 20 条历史保存在本地。应用或 Bridge 重启后只显示历史，不支持恢复尚未完成的任务。
- 运行中关闭桌面客户端会先显示确认框；停止后退出会尽量在 3 秒内结束，但已写入数据仍会保留。

Bridge 新增以下接口：

- `POST /bulk-jobs/preview`：校验计划并生成确定性预览。
- `POST /bulk-jobs`：创建并执行任务。
- `GET /bulk-jobs/active`、`GET /bulk-jobs/:id`：读取当前或指定任务状态。
- `POST /bulk-jobs/:id/resume`：从失败批次继续。
- `POST /bulk-jobs/:id/cancel`：取消后续写入。

## 当前能力

- 常用连接与自动登录
- database 切换与天表目录
- database、measurements 和 measurement 前缀三级目录均可展开/收起
- Monaco InfluxQL 编辑器：语法高亮、关键字/函数/measurement 补全和常见 MySQL 语法提醒
- 选择 measurement 后自动读取 Field Key、字段类型和 Tag Key，并加入编辑器补全
- 测试环境批量造数：多日期、Tag/Field 生成器、约束、预览、后台任务和历史
- 多查询页签与草稿自动保存；双击页签重命名，`Ctrl/Cmd + Enter` 执行选区或全文
- InfluxQL 查询与 line protocol 写入
- 结果表、CSV/JSON 导出
- 历史记录、消息与收藏
- 北京时间/Unix 时间戳转换
- Claude Code 建议 SQL 模拟接口

## 安全说明

- Bridge 只监听 `127.0.0.1`。
- Tauri 仅授予已声明的 `geminidb-bridge` sidecar 启动与终止权限，不开放任意 Shell 命令。
- 数据库密码仅保存在 Bridge 内存会话中，Bridge 重启后失效。
- 连接元数据保存在浏览器本地，密码只保存在当前浏览器会话的 `sessionStorage`，关闭会话后清除；生产桌面版应改用系统 Keychain。
- 生产环境建议使用负载均衡地址和有效 SSL 证书。
- 不建议启用“忽略 TLS 证书校验”。
- 可将连接标记为只读，前端和 Bridge 都会阻止 `WRITE`。
- `WRITE` 执行前必须确认目标 database 和完整 line protocol。
- `SELECT` 必须包含 `time` 范围，避免无界扫描。
- 前端查询超过 30 秒自动取消，运行中也可以手动取消。

## 生产化入口

Bridge API 保持 `/login`、`/databases`、`/tables`、`/schema`、`/query`、`/ask`，并提供 `/retention-policies`、`/tag-values` 和 `/bulk-jobs/*` 批量造数接口。`/schema` 使用 `SHOW FIELD KEYS` 和 `SHOW TAG KEYS` 读取当前 measurement 结构；真实 Influx HTTP 适配器位于 `apps/bridge/influx-client.mjs`。
