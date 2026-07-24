export type TourStatus = 'new' | 'completed' | 'skipped'

export type TourStep = {
  target: string
  title: string
  description: string
}

export const TOUR_STORAGE_KEY = 'gdb.onboarding.v2.status'

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'new-connection',
    title: '新建 GeminiDB 连接',
    description: '先从这里添加连接，填写实例地址、用户名和密码；保存后即可载入 Database。'
  },
  {
    target: 'database-switcher',
    title: '直接切换 Database',
    description: '在这里选择当前 Database，无需再执行 USE database_xxx。'
  },
  {
    target: 'catalog',
    title: '浏览数据目录',
    description: '打开数据目录可选择 Measurement；拖动左侧边缘可以调整宽度。'
  },
  {
    target: 'query-editor',
    title: '更快编写 InfluxQL',
    description: '输入 SELECT 等关键词会自动补全，也可按 Ctrl + Space 主动唤起。'
  },
  {
    target: 'execute-query',
    title: '安全执行查询',
    description: '执行当前语句。查询生产库时，建议始终限制时间范围和返回行数。'
  },
  {
    target: 'query-results',
    title: '查看完整结果',
    description: '结果支持分页和横向滚动；悬停 time 字段可查看北京时间与原始时间戳。'
  },
  {
    target: 'result-actions',
    title: '复制与导出',
    description: '一键复制查询结果，或导出 CSV、Excel、JSON，并可设置保存目录。'
  },
  {
    target: 'time-converter',
    title: '转换时间戳',
    description: '随时转换 UTC、北京时间和 Unix 时间戳，写时间范围时更方便。'
  }
]

export function initialTourStatus(saved: unknown): TourStatus {
  if (saved === 'completed' || saved === 'skipped') return saved
  return 'new'
}
