export type GuideStatus = 'new'|'completed'|'skipped'
export type TourStep = {
  target:string
  title:string
  description:string
}
export type GuideTopicId = 'quick-start'|'query-efficiency'|'measurement-data'|'knowledge'|'bulk-data'|'claude-assistant'
export type GuideHintId = 'measurement-data'|'knowledge'|'bulk-data'|'claude-assistant'
export type LearningProgress = {
  version:1
  topics:Record<GuideTopicId,GuideStatus>
  hints:Partial<Record<GuideHintId,'dismissed'|'completed'>>
  seenRelease:string
}
export type GuideTopic = {
  id:GuideTopicId
  icon:string
  title:string
  description:string
  workspace:'query'
  sideTool?:'connections'|'catalog'|'knowledge'
  steps:TourStep[]
}

export const LEARNING_STORAGE_KEY='gdb.learningCenter.v1'
export const CURRENT_LEARNING_RELEASE='0.7'
export const OLD_TOUR_STORAGE_KEY='gdb.onboarding.v3.status'
const ids:GuideTopicId[]=['quick-start','query-efficiency','measurement-data','knowledge','bulk-data','claude-assistant']

export const GUIDE_TOPICS:GuideTopic[]=[
  {id:'quick-start',icon:'◎',title:'快速上手',description:'从连接到完成第一次安全查询。',workspace:'query',sideTool:'connections',steps:[
    {target:'new-connection',title:'新建 GeminiDB 连接',description:'添加实例地址和账号，保存后载入 Database。'},
    {target:'database-switcher',title:'选择 Database',description:'直接切换当前 Database，无需执行 USE。'},
    {target:'catalog',title:'浏览数据目录',description:'打开目录并选择要查询的 Measurement。'},
    {target:'query-editor',title:'编写 InfluxQL',description:'输入关键词会自动补全，也可按 Ctrl + Space。'},
    {target:'execute-query',title:'安全执行查询',description:'优先限定时间范围和返回行数，然后执行当前语句。'},
    {target:'query-results',title:'查看查询结果',description:'结果支持分页、横向滚动和精确时间展示。'},
  ]},
  {id:'query-efficiency',icon:'⌘',title:'查询效率',description:'掌握补全、Schema、导出和时间工具。',workspace:'query',steps:[
    {target:'query-editor',title:'编辑器快捷能力',description:'使用自动补全、格式化和快捷键更快编写 InfluxQL。'},
    {target:'schema-summary',title:'完整 Schema',description:'查看、搜索并复制 Field 类型和 Tag。'},
    {target:'result-actions',title:'复制与导出',description:'复制结果或导出 CSV、Excel、JSON。'},
    {target:'time-converter',title:'时间转换',description:'在 UTC、北京时间与 Unix 时间戳之间转换。'},
  ]},
  {id:'measurement-data',icon:'▦',title:'查看与编辑数据',description:'查看原始点、切换时间并受控编辑 Field。',workspace:'query',sideTool:'catalog',steps:[
    {target:'catalog',title:'从目录进入',description:'点击 Measurement 并选择“查看数据”。'},
    {target:'measurement-data',title:'数据工作区',description:'支持时间戳、UTC、北京时间切换和当前页搜索。'},
    {target:'measurement-data',title:'安全编辑',description:'开发和测试环境可编辑 Field；生产环境保持只读。'},
  ]},
  {id:'knowledge',icon:'◇',title:'离线知识库',description:'快速查概念、语法和可执行示例。',workspace:'query',sideTool:'knowledge',steps:[
    {target:'knowledge-search',title:'搜索知识',description:'按关键词搜索 Measurement、INSERT、时间和排错知识。'},
    {target:'knowledge-list',title:'概念与语法',description:'概念采用文章说明，语法条目提供模板和示例。'},
    {target:'knowledge-list',title:'插入新查询',description:'示例只插入新查询页签，不会自动执行。'},
  ]},
  {id:'bulk-data',icon:'◫',title:'批量造数',description:'为开发或测试环境生成可控数据。',workspace:'query',steps:[
    {target:'bulk-data',title:'环境边界',description:'开发和测试环境可用，生产或只读连接禁止。'},
    {target:'bulk-data',title:'四步向导',description:'选择目标、日期、生成规则，再核对预览。'},
    {target:'bulk-data',title:'先预览再执行',description:'确认点数、Series、样本和覆盖风险后才能执行。'},
  ]},
  {id:'claude-assistant',icon:'✦',title:'Claude 助手',description:'用本机 Claude CLI 聊天和诊断查询。',workspace:'query',steps:[
    {target:'claude-assistant',title:'打开本地助手',description:'在查询窗口打开 Claude 助手，不需要配置 API Key。'},
    {target:'claude-assistant',title:'显式附加上下文',description:'按需附加当前 SQL、最近错误或 Schema；默认不会发送数据库内容。'},
    {target:'claude-assistant',title:'诊断当前查询',description:'诊断结果只提供建议，生成的 SQL 需要人工确认后手动执行。'},
    {target:'claude-assistant',title:'本机聊天历史',description:'会话保存在本机，可搜索、重命名和删除。'},
  ]},
]

export const GUIDE_HINTS:Record<GuideHintId,{title:string;description:string;topic:GuideTopicId}>={
  'measurement-data':{title:'数据查看小技巧',description:'可切换时间戳、UTC、北京时间；开发和测试环境还能受控编辑 Field。',topic:'measurement-data'},
  knowledge:{title:'完全离线的知识库',description:'概念和语法可本地搜索，示例只插入查询页签，不会自动执行。',topic:'knowledge'},
  'bulk-data':{title:'批量造数先预览',description:'请先核对点数、Series、样本与覆盖风险；生产环境始终禁止。',topic:'bulk-data'},
  'claude-assistant':{title:'上下文由你决定',description:'默认不发送数据库内容；只有主动勾选或诊断时才附加 SQL、错误和 Schema。',topic:'claude-assistant'},
}

export function initialLearningProgress(saved:unknown,legacy:unknown):LearningProgress{
  const topics=Object.fromEntries(ids.map(id=>[id,'new'])) as Record<GuideTopicId,GuideStatus>
  const old=legacy==='completed'||legacy==='skipped'?legacy:'new'
  topics['quick-start']=old
  if(saved&&typeof saved==='object'&&(saved as {version?:unknown}).version===1){
    const value=saved as Partial<LearningProgress>
    for(const id of ids){const status=value.topics?.[id];if(status==='new'||status==='completed'||status==='skipped')topics[id]=status}
    const legacyAgent=(value.topics as Record<string,unknown>|undefined)?.agent
    if(topics['claude-assistant']==='new'&&(legacyAgent==='completed'||legacyAgent==='skipped'))topics['claude-assistant']=legacyAgent
    const hints=value.hints&&typeof value.hints==='object'?value.hints:{}
    return {version:1,topics,hints,seenRelease:typeof value.seenRelease==='string'?value.seenRelease:''}
  }
  return {version:1,topics,hints:{},seenRelease:old==='new'?CURRENT_LEARNING_RELEASE:''}
}
export function setTopicStatus(progress:LearningProgress,id:GuideTopicId,status:Exclude<GuideStatus,'new'>):LearningProgress{
  return {...progress,topics:{...progress.topics,[id]:status}}
}
export function dismissGuideHint(progress:LearningProgress,id:GuideHintId):LearningProgress{
  return {...progress,hints:{...progress.hints,[id]:'dismissed'}}
}
export function markReleaseSeen(progress:LearningProgress):LearningProgress{return {...progress,seenRelease:CURRENT_LEARNING_RELEASE}}
export function topicById(id:GuideTopicId){return GUIDE_TOPICS.find(topic=>topic.id===id)!}
