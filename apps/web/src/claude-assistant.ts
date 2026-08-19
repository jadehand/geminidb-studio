import type { ClaudeAssistantAttachments } from './claude-assistant-types.ts'
import type { MeasurementSchema } from './types.ts'

export type ClaudeContextSource={sql:string;error:string;schema:MeasurementSchema}
export type ClaudeContextSelection={sql:boolean;error:boolean;schema:boolean}

export function buildClaudeAttachments(
  source:ClaudeContextSource,
  selection:ClaudeContextSelection,
):ClaudeAssistantAttachments {
  return{
    ...(selection.sql&&source.sql.trim()?{sql:source.sql}:{}),
    ...(selection.error&&source.error.trim()?{error:source.error}:{}),
    ...(selection.schema&&(source.schema.fields.length>0||source.schema.tags.length>0)?{schema:source.schema}:{}),
  }
}

export function extractInfluxqlBlocks(content:string):string[] {
  const blocks:string[]=[]
  const pattern=/```(?:influxql|sql)?\s*\n([\s\S]*?)```/gi
  for(const match of content.matchAll(pattern)) {
    const sql=match[1].trim()
    if(sql)blocks.push(sql)
  }
  return blocks
}

export function shouldRenameSession(currentTitle:string,draftTitle:string):boolean {
  const next=draftTitle.trim()
  return Boolean(next)&&next!==currentTitle
}
