# Grid Zoom and Dark Menu Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize result-grid zoom across headers and cells and remove the light focus frame from the dark Measurement action menu.

**Architecture:** Keep the existing shared `--grid-zoom` state and extend CSS consumers instead of geometrically transforming the table. Harden the dark menu surface and use an inset focus ring so keyboard navigation remains visible.

**Tech Stack:** React 19, TypeScript, CSS, Node test runner

## Global Constraints

- Preserve the existing 80%–160% zoom range and 10% steps.
- Do not change data fetching, pagination, filtering, sorting, or database writes.
- Keep keyboard focus visible in dark mode.

---

### Task 1: Grid zoom contract

**Files:**
- Modify: `apps/web/src/measurement-data-view.test.mjs`
- Modify: `apps/web/src/measurement-data-view.css`
- Modify: `apps/web/src/data-grid.css`
- Modify: `apps/web/src/MeasurementDataView.tsx`

**Interfaces:**
- Consumes: existing CSS custom property `--grid-zoom` and `ResultGridZoomControls`.
- Produces: synchronized header/cell sizing in both result grids.

- [ ] **Step 1: Write the failing source-contract test**

Assert that both grid styles scale headers, cells, padding and minimum widths, and that the Measurement controls render inside `.measurement-data-toolbar`.

- [ ] **Step 2: Run the focused Web test and verify failure**

Run: `node --test apps/web/src/measurement-data-view.test.mjs`

- [ ] **Step 3: Implement the minimal synchronized CSS and move the control**

Use `calc(... * var(--grid-zoom))` for table typography and geometry; move `ResultGridZoomControls` from `.measurement-data-head` into `.measurement-data-toolbar`.

- [ ] **Step 4: Re-run the focused test and verify it passes**

Run: `node --test apps/web/src/measurement-data-view.test.mjs`

### Task 2: Dark Measurement action menu

**Files:**
- Modify: `apps/web/src/measurement-action-menu.test.mjs`
- Modify: `apps/web/src/sidebar-polish.css`

**Interfaces:**
- Consumes: `.measurement-action-menu` and its existing keyboard focus behavior.
- Produces: a dark surface without an external light outline and an inset keyboard focus ring.

- [ ] **Step 1: Write the failing dark-theme contract test**

Require `color-scheme: dark`, explicit `outline: none`, and an inset focus ring for dark menu items.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test apps/web/src/measurement-action-menu.test.mjs`

- [ ] **Step 3: Implement the minimal dark-menu CSS fix**

Harden the menu surface and replace the global external focus outline with a menu-scoped inset box shadow.

- [ ] **Step 4: Re-run the focused test and verify it passes**

Run: `node --test apps/web/src/measurement-action-menu.test.mjs`

### Task 3: Full verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: the completed fixes.
- Produces: release-ready validation evidence.

- [ ] **Step 1: Run all checks**

Run: `npm run check && npm run test:web && npm run test:bridge && npm run build && git diff --check`

- [ ] **Step 2: Commit the verified fix**

Commit message: `fix: synchronize grid zoom and dark menu theme`
