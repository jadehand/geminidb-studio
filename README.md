# GeminiDB Studio MVP

本地 GeminiDB 可视化查询工作台。Bridge 同时支持 Mock 和真实 GeminiDB Influx（InfluxDB 1.x HTTP API）连接。

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
5. 输入数据库用户名（默认管理员通常为 `rwuser`）和密码。
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

## 当前能力

- 常用连接与自动登录
- database 切换与天表目录
- database、measurements 和 measurement 前缀三级目录均可展开/收起
- Monaco InfluxQL 编辑器：语法高亮、关键字/函数/measurement 补全和常见 MySQL 语法提醒
- 选择 measurement 后自动读取 Field Key、字段类型和 Tag Key，并加入编辑器补全
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

Bridge API 保持 `/login`、`/databases`、`/tables`、`/schema`、`/query`、`/ask`。`/schema` 使用 `SHOW FIELD KEYS` 和 `SHOW TAG KEYS` 读取当前 measurement 结构；真实 Influx HTTP 适配器位于 `apps/bridge/influx-client.mjs`。
