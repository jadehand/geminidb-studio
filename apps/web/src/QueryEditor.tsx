import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor, Position } from 'monaco-editor'
import * as monacoApi from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import type { MeasurementSchema } from './types'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco: monacoApi })

let completionReady = false
let currentMeasurements: string[] = []
let currentSchema: MeasurementSchema = { fields: [], tags: [] }

const KEYWORDS = ['SELECT','FROM','WHERE','GROUP BY','ORDER BY','LIMIT','SLIMIT','OFFSET','SHOW DATABASES','SHOW MEASUREMENTS','SHOW FIELD KEYS','SHOW TAG KEYS','SHOW TAG VALUES','EXPLAIN','WRITE']
const FUNCTIONS = ['now()','mean()','sum()','count()','max()','min()','first()','last()','percentile()','derivative()','difference()','fill()']

function activeClause(value: string) {
  const statement = value.split(';').at(-1) || ''
  const matches = [...statement.matchAll(/\b(GROUP\s+BY|ORDER\s+BY|SELECT|FROM|WHERE|LIMIT|SLIMIT|OFFSET)\b/gi)]
  return matches.at(-1)?.[1].toUpperCase().replace(/\s+/g, ' ') || ''
}

function registerInfluxQL(monaco: Monaco) {
  if (completionReady) return
  completionReady = true
  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', '"'],
    provideCompletionItems(model: MonacoEditor.ITextModel, position: Position) {
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
      const beforeCursor = model.getValueInRange({ startLineNumber:1, startColumn:1, endLineNumber:position.lineNumber, endColumn:position.column })
      const clause = activeClause(beforeCursor)
      const line = model.getLineContent(position.lineNumber)
      const insideQuote = line[word.startColumn - 2] === '"'
      const quoted = (label: string) => insideQuote ? label : `"${label}"`
      const keywords = KEYWORDS.map(label => ({ label, kind: monaco.languages.CompletionItemKind.Keyword, insertText: label, range }))
      const functions = FUNCTIONS.map(label => ({ label, kind: monaco.languages.CompletionItemKind.Function, insertText: label, range }))
      const measurements = currentMeasurements.map(label => ({ label, detail: 'measurement', kind: monaco.languages.CompletionItemKind.Reference, insertText: quoted(label), range, sortText:`0${label}` }))
      const fields = currentSchema.fields.map(field => ({ label:field.name, detail:`field · ${field.type}`, kind:monaco.languages.CompletionItemKind.Field, insertText:quoted(field.name), range, sortText:`0${field.name}` }))
      const tags = currentSchema.tags.map(label => ({ label, detail:'tag', kind:monaco.languages.CompletionItemKind.Property, insertText:quoted(label), range, sortText:`1${label}` }))
      const allSchema = [...fields, ...tags]
      const contextual = clause === 'FROM' ? measurements
        : clause === 'SELECT' ? [...fields, ...functions]
        : clause === 'WHERE' ? [...allSchema, ...functions]
        : clause === 'GROUP BY' ? [...tags, { label:'time()', detail:'时间窗口', kind:monaco.languages.CompletionItemKind.Function, insertText:'time()', range }]
        : clause === 'ORDER BY' ? [{ label:'time', detail:'InfluxQL 时间列', kind:monaco.languages.CompletionItemKind.Field, insertText:'time', range }]
        : [...measurements, ...allSchema, ...functions]
      return { suggestions: [...contextual, ...keywords] }
    }
  })
  monaco.editor.defineTheme('geminidb-light', {
    base: 'vs', inherit: true,
    rules: [{ token: 'keyword', foreground: '245FC7', fontStyle: 'bold' }, { token: 'string', foreground: '16785F' }, { token: 'number', foreground: '9A5818' }],
    colors: { 'editor.background': '#FAFBFC', 'editorLineNumber.foreground': '#9AA3AD', 'editorLineNumber.activeForeground': '#526071', 'editor.selectionBackground': '#CFE0FF', 'editor.lineHighlightBackground': '#F3F6FA' }
  })
}

function validate(monaco: Monaco, model: MonacoEditor.ITextModel) {
  const value = model.getValue()
  const markers: Parameters<typeof monaco.editor.setModelMarkers>[2] = []
  const add = (message: string, severity: number, match: RegExpMatchArray | null) => {
    const offset = match?.index || 0
    const start = model.getPositionAt(offset)
    const end = model.getPositionAt(offset + Math.max(match?.[0].length || 1, 1))
    markers.push({ message, severity, startLineNumber:start.lineNumber, startColumn:start.column, endLineNumber:end.lineNumber, endColumn:end.column })
  }
  const backtick = value.match(/`[^`]+`/)
  if (backtick) add('InfluxQL measurement 请使用双引号，不要使用 MySQL 反引号', monaco.MarkerSeverity.Error, backtick)
  const interval = value.match(/INTERVAL\s+\d+/i)
  if (interval) add('InfluxQL 时间范围请使用 now() - 1h 等写法', monaco.MarkerSeverity.Error, interval)
  if (/^\s*select\b/i.test(value) && !/\bwhere\b[\s\S]*\btime\b[\s\S]*(?:>=|<=|>|<)/i.test(value)) add('SELECT 必须包含 time 范围，避免全量扫描', monaco.MarkerSeverity.Warning, value.match(/select/i))
  monaco.editor.setModelMarkers(model, 'influxql', markers)
}

type Props = { tabId: string; value: string; measurements: string[]; schema: MeasurementSchema; onChange: (value: string) => void; onRun: (sql: string) => void }

export default function QueryEditor({ tabId, value, measurements, schema, onChange, onRun }: Props) {
  currentMeasurements = measurements
  currentSchema = schema
  const handleMount: OnMount = (editor, monaco) => {
    registerInfluxQL(monaco)
    const model = editor.getModel()
    if (model) validate(monaco, model)
    editor.onDidChangeModelContent(() => { const activeModel=editor.getModel(); if (activeModel) validate(monaco,activeModel) })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const activeModel = editor.getModel()
      const selection = editor.getSelection()
      const selected = activeModel && selection ? activeModel.getValueInRange(selection).trim() : ''
      onRun(selected || activeModel?.getValue() || '')
    })
  }
  return <div className="monaco-shell"><Editor path={`influxql:///${tabId}.sql`} language="sql" theme="geminidb-light" value={value} beforeMount={registerInfluxQL} onMount={handleMount} onChange={next => onChange(next || '')} options={{ automaticLayout:true, minimap:{enabled:false}, fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize:12, lineHeight:22, padding:{top:10,bottom:28}, scrollBeyondLastLine:false, wordWrap:'off', tabSize:2, suggest:{showWords:false}, quickSuggestions:{other:true,comments:false,strings:true}, fixedOverflowWidgets:true, renderValidationDecorations:'on' }}/><div className="monaco-foot"><span>InfluxQL · {schema.fields.length} fields · {schema.tags.length} tags · 按语句上下文补全</span><span>选中后 Ctrl/Cmd + Enter 仅执行选中内容</span></div></div>
}
