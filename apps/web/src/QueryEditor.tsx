import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor, Position } from 'monaco-editor'
import * as monacoApi from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { useEffect, useRef, useState } from 'react'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import type { MeasurementSchema } from './types'
import { findTimeHover } from './influxql-time-hover'
import { completionContext, measurementFromQuery, shouldAutoSuggest } from './influxql-completion'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco: monacoApi })

let languageFeaturesReady = false
const modelContexts = new Map<string, { measurements: string[]; schema: MeasurementSchema }>()

const KEYWORDS = ['SELECT','FROM','WHERE','GROUP BY','ORDER BY','LIMIT','SLIMIT','OFFSET','SHOW DATABASES','SHOW MEASUREMENTS','SHOW FIELD KEYS','SHOW TAG KEYS','SHOW TAG VALUES','EXPLAIN','WRITE']
const FUNCTIONS = ['mean','sum','count','max','min','first','last','percentile','derivative','difference']

function registerInfluxQL(monaco: Monaco) {
  if (languageFeaturesReady) return
  languageFeaturesReady = true
  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', '"'],
    provideCompletionItems(model: MonacoEditor.ITextModel, position: Position) {
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
      const beforeCursor = model.getValueInRange({ startLineNumber:1, startColumn:1, endLineNumber:position.lineNumber, endColumn:position.column })
      const context = completionContext(beforeCursor)
      const { measurements, schema } = modelContexts.get(model.uri.toString()) || { measurements:[], schema:{fields:[],tags:[]} }
      const line = model.getLineContent(position.lineNumber)
      const insideQuote = line[word.startColumn - 2] === '"'
      const quoted = (label: string) => insideQuote ? label : `"${label}"`
      const snippetRule = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      const keywords = KEYWORDS.map(label => ({ label, detail:'InfluxQL 关键词', kind:monaco.languages.CompletionItemKind.Keyword, insertText:label, range, sortText:`5${label}` }))
      const functions = FUNCTIONS.map(label => ({ label:`${label}()`, filterText:label, detail:'InfluxQL 函数', kind:monaco.languages.CompletionItemKind.Function, insertText:`${label}(\${1:"field"})`, insertTextRules:snippetRule, range, sortText:`2${label}` }))
      const measurementItems = measurements.map(label => ({ label, detail:'Measurement', kind:monaco.languages.CompletionItemKind.Reference, insertText:quoted(label), range, sortText:`0${label}` }))
      const fields = schema.fields.map(field => ({ label:field.name, detail:`Field · ${field.type}`, kind:monaco.languages.CompletionItemKind.Field, insertText:quoted(field.name), range, sortText:`0${field.name}` }))
      const tags = schema.tags.map(label => ({ label, detail:'Tag Key', kind:monaco.languages.CompletionItemKind.Property, insertText:quoted(label), range, sortText:`1${label}` }))
      const allSchema = [...fields, ...tags]
      const operators = ['=','!=','=~','!~','>','>=','<','<='].map(label => ({ label, detail:'条件运算符', kind:monaco.languages.CompletionItemKind.Operator, insertText:label, range, sortText:`0${label}` }))
      const contextual = context.clause === 'FROM' ? measurementItems
        : context.clause === 'SELECT' ? [...fields, ...functions, { label:'*', detail:'全部 Field', kind:monaco.languages.CompletionItemKind.Field, insertText:'*', range, sortText:'0*' }]
        : context.clause === 'WHERE' ? [...allSchema, ...operators, { label:'time', detail:'InfluxQL 时间列', kind:monaco.languages.CompletionItemKind.Field, insertText:'time', range, sortText:'0time' }, { label:'now()', detail:'当前时间', kind:monaco.languages.CompletionItemKind.Function, insertText:'now()', range, sortText:'2now' }]
        : context.clause === 'GROUP BY' ? [...tags, { label:'time()', detail:'时间窗口', kind:monaco.languages.CompletionItemKind.Function, insertText:'time(${1:1m})', insertTextRules:snippetRule, range, sortText:'0time' }, { label:'fill()', detail:'空值填充', kind:monaco.languages.CompletionItemKind.Function, insertText:'fill(${1:null})', insertTextRules:snippetRule, range, sortText:'1fill' }]
        : context.clause === 'ORDER BY' ? [{ label:'time DESC', detail:'时间倒序', kind:monaco.languages.CompletionItemKind.Snippet, insertText:'time DESC', range, sortText:'0' }, { label:'time ASC', detail:'时间正序', kind:monaco.languages.CompletionItemKind.Snippet, insertText:'time ASC', range, sortText:'1' }]
        : [...measurementItems, ...allSchema, ...functions]
      const templates = [
        { label:'SELECT 查询模板', filterText:'SELECT', detail:'带时间范围和 LIMIT', kind:monaco.languages.CompletionItemKind.Snippet, insertText:'SELECT ${1:*}\\nFROM "${2:measurement}"\\nWHERE time >= now() - ${3:1h}\\nORDER BY time DESC\\nLIMIT ${4:100}', insertTextRules:snippetRule, range, sortText:'8SELECT' },
        { label:'WRITE 写入模板', filterText:'WRITE', detail:'GeminiDB Line Protocol', kind:monaco.languages.CompletionItemKind.Snippet, insertText:'WRITE ${1:measurement},${2:tag_key}=${3:tag_value} ${4:field_key}=${5:field_value} ${6:timestamp}', insertTextRules:snippetRule, range, sortText:'8WRITE' },
      ]
      return { suggestions: [...contextual, ...keywords, ...templates] }
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

type Props = { tabId: string; value: string; measurements: string[]; selectedMeasurement:string; schema: MeasurementSchema; theme:'light'|'dark'; resolveSchema:(measurement:string)=>Promise<MeasurementSchema>; onChange: (value: string) => void; onRun: (sql: string) => void }

export default function QueryEditor({ tabId, value, measurements, selectedMeasurement, schema, theme, resolveSchema, onChange, onRun }: Props) {
  const sqlMeasurement=measurementFromQuery(value)
  const activeMeasurement=sqlMeasurement||selectedMeasurement
  const [completionSchema,setCompletionSchema]=useState(schema)
  const [schemaState,setSchemaState]=useState<'empty'|'loading'|'ready'|'error'>(()=>schema.fields.length||schema.tags.length?'ready':'empty')
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const suggestTimer = useRef<number | null>(null)
  const modelUri=`influxql:///${tabId}.sql`
  modelContexts.set(monacoApi.Uri.parse(modelUri).toString(),{measurements,schema:completionSchema})
  useEffect(()=>{
    let active=true
    if(!activeMeasurement){setCompletionSchema({fields:[],tags:[]});setSchemaState('empty');return()=>{active=false}}
    if(activeMeasurement===selectedMeasurement&&(schema.fields.length||schema.tags.length)){setCompletionSchema(schema);setSchemaState('ready');return()=>{active=false}}
    setSchemaState('loading')
    void resolveSchema(activeMeasurement).then(next=>{if(active){setCompletionSchema(next);setSchemaState('ready')}}).catch(()=>{if(active){setCompletionSchema({fields:[],tags:[]});setSchemaState('error')}})
    return()=>{active=false}
  },[activeMeasurement,resolveSchema,schema,selectedMeasurement])
  useEffect(()=>()=>{modelContexts.delete(monacoApi.Uri.parse(modelUri).toString());if(suggestTimer.current)window.clearTimeout(suggestTimer.current)},[modelUri])
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
      if (!position) return
      const beforeCursor = activeModel.getValueInRange({
        startLineNumber:1,
        startColumn:1,
        endLineNumber:position.lineNumber,
        endColumn:position.column,
      })
      if (!event.changes.some(change=>shouldAutoSuggest(beforeCursor,change.text))) return
      if(suggestTimer.current)window.clearTimeout(suggestTimer.current)
      suggestTimer.current=window.setTimeout(()=>openSuggestions(editor),80)
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
  const schemaLabel=schemaState==='loading'?`正在读取 ${activeMeasurement} Schema…`:schemaState==='error'?`${activeMeasurement} Schema 加载失败`:schemaState==='ready'?`${activeMeasurement} · ${completionSchema.fields.length} Field · ${completionSchema.tags.length} Tag`:'输入 FROM 或选择 Measurement 后加载 Schema'
  return <div className="monaco-shell"><Editor path={modelUri} language="sql" theme={theme==='dark'?'geminidb-dark':'geminidb-light'} value={value} beforeMount={registerInfluxQL} onMount={handleMount} onChange={next => onChange(next || '')} options={{ automaticLayout:true, minimap:{enabled:false}, fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize:12, lineHeight:22, lineNumbers:'on', lineNumbersMinChars:3, lineDecorationsWidth:8, padding:{top:10,bottom:30}, scrollBeyondLastLine:false, wordWrap:'off', tabSize:2, suggest:{showWords:false,filterGraceful:true,showStatusBar:true,preview:true}, quickSuggestions:{other:true,comments:false,strings:true}, quickSuggestionsDelay:80, suggestOnTriggerCharacters:true, acceptSuggestionOnEnter:'on', snippetSuggestions:'inline', fixedOverflowWidgets:true, renderValidationDecorations:'on' }}/><div className="monaco-foot"><span className={`schema-${schemaState}`}>{schemaLabel}</span><span className="completion-help"><button type="button" onMouseDown={event=>{event.preventDefault();openSuggestions()}}>显示补全</button><kbd>Ctrl</kbd> + <kbd>Space</kbd><i>·</i><kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd> 执行</span></div></div>
}
