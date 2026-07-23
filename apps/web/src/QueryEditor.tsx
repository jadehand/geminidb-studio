import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor, Position } from 'monaco-editor'
import * as monacoApi from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { useRef } from 'react'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import type { MeasurementSchema } from './types'
import { findTimeHover } from './influxql-time-hover'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco: monacoApi })

let languageFeaturesReady = false
let currentMeasurements: string[] = []
let currentSchema: MeasurementSchema = { fields: [], tags: [] }

const KEYWORDS = ['SELECT','FROM','WHERE','GROUP BY','ORDER BY','LIMIT','SLIMIT','OFFSET','SHOW DATABASES','SHOW MEASUREMENTS','SHOW FIELD KEYS','SHOW TAG KEYS','SHOW TAG VALUES','EXPLAIN','WRITE']
const FUNCTIONS = ['now()','mean()','sum()','count()','max()','min()','first()','last()','percentile()','derivative()','difference()','fill()']

function activeClause(value: string) {
  const statement = value.split(';').at(-1) || ''
  const matches = [...statement.matchAll(/\b(GROUP\s+BY|ORDER\s+BY|SELECT|FROM|WHERE|LIMIT|SLIMIT|OFFSET)\b/gi)]
  return matches.at(-1)?.[1].toUpperCase().replace(/\s+/g, ' ') || ''
}

function shouldTriggerSuggestions(value: string) {
  const statement = value.split(';').at(-1) || ''
  return /\b(?:SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY)\s+(?:"[^"]*)?$/i.test(statement)
}

function registerInfluxQL(monaco: Monaco) {
  if (languageFeaturesReady) return
  languageFeaturesReady = true
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
  monaco.languages.registerHoverProvider('sql', {
    provideHover(model, position) {
      const match = findTimeHover(model.getLineContent(position.lineNumber), position.column)
      if (!match) return null
      return {
        range:new monaco.Range(position.lineNumber, match.startColumn, position.lineNumber, match.endColumn),
        contents:[
          { value:'**北京时间**' },
          { value:`\`${match.beijing} UTC+8\`` },
        ],
      }
    },
  })
  monaco.editor.defineTheme('geminidb-light', {
    base: 'vs', inherit: true,
    rules: [{ token: 'keyword', foreground: '245FC7', fontStyle: 'bold' }, { token: 'string', foreground: '16785F' }, { token: 'number', foreground: '9A5818' }],
    colors: { 'editor.background': '#FAFBFC', 'editorLineNumber.foreground': '#9AA3AD', 'editorLineNumber.activeForeground': '#526071', 'editor.selectionBackground': '#CFE0FF', 'editor.lineHighlightBackground': '#F3F6FA' }
  })
  monaco.editor.defineTheme('geminidb-dark', {
    base: 'vs-dark', inherit: true,
    rules: [{ token:'keyword', foreground:'79AFFF', fontStyle:'bold' }, { token:'string', foreground:'72D0B3' }, { token:'number', foreground:'E8B778' }],
    colors: {
      'editor.background':'#171D25',
      'editorGutter.background':'#171D25',
      'editorLineNumber.foreground':'#667383',
      'editorLineNumber.activeForeground':'#C1CBD7',
      'editor.selectionBackground':'#294A70',
      'editor.lineHighlightBackground':'#1D2631',
      'editorWidget.background':'#202833',
      'editorWidget.border':'#465262',
      'editorHoverWidget.background':'#202833',
      'editorHoverWidget.border':'#465262',
      'editorSuggestWidget.background':'#202833',
      'editorSuggestWidget.border':'#465262',
      'editorSuggestWidget.foreground':'#D9E1EA',
      'editorSuggestWidget.selectedBackground':'#294A70',
      'editorSuggestWidget.highlightForeground':'#8FBDFF',
    }
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

type Props = { tabId: string; value: string; measurements: string[]; schema: MeasurementSchema; theme:'light'|'dark'; onChange: (value: string) => void; onRun: (sql: string) => void }

export default function QueryEditor({ tabId, value, measurements, schema, theme, onChange, onRun }: Props) {
  currentMeasurements = measurements
  currentSchema = schema
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const openSuggestions = (editor = editorRef.current) => {
    if (!editor) return
    editor.focus()
    void editor.getAction('editor.action.triggerSuggest')?.run()
  }
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    registerInfluxQL(monaco)
    const model = editor.getModel()
    if (model) validate(monaco, model)
    editor.onDidChangeModelContent(event => {
      const activeModel = editor.getModel()
      if (!activeModel) return
      validate(monaco, activeModel)
      const position = editor.getPosition()
      const typedTrigger = event.changes.some(change => change.text.endsWith(' ') || change.text.endsWith('"'))
      if (!position || !typedTrigger) return
      const beforeCursor = activeModel.getValueInRange({
        startLineNumber:1,
        startColumn:1,
        endLineNumber:position.lineNumber,
        endColumn:position.column,
      })
      if (shouldTriggerSuggestions(beforeCursor)) {
        openSuggestions(editor)
      }
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
      openSuggestions(editor)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const activeModel = editor.getModel()
      const selection = editor.getSelection()
      const selected = activeModel && selection ? activeModel.getValueInRange(selection).trim() : ''
      onRun(selected || activeModel?.getValue() || '')
    })
  }
  const schemaReady = schema.fields.length > 0 || schema.tags.length > 0
  return <div className="monaco-shell"><Editor path={`influxql:///${tabId}.sql`} language="sql" theme={theme==='dark'?'geminidb-dark':'geminidb-light'} value={value} beforeMount={registerInfluxQL} onMount={handleMount} onChange={next => onChange(next || '')} options={{ automaticLayout:true, minimap:{enabled:false}, fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize:12, lineHeight:22, lineNumbers:'on', lineNumbersMinChars:3, lineDecorationsWidth:8, padding:{top:10,bottom:30}, scrollBeyondLastLine:false, wordWrap:'off', tabSize:2, suggest:{showWords:false}, quickSuggestions:{other:true,comments:false,strings:true}, suggestOnTriggerCharacters:true, acceptSuggestionOnEnter:'on', fixedOverflowWidgets:true, renderValidationDecorations:'on' }}/><div className="monaco-foot"><span className={schemaReady?'schema-ready':'schema-empty'}>{schemaReady?`Schema 已就绪 · ${schema.fields.length} 字段 · ${schema.tags.length} 标签`:'尚未选择 Measurement'}</span><span className="completion-help"><button type="button" onMouseDown={event=>{event.preventDefault();openSuggestions()}}>显示补全</button><kbd>Ctrl</kbd> + <kbd>Space</kbd><i>·</i><kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd> 执行</span></div></div>
}
