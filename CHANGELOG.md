# 更新日志

## 0.3.0

- 查询页签、Database、Measurement 和界面状态自动恢复；
- 异常退出检测、恢复/重新开始入口及最近三份工作区快照；
- 查询结果默认分页并支持 50～1000 行分页数量调整；
- 分页范围、首页/末页及页码跳转，切换查询后自动回到第一页；
- 图表结果页签占位，为后续时序可视化保留稳定入口；
- 本地 Claude CLI 与 Anthropic API 双诊断通道；
- 统一 DiagnosticProvider、错误分类、请求取消和旧结果覆盖保护；
- GeminiDB InfluxQL 本地规则检查、Schema 上下文诊断及性能建议；
- 修复 SQL 逐行差异预览，只允许人工替换或新页签打开；
- Claude API Key 使用系统凭据库存储，诊断默认不发送查询结果与数据库凭据。

## 0.2.0

- Measurement Field、Tag Schema 自动补全与缓存；
- 天表日期筛选及多天表 InfluxQL 生成；
- 结果搜索、排序、列隐藏、固定首列、列宽调整和 Excel 导出；
- 连接复制、删除、环境标识和系统凭据保存；
- 左侧连接与数据目录工具窗视觉精修；
- Git Tag 自动构建并发布 Windows MSI、NSIS 安装包。
