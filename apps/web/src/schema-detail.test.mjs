import assert from 'node:assert/strict'
import test from 'node:test'
import { filterMeasurementSchema, schemaPlainText } from './schema-detail.ts'

const schema={fields:[{name:'cpu_usage',type:'float'},{name:'host_name',type:'string'}],tags:['region','device_id']}

test('Schema 搜索同时匹配 Field 名称、类型和 Tag',()=>{
  assert.deepEqual(filterMeasurementSchema(schema,'float'),{fields:[{name:'cpu_usage',type:'float'}],tags:[]})
  assert.deepEqual(filterMeasurementSchema(schema,'device'),{fields:[],tags:['device_id']})
})

test('复制 Schema 使用完整纯文本并包含类型和计数',()=>{
  const text=schemaPlainText('monitoring','t_device',schema)
  assert.match(text,/Database: monitoring/)
  assert.match(text,/Measurement: t_device/)
  assert.match(text,/Fields \(2\):\n- cpu_usage: float/)
  assert.match(text,/Tags \(2\):\n- region/)
})
