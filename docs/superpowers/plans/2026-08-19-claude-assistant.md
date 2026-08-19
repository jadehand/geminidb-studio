# Lightweight Claude Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the database-capable Agent workbench with a local-Claude-CLI-only assistant that supports contextual chat, SQL diagnosis, and durable local history.

**Architecture:** A focused Bridge CLI adapter calls only the local `claude` executable. A file-backed assistant store owns conversation history, and a request/response HTTP API exposes CRUD and message submission without SSE, tools, API providers, or database execution. The query workspace hosts a right-side assistant drawer and supplies SQL, error, and schema only when the user explicitly attaches them.

**Tech Stack:** Node.js ESM Bridge, React 19, TypeScript, Tauri v2, Node test runner, existing Bridge bearer-session authentication.

**Spec:** `docs/superpowers/specs/2026-08-19-claude-assistant-design.md`

## Global Constraints

- Claude execution uses only the local `claude` CLI; there is no Anthropic API fallback.
- The assistant never receives Shell, file-system, database-query, write, or bulk-generation tools.
- SQL, error, and Schema context is attached only by explicit user selection or the diagnosis action.
- Passwords, bearer tokens, API keys, and complete connection addresses are never persisted or sent to Claude.
- Claude output may be copied or opened in a new query tab, but is never executed automatically.
- Existing Agent history remains on disk but is no longer read or deleted.
- Remove obsolete Agent UI, routes, orchestration, tools, provider API, tests, styles, types, and documentation references instead of leaving dead code.
- Keep `npm run check`, `npm run build`, `npm run test:web`, and `npm run test:bridge` green.

---

## File Structure

### Bridge

- Create `apps/bridge/claude-cli.mjs`: local CLI probe, chat execution, timeout/cancel/output-limit mapping, and prompt construction.
- Create `apps/bridge/claude-cli.test.mjs`: isolated CLI adapter contract tests.
- Create `apps/bridge/claude-assistant-store.mjs`: atomic file-backed session persistence and corruption isolation.
- Create `apps/bridge/claude-assistant-store.test.mjs`: CRUD, validation, atomicity, corruption, and redaction tests.
- Create `apps/bridge/claude-assistant-api.mjs`: authenticated request/response route handling and one-in-flight-message guard.
- Create `apps/bridge/claude-assistant-api.test.mjs`: route and ownership tests.
- Modify `apps/bridge/claude-diagnostics.mjs`: depend on `ClaudeCli`, retain the existing diagnosis response contract.
- Modify `apps/bridge/claude-diagnostics.test.mjs`: verify diagnosis delegates to the CLI adapter.
- Modify `apps/bridge/server.mjs`: initialize the new store/API and remove `/agent/*`, SSE, tools, orchestration, and API-provider wiring.

### Web

- Create `apps/web/src/claude-assistant-types.ts`: focused session, message, attachment, and probe types.
- Create `apps/web/src/claude-assistant-api.ts`: bearer-authenticated CRUD, send, and cancellation client.
- Create `apps/web/src/claude-assistant-api.test.mjs`: URL, payload, structured-error, and token-redaction tests.
- Create `apps/web/src/ClaudeAssistantDrawer.tsx`: history, search, chat, attachment controls, diagnosis entry, Markdown/code actions, and delete confirmation.
- Create `apps/web/src/claude-assistant.css`: drawer, responsive layout, message, attachment, and confirmation styling.
- Create `apps/web/src/claude-assistant-ui.test.mjs`: structural and interaction contract tests.
- Modify `apps/web/src/App.tsx`: remove Agent workspace, host the assistant drawer, provide explicit context, and open returned SQL in a new query tab.
- Modify `apps/web/src/diagnostic-provider.ts`: remove API-provider vocabulary and use the local CLI routes.
- Modify `apps/web/src/types.ts`: remove Agent/API settings and retain the diagnosis model.
- Modify relevant workspace, onboarding, learning-center, and app tests to assert the new entry and removal of Agent navigation.

### Removal and documentation

- Delete `apps/bridge/agent-*.mjs` and matching `agent-*.test.mjs` files after replacement coverage exists.
- Delete `apps/web/src/Agent*.tsx`, `agent-api.ts`, `agent-types.ts`, `agent-workbench.css`, and matching Agent tests.
- Modify `README.md`, `CHANGELOG.md`, `docs/architecture/overview.md`, learning-center content/tests, and release consistency tests to describe the local Claude assistant.

---

### Task 1: Local Claude CLI Adapter

**Files:**
- Create: `apps/bridge/claude-cli.mjs`
- Create: `apps/bridge/claude-cli.test.mjs`
- Reference: `apps/bridge/agent-providers.mjs`
- Reference: `apps/bridge/server.mjs`

**Interfaces:**
- Produces: `createClaudeCli({ runProcess, command = 'claude', timeoutMs = 90000, maxOutputBytes = 1048576 })`.
- Produces: `probe({ cliPath? }) -> Promise<{ready, kind, version, message}>`.
- Produces: `chat({ messages, attachments, signal, cliPath? }) -> Promise<{content, usage}>`.
- Produces: `ClaudeCliError` with `status`, `code`, and safe `message`.
- Consumes: `runProcess(command, args, input, timeoutMs, signal)` already available in `server.mjs`.

- [ ] **Step 1: Write failing adapter tests**

```js
test('chat invokes only the local claude executable without tools or API settings', async () => {
  const calls=[]
  const cli=createClaudeCli({runProcess:async (...args)=>{calls.push(args);return '回答'}})
  const result=await cli.chat({
    messages:[{role:'user',content:'解释这个查询'}],
    attachments:{sql:'SELECT * FROM cpu',error:'',schema:null}
  })
  assert.equal(result.content,'回答')
  assert.equal(calls[0][0],'claude')
  assert.equal(calls[0][1].includes('--print'),true)
  assert.equal(JSON.stringify(calls[0]).includes('tools'),false)
})
```

Add tests for CLI version/authentication probe, explicit attachment serialization, absent attachments, cancellation, timeout, output limit, invalid message roles, and sensitive-key redaction.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test apps/bridge/claude-cli.test.mjs`

Expected: FAIL because `claude-cli.mjs` does not exist.

- [ ] **Step 3: Implement the minimal CLI adapter**

Implement immutable limits, strict plain-object validation, a prompt builder with separate `conversation` and `attachments` sections, and safe error mapping:

```js
export function createClaudeCli({runProcess,command='claude',timeoutMs=90000,maxOutputBytes=1048576}) {
  return {
    async probe({cliPath=command}={}) { /* --version and auth status */ },
    async chat({messages,attachments={},signal,cliPath=command}) {
      const prompt=buildChatPrompt(messages,attachments)
      const content=await runProcess(cliPath,['--print','--output-format','text'],prompt,timeoutMs,signal)
      return {content:validateOutput(content,maxOutputBytes),usage:{}}
    }
  }
}
```

Do not import the Agent provider, fetch, API keys, model tools, or database clients.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test apps/bridge/claude-cli.test.mjs`

Expected: all Claude CLI adapter tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/bridge/claude-cli.mjs apps/bridge/claude-cli.test.mjs
git commit -m "feat: add local Claude CLI adapter"
```

### Task 2: Durable Assistant History Store

**Files:**
- Create: `apps/bridge/claude-assistant-store.mjs`
- Create: `apps/bridge/claude-assistant-store.test.mjs`
- Reference: `apps/bridge/agent-store.mjs`

**Interfaces:**
- Produces: `createClaudeAssistantStore({ dataDir, now = Date.now, randomUUID })`.
- Produces methods: `init()`, `list(ownerId)`, `create(ownerId,{title})`, `get(ownerId,id)`, `rename(ownerId,id,title)`, `append(ownerId,id,message)`, and `remove(ownerId,id)`.
- Produces message shape: `{id, role:'user'|'assistant', content, createdAt, attachments?}`.
- Consumes: owner identity derived from the current Bridge bearer session, never a caller-supplied owner field.

- [ ] **Step 1: Write failing persistence tests**

```js
test('persists sessions and messages without credentials', async () => {
  const first=createClaudeAssistantStore({dataDir,randomUUID:ids.shift.bind(ids)})
  await first.init()
  const session=await first.create('owner-1',{title:'查询诊断'})
  await first.append('owner-1',session.id,{
    role:'user',content:'看看这个 SQL',attachments:{sql:'SELECT 1',error:'',schema:null}
  })
  const second=createClaudeAssistantStore({dataDir})
  await second.init()
  assert.equal((await second.get('owner-1',session.id)).messages.length,1)
  assert.equal(JSON.stringify(await second.get('owner-1',session.id)).includes('password'),false)
})
```

Cover owner isolation, title/message/attachment limits, invalid roles, atomic temporary-file replacement, malformed-index recovery, per-session corruption quarantine, newest-first summaries, search-ready titles, and delete behavior.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test apps/bridge/claude-assistant-store.test.mjs`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the store**

Use `claude-assistant/index.json` plus `claude-assistant/sessions/<uuid>.json`. Validate all parsed JSON before returning it. Write a sibling temporary file and rename it over the destination. Quarantine corrupt files with a timestamped `.corrupt` suffix. Keep the existing `agent` directory untouched.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test apps/bridge/claude-assistant-store.test.mjs`

Expected: all store tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/bridge/claude-assistant-store.mjs apps/bridge/claude-assistant-store.test.mjs
git commit -m "feat: persist Claude assistant history"
```

### Task 3: Claude Assistant HTTP API

**Files:**
- Create: `apps/bridge/claude-assistant-api.mjs`
- Create: `apps/bridge/claude-assistant-api.test.mjs`
- Modify: `apps/bridge/claude-diagnostics.mjs`
- Modify: `apps/bridge/claude-diagnostics.test.mjs`

**Interfaces:**
- Consumes: `store` from Task 2 and `cli` from Task 1.
- Produces: `createClaudeAssistantApi({store,cli,diagnostics})` with `handle({pathname,method,session,body,signal})`.
- Produces routes under `/claude/sessions` and retains the diagnosis response shape `{summary, explanation, fixedSql, diff, warnings, usage}`.

- [ ] **Step 1: Write failing API tests**

```js
test('message submission persists the user message and assistant reply', async () => {
  const api=createClaudeAssistantApi({store,cli:{chat:async()=>({content:'建议',usage:{}})},diagnostics})
  const result=await api.handle({
    pathname:`/claude/sessions/${id}/messages`,method:'POST',session:{identity:'owner-1'},
    body:{content:'帮我解释',attachments:{sql:'SELECT 1'}}
  })
  assert.equal(result.status,200)
  assert.deepEqual(result.payload.messages.map(message=>message.role),['user','assistant'])
})
```

Cover CRUD, owner isolation, duplicate in-flight submissions for one session, retry after failure, cancellation, missing session, malformed route IDs, context limits, and server-derived owner identity.

- [ ] **Step 2: Run focused API/diagnosis tests and confirm RED**

Run: `node --test apps/bridge/claude-assistant-api.test.mjs apps/bridge/claude-diagnostics.test.mjs`

Expected: assistant API module missing or diagnostics still requiring the Agent provider.

- [ ] **Step 3: Implement request/response API and refactor diagnosis**

Message flow must append the user message first, call `cli.chat` with the stored conversation, and append an assistant message only after a valid response. `createClaudeDiagnostics` must depend on `{cli}` and use a fixed diagnosis prompt; remove API-provider error branches and preserve stable legacy error codes used by the UI.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test apps/bridge/claude-assistant-api.test.mjs apps/bridge/claude-diagnostics.test.mjs`

Expected: all assistant API and diagnosis tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/bridge/claude-assistant-api.mjs apps/bridge/claude-assistant-api.test.mjs apps/bridge/claude-diagnostics.mjs apps/bridge/claude-diagnostics.test.mjs
git commit -m "feat: add Claude assistant API"
```

### Task 4: Integrate Bridge and Remove Agent Backend

**Files:**
- Modify: `apps/bridge/server.mjs`
- Modify: `apps/bridge/server-body.test.mjs`
- Modify: relevant route-order tests in `apps/bridge/command-execution.test.mjs`
- Delete: `apps/bridge/agent-api.mjs`
- Delete: `apps/bridge/agent-api.test.mjs`
- Delete: `apps/bridge/agent-orchestrator.mjs`
- Delete: `apps/bridge/agent-orchestrator.test.mjs`
- Delete: `apps/bridge/agent-policy.mjs`
- Delete: `apps/bridge/agent-policy.test.mjs`
- Delete: `apps/bridge/agent-providers.mjs`
- Delete: `apps/bridge/agent-providers.test.mjs`
- Delete: `apps/bridge/agent-store.mjs`
- Delete: `apps/bridge/agent-store.test.mjs`
- Delete: `apps/bridge/agent-tools.mjs`
- Delete: `apps/bridge/agent-tools.test.mjs`
- Delete: `apps/bridge/agent-types.mjs`

**Interfaces:**
- Consumes: Tasks 1-3 modules.
- Produces: live `/claude/probe`, `/claude/diagnose`, and `/claude/sessions*` routes protected by the existing bearer session.
- Removes: every `/agent` and `/agent/*` route and Agent stream shutdown behavior.

- [ ] **Step 1: Add failing server wiring tests**

Assert source and route behavior:

```js
test('server exposes Claude assistant routes without Agent routes', () => {
  const source=readFileSync(new URL('./server.mjs',import.meta.url),'utf8')
  assert.match(source,/createClaudeAssistantApi/)
  assert.doesNotMatch(source,/createAgent|\/agent\//)
})
```

Add a health-contract assertion that no Agent readiness object is exposed.

- [ ] **Step 2: Run Bridge tests and confirm RED**

Run: `npm run test:bridge`

Expected: new removal/wiring assertions fail.

- [ ] **Step 3: Rewire `server.mjs` and delete obsolete backend files**

Initialize the assistant store under the existing `--data-dir`; dispatch `/claude/sessions*` before `/claude/diagnose`; reuse request abort signals; remove Agent store init, database tool assembly, SSE response tracking, API fetch provider, and Agent shutdown logic. Then delete the listed Agent files and fix imports.

- [ ] **Step 4: Run all Bridge tests and confirm GREEN**

Run: `npm run test:bridge`

Expected: all Bridge and script tests pass with no Agent modules loaded.

- [ ] **Step 5: Commit**

```powershell
git add -A apps/bridge
git commit -m "refactor: remove Agent backend"
```

### Task 5: Web Client and Focused Types

**Files:**
- Create: `apps/web/src/claude-assistant-types.ts`
- Create: `apps/web/src/claude-assistant-api.ts`
- Create: `apps/web/src/claude-assistant-api.test.mjs`
- Modify: `apps/web/src/diagnostic-provider.ts`
- Modify: `apps/web/src/types.ts`

**Interfaces:**
- Produces: `ClaudeAssistantSessionSummary`, `ClaudeAssistantSession`, `ClaudeAssistantMessage`, and `ClaudeAssistantAttachments`.
- Produces: `claudeAssistantApi` methods `listSessions`, `createSession`, `getSession`, `renameSession`, `deleteSession`, `sendMessage`, and `probe`.
- Consumes: existing Bridge base URL and bearer-token accessors from `apps/web/src/api.ts`.

- [ ] **Step 1: Write failing client tests**

```js
test('sendMessage posts only content and explicit attachments', async () => {
  const client=createClaudeAssistantClient({fetchImpl,getBase:()=>'/api',getToken:()=> 'token'})
  await client.sendMessage('session-1',{content:'解释',attachments:{sql:'SELECT 1'}})
  assert.equal(calls[0].url,'/api/claude/sessions/session-1/messages')
  assert.deepEqual(JSON.parse(calls[0].init.body),{content:'解释',attachments:{sql:'SELECT 1'}})
})
```

Cover every route, 204 deletion, cancellation signal forwarding, structured Bridge errors, recursive token redaction, and absence of provider/API-key fields.

- [ ] **Step 2: Run client tests and confirm RED**

Run: `node --test apps/web/src/claude-assistant-api.test.mjs`

Expected: client/types do not exist.

- [ ] **Step 3: Implement types and client, then simplify diagnostic provider**

Use the existing safe request patterns from `agent-api.ts`, but omit SSE, retry backoff, provider settings, API keys, runs, events, and tool types. `diagnostic-provider.ts` must always identify itself as `cli` and call the existing `/claude/probe` and `/ask` or `/claude/diagnose` compatibility route.

- [ ] **Step 4: Run focused client/diagnostic tests and confirm GREEN**

Run: `node --test apps/web/src/claude-assistant-api.test.mjs apps/web/src/diagnostics.test.mjs`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/claude-assistant-types.ts apps/web/src/claude-assistant-api.ts apps/web/src/claude-assistant-api.test.mjs apps/web/src/diagnostic-provider.ts apps/web/src/types.ts apps/web/src/diagnostics.test.mjs
git commit -m "feat: add Claude assistant web client"
```

### Task 6: Assistant Drawer and Query Context UX

**Files:**
- Create: `apps/web/src/ClaudeAssistantDrawer.tsx`
- Create: `apps/web/src/claude-assistant.css`
- Create: `apps/web/src/claude-assistant-ui.test.mjs`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/responsive-layout.css`
- Modify: `apps/web/src/agent-workbench.test.mjs` before replacing it with `apps/web/src/claude-assistant-ui.test.mjs`.

**Interfaces:**
- Consumes: Task 5 client/types and props `{open,onClose,currentSql,currentError,currentSchema,onOpenSql,onNotify}`.
- Produces: history/search/chat UI, explicit attachment toggles, diagnosis action, delete confirmation, cancel, and code-block actions.
- Produces no direct query execution callback.

- [ ] **Step 1: Write failing UI contract tests**

Assert that the drawer contains history search, new session, message input, SQL/error/Schema attachment toggles, diagnosis action, CLI status, delete confirmation with cancel default focus and Escape cancellation, and “open in new query” without an execute action.

```js
test('assistant requires explicit context selection and never exposes execute', () => {
  const source=readFileSync(new URL('./ClaudeAssistantDrawer.tsx',import.meta.url),'utf8')
  assert.match(source,/附加当前 SQL/)
  assert.match(source,/附加最近错误/)
  assert.match(source,/附加 Schema/)
  assert.match(source,/打开到新查询/)
  assert.doesNotMatch(source,/执行 SQL|onExecute/)
})
```

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `node --test apps/web/src/claude-assistant-ui.test.mjs`

Expected: drawer module does not exist.

- [ ] **Step 3: Implement the drawer and integrate it into `App.tsx`**

Remove `'agent'` from `PrimaryWorkspace`, replace the Agent navigation item with a Claude assistant button inside the query workspace, and ignore a persisted legacy `gdb.primaryWorkspace='agent'` by selecting `'query'`. Reuse `openQueryTab` for code blocks. Keep current SQL/error/Schema as props and build attachments only at send time from checked toggles. Import the new stylesheet from `main.tsx`.

- [ ] **Step 4: Run focused tests, typecheck, and build**

Run: `node --test apps/web/src/claude-assistant-ui.test.mjs apps/web/src/workspace.test.mjs apps/web/src/onboarding.test.mjs`

Run: `npm run check`

Run: `npm run build`

Expected: all commands pass; the only build advisory may be the existing large-chunk warning.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/ClaudeAssistantDrawer.tsx apps/web/src/claude-assistant.css apps/web/src/claude-assistant-ui.test.mjs apps/web/src/App.tsx apps/web/src/main.tsx apps/web/src/responsive-layout.css apps/web/src/workspace.test.mjs apps/web/src/onboarding.test.mjs
git commit -m "feat: add contextual Claude assistant drawer"
```

### Task 7: Remove Agent Frontend and Dead References

**Files:**
- Delete: `apps/web/src/AgentConversation.tsx`
- Delete: `apps/web/src/AgentExecutionPanel.tsx`
- Delete: `apps/web/src/AgentSessionList.tsx`
- Delete: `apps/web/src/AgentWorkbench.tsx`
- Delete: `apps/web/src/agent-api.ts`
- Delete: `apps/web/src/agent-types.ts`
- Delete: `apps/web/src/agent-workbench.css`
- Delete: `apps/web/src/agent-api-client.test.mjs`
- Delete: `apps/web/src/agent-workbench.test.mjs`
- Modify: every remaining web test or stylesheet that references Agent workspace selectors or copy.

**Interfaces:**
- Consumes: Task 6 completed UI.
- Produces: no `AgentWorkbench`, Agent SSE, Run, tool-event, provider-settings, or `agent-active` references under `apps/web/src`.

- [ ] **Step 1: Add a failing dead-code scan test**

Add to `apps/web/src/claude-assistant-ui.test.mjs` a recursive source assertion that excludes test fixtures and verifies no runtime `.ts`, `.tsx`, or `.css` file contains `AgentWorkbench`, `/agent/`, `agent-active`, `AgentExecutionPanel`, or `Anthropic API`.

- [ ] **Step 2: Run the scan and confirm RED**

Run: `node --test apps/web/src/claude-assistant-ui.test.mjs`

Expected: existing Agent runtime files trigger the scan.

- [ ] **Step 3: Delete Agent frontend files and clean all references**

Delete the listed files, remove their imports from `main.tsx` and `App.tsx`, remove obsolete CSS selectors, migrate tests to Claude assistant naming, and ensure no API-key setting remains in local storage migration code.

- [ ] **Step 4: Run the complete web suite and confirm GREEN**

Run: `npm run test:web`

Run: `npm run check`

Expected: all web tests and TypeScript checks pass.

- [ ] **Step 5: Commit**

```powershell
git add -A apps/web
git commit -m "refactor: remove Agent workbench"
```

### Task 8: Documentation, Release Copy, and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture/overview.md`
- Modify: `apps/web/src/learning-center.ts`
- Modify: `apps/web/src/learning-center.test.mjs`
- Modify: `scripts/documentation-consistency.test.mjs`
- Modify: `scripts/version-consistency.test.mjs` only if its required copy changes.

**Interfaces:**
- Consumes: completed product behavior from Tasks 1-7.
- Produces: user documentation that describes local CLI chat/diagnosis and contains no active Agent workbench, database-tool, API-key, or Anthropic fallback claims.

- [ ] **Step 1: Write failing documentation consistency assertions**

```js
test('current documentation describes the local Claude assistant only', () => {
  assert.match(readme,/本地 Claude CLI/)
  assert.match(readme,/聊天历史/)
  assert.doesNotMatch(currentDocs,/Agent 工作台|ANTHROPIC_API_KEY|Anthropic API 备用/)
})
```

Allow archived historical design documents to retain historical Agent terminology; restrict the scan to README, current architecture, current learning content, and runtime source.

- [ ] **Step 2: Run documentation tests and confirm RED**

Run: `node --test scripts/documentation-consistency.test.mjs apps/web/src/learning-center.test.mjs`

Expected: current docs still advertise the Agent workbench/API fallback.

- [ ] **Step 3: Update documentation and learning copy**

Document CLI installation/login, the assistant drawer, explicit context attachments, local history location, privacy boundary, diagnosis flow, and the fact that generated SQL requires manual execution. Remove obsolete setup and feature bullets.

- [ ] **Step 4: Run complete verification**

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS, allowing only the existing Vite large-chunk advisory.

Run: `npm run test:web`

Expected: all web tests pass.

Run: `npm run test:bridge`

Expected: all Bridge and script tests pass.

Run: `git diff --check`

Expected: no whitespace errors.

Run a final source scan under `apps/bridge`, `apps/web/src`, `README.md`, and `docs/architecture` for `/agent/`, `AgentWorkbench`, `agent-active`, `ANTHROPIC_API_KEY`, and API-provider setup. Only archived documents may contain historical references.

- [ ] **Step 5: Commit**

```powershell
git add README.md CHANGELOG.md docs/architecture/overview.md apps/web/src/learning-center.ts apps/web/src/learning-center.test.mjs scripts/documentation-consistency.test.mjs scripts/version-consistency.test.mjs
git commit -m "docs: document local Claude assistant"
```

### Task 9: Final Review and Clean Handoff

**Files:**
- Review: all changes since `5a5b83c`

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces: reviewed, test-backed implementation with a clean worktree and no obsolete Agent runtime code.

- [ ] **Step 1: Review the cumulative diff**

Run: `git diff --stat 5a5b83c..HEAD`

Run: `git diff --check 5a5b83c..HEAD`

Inspect deleted files, server route ordering, sensitive-data boundaries, assistant attachment defaults, local storage behavior, and SQL open-without-execute behavior.

- [ ] **Step 2: Re-run the complete verification from Task 8**

Expected: all four npm commands pass and the worktree remains clean.

- [ ] **Step 3: Record remaining environment limitations**

If Rust/Cargo is unavailable, report that desktop packaging/manual Tauri verification was not performed; do not claim it passed. Do not install tools without authorization.

- [ ] **Step 4: Confirm branch state**

Run: `git status --short --branch`

Expected: current branch with no modified or untracked files.
