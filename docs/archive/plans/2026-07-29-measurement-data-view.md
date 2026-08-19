# Measurement Data View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated read-only workspace tab that displays raw points from one concrete day-table Measurement.

**Architecture:** Keep generic SQL query results unchanged. Add a dedicated Bridge query module that preserves Measurement, Tags, Fields, schema types, and nanosecond timestamp strings, then introduce discriminated workspace tabs and a focused `MeasurementDataView` component.

**Tech Stack:** React 19, TypeScript, Node.js ESM, InfluxQL HTTP API, CSS, built-in Node test runner

## Global Constraints

- Menus exist only on concrete Measurement leaf nodes; logical prefix groups only expand and collapse.
- Left-click and right-click open the same menu: 查看数据、新建查询、查看 Schema.
- Data view default: whole day, `time DESC`, 50 rows.
- Time filter choices: 全天 or custom time within that day.
- Page sizes: 50, 100, 200, 500.
- Preserve exact nanosecond timestamps as strings.
- This plan delivers a read-only data view; editing belongs to the later editing plan.
- Never push.

---

### Task 1: Day-Table Context and Data-View Query Parameters

**Files:**
- Create: `apps/web/src/measurement-data.ts`
- Create: `apps/web/src/measurement-data.test.mjs`

**Interfaces:**
- Produces: `measurementDay(measurement): { date:string; startNs:string; endNs:string } | null`.
- Produces: `normalizeMeasurementDataOptions(input): MeasurementDataOptions`.
- Produces types: `MeasurementDataOptions`, `MeasurementPoint`, `MeasurementDataPage`.

- [ ] **Step 1: Write failing day-boundary and option tests**

```js
test('derives Beijing day bounds from ten-digit suffix', () => {
  assert.deepEqual(measurementDay('cpu_1784995200'), {
    date:'2026-07-26',
    startNs:'1784995200000000000',
    endNs:'1785081599999999999',
  })
})

test('defaults to whole day, descending, and fifty rows', () => {
  assert.deepEqual(normalizeMeasurementDataOptions({}), {
    limit:50, offset:0, startNs:null, endNs:null,
  })
})
```

Also reject limit values outside `[50, 100, 200, 500]`, negative offsets, reversed custom ranges, and ranges outside the selected day.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/web/src/measurement-data.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement types and pure normalization**

Define:

```ts
export type MeasurementPoint = {
  id: string
  measurement: string
  timestampNs: string
  time: string
  tags: Record<string, string>
  fields: Record<string, string | number | boolean | null>
}

export type MeasurementDataPage = {
  schema: MeasurementSchema
  points: MeasurementPoint[]
  page: { limit:number; offset:number; hasMore:boolean }
}
```

Use `BigInt` only for nanosecond arithmetic and serialize all boundaries back to decimal strings.

- [ ] **Step 4: Run tests and commit**

Run: `node --test apps/web/src/measurement-data.test.mjs`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/measurement-data.ts apps/web/src/measurement-data.test.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: define measurement data view model"
```

### Task 2: Bridge Measurement Data Query

**Files:**
- Create: `apps/bridge/measurement-data.mjs`
- Create: `apps/bridge/measurement-data.test.mjs`
- Modify: `apps/bridge/influx-client.mjs`
- Modify: `apps/bridge/influx-client.test.mjs`
- Modify: `apps/bridge/server.mjs`

**Interfaces:**
- Produces: `buildMeasurementDataQuery({ measurement, limit, offset, startNs, endNs })`.
- Produces: `flattenMeasurementSeries({ measurement, schema, series, limit })`.
- Extends: `influxQuery(config, database, sql, { epoch })`.
- Adds: `GET /measurement-data`.

- [ ] **Step 1: Write failing query builder tests**

```js
test('builds whole-day latest-page query', () => {
  assert.equal(
    buildMeasurementDataQuery({ measurement:'cpu_1784995200', limit:50, offset:0, startNs:null, endNs:null }),
    'SELECT * FROM "cpu_1784995200" ORDER BY time DESC LIMIT 51 OFFSET 0',
  )
})

test('adds exact nanosecond bounds for a custom range', () => {
  assert.match(
    buildMeasurementDataQuery({
      measurement:'cpu_1784995200',
      limit:100,
      offset:100,
      startNs:'1784995200000000000',
      endNs:'1784998800000000000',
    }),
    /WHERE time >= 1784995200000000000ns AND time <= 1784998800000000000ns/,
  )
})
```

Test identifier escaping and invalid parameter rejection.

- [ ] **Step 2: Write failing response-flattening tests**

Use an upstream fixture with `series.name`, `series.tags`, `columns`, and `values`. Assert:

- schema Tag columns merge with `series.tags`;
- Field columns stay under `fields`;
- missing Fields become `null`;
- `timestampNs` remains the exact input string;
- `limit + 1` determines `hasMore`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test apps/bridge/measurement-data.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Extend `influxQuery` epoch handling**

Accept:

```js
influxQuery(config, database, sql, { epoch:'ms' | 'ns' } = { epoch:'ms' })
```

Keep existing callers on `ms`. The Measurement endpoint calls with `epoch:'ns'`. Do not parse timestamp strings into numbers.

- [ ] **Step 5: Implement endpoint**

Authenticated request:

```text
GET /measurement-data?database=metrics&measurement=cpu_1784995200&limit=50&offset=0
```

Optional `startNs` and `endNs` are decimal strings. Load schema, execute `LIMIT limit + 1`, flatten the response, trim to `limit`, and return schema plus paging metadata.

- [ ] **Step 6: Run Bridge tests and commit**

Run: `node --test apps/bridge/measurement-data.test.mjs apps/bridge/influx-client.test.mjs`

Expected: PASS.

Run: `npm run test:bridge`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/bridge/measurement-data.mjs apps/bridge/measurement-data.test.mjs apps/bridge/influx-client.mjs apps/bridge/influx-client.test.mjs apps/bridge/server.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: expose measurement data pages"
```

### Task 3: Discriminated Workspace Tabs

**Files:**
- Create: `apps/web/src/workspace-tabs.ts`
- Create: `apps/web/src/workspace-tabs.test.mjs`
- Create: `apps/web/src/WorkspaceTabs.tsx`
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/workspace.ts`
- Modify: `apps/web/src/workspace.test.mjs`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/query-editor.css`

**Interfaces:**
- Produces `WorkspaceTab = QueryWorkspaceTab | MeasurementDataWorkspaceTab`.
- Produces `openMeasurementDataTab(tabs, context)`.
- Produces `WorkspaceTabs` rendering both kinds.

- [ ] **Step 1: Write failing tab identity and migration tests**

```js
test('reuses an existing measurement data tab', () => {
  const existing = [{
    kind:'measurement-data', id:'data-1', name:'cpu · 数据',
    connectionId:'c1', database:'metrics', measurement:'cpu_1784995200',
  }]
  const result = openMeasurementDataTab(existing, {
    connectionId:'c1', database:'metrics', measurement:'cpu_1784995200',
  })
  assert.equal(result.tabs.length, 1)
  assert.equal(result.activeId, 'data-1')
})
```

Add a migration test converting persisted legacy `{ id, name, sql }` query tabs to `{ kind:'query', ... }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/web/src/workspace-tabs.test.mjs apps/web/src/workspace.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement the discriminated model**

```ts
export type QueryWorkspaceTab = {
  kind: 'query'
  id: string
  name: string
  sql: string
}

export type MeasurementDataWorkspaceTab = {
  kind: 'measurement-data'
  id: string
  name: string
  connectionId: string
  database: string
  measurement: string
}
```

Keep query-tab rename behavior only for `kind:'query'`. Persist tab descriptors, but never persist loaded Measurement rows.

- [ ] **Step 4: Replace inline query-tab rendering**

Move tab rendering from `App.tsx` into `WorkspaceTabs.tsx`. Query tabs retain existing keyboard, close, add, and rename behavior. Data tabs use the table name plus `· 数据`.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `node --test apps/web/src/workspace-tabs.test.mjs apps/web/src/workspace.test.mjs`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/workspace-tabs.ts apps/web/src/workspace-tabs.test.mjs apps/web/src/WorkspaceTabs.tsx apps/web/src/types.ts apps/web/src/workspace.ts apps/web/src/workspace.test.mjs apps/web/src/App.tsx apps/web/src/query-editor.css
& 'C:\Program Files\Git\cmd\git.exe' commit -m "refactor: support workspace tab types"
```

### Task 4: Concrete Measurement Action Menu

**Files:**
- Create: `apps/web/src/MeasurementActionMenu.tsx`
- Create: `apps/web/src/measurement-action-menu.test.mjs`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/sidebar-polish.css`

**Interfaces:**
- Produces `MeasurementActionMenu({ anchor, measurement, onViewData, onNewQuery, onViewSchema, onClose })`.
- Consumes `openMeasurementDataTab` from Task 3.

- [ ] **Step 1: Write a failing structural test**

Assert the source includes the three exact labels, `contextmenu` handling, `Escape`, arrow keys, and `Enter`. Assert `App.tsx` no longer calls `chooseTable` directly from a leaf row click.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/web/src/measurement-action-menu.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement shared left/right-click menu state**

Leaf node `onClick` and `onContextMenu` both set:

```ts
{ measurement, x, y }
```

Group-node click remains expand/collapse only. Menu actions:

- `onViewData`: open or activate the data tab.
- `onNewQuery`: create a fresh query tab with current generated SQL.
- `onViewSchema`: load schema and open the existing dialog.

- [ ] **Step 4: Run tests and commit**

Run: `node --test apps/web/src/measurement-action-menu.test.mjs`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/MeasurementActionMenu.tsx apps/web/src/measurement-action-menu.test.mjs apps/web/src/App.tsx apps/web/src/sidebar-polish.css
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add measurement action menu"
```

### Task 5: Read-Only Measurement Data View

**Files:**
- Create: `apps/web/src/MeasurementDataView.tsx`
- Create: `apps/web/src/measurement-data-view.test.mjs`
- Create: `apps/web/src/measurement-data-view.css`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes `MeasurementDataPage`, workspace data-tab context, and shared result zoom controls.
- Adds `bridge.measurementData(options, signal)`.
- Produces a read-only grid with time, Tag, and Field columns.

- [ ] **Step 1: Write failing API and structure tests**

Assert `api.ts` uses `/measurement-data` with Database, Measurement, limit, offset, and optional bounds. Structural tests assert toolbar labels `全天`, `自定义时段`, `每页`, and `刷新`, plus time/tag/field column grouping.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/web/src/measurement-data-view.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement data fetching**

Fetch on tab activation or option change using an `AbortController`. Preserve the current page while refreshing. On error, show the message and a retry button without closing the tab.

- [ ] **Step 4: Implement grid and controls**

Render:

- exact time text with the existing time hover helper;
- Tag columns before Field columns;
- blank cells for missing Fields;
- previous/next page controls using offset;
- 50/100/200/500 page-size options;
- whole-day/custom range selector constrained by `measurementDay`;
- shared `ResultGridZoomControls`.

This component is deliberately read-only in this plan.

- [ ] **Step 5: Wire active workspace content**

When active tab is query, render the existing editor/result split. When it is measurement data, render `MeasurementDataView` across the full main workspace.

- [ ] **Step 6: Run tests and build**

Run: `npm run test:web`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/MeasurementDataView.tsx apps/web/src/measurement-data-view.test.mjs apps/web/src/measurement-data-view.css apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/main.tsx
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add measurement data view"
```

### Task 6: Read-Only Data View Regression Gate

**Files:**
- Verify only.

**Interfaces:**
- Produces a verified read-only Measurement-view milestone.

- [ ] **Step 1: Run all automated checks**

Run: `npm run test:web`

Expected: PASS.

Run: `npm run test:bridge`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Manually verify**

Run: `npm run desktop`

Verify concrete leaf menus, group expand/collapse, data-tab de-duplication, latest 50 ordering, custom time bounds within the table day, paging, blank missing Fields, shared zoom, query-tab preservation, and Schema opening.

- [ ] **Step 3: Confirm clean worktree**

Run: `& 'C:\Program Files\Git\cmd\git.exe' status --short`

Expected: no output.
