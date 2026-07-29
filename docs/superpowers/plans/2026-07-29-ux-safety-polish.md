# UX Safety Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native connection deletion confirmation, improve result-table readability and zoom, and add bulk generation to the final onboarding step.

**Architecture:** Keep each behavior isolated: a focused delete dialog component, a pure zoom-state module consumed by result grids, and the existing data-driven onboarding step list. `App.tsx` only owns dialog state and wires callbacks.

**Tech Stack:** React 19, TypeScript, CSS, Node.js built-in test runner, Vite

## Global Constraints

- Do not change database write behavior in this plan.
- Delete confirmation shows only connection name and address.
- “取消” is the default focus; red “确认删除” performs deletion; `Escape` cancels.
- Result grids default to 12px and share one persisted zoom value from 80% through 160% in 10% steps.
- Plain wheel scrolls; only `Ctrl + wheel` changes grid zoom.
- Bulk generation is the final onboarding step and does not open the wizard automatically.
- Use commit format `<type>: <description>` and never push.

---

### Task 1: Application-Native Connection Delete Dialog

**Files:**
- Create: `apps/web/src/DeleteConnectionDialog.tsx`
- Create: `apps/web/src/delete-connection-dialog.test.mjs`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/connection-dialog.css`

**Interfaces:**
- Consumes: existing `Connection` type and existing deletion callback in `App.tsx`.
- Produces: `DeleteConnectionDialog({ connection, onCancel, onConfirm })`.

- [ ] **Step 1: Write the failing structural test**

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./DeleteConnectionDialog.tsx', import.meta.url), 'utf8')

test('delete dialog exposes required content and keyboard behavior', () => {
  assert.match(source, /connection\.name/)
  assert.match(source, /connection\.endpoint/)
  assert.match(source, /取消/)
  assert.match(source, /确认删除/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /autoFocus/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/web/src/delete-connection-dialog.test.mjs`

Expected: FAIL because `DeleteConnectionDialog.tsx` does not exist.

- [ ] **Step 3: Implement the focused dialog**

Create this public shape:

```tsx
import { useEffect } from 'react'
import type { Connection } from './types'

export default function DeleteConnectionDialog({
  connection,
  onCancel,
  onConfirm,
}: {
  connection: Connection
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return <div className="modal" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onCancel()
  }}>
    <section className="dialog delete-connection-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-connection-title">
      <h2 id="delete-connection-title">删除连接</h2>
      <dl><dt>连接名称</dt><dd>{connection.name}</dd><dt>连接地址</dt><dd>{connection.endpoint}</dd></dl>
      <div className="dialog-actions">
        <button autoFocus onClick={onCancel}>取消</button>
        <button className="danger solid-danger" onClick={onConfirm}>确认删除</button>
      </div>
    </section>
  </div>
}
```

In `App.tsx`, add `connectionPendingDelete: Connection | null`. Change the connection editor’s delete callback to close the editor and set this state. Move the existing connection removal and credential deletion logic into `confirmDeleteConnection()`. Remove `window.confirm`.

- [ ] **Step 4: Add dialog styles**

Add styles for the definition list, long endpoint wrapping, and solid red destructive button. Preserve current light/dark theme variables and ensure the dialog remains within `92vw`.

- [ ] **Step 5: Run focused and full web tests**

Run: `node --test apps/web/src/delete-connection-dialog.test.mjs`

Expected: PASS.

Run: `npm run test:web`

Expected: all web tests PASS.

- [ ] **Step 6: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/DeleteConnectionDialog.tsx apps/web/src/delete-connection-dialog.test.mjs apps/web/src/App.tsx apps/web/src/connection-dialog.css
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add connection delete dialog"
```

### Task 2: Shared Result Grid Zoom

**Files:**
- Create: `apps/web/src/result-grid-zoom.ts`
- Create: `apps/web/src/result-grid-zoom.test.mjs`
- Create: `apps/web/src/ResultGridZoomControls.tsx`
- Modify: `apps/web/src/ResultsTable.tsx`
- Modify: `apps/web/src/data-grid.css`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/theme.css`

**Interfaces:**
- Produces: `GRID_ZOOM_STORAGE_KEY`, `normalizeGridZoom(value)`, `stepGridZoom(current, direction)`.
- Produces: `ResultGridZoomControls({ zoom, onChange })`.
- Later Measurement data grids reuse these exports.

- [ ] **Step 1: Write failing zoom-state tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGridZoom, stepGridZoom } from './result-grid-zoom.ts'

test('grid zoom clamps and rounds to ten percent steps', () => {
  assert.equal(normalizeGridZoom(73), 80)
  assert.equal(normalizeGridZoom(126), 130)
  assert.equal(normalizeGridZoom(999), 160)
})

test('grid zoom steps between 80 and 160', () => {
  assert.equal(stepGridZoom(100, 1), 110)
  assert.equal(stepGridZoom(80, -1), 80)
  assert.equal(stepGridZoom(160, 1), 160)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/web/src/result-grid-zoom.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure zoom state**

```ts
export const GRID_ZOOM_STORAGE_KEY = 'gdb.resultGridZoom'
export const DEFAULT_GRID_ZOOM = 100
export const MIN_GRID_ZOOM = 80
export const MAX_GRID_ZOOM = 160

export function normalizeGridZoom(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_GRID_ZOOM
  return Math.max(MIN_GRID_ZOOM, Math.min(MAX_GRID_ZOOM, Math.round(numeric / 10) * 10))
}

export function stepGridZoom(current: number, direction: -1 | 1) {
  return normalizeGridZoom(current + direction * 10)
}
```

- [ ] **Step 4: Add controls and `Ctrl + wheel` wiring**

`ResultGridZoomControls` renders `−`, the clickable percentage, and `+`. In `ResultsTable`, initialize from local storage, persist on change, and attach:

```tsx
onWheel={event => {
  if (!event.ctrlKey) return
  event.preventDefault()
  setZoom(current => stepGridZoom(current, event.deltaY < 0 ? 1 : -1))
}}
```

Apply `style={{ '--grid-zoom': zoom / 100 } as React.CSSProperties}` to `.data-grid`. Render controls in `.grid-tools`.

- [ ] **Step 5: Update typography**

Set data cells to a 12px base multiplied by `--grid-zoom`, with line-height `1.5` and font stack:

```css
"Cascadia Mono","JetBrains Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace
```

Increase light and dark theme contrast without changing non-grid typography.

- [ ] **Step 6: Run focused tests and build**

Run: `node --test apps/web/src/result-grid-zoom.test.mjs apps/web/src/data-grid-sticky.test.mjs`

Expected: PASS.

Run: `npm run check`

Expected: TypeScript check PASS.

Run: `npm run build`

Expected: production web build PASS.

- [ ] **Step 7: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/result-grid-zoom.ts apps/web/src/result-grid-zoom.test.mjs apps/web/src/ResultGridZoomControls.tsx apps/web/src/ResultsTable.tsx apps/web/src/data-grid.css apps/web/src/styles.css apps/web/src/theme.css
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: improve result grid readability"
```

### Task 3: Final Bulk Generation Onboarding Step

**Files:**
- Modify: `apps/web/src/onboarding.ts`
- Modify: `apps/web/src/onboarding.test.mjs`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: existing `TOUR_STEPS` and `FeatureTour`.
- Produces: final step targeting `bulk-data`.

- [ ] **Step 1: Add a failing onboarding test**

Add:

```js
test('bulk generation is the final onboarding step', () => {
  const finalStep = TOUR_STEPS.at(-1)
  assert.equal(finalStep.target, 'bulk-data')
  assert.match(finalStep.title, /批量造数/)
  assert.match(finalStep.description, /预览/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/web/src/onboarding.test.mjs`

Expected: FAIL because the final step still targets the time converter.

- [ ] **Step 3: Add the final tour step and target**

Append:

```ts
{
  target: 'bulk-data',
  title: '批量生成测试数据',
  description: '选择目标和生成规则，先预览计划，再确认执行批量造数。'
}
```

Add `data-tour="bulk-data"` to the existing bulk entry button. Do not call `setBulkWizardOpen(true)` from tour navigation.

Keep the current onboarding storage key so completed existing users are not forced through the full tour again.

- [ ] **Step 4: Run tests and build**

Run: `node --test apps/web/src/onboarding.test.mjs apps/web/src/feature-tour-visual.test.mjs`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- apps/web/src/onboarding.ts apps/web/src/onboarding.test.mjs apps/web/src/App.tsx
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add bulk generation tour step"
```

### Task 4: UX Polish Regression Gate

**Files:**
- Verify only; no new files expected.

**Interfaces:**
- Consumes all prior tasks in this plan.
- Produces a verified UX-polish milestone.

- [ ] **Step 1: Run the full verification suite**

Run: `npm run test:web`

Expected: all web tests PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Manually verify desktop interactions**

Run: `npm run desktop`

Verify:

1. Connection deletion uses the app dialog.
2. “取消” receives focus and `Escape` closes the dialog.
3. Query results render at the clearer 12px default.
4. Plain wheel scrolls and `Ctrl + wheel` zooms only the grid.
5. `100%` resets and survives reload.
6. The final feature-tour step highlights bulk generation without opening it.

- [ ] **Step 3: Review the final diff**

Run: `& 'C:\Program Files\Git\cmd\git.exe' status --short`

Expected: clean worktree.

Run: `& 'C:\Program Files\Git\cmd\git.exe' log -3 --oneline`

Expected: three focused commits from this plan.
