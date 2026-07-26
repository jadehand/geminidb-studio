# GeminiDB Studio v0.5.0 Bulk Data Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe four-step bulk data generation workflow for GeminiDB Influx test connections, with deterministic preview, constrained generation, bounded background writes, progress, cancellation, and local draft/history.

**Architecture:** The React frontend submits declarative plans and polls status; it never constructs the full dataset. New focused Bridge modules validate plans, generate deterministic Line Protocol, and run one in-memory job at a time through the existing Influx HTTP client. The current `App.tsx` and `server.mjs` remain composition layers rather than absorbing generator and state-machine logic.

**Tech Stack:** React 18, TypeScript, Vite, Node.js ESM and built-in `node:test`, native `http`/`https`, Tauri v2, Playwright.

## Global Constraints

- Target version is exactly `0.5.0`; baseline is `0.4.10`.
- Only connections with `environment === "test"`, `readOnly === false`, a live session, and a selected Database may generate data.
- One global bulk job may be unfinished at a time.
- One job targets one existing logical prefix and at most 7 dates.
- Dates and day-table suffixes use `Asia/Shanghai`; writes use UTC timestamps with `precision=ms`.
- Maximum planned points is `100000`; maximum worst-case new series is `10000`.
- Each batch contains at most `1000` points; dates are sequential; one date has at most `2` in-flight writes.
- Retry only timeouts, resets, HTTP 429, 500, 502, 503, and 504, at most 3 retries with 250/500/1000ms backoff.
- RP absence, RP retention overflow, Schema type conflict, invalid constraints, point overflow, and series overflow are hard blockers.
- Preview creates a Bridge-held seed and 15-minute `previewId`; execution must use that preview and revalidate remote state.
- Do not persist passwords, bearer tokens, random seeds, complete generated data, or complete Line Protocol.
- Do not add arbitrary scripts, cross-measurement rules, OR groups, Tag conditions, rollback, millisecond sampling, or user-tunable concurrency.
- Use TDD for every behavior change and keep commits in `<type>: <description>` format without co-author trailers.

---

## Planned File Map

### Bridge

- Create `apps/bridge/bulk-plan.mjs`: normalization, Beijing time, target tables, RP/Schema validation, and upper-bound calculations.
- Create `apps/bridge/bulk-plan.test.mjs`: plan-domain tests.
- Create `apps/bridge/bulk-generator.mjs`: seeded PRNG, constraint graph, value generation, escaping, and batching.
- Create `apps/bridge/bulk-generator.test.mjs`: generator and deterministic-output tests.
- Create `apps/bridge/bulk-jobs.mjs`: single-job state machine, scheduling, retry, pause/resume, and cancel.
- Create `apps/bridge/bulk-jobs.test.mjs`: state-machine tests with controlled writers and clocks.
- Create `apps/bridge/bulk-api.mjs`: bulk route dispatch, preview cache, authorization, and error mapping.
- Create `apps/bridge/bulk-api.test.mjs`: route-level tests without a real GeminiDB instance.
- Create `apps/bridge/server-body.mjs`: bounded JSON request parsing.
- Create `apps/bridge/server-body.test.mjs`: malformed and oversized body tests.
- Modify `apps/bridge/influx-client.mjs`: Keep-Alive, typed upstream errors, RP/tag metadata, and RP-aware writes.
- Modify `apps/bridge/influx-client.test.mjs`: metadata, query parameters, Keep-Alive, and error classification.
- Modify `apps/bridge/server.mjs`: session environment, 1 MiB body limit, bulk routes, shutdown coordination, and health version.

### Web

- Create `apps/web/src/bulk-data.ts`: frontend contracts, eligibility, draft/history, estimates, and error-to-step mapping.
- Create `apps/web/src/bulk-data.test.mjs`: pure web-domain tests.
- Create `apps/web/src/BulkDataWizard.tsx`: wizard, history, preview, and progress UI.
- Create `apps/web/src/bulk-data.css`: feature-local styles.
- Create `apps/web/src/app-close.ts`: unfinished-job detection and close-guard decisions.
- Create `apps/web/src/app-close.test.mjs`: close-guard tests.
- Modify `apps/web/src/day-tables.ts`: export one shared day-table prefix parser.
- Modify `apps/web/src/day-tables.test.mjs`: cover prefix parsing.
- Modify `apps/web/src/api.ts`: bulk endpoint client.
- Modify `apps/web/src/App.tsx`: top entry, modal composition, polling ownership, notification, and close guard.
- Modify `apps/web/src/main.tsx`: import `bulk-data.css`.
- Modify `apps/web/src/desktop.ts`: Tauri close interception and explicit window destruction.
- Modify `apps/web/src/types.ts`: login transport environment and shared connection compatibility.

### End-to-end and release

- Create `playwright.config.ts`: local Vite and fixture Bridge startup.
- Create `tests/e2e/fixtures/bulk-bridge.mjs`: deterministic local API fixture.
- Create `tests/e2e/bulk-data.spec.ts`: four-step workflow and job lifecycle.
- Modify `package.json` and `package-lock.json`: Playwright dependency and `test:e2e`.
- Create `scripts/version-consistency.test.mjs`: release version consistency test.
- Modify `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `CHANGELOG.md`: release metadata.

---

### Task 1: Plan Domain, Beijing Dates, and Hard Limits

**Files:**
- Create: `apps/bridge/bulk-plan.mjs`
- Create: `apps/bridge/bulk-plan.test.mjs`

**Interfaces:**
- Produces: `BULK_LIMITS`, `beijingDateToUnixSeconds(date)`, `measurementForDate(prefix, date)`, `buildTimeSlots(date, startTime, endTime, intervalSeconds)`, `normalizePlanInput(input)`, `estimatePlan(input)`, `validateRetentionPolicy(rp, timestamps, now)`, and `compareTargetSchema(source, target)`.
- Consumes: no project module; this task is pure and deterministic.

- [ ] **Step 1: Write failing tests for Beijing day-table naming and inclusive slots**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beijingDateToUnixSeconds,
  buildTimeSlots,
  measurementForDate,
} from './bulk-plan.mjs'

test('北京时间日期生成十位秒级天表后缀', () => {
  assert.equal(beijingDateToUnixSeconds('2026-07-26'), 1784995200)
  assert.equal(measurementForDate('cpu', '2026-07-26'), 'cpu_1784995200')
})

test('时间槽包含结束时间且不跨日', () => {
  assert.deepEqual(
    buildTimeSlots('2026-07-26', '00:00:00', '00:02:00', 60),
    [1784995200000, 1784995260000, 1784995320000],
  )
  assert.throws(
    () => buildTimeSlots('2026-07-26', '23:00:00', '01:00:00', 60),
    /开始时间不能晚于结束时间/,
  )
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test apps/bridge/bulk-plan.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `bulk-plan.mjs`.

- [ ] **Step 3: Implement Beijing conversion and slot generation**

Implement parsing without relying on the machine timezone:

```js
export const BULK_LIMITS = Object.freeze({
  maxDates: 7,
  maxPoints: 100_000,
  maxSeries: 10_000,
  minIntervalSeconds: 1,
  maxIntervalSeconds: 86_400,
})

export function beijingDateToUnixSeconds(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式必须为 YYYY-MM-DD')
  const milliseconds = Date.parse(`${date}T00:00:00+08:00`)
  if (!Number.isFinite(milliseconds)) throw new Error('日期无效')
  return milliseconds / 1000
}

export function measurementForDate(prefix, date) {
  return `${prefix}_${beijingDateToUnixSeconds(date)}`
}
```

`buildTimeSlots` must parse `HH:mm:ss`, require start `<=` end, require integer seconds in the configured range, and return UTC millisecond integers.

- [ ] **Step 4: Add failing tests for normalization and estimates**

Cover:

```js
test('最多七天并计算点数和最坏新增时间线', () => {
  const result = estimatePlan({
    prefix: 'cpu',
    dates: ['2026-07-25', '2026-07-26'],
    startTime: '00:00:00',
    endTime: '00:01:00',
    intervalSeconds: 60,
    tags: [{ name:'host', values:['n1','n2'] }, { name:'region', values:['a','b'] }],
  })
  assert.equal(result.tagCombinationCount, 4)
  assert.equal(result.pointCount, 16)
  assert.equal(result.maxNewSeries, 8)
})
```

Also assert rejection for 8 dates, duplicate dates, empty prefix, non-integer intervals, more than 100,000 points, more than 10,000 series, and safe-integer multiplication overflow.

- [ ] **Step 5: Implement normalization, estimates, RP validation, and Schema comparison**

`normalizePlanInput` must:

- sort and deduplicate dates;
- validate `1..7` dates;
- trim Tag values and reject empty values;
- require one generator per Schema Tag and Field;
- keep stable Schema order.

`validateRetentionPolicy` must treat `durationMs === 0` as infinite and throw `RP_RETENTION_EXCEEDED` if any timestamp is older than `now - durationMs`.

`compareTargetSchema` must return:

```js
{
  warnings: [{ kind:'missing-field'|'extra-field'|'missing-tag'|'extra-tag', name }],
  conflicts: [{ name, sourceType, targetType }],
}
```

- [ ] **Step 6: Run plan tests**

Run: `node --test apps/bridge/bulk-plan.test.mjs`

Expected: all plan tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bridge/bulk-plan.mjs apps/bridge/bulk-plan.test.mjs
git commit -m "feat: add bulk generation plan validation"
```

---

### Task 2: Deterministic Field Generation and Constraint Solver

**Files:**
- Create: `apps/bridge/bulk-generator.mjs`
- Create: `apps/bridge/bulk-generator.test.mjs`

**Interfaces:**
- Consumes: normalized plan and target descriptors from `bulk-plan.mjs`.
- Produces: `createSeededRandom(seed)`, `compileConstraints(fields, constraints)`, `generatePoint(context)`, `encodeLineProtocol(point)`, `iteratePlanLines(plan, seed)`, and `batchLines(lines, maxBatchSize)`.

- [ ] **Step 1: Write failing deterministic and escaping tests**

```js
test('相同种子生成逐字节相同的 Line Protocol', () => {
  const plan = {
    targets:[{date:'2026-07-26',measurement:'cpu_1784995200',timestamps:[1784995200000]}],
    tags:[{name:'host',values:['node-01','node-02']}],
    fields:[{name:'value',type:'float',generator:{kind:'random-number',min:1,max:2}}],
    constraints:[],
  }
  const first = [...iteratePlanLines(plan, 'seed-1')]
  const second = [...iteratePlanLines(plan, 'seed-1')]
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, [...iteratePlanLines(plan, 'seed-2')])
})

test('按 Influx Line Protocol 转义并保留类型', () => {
  assert.equal(
    encodeLineProtocol({
      measurement:'cpu load',
      tags:{host:'node, 01'},
      fields:{count:{type:'integer',value:2}, ok:{type:'boolean',value:true}, note:{type:'string',value:'a"b'}},
      timestampMs:1784995200000,
    }),
    'cpu\\ load,host=node\\,\\ 01 count=2i,ok=true,note="a\\"b" 1784995200000',
  )
})
```

- [ ] **Step 2: Run the generator test and verify RED**

Run: `node --test apps/bridge/bulk-generator.test.mjs`

Expected: FAIL because `bulk-generator.mjs` does not exist.

- [ ] **Step 3: Implement seeded PRNG, basic generators, and encoding**

Use a string-to-32-bit hash plus Mulberry32; never use `Math.random()` inside task generation. Implement:

- float/integer fixed, uniform range, increment;
- string fixed/list;
- boolean fixed/probability;
- stable date, timestamp, and Tag Cartesian ordering;
- finite-number and integer checks;
- Line Protocol measurement, Tag, key, and string escaping.

- [ ] **Step 4: Write failing constraint tests**

Cover:

```js
test('AND 约束按拓扑顺序生成且每点满足条件', () => {
  const compiled = compileConstraints(
    [
      {name:'ttft_avg',type:'float',generator:{kind:'random-number',min:20,max:60}},
      {name:'latency_avg',type:'float',generator:{kind:'random-number',min:50,max:120}},
    ],
    [{left:'latency_avg',operator:'>',right:{kind:'field',field:'ttft_avg'}}],
  )
  for (let index=0; index<100; index += 1) {
    const values = compiled.generate(createSeededRandom(`seed-${index}`), index)
    assert.ok(values.latency_avg > values.ttft_avg)
  }
})

test('循环和空可行域在预览前失败', () => {
  const cyclicFields = [
    {name:'a',type:'float',generator:{kind:'random-number',min:0,max:10}},
    {name:'b',type:'float',generator:{kind:'random-number',min:0,max:10}},
  ]
  assert.throws(() => compileConstraints(cyclicFields, [
    {left:'a',operator:'>',right:{kind:'field',field:'b'}},
    {left:'b',operator:'>=',right:{kind:'field',field:'a'}},
  ]), /CONSTRAINT_UNSATISFIABLE/)
})
```

Also test numeric six operators, string/boolean `=` and `!=`, type mismatch, self-reference, singleton `!=`, and integer strict-bound rounding.

- [ ] **Step 5: Implement the dependency graph and feasible-domain generation**

Compile edges from right Field to left Field, topologically sort, and reject cycles. For each dependent Field:

- intersect configured numeric range with strict/inclusive bounds;
- copy the right value for equality;
- exclude the right value for inequality;
- intersect string/boolean candidate sets;
- preserve integer semantics with `Math.floor`/`Math.ceil` at strict boundaries.

Do not implement rejection sampling that silently drops points.

- [ ] **Step 6: Write and pass batching tests**

Assert `batchLines(iterator, 1000)` emits sizes `[1000, 1000, remainder]`, never builds all lines first, and rejects a non-positive batch size.

Run: `node --test apps/bridge/bulk-generator.test.mjs`

Expected: all generator tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bridge/bulk-generator.mjs apps/bridge/bulk-generator.test.mjs
git commit -m "feat: add deterministic constrained data generator"
```

---

### Task 3: Influx Metadata, RP-Aware Writes, and Keep-Alive

**Files:**
- Modify: `apps/bridge/influx-client.mjs`
- Modify: `apps/bridge/influx-client.test.mjs`

**Interfaces:**
- Produces: `listRetentionPolicies(config, database)`, `listTagValues(config, database, measurement, tag, limit)`, `influxWrite(config, database, lineProtocol, {precision, retentionPolicy, signal})`, `InfluxHttpError`, and `closeInfluxAgents()`.
- Consumes: existing `influxQuery`, Basic Auth session config, and native `http`/`https`.

- [ ] **Step 1: Extend the fixture and write failing metadata tests**

Add fixture responses for:

```text
SHOW RETENTION POLICIES ON "monitoring"
SHOW TAG VALUES FROM "cpu_1784995200" WITH KEY = "host" LIMIT 1001
```

Assert:

```js
assert.deepEqual(await listRetentionPolicies(config, 'monitoring'), [
  {name:'autogen',durationMs:604800000,isDefault:true},
])
assert.deepEqual(await listTagValues(config,'monitoring','cpu_1784995200','host',1000), {
  values:['node-01','node-02'],
  truncated:false,
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test apps/bridge/influx-client.test.mjs`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement safe InfluxQL quoting and metadata parsers**

Add one identifier-quoting helper and parse duration strings into milliseconds. Handle `0s` as `0`. Query Tag values with `LIMIT limit + 1`, return only `limit`, and set `truncated`.

- [ ] **Step 4: Write failing RP write and error tests**

Assert a write request contains:

```text
/write?db=monitoring&rp=autogen&precision=ms
```

Assert HTTP 429 becomes:

```js
error instanceof InfluxHttpError
error.statusCode === 429
error.retryable === true
```

Assert HTTP 400 is not retryable and an aborted signal destroys the request.

- [ ] **Step 5: Implement Keep-Alive agents and typed errors**

Create one HTTP and one HTTPS agent with:

```js
new http.Agent({keepAlive:true,maxSockets:2})
new https.Agent({keepAlive:true,maxSockets:2})
```

Pass the HTTP agent for `http:` endpoints and the HTTPS agent for `https:` endpoints, together with the optional `signal`, into `transport.request`. Preserve the existing HTTPS-to-HTTP diagnostic. Add `closeInfluxAgents()` for Bridge shutdown. Keep `influxWrite(config, database, lineProtocol)` valid for the existing manual `WRITE` path by defaulting options to `{precision:'ns'}`; bulk jobs pass `{precision:'ms', retentionPolicy, signal}` explicitly.

- [ ] **Step 6: Run the full Influx client tests**

Run: `node --test apps/bridge/influx-client.test.mjs`

Expected: all tests PASS, including existing query/write behavior.

- [ ] **Step 7: Commit**

```bash
git add apps/bridge/influx-client.mjs apps/bridge/influx-client.test.mjs
git commit -m "feat: extend influx client for bounded bulk writes"
```

---

### Task 4: Single-Job State Machine, Retry, Resume, and Cancel

**Files:**
- Create: `apps/bridge/bulk-jobs.mjs`
- Create: `apps/bridge/bulk-jobs.test.mjs`

**Interfaces:**
- Consumes: `iteratePlanLines`, `batchLines`, and an injected async `writeBatch`.
- Produces: `createBulkJobManager({writeBatch, now, sleep, randomJitter})` with methods `start`, `active`, `get`, `resume`, `cancel`, and `shutdown`.

- [ ] **Step 1: Write a failing success-path scheduling test**

Use an injected writer that records `{measurement, batchIndex, body}`. Assert:

- dates execute in ascending order;
- no date starts before the previous date finishes;
- at most two promises are active;
- every batch is at most 1000 lines;
- terminal status is `succeeded`.

- [ ] **Step 2: Run the state-machine test and verify RED**

Run: `node --test apps/bridge/bulk-jobs.test.mjs`

Expected: FAIL because `bulk-jobs.mjs` does not exist.

- [ ] **Step 3: Implement immutable snapshots and bounded scheduling**

Each public status snapshot must include:

```js
{
  id,
  connectionIdentity,
  status,
  currentMeasurement,
  completedPoints,
  totalPoints,
  completedBatches,
  totalBatches,
  retryCount,
  lastError,
  startedAt,
  updatedAt,
}
```

Do not expose the seed, write config, full batch bodies, or credentials.

- [ ] **Step 4: Write failing retry/pause/resume tests**

Test:

- retryable failures sleep for 250, 500, and 1000ms plus injected jitter;
- the fourth failed attempt pauses the job;
- a later in-flight batch may finish and is recorded;
- `resume(id)` retries the failed batch and skips the completed set;
- byte bodies before and after resume are identical;
- non-retryable 400 produces `failed`;
- starting a second unfinished job throws `BULK_JOB_ACTIVE`.

- [ ] **Step 5: Implement retry classification and completed-batch tracking**

Store completed batch keys as `${dateIndex}:${batchIndex}`. On pause, stop scheduling, await in-flight writes, and retain normalized plan and seed in memory. `resume` is valid only for `paused`.

- [ ] **Step 6: Write failing cancel and shutdown tests**

Assert:

- `cancel` is idempotent;
- cancelling stops new scheduling;
- in-flight writes receive an AbortSignal;
- final status is `cancelled`;
- `shutdown` cancels and resolves within its injected timeout.

- [ ] **Step 7: Implement cancel and shutdown**

Use one job-level `AbortController` plus a scheduling flag. Never mark already acknowledged writes as undone.

- [ ] **Step 8: Run state-machine tests**

Run: `node --test apps/bridge/bulk-jobs.test.mjs`

Expected: all state-machine tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/bridge/bulk-jobs.mjs apps/bridge/bulk-jobs.test.mjs
git commit -m "feat: add bulk write job state machine"
```

---

### Task 5: Preview Cache and Bulk API Router

**Files:**
- Create: `apps/bridge/bulk-api.mjs`
- Create: `apps/bridge/bulk-api.test.mjs`

**Interfaces:**
- Consumes: plan functions, generator functions, Influx metadata functions, and job manager.
- Produces: `createBulkApi({jobManager, influx, now, randomUUID})` with `handle({method, pathname, searchParams, session, payload})`.

- [ ] **Step 1: Write failing authorization and preview tests**

Assert:

- `prod`, `dev`, missing environment, and read-only sessions return the corresponding error code;
- a valid test session returns exactly 20 stable sample rows plus Line Protocol;
- point/RP/Schema blockers produce `BULK_PLAN_INVALID`;
- one preview has a 15-minute expiry and opaque `previewId`.

Use a session fixture:

```js
const session = {
  endpoint:'http://127.0.0.1:8635',
  username:'rwuser',
  environment:'test',
  readOnly:false,
}
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `node --test apps/bridge/bulk-api.test.mjs`

Expected: FAIL because `bulk-api.mjs` does not exist.

- [ ] **Step 3: Implement preview orchestration**

The preview handler must:

1. assert the session;
2. fetch tables, RP list, source Schema, and existing target Schemas;
3. normalize and validate the plan;
4. create a seed and normalized remote-state fingerprint;
5. generate 20 samples;
6. store one preview per connection identity with 15-minute expiry.

Return `422` errors as data from the router:

```js
{status:422,body:{code:'BULK_PLAN_INVALID',message:'生成计划不可执行',details:{issues}}}
```

- [ ] **Step 4: Write failing create/revalidate/status tests**

Assert:

- wrong typed prefix is rejected;
- missing future/overwrite acknowledgement is rejected only when required;
- changed RP, source Schema, or target existence returns `STALE_BULK_PREVIEW`;
- a valid preview starts a job;
- `GET active`, `GET id`, `POST resume`, and `POST cancel` enforce connection identity.

- [ ] **Step 5: Implement execution and control routes**

Map these exact paths:

```text
POST /bulk-jobs/preview
POST /bulk-jobs
GET  /bulk-jobs/active
GET  /bulk-jobs/:id
POST /bulk-jobs/:id/resume
POST /bulk-jobs/:id/cancel
```

Return `null` from `handle` when a path does not belong to the bulk API so `server.mjs` can continue existing routing.

- [ ] **Step 6: Run API tests**

Run: `node --test apps/bridge/bulk-api.test.mjs`

Expected: all API tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bridge/bulk-api.mjs apps/bridge/bulk-api.test.mjs
git commit -m "feat: add bulk generation bridge api"
```

---

### Task 6: Integrate Bulk Routes into the Bridge Server

**Files:**
- Modify: `apps/bridge/server.mjs`
- Create: `apps/bridge/server-body.mjs`
- Create: `apps/bridge/server-body.test.mjs`

**Interfaces:**
- Consumes: `createBulkApi`, `createBulkJobManager`, extended Influx client, and existing session/auth helpers.
- Produces: live Bridge routes and coordinated shutdown.

- [ ] **Step 1: Write a failing 1 MiB body-reader test**

Export `readJsonBody(request, maxBytes = 1_048_576)` from `apps/bridge/server-body.mjs`. Assert:

- valid JSON under the limit parses;
- malformed JSON returns `INVALID_JSON`;
- more than 1 MiB returns `REQUEST_BODY_TOO_LARGE` without buffering the rest.

- [ ] **Step 2: Run the body test and verify RED**

Run: `node --test apps/bridge/server-body.test.mjs`

Expected: FAIL because the bounded body reader is not available.

- [ ] **Step 3: Implement bounded request parsing and session environment**

Extend login transport to accept only `prod`, `test`, or `dev`; missing/invalid values become `dev`. Store `environment` in the server-side session. Keep passwords only in memory as today.

- [ ] **Step 4: Wire the job manager and route dispatcher**

Instantiate one global manager and API. After existing unauthenticated `/health` and `/login`, obtain the session, parse POST bodies with `readJsonBody`, call `bulkApi.handle`, and send its result before existing query/Claude routing. Replace the old unbounded `body()` calls for `/query`, `/ask`, and `/claude/probe` with the same 1 MiB reader.

- [ ] **Step 5: Coordinate shutdown**

On shutdown:

1. stop accepting new HTTP requests;
2. call `bulkJobManager.shutdown({timeoutMs:1000})`;
3. call `closeInfluxAgents()`;
4. exit through the existing 1500ms fail-safe.

- [ ] **Step 6: Run all Bridge tests**

Run: `npm run test:bridge`

Expected: all existing and new Bridge/script tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bridge/server.mjs apps/bridge/server-body.mjs apps/bridge/server-body.test.mjs
git commit -m "feat: expose bulk jobs through bridge server"
```

---

### Task 7: Frontend Contracts, Eligibility, Draft, and History

**Files:**
- Create: `apps/web/src/bulk-data.ts`
- Create: `apps/web/src/bulk-data.test.mjs`
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/day-tables.ts`
- Modify: `apps/web/src/day-tables.test.mjs`

**Interfaces:**
- Produces TypeScript types `BulkDraft`, `BulkPlanRequest`, `BulkPreview`, `BulkJobStatus`, `BulkHistoryItem`, `BulkIssue`, and `BulkWizardStep`.
- Produces functions `bulkEntryState(context)`, `estimateBulkDraft(draft)`, `loadBulkDraft()`, `saveBulkDraft(draft)`, `clearBulkDraft()`, `loadBulkHistory()`, `appendBulkHistory(item)`, `copyHistoryToDraft(item)`, and `stepForBulkError(code)`.
- Consumes: generic `load`/`save` from `storage.ts` and `Connection` from `types.ts`.

- [ ] **Step 1: Write failing eligibility tests**

```js
test('只有测试环境可写连接启用入口', () => {
  assert.equal(bulkEntryState({connection:{environment:'test',readOnly:false},connected:true,database:'db'}).enabled,true)
  assert.match(bulkEntryState({connection:{environment:'prod',readOnly:false},connected:true,database:'db'}).reason,/测试环境/)
  assert.match(bulkEntryState({connection:{environment:'test',readOnly:true},connected:true,database:'db'}).reason,/只读/)
})
```

- [ ] **Step 2: Run the web-domain test and verify RED**

Run: `node --test apps/web/src/bulk-data.test.mjs`

Expected: FAIL because `bulk-data.ts` does not exist.

- [ ] **Step 3: Define exact frontend contracts and eligibility**

Use discriminated unions for generators:

```ts
export type TagGenerator =
  | {kind:'list';values:string[]}
  | {kind:'sequence';prefix:string;start:number;count:number;padding:number}
  | {kind:'existing';values:string[];truncated:boolean}

export type FieldGenerator =
  | {kind:'fixed';value:string|number|boolean}
  | {kind:'random-number';min:number;max:number}
  | {kind:'increment';start:number;step:number}
  | {kind:'string-list';values:string[]}
  | {kind:'random-boolean';truePercent:number}
```

Mirror the API response names exactly; do not introduce a second naming vocabulary.

Export `dayTablePrefix(name)` from `day-tables.ts` so `App.tsx`, the catalog, and the wizard share the same `_<10 digit seconds>` parsing rule. Task 9 replaces the private `splitTable` prefix branch in `App.tsx` with this function.

- [ ] **Step 4: Write failing storage and estimate tests**

Assert:

- draft key is `gdb.bulkData.draft.v1`;
- history key is `gdb.bulkData.history.v1`;
- history is capped at 20 newest entries;
- copied history removes `jobId`, status, seed, progress, and preview;
- instantaneous estimates reject date 8 and calculate points/series;
- error codes map to steps 1 through 4.

- [ ] **Step 5: Implement versioned storage and pure estimates**

Store:

```ts
type StoredBulkDraft = {version:1;savedAt:number;draft:BulkDraft}
type StoredBulkHistory = {version:1;items:BulkHistoryItem[]}
```

Invalid versions return no draft/history rather than throwing.

- [ ] **Step 6: Run the focused web test**

Run: `node --test apps/web/src/bulk-data.test.mjs apps/web/src/day-tables.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/bulk-data.ts apps/web/src/bulk-data.test.mjs apps/web/src/types.ts apps/web/src/day-tables.ts apps/web/src/day-tables.test.mjs
git commit -m "feat: add bulk generation frontend model"
```

---

### Task 8: Frontend API Client

**Files:**
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/bulk-api-client.test.mjs`

**Interfaces:**
- Consumes: types from `bulk-data.ts`.
- Produces: `bridge.retentionPolicies`, `bridge.tagValues`, `bridge.previewBulkJob`, `bridge.createBulkJob`, `bridge.activeBulkJob`, `bridge.bulkJob`, `bridge.resumeBulkJob`, and `bridge.cancelBulkJob`.

- [ ] **Step 1: Write a failing source/API contract test**

Follow the repository's source-level contract-test style to assert exact methods and routes, including URL encoding for Database, measurement, and Tag.

- [ ] **Step 2: Run and verify RED**

Run: `node --test apps/web/src/bulk-api-client.test.mjs`

Expected: FAIL because the bridge methods are absent.

- [ ] **Step 3: Add the typed API methods**

Use:

```ts
previewBulkJob: (plan:BulkPlanRequest, signal?:AbortSignal) =>
  request<BulkPreview>('/bulk-jobs/preview', {
    method:'POST',
    body:JSON.stringify(plan),
    signal,
  })
```

Use the same `BridgeError` handling as existing endpoints.

Extend `bridge.login` to require `environment: 'prod'|'test'|'dev'`. Task 9 passes `currentConnection.environment ?? 'dev'` from the existing `connect` function.

- [ ] **Step 4: Run API client and TypeScript checks**

Run:

```text
node --test apps/web/src/bulk-api-client.test.mjs
npm run check
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/bulk-api-client.test.mjs
git commit -m "feat: add bulk generation web api client"
```

---

### Task 9: Wizard Shell, Top Entry, Target, and Time Steps

**Files:**
- Create: `apps/web/src/BulkDataWizard.tsx`
- Create: `apps/web/src/bulk-data.css`
- Create: `apps/web/src/bulk-wizard-structure.test.mjs`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: current `Connection`, current Database, tables, Schema resolver, bulk frontend model, and Bridge API.
- Produces: `BulkDataWizard` props:

```ts
type BulkDataWizardProps = {
  open: boolean
  connection: Connection
  database: string
  tables: string[]
  activeJob: BulkJobStatus | null
  onClose(): void
  onJobChange(job: BulkJobStatus | null): void
  onNotify(message: string): void
}
```

- [ ] **Step 1: Write a failing structure test**

Assert source structure includes:

- a topbar entry immediately after the Database switcher;
- no sidebar duplicate;
- a 24px feature grouping margin;
- four step labels exactly `目标与 RP`, `时间与天表`, `字段与约束`, `预览与执行`;
- `BulkDataWizard` imported rather than defined inline in `App.tsx`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test apps/web/src/bulk-wizard-structure.test.mjs`

Expected: FAIL because the component and entry do not exist.

- [ ] **Step 3: Implement top-entry composition**

In `App.tsx`:

- derive `bulkEntryState`;
- pass `currentConnection.environment ?? 'dev'` to `bridge.login`;
- replace the private prefix parsing branch with `dayTablePrefix`;
- render the outlined icon/text button after `.database-switcher`;
- use `margin-left:24px`;
- show disabled reason in `title`;
- open the wizard or current job.

Do not add generator state variables to `App.tsx`.

- [ ] **Step 4: Implement the modal shell and step navigation**

Create an accessible `role="dialog"` with:

- left navigation and “最近任务” at the bottom;
- header, close/minimize button, scrollable body, and fixed footer;
- Back/Next actions;
- light/dark tokens derived from existing CSS variables;
- Microsoft YaHei UI/Segoe UI-compatible form typography.

- [ ] **Step 5: Implement step 1**

Display current connection and Database as fixed context. Group tables by the existing ten-digit suffix convention, select one prefix, default the Schema source to the newest sibling table, fetch RP options, and display RP duration and Schema drift results.

- [ ] **Step 6: Implement step 2**

Add:

- “最近 N 天” with `1..7`;
- one “指定日期” calendar supporting up to 7 dates;
- daily start/end;
- preset/custom interval;
- target rows with `已存在` or `待创建`;
- point and series estimates;
- future-date warning.

Use the existing day-table naming rule rather than duplicating a different regex.

- [ ] **Step 7: Run structure tests and TypeScript**

Run:

```text
node --test apps/web/src/bulk-wizard-structure.test.mjs
npm run check
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/BulkDataWizard.tsx apps/web/src/bulk-data.css apps/web/src/bulk-wizard-structure.test.mjs apps/web/src/App.tsx apps/web/src/main.tsx
git commit -m "feat: add bulk generation target and time workflow"
```

---

### Task 10: Tag, Field, Constraints, and Deterministic Preview UI

**Files:**
- Modify: `apps/web/src/BulkDataWizard.tsx`
- Modify: `apps/web/src/bulk-data.css`
- Create: `apps/web/src/bulk-field-ui.test.mjs`

**Interfaces:**
- Consumes: Schema, Tag-value API, `BulkDraft`, and preview API.
- Produces: complete step 3 and step 4 pre-execution experience.

- [ ] **Step 1: Write failing UI-contract tests**

Assert:

- Tag modes are list, sequence, and existing values;
- float/integer, string, and boolean expose only their allowed generator modes;
- numeric operators are six symbols;
- string/boolean operators are only `=` and `≠`;
- the operator is not a native `<select className="constraint-operator">`;
- the custom menu uses a centered symbol and separate chevron;
- no em-dash parameter placeholder remains.

- [ ] **Step 2: Run and verify RED**

Run: `node --test apps/web/src/bulk-field-ui.test.mjs`

Expected: FAIL because field configuration is absent.

- [ ] **Step 3: Implement Tag and Field editors**

Render every Schema Tag and Field. Change the parameter form when the generator kind changes. For loaded Tag values:

- call `bridge.tagValues`;
- show value count;
- block accepting a truncated 1000-value result until the user reduces it.

- [ ] **Step 4: Implement the custom operator picker**

Use a button/popover component with:

- fixed 72px trigger width;
- symbol absolutely centered;
- arrow independently positioned on the right;
- two-column option panel centered on the trigger;
- `aria-haspopup="listbox"`, `aria-expanded`, Escape, outside-click close, and keyboard selection.

- [ ] **Step 5: Implement constraints and frontend feedback**

All rows are AND. Changing the left Field filters operators and right-side Fields to compatible types. Immediate frontend estimates may disable Preview, but Bridge preview remains authoritative.

- [ ] **Step 6: Implement step 4 preview**

Call `previewBulkJob`; display:

- target/RP/date summaries;
- existing/pending targets;
- points and worst-case new series;
- Tag/Field/constraint summaries;
- 20-row table;
- collapsible Line Protocol;
- warnings and blockers;
- typed-prefix, overwrite, and future confirmations.

Any draft edit after a successful preview must clear `previewId` and require a new preview.

- [ ] **Step 7: Run focused tests and build**

Run:

```text
node --test apps/web/src/bulk-field-ui.test.mjs
npm run check
npm run build
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/BulkDataWizard.tsx apps/web/src/bulk-data.css apps/web/src/bulk-field-ui.test.mjs
git commit -m "feat: add bulk generators constraints and preview"
```

---

### Task 11: Execution Progress, Draft, History, and Application Close Guard

**Files:**
- Modify: `apps/web/src/BulkDataWizard.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/desktop.ts`
- Create: `apps/web/src/app-close.ts`
- Create: `apps/web/src/app-close.test.mjs`
- Create: `apps/web/src/bulk-job-polling.test.mjs`

**Interfaces:**
- Consumes: job API, draft/history helpers, Tauri `getCurrentWindow`.
- Produces: one-second polling, minimization, notifications, stop confirmation, and guarded close.

- [ ] **Step 1: Write failing polling and close-state tests**

Test pure helpers:

```ts
export function isUnfinishedBulkJob(status?:BulkJobStatus['status']) {
  return ['queued','running','retrying','paused','cancelling'].includes(status ?? '')
}

export function nextPollDelay(status:BulkJobStatus['status']) {
  return isUnfinishedBulkJob(status) ? 1000 : null
}
```

Assert terminal states stop polling and paused state still guards application close.

- [ ] **Step 2: Run and verify RED**

Run:

```text
node --test apps/web/src/app-close.test.mjs
node --test apps/web/src/bulk-job-polling.test.mjs
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement execution and one-second polling**

After `createBulkJob`:

- switch to progress;
- poll the exact job ID every 1000ms;
- prevent overlapping polls;
- update `App.tsx` active-job summary;
- stop on terminal status;
- append one history item exactly once.

- [ ] **Step 4: Implement pause, resume, stop, and minimize**

- `paused` shows last error and “从失败批次继续”;
- stop opens an in-app confirmation;
- confirmed stop calls the idempotent cancel API;
- close button minimizes during an unfinished job;
- top entry displays rounded percent and reopens progress.

- [ ] **Step 5: Implement draft and history UI**

- debounce draft saves;
- prompt to continue/discard on open;
- revalidate all resumed drafts;
- show 20 history summaries in the left-side history view;
- “复制为新任务” removes execution state and creates a new preview later.

- [ ] **Step 6: Implement desktop and web close guards**

In `desktop.ts`, wrap:

```ts
getCurrentWindow().onCloseRequested(event => {
  if (!shouldGuard()) return
  event.preventDefault()
  onGuardedClose()
})
```

On “停止任务并退出”:

1. call cancel;
2. poll until terminal or 3 seconds;
3. call `getCurrentWindow().destroy()`.

For Web mode, register `beforeunload` only while a job is unfinished.

- [ ] **Step 7: Run focused and full web checks**

Run:

```text
node --test apps/web/src/app-close.test.mjs apps/web/src/bulk-job-polling.test.mjs
npm run test:web
npm run check
npm run build
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/BulkDataWizard.tsx apps/web/src/App.tsx apps/web/src/desktop.ts apps/web/src/app-close.ts apps/web/src/app-close.test.mjs apps/web/src/bulk-job-polling.test.mjs
git commit -m "feat: add bulk job lifecycle and close protection"
```

---

### Task 12: Browser Workflow Tests with a Fixture Bridge

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/fixtures/bulk-bridge.mjs`
- Create: `tests/e2e/bulk-data.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: built frontend behavior and documented Bridge JSON contracts.
- Produces: `npm run test:e2e`.

- [ ] **Step 1: Add Playwright and the failing E2E script**

Run:

```text
npm install --save-dev @playwright/test
npx playwright install chromium
```

Add root script:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Create the fixture Bridge**

The fixture must listen on `127.0.0.1:8790` and implement deterministic responses for login, databases, tables, Schema, RP, Tag values, preview, create, status progression, pause/resume, and cancel. It must reject non-local origins using the same expected policy.

- [ ] **Step 3: Configure Playwright web servers**

Use two `webServer` entries:

```ts
webServer: [
  {command:'node tests/e2e/fixtures/bulk-bridge.mjs',port:8790,reuseExistingServer:false},
  {command:'npm run dev:web',port:8791,reuseExistingServer:false},
]
```

Set Chromium viewport to `1440x900`.

- [ ] **Step 4: Write the first failing full-flow test**

Test:

1. create and connect a connection marked `test`;
2. verify the top entry follows Database with visual spacing;
3. complete four steps;
4. choose 7 non-contiguous dates;
5. configure Tag sequence and numeric constraint;
6. inspect table and Line Protocol preview;
7. type the prefix and start;
8. minimize and reopen via top progress;
9. reach success and find the history item.

- [ ] **Step 5: Add safety and recovery scenarios**

Cover:

- prod/read-only entry disabled;
- eighth date cannot be selected;
- existing target requires overwrite confirmation;
- future target requires future confirmation;
- custom operator menu is centered within 1px of its trigger center using bounding boxes;
- paused task resumes;
- cancelled task sends no later fixture writes.

- [ ] **Step 6: Run E2E tests**

Run: `npm run test:e2e`

Expected: all Chromium tests PASS without retries.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e/fixtures/bulk-bridge.mjs tests/e2e/bulk-data.spec.ts
git commit -m "test: cover bulk generation browser workflow"
```

---

### Task 13: Release Metadata, Documentation, and Full Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `apps/bridge/server.mjs`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Create: `scripts/version-consistency.test.mjs`

**Interfaces:**
- Consumes: all completed implementation tasks.
- Produces: consistent `0.5.0` release metadata and user-facing documentation.

- [ ] **Step 1: Write a failing version-consistency check**

Create `scripts/version-consistency.test.mjs` to assert:

```text
package.json version = 0.5.0
package-lock.json root version = 0.5.0
src-tauri/Cargo.toml version = 0.5.0
src-tauri/tauri.conf.json version = 0.5.0
Bridge /health source version = 0.5.0
```

- [ ] **Step 2: Run the version check and verify RED**

Run: `node --test scripts/version-consistency.test.mjs`

Expected: FAIL because the repository still reports `0.4.10`.

- [ ] **Step 3: Update release versions and changelog**

Add a `0.5.0` changelog section covering:

- test-only environment gate;
- four-step wizard;
- 7-day and bounded point/series limits;
- Tag/Field generators and constraints;
- deterministic preview;
- background execution, pause/resume, cancel, close protection, draft, and history.

- [ ] **Step 4: Update README**

Document:

- how to mark a connection as test;
- what “待创建” means;
- RP and overwrite behavior;
- hard limits;
- no rollback and no cross-restart resume;
- new bulk API endpoints.

- [ ] **Step 5: Run complete verification**

Run in this order:

```text
npm run check
npm run test:web
npm run test:bridge
npm run build
npm run test:e2e
npm run build:sidecar
```

Expected: every command exits `0`.

- [ ] **Step 6: Perform desktop manual acceptance**

Run `npm run desktop` and verify:

1. entry layout at 1440×900 and minimum 1024×700;
2. light and dark themes;
3. a fixture or disposable GeminiDB test instance completes a bounded task;
4. closing during a task shows the custom desktop confirmation;
5. “停止任务并退出” leaves already written data and closes within 3 seconds;
6. restart shows history but does not offer task resume.

Record the tested connection as a disposable test environment; do not use production data.

- [ ] **Step 7: Review the final diff**

Run:

```text
git status --short
git diff --stat
git diff --check
```

Confirm no credentials, generated datasets, Playwright videos, screenshots, Bridge binaries, or unrelated edits are staged.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json apps/bridge/server.mjs CHANGELOG.md README.md scripts/version-consistency.test.mjs
git commit -m "release: prepare v0.5.0 bulk data generation"
```

---

## Execution Checkpoints

1. After Task 3, review GeminiDB metadata queries and RP-aware write compatibility against a disposable test instance.
2. After Task 6, review Bridge API/security/state-machine behavior before starting UI integration.
3. After Task 10, compare the real wizard against the approved v7 prototype and the design specification.
4. After Task 12, review browser evidence for light, dark, 1440×900, and 1024×700 layouts.
5. After Task 13, use `superpowers:verification-before-completion` before making any completion claim, then use `superpowers:finishing-a-development-branch` to choose merge/PR/cleanup.
