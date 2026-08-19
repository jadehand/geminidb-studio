# Measurement Field Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow test and development users to modify or add Field values in Measurement data tabs and submit changes safely.

**Architecture:** Keep editing state as a pure client-side draft model keyed by point identity and Field name. Submit normalized point updates to a dedicated Bridge module that validates environment, schema, exact timestamp, and types, encodes only changed Fields, and stops on the first failed point.

**Tech Stack:** React 19, TypeScript, Node.js ESM, Line Protocol, built-in Node test runner

## Global Constraints

- This plan starts only after the write-policy and read-only Measurement data-view plans pass.
- Production data tabs remain fully read-only.
- Time and Tags are never editable.
- Existing and missing schema-defined Fields are editable in test/dev.
- Missing Fields display as blank cells, not `NULL`.
- Single-Field deletion and Field `NULL` are not supported.
- Multiple changed Fields on one point become one write.
- Batch submission stops on first point failure and never claims rollback.
- Never push.

---

### Task 1: Exact-Timestamp Line Protocol Encoder

**Files:**
- Create: `apps/bridge/line-protocol.mjs`
- Create: `apps/bridge/line-protocol.test.mjs`
- Modify: `apps/bridge/bulk-generator.mjs`
- Modify: `apps/bridge/bulk-generator.test.mjs`

**Interfaces:**
- Produces `encodeLineProtocolPoint({ measurement, tags, fields, timestamp, precision })`.
- `timestamp` accepts a safe integer for `ms` or a decimal string for `ns`.
- `fields` uses `{ [name]: { type:'integer'|'float'|'string'|'boolean', value } }`.

- [ ] **Step 1: Write failing exact-timestamp and escaping tests**

```js
test('preserves exact nanosecond timestamp strings', () => {
  assert.equal(
    encodeLineProtocolPoint({
      measurement:'cpu load',
      tags:{ host:'node 1' },
      fields:{
        count:{ type:'integer', value:2 },
        ok:{ type:'boolean', value:true },
        note:{ type:'string', value:'a"b' },
      },
      timestamp:'1784995200123456789',
      precision:'ns',
    }),
    'cpu\\ load,host=node\\ 1 count=2i,ok=true,note="a\\"b" 1784995200123456789',
  )
})
```

Test float, CR/LF rejection, empty field set, invalid integer, unsafe millisecond timestamp, and invalid nanosecond strings.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/bridge/line-protocol.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Extract and generalize the existing encoder**

Move escaping and Field encoding from `bulk-generator.mjs` to `line-protocol.mjs`. Keep a compatibility wrapper in `bulk-generator.mjs`:

```js
export function encodeLineProtocol(point) {
  return encodeLineProtocolPoint({
    measurement:point.measurement,
    tags:point.tags,
    fields:point.fields,
    timestamp:point.timestampMs,
    precision:'ms',
  })
}
```

- [ ] **Step 4: Run tests and commit**

Run: `node --test apps/bridge/line-protocol.test.mjs apps/bridge/bulk-generator.test.mjs`

Expected: PASS with no bulk-generation behavior change.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/bridge/line-protocol.mjs apps/bridge/line-protocol.test.mjs apps/bridge/bulk-generator.mjs apps/bridge/bulk-generator.test.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "refactor: share line protocol encoding"
```

### Task 2: Point Update Validation and Stop-on-Error Execution

**Files:**
- Create: `apps/bridge/measurement-updates.mjs`
- Create: `apps/bridge/measurement-updates.test.mjs`
- Modify: `apps/bridge/server.mjs`

**Interfaces:**
- Consumes `assertEnvironmentWritable`, `encodeLineProtocolPoint`, `getMeasurementSchema`, `influxWrite`.
- Produces `normalizePointUpdate(update, schema)`.
- Produces `executeMeasurementUpdates({ session, database, measurement, updates, loadSchema, writePoint })`.
- Adds `POST /measurement-data/updates`.

- [ ] **Step 1: Write failing validation tests**

```js
test('accepts a missing schema-defined field and keeps exact point identity', () => {
  assert.deepEqual(
    normalizePointUpdate({
      timestampNs:'1784995200123456789',
      tags:{ host:'node1' },
      fields:{ temperature:27.5 },
    }, {
      tags:['host'],
      fields:[{ name:'temperature', type:'float' }],
    }),
    {
      timestampNs:'1784995200123456789',
      tags:{ host:'node1' },
      fields:{ temperature:{ type:'float', value:27.5 } },
    },
  )
})
```

Reject missing/extra Tags, Time changes, unknown Fields, empty Field sets, null values, integer/float/string/boolean mismatches, and production sessions.

- [ ] **Step 2: Write failing stop-on-error tests**

Create three point updates, force point two to fail, and assert one success, one failure, one skipped, with only two writer calls.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test apps/bridge/measurement-updates.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implement normalization and sequential execution**

Load schema once. Normalize all updates before the first write so structural/type errors cannot cause partial execution. Then write each point separately using `precision:'ns'`.

Return:

```js
{
  summary:{ total, succeeded, failed, skipped },
  succeededIds:string[],
  failed:{ id:string, index:number, message:string } | null,
}
```

- [ ] **Step 5: Add authenticated route**

Request:

```json
{
  "database": "metrics",
  "measurement": "cpu_1784995200",
  "updates": [
    {
      "id": "point-id",
      "timestampNs": "1784995200123456789",
      "tags": { "host": "node1" },
      "fields": { "temperature": 27.5 }
    }
  ]
}
```

Do not accept Measurement per update; all updates in one request target the route-level Measurement.

- [ ] **Step 6: Run Bridge tests and commit**

Run: `node --test apps/bridge/measurement-updates.test.mjs apps/bridge/line-protocol.test.mjs`

Expected: PASS.

Run: `npm run test:bridge`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/bridge/measurement-updates.mjs apps/bridge/measurement-updates.test.mjs apps/bridge/server.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: update measurement field values"
```

### Task 3: Pure Client Editing Model

**Files:**
- Create: `apps/web/src/measurement-editing.ts`
- Create: `apps/web/src/measurement-editing.test.mjs`
- Modify: `apps/web/src/types.ts`

**Interfaces:**
- Produces `MeasurementDraftState`.
- Produces `parseFieldInput(type, input)`.
- Produces `setDraftValue(state, point, field, value)`.
- Produces `updatesFromDraft(state, points, schema)`.
- Produces `applyUpdateResult(state, result)`.

- [ ] **Step 1: Write failing type parser tests**

```js
test('parses schema field types without treating blank as null', () => {
  assert.deepEqual(parseFieldInput('integer', '42'), { ok:true, value:42 })
  assert.deepEqual(parseFieldInput('float', '2.5'), { ok:true, value:2.5 })
  assert.deepEqual(parseFieldInput('boolean', 'true'), { ok:true, value:true })
  assert.deepEqual(parseFieldInput('string', ''), { ok:true, value:'' })
  assert.equal(parseFieldInput('integer', '').ok, false)
})
```

- [ ] **Step 2: Write failing grouping/result tests**

Assert two changed Fields on one point produce one update, reverting to the original value removes the draft, missing Field additions are included, succeeded point IDs are removed after submit, and failed/skipped drafts remain.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test apps/web/src/measurement-editing.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implement immutable draft helpers**

Use keys:

```text
<point-id>\u0000<field-name>
```

Store original and next typed values. Do not mutate loaded `MeasurementPoint` objects. `updatesFromDraft` groups by point ID and includes exact timestamp and complete Tags.

- [ ] **Step 5: Run tests and commit**

Run: `node --test apps/web/src/measurement-editing.test.mjs`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/measurement-editing.ts apps/web/src/measurement-editing.test.mjs apps/web/src/types.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: model measurement field edits"
```

### Task 4: Editable Data Grid and Submit Toolbar

**Files:**
- Create: `apps/web/src/EditableFieldCell.tsx`
- Create: `apps/web/src/editable-field-cell.test.mjs`
- Modify: `apps/web/src/MeasurementDataView.tsx`
- Modify: `apps/web/src/measurement-data-view.css`
- Modify: `apps/web/src/api.ts`

**Interfaces:**
- Consumes `MeasurementDraftState` helpers.
- Produces `EditableFieldCell({ value, field, editable, draft, onChange })`.
- Adds `bridge.updateMeasurementData(payload, signal)`.

- [ ] **Step 1: Write failing structural tests**

Assert:

- Field cells use double-click to edit.
- Enter accepts and Escape cancels.
- Time and Tag cells never render `EditableFieldCell`.
- Missing Field cells render blank.
- Production derives `editable=false`.
- Toolbar contains `刷新`, `放弃修改`, and `提交`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/web/src/editable-field-cell.test.mjs apps/web/src/measurement-data-view.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement typed cell editing**

Use a text input for numeric/string and a select for boolean. On Enter, call `parseFieldInput`; show inline validation without creating a draft when invalid. Missing Field starts with an empty editor but the non-editing cell remains visually blank.

- [ ] **Step 4: Implement submit and result reconciliation**

Toolbar label:

```text
↑ 提交 N 项修改
```

On submit:

1. Build grouped point updates.
2. Call Bridge.
3. Remove succeeded point drafts.
4. Keep failed/skipped drafts.
5. Refresh only after state reconciliation.
6. Show `成功 N 个 · 失败 N 个 · 未执行 N 个`.

No extra confirmation dialog.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `npm run test:web`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/EditableFieldCell.tsx apps/web/src/editable-field-cell.test.mjs apps/web/src/MeasurementDataView.tsx apps/web/src/measurement-data-view.css apps/web/src/api.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: edit measurement field cells"
```

### Task 5: Unsaved-Change Protection

**Files:**
- Create: `apps/web/src/UnsavedMeasurementDialog.tsx`
- Create: `apps/web/src/unsaved-measurement-dialog.test.mjs`
- Modify: `apps/web/src/MeasurementDataView.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/workspace-tabs.ts`
- Modify: `apps/web/src/workspace-tabs.test.mjs`

**Interfaces:**
- Produces `UnsavedMeasurementDialog({ onSubmit, onDiscard, onCancel })`.
- Measurement view exposes a pending-navigation continuation only after submit/discard.

- [ ] **Step 1: Write failing protection tests**

Test that refresh, page change, time-range change, page-size change, data-tab close, connection switch, and Database switch return a guard requirement when the active data tab has drafts.

Structural dialog test asserts exact actions `提交`, `放弃`, `取消`, and `Escape` maps to cancel.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/web/src/unsaved-measurement-dialog.test.mjs apps/web/src/workspace-tabs.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement one guarded-action queue**

Store at most one pending continuation:

```ts
type PendingMeasurementAction = null | (() => void)
```

When guarded:

- submit runs the update flow, then continuation only if all drafts are resolved;
- discard clears drafts, then continuation;
- cancel clears the continuation without navigation.

Do not duplicate guard logic separately for every button.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:web`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/UnsavedMeasurementDialog.tsx apps/web/src/unsaved-measurement-dialog.test.mjs apps/web/src/MeasurementDataView.tsx apps/web/src/App.tsx apps/web/src/workspace-tabs.ts apps/web/src/workspace-tabs.test.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: protect unsaved measurement edits"
```

### Task 6: Editing Regression and Runtime Verification

**Files:**
- Verify only.

**Interfaces:**
- Produces a verified Measurement editing milestone.

- [ ] **Step 1: Run all automated checks**

Run: `npm run test:web`

Expected: PASS.

Run: `npm run test:bridge`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Manually verify test/dev editing**

Run: `npm run desktop`

Verify:

1. Existing Field overwrite.
2. Missing blank Field addition.
3. Integer/float/string/boolean validation.
4. Empty string writes as a value.
5. Numeric blank is rejected.
6. Time and Tags remain read-only.
7. Multiple Field changes on one point submit once.
8. Forced failure stops remaining points and preserves drafts.
9. Refresh, pagination, range changes, tab close, connection switch, and Database switch trigger protection.

- [ ] **Step 3: Manually verify production protection**

Connect with environment `prod`. Confirm no editable cells or submit button appear. Use a direct HTTP request to `POST /measurement-data/updates` with the active session and verify status `403` with code `PRODUCTION_READ_ONLY`.

- [ ] **Step 4: Confirm clean worktree**

Run: `& 'C:\Program Files\Git\cmd\git.exe' status --short`

Expected: no output.
