# Local Mock GeminiDB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-memory local InfluxDB 1.x HTTP substitute that exercises GeminiDB Studio's connection, catalog, query, write, and online-edit workflows without a paid GeminiDB instance.

**Architecture:** A standalone Node HTTP server delegates parsing and storage to a focused Mock engine module. The production Bridge remains unchanged and connects through its existing Influx client. Tests use an ephemeral port and the real Bridge client functions to prove contract compatibility.

**Tech Stack:** Node.js ESM, native `node:http`, Node test runner, existing Bridge Influx client

**Spec:** `docs/superpowers/specs/2026-08-19-local-mock-geminidb-design.md`

## Global Constraints

- Bind the runnable development server to `127.0.0.1:8765` by default.
- Keep all Mock data in memory and make no outbound requests.
- Accept only the fixed development credentials `demo` / `demo`.
- Do not reference the Mock from Tauri, sidecar packaging, desktop startup, or release workflows.
- Return explicit errors for unsupported InfluxQL rather than silently approximating it.

---

### Task 1: In-memory Line Protocol store

**Files:**
- Create: `scripts/mock-geminidb-engine.mjs`
- Create: `scripts/mock-geminidb-engine.test.mjs`

**Interfaces:**
- Produces: `createMockGeminiDbEngine({nowNs?})`
- Produces engine methods `write(database, body, {precision})`, `query(database, influxql, {epoch})`, and `snapshot()`.

- [ ] **Step 1: Write failing tests for typed Line Protocol and overwrite identity**

Cover escaped Measurement/tag/Field identifiers, strings, booleans, integer suffixes, finite floats, supported precisions, multi-line atomic validation, and merging Fields for an identical Measurement/timestamp/complete-tag identity.

- [ ] **Step 2: Run the focused test and confirm missing-module failure**

Run: `node --test scripts/mock-geminidb-engine.test.mjs`

Expected: FAIL because `mock-geminidb-engine.mjs` does not exist.

- [ ] **Step 3: Implement the minimal store and parser**

Use Maps keyed by database and Measurement. Normalize timestamps to exact nanosecond decimal strings and key points with:

```js
const identity=JSON.stringify([measurement,timestampNs,Object.entries(tags).sort()])
```

Validate every line before mutating the store so a malformed multi-line request writes nothing.

- [ ] **Step 4: Run focused tests**

Run: `node --test scripts/mock-geminidb-engine.test.mjs`

Expected: PASS.

### Task 2: Catalog and bounded SELECT compatibility

**Files:**
- Modify: `scripts/mock-geminidb-engine.mjs`
- Modify: `scripts/mock-geminidb-engine.test.mjs`

**Interfaces:**
- Consumes: Task 1 engine and point model.
- Produces: InfluxDB-compatible `{results:[{series?:...,error?:...}]}` payloads.

- [ ] **Step 1: Add failing query tests**

Test `SHOW DATABASES`, `SHOW MEASUREMENTS`, `SHOW FIELD KEYS`, `SHOW TAG KEYS`, `SHOW TAG VALUES`, `SHOW RETENTION POLICIES`, `INSERT`, and:

```sql
SELECT * FROM "cpu_1787068800"
WHERE time >= 1787068800000000000ns AND time <= 1787155199999999999ns
ORDER BY time DESC LIMIT 51 OFFSET 0
```

Assert exact `ns` timestamps, `ms` conversion, deterministic Field/tag columns, ordering, bounds, pagination, and a clear error for unsupported aggregation.

- [ ] **Step 2: Run the focused test and confirm query failures**

Run: `node --test scripts/mock-geminidb-engine.test.mjs`

Expected: FAIL on the first unsupported catalog query.

- [ ] **Step 3: Implement query dispatch and result encoding**

Parse only the grammar in the spec. Build series with `name`, `columns`, and `values`; return `{results:[{}]}` for successful writes and empty queries.

- [ ] **Step 4: Run focused tests**

Run: `node --test scripts/mock-geminidb-engine.test.mjs`

Expected: PASS.

### Task 3: HTTP development server and real Bridge contract test

**Files:**
- Create: `scripts/mock-geminidb.mjs`
- Create: `scripts/mock-geminidb-http.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createMockGeminiDbEngine`.
- Produces: `createMockGeminiDbServer({host,port,username,password,seed})` returning `{listen(), close(), address(), engine}`.
- Produces command: `npm run dev:mock`.

- [ ] **Step 1: Write failing HTTP tests**

Start on port `0`, assert Basic Auth rejection, health response, `/query`, `/write`, and an unsupported route. Then call the actual Bridge functions `listDatabases`, `listMeasurements`, `getMeasurementSchema`, `influxQuery`, `influxWrite`, `influxCommand`, `listRetentionPolicies`, and `listTagValues` against it.

- [ ] **Step 2: Run the focused HTTP test and confirm missing-module failure**

Run: `node --test scripts/mock-geminidb-http.test.mjs`

Expected: FAIL because `mock-geminidb.mjs` does not exist.

- [ ] **Step 3: Implement native HTTP routing and seed data**

Require `Authorization: Basic ZGVtbzpkZW1v`, cap request bodies, emit JSON with `Content-Type: application/json`, return 204 for successful `/write`, and seed database `monitoring` with a current day-table Measurement.

- [ ] **Step 4: Add the development command**

Add to root `package.json`:

```json
"dev:mock": "node scripts/mock-geminidb.mjs"
```

- [ ] **Step 5: Run focused tests**

Run: `node --test scripts/mock-geminidb-engine.test.mjs scripts/mock-geminidb-http.test.mjs`

Expected: PASS.

### Task 4: Documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `scripts/documentation-consistency.test.mjs`

**Interfaces:**
- Consumes: `npm run dev:mock`, `npm run dev:bridge`, and `npm run dev:web`.
- Produces: documented local connection parameters and limitations.

- [ ] **Step 1: Add a failing documentation assertion**

Require README text for `npm run dev:mock`, `http://127.0.0.1:8765`, `demo` credentials, in-memory lifecycle, and the statement that the Mock is excluded from formal runtime and cannot prove GeminiDB compatibility.

- [ ] **Step 2: Run the documentation test and confirm failure**

Run: `node --test scripts/documentation-consistency.test.mjs`

Expected: FAIL until README is updated.

- [ ] **Step 3: Document startup and safety boundaries**

Add a development-only section with exact PowerShell commands and connection form values. Keep production feature documentation separate from the Mock.

- [ ] **Step 4: Run complete automated verification**

Run:

```powershell
npm run check
npm run test:web
npm run test:bridge
npm run build
```

Expected: all checks pass; the existing large Monaco chunk warning is non-fatal.

- [ ] **Step 5: Run browser end-to-end verification**

Start Mock, Bridge, and Web. In Studio create the documented development connection, load `monitoring`, open the seeded Measurement, run a SELECT, execute one write, and query it back. Confirm browser console errors are empty and capture one final screenshot.

- [ ] **Step 6: Commit the completed feature**

```powershell
git add scripts/mock-geminidb*.mjs package.json README.md scripts/documentation-consistency.test.mjs docs/superpowers
git commit -m "feat: add local mock GeminiDB"
```
