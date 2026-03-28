# ESM Imports Analyzer -- Comprehensive Specification

This document is the primary reference for the ESM Imports Analyzer project. It describes every file, algorithm, data structure, UI behavior, and design decision in enough detail that someone with zero prior context can understand and modify any part of the codebase.

Generated from the actual source code as of commit `2c3411f` (March 2026).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Data Flow](#3-data-flow)
4. [Key Types](#4-key-types)
5. [Timing Model](#5-timing-model)
6. [Loader Hooks](#6-loader-hooks)
7. [Analysis Pipeline](#7-analysis-pipeline)
8. [Report Generation](#8-report-generation)
9. [HTML Report UI](#9-html-report-ui)
10. [CLI](#10-cli)
11. [Build & Package](#11-build--package)
12. [Testing Strategy](#12-testing-strategy)
13. [Known Limitations & Workarounds](#13-known-limitations--workarounds)
14. [Key Design Decisions](#14-key-design-decisions)
15. [Development Guide](#15-development-guide)

---

## 1. Overview

ESM Imports Analyzer is a CLI tool that instruments a Node.js application's ESM import graph at runtime, captures every module resolution and load with wall-clock timing, and generates a self-contained HTML report with an interactive dependency graph visualization.

**Who it is for:** Node.js developers diagnosing slow startup times, understanding dependency structure, or identifying circular dependencies in ESM-based projects.

**How it works in one paragraph:** The CLI spawns the user's command with `NODE_OPTIONS=--import=<register.ts>`, which injects synchronous loader hooks via `module.registerHooks()` (Node 24+). The resolve hook timestamps every import. The load hook appends a `globalThis.__esm_analyzer_import_done__(url)` callback to each module's source code, which fires after the module finishes evaluating (including all its dependencies). On process exit, the collected `ImportRecord[]` array is written to a temp JSON file. The CLI reads it back, runs analysis (tree building, cycle detection via Tarjan's SCC, package grouping, folder tree computation, timing ranking), and assembles a single HTML file embedding all data, CSS, and JS. The report renders the graph with Cytoscape.js and dagre layout in a Web Worker.

Requires **Node.js 24+** (for `module.registerHooks()`). Written in erasable-only TypeScript that Node 24 runs natively via type stripping.

---

## 2. Architecture

### Directory Tree

```
esm-imports-analyzer/
  src/
    cli.ts                       # CLI entry point
    types.ts                     # All shared TypeScript interfaces
    loader/
      register.ts                # --import entry: hooks registration + process exit flush
      hooks.ts                   # resolve + load hook implementations
    analysis/
      tree-builder.ts            # Builds import tree from flat records
      cycle-detector.ts          # Tarjan's SCC + cycle extraction
      grouper.ts                 # Groups modules by package.json boundaries
      folder-tree.ts             # Builds hierarchical folder tree within each group
      timing.ts                  # Ranked timing list + total execution span
    report/
      generator.ts               # Assembles self-contained HTML
      template.html              # HTML shell with {{PLACEHOLDER}} markers
      ui/
        graph.js                 # Cytoscape.js graph (plain browser JS, inlined into HTML)
        table.js                 # Slowest modules table (plain browser JS)
        cycles-panel.js          # Cycles sidebar (plain browser JS)
        filters.js               # Search wiring (plain browser JS)
        styles.css               # Dark theme CSS (Catppuccin Mocha)
  test/
    unit/                        # Unit tests for analysis modules and UI logic
    integration/                 # Loader, report, CLI integration tests
      fixtures/                  # 20 test fixture directories
      helpers.ts                 # runWithLoader() and runCli() test utilities
    performance/                 # 1000 and 5000 module benchmarks
  examples/
    tests/                       # Example project using lodash-es, chalk, ms, etc.
  plans/                         # Specification documents
  package.json
  tsconfig.json
  .gitignore
```

### File-by-File Description

#### `src/types.ts`
- **Purpose:** Defines all shared TypeScript interfaces.
- **Exports:** `ImportRecord`, `ModuleNode`, `Cycle`, `FolderTreeNode`, `Group`, `ReportData`.
- **Dependencies:** None.
- **Details:** This is a pure type file. Every other module in `src/` imports types from here.

#### `src/cli.ts`
- **Purpose:** CLI entry point. Parses arguments, spawns the child process with loader hooks, reads collected data, runs the analysis pipeline, and generates the HTML report.
- **Key functions:** `parseArgs()`, `main()`, `findProjectRoot()`, `printUsage()`, `getVersion()`, `fail()`.
- **Dependencies:** `types.ts`, `analysis/tree-builder.ts`, `analysis/cycle-detector.ts`, `analysis/grouper.ts`, `analysis/timing.ts`, `report/generator.ts`.
- **Details:** Uses `child_process.spawn()` with `stdio: 'inherit'` so the child's output is visible. Sets `NODE_OPTIONS` and `ESM_ANALYZER_TEMP_FILE` environment variables. Determines whether to use `src/` or `dist/` register path by checking if `__dirname` contains `'dist'`.

#### `src/loader/register.ts`
- **Purpose:** The `--import` entry point that runs inside the child process. Registers hooks and sets up data flushing.
- **Exports:** None (side-effect module).
- **Dependencies:** `node:module`, `node:fs`, `types.ts`, `hooks.ts`.
- **Details:**
  - Creates shared `records: ImportRecord[]` and `evalStarts: Map<string, number>` data structures.
  - Defines `globalThis.__esm_analyzer_import_done__` callback that computes `totalImportTime = performance.now() - importStartTime` and stores it in `evalTimes`.
  - Calls `module.registerHooks(hooks)` with hooks from `createHooks()`.
  - On `beforeExit` and `exit` events, `flushData()` merges `evalTimes` into all matching records by URL and writes `JSON.stringify(records)` to the temp file.

#### `src/loader/hooks.ts`
- **Purpose:** Implements the resolve and load hooks that intercept every module import.
- **Key functions:** `createHooks()`, `injectCallback()`.
- **Dependencies:** `node:fs`, `node:url`, `types.ts`.
- **Details:** See [Section 6: Loader Hooks](#6-loader-hooks) for full behavior.

#### `src/analysis/tree-builder.ts`
- **Purpose:** Builds a parent-child tree from flat `ImportRecord[]`.
- **Exports:** `buildTree()`.
- **Dependencies:** `types.ts`.
- **Details:** First occurrence of each URL wins. Children sorted by `importStartTime`. Orphaned nodes become roots.

#### `src/analysis/cycle-detector.ts`
- **Purpose:** Detects circular dependencies using Tarjan's SCC algorithm.
- **Exports:** `detectCycles()`.
- **Dependencies:** `types.ts`.
- **Details:** See [Section 7: Analysis Pipeline](#7-analysis-pipeline).

#### `src/analysis/grouper.ts`
- **Purpose:** Groups modules by `package.json` boundaries.
- **Exports:** `groupModules()`, `clearPackageJsonCache()`.
- **Dependencies:** `node:fs`, `node:path`, `node:url`, `types.ts`, `folder-tree.ts`.
- **Details:** Handles `node:`, `data:`, `file:` URL schemes. Uses `getNodeModulesPackageRoot()` to skip nested `package.json` files inside `node_modules`. Caches `package.json` lookups. After grouping, calls `buildFolderTree()` for each group with a `packageJsonPath`.

#### `src/analysis/folder-tree.ts`
- **Purpose:** Builds a hierarchical folder tree within each package group.
- **Exports:** `buildFolderTree()`.
- **Dependencies:** `node:path`, `node:url`, `types.ts`.
- **Details:** Builds a trie from relative paths, then flattens single-child folder chains (e.g., `src/lib/internal/deep.js` becomes a single node with label `src/lib/internal/deep.js` instead of four nested folders). Folder IDs use `ftree::<groupId>::<path>` format. File IDs are the original `resolvedURL`.

#### `src/analysis/timing.ts`
- **Purpose:** Computes ranked timing list and total execution span.
- **Exports:** `computeRankedList()`, `computeTotalTime()`, `TimingEntry` (interface).
- **Dependencies:** `types.ts`.
- **Details:** `computeRankedList()` deduplicates by URL (first occurrence), sorts descending by `totalImportTime` (undefined treated as 0). `computeTotalTime()` computes `max(importStartTime + totalImportTime) - min(importStartTime)`.

#### `src/report/generator.ts`
- **Purpose:** Reads the HTML template and UI asset files, substitutes placeholders, and writes the assembled HTML file.
- **Exports:** `generateReport()`.
- **Dependencies:** `node:fs`, `node:path`, `node:url`, `types.ts`.
- **Details:** Uses `split/join` instead of `String.replace` to avoid `$`-substitution bugs. Determines `src/` vs `dist/` path by checking if `__dirname` contains `'dist'`.

#### `src/report/template.html`
- **Purpose:** HTML shell with `{{PLACEHOLDER}}` markers for CSS, data JSON, and JS files.
- **Placeholders:** `{{STYLES}}`, `{{DATA}}`, `{{GRAPH_JS}}`, `{{TABLE_JS}}`, `{{CYCLES_PANEL_JS}}`, `{{FILTERS_JS}}`.
- **Details:** Loads Cytoscape.js from unpkg CDN (`cytoscape@3.31.0`). Contains the inline init script that wires everything together: parses JSON data, calls `initGraph()`, `initTable()`, `initCyclesPanel()`, `initFilters()`, and sets up expand/collapse/relayout/resize handlers.

#### `src/report/ui/graph.js`
- **Purpose:** The largest UI file (~1310 lines). Builds the Cytoscape.js graph, handles all graph interactions.
- **Key functions:** `initGraph()`, `runLayout()`, `expandGroup()`, `collapseGroup()`, `expandFolder()`, `expandAll()`, `collapseAll()`, `applySelectionHighlight()`, `clearSelectionHighlight()`, `refreshEdgeVisibility()`, `resolveVisibleNode()`, `highlightCycle()`, `clearHighlights()`, `focusOnNode()`, `zoomToNode()`, `filterBySearch()`, `expandImporters()`, `expandImported()`, `buildFolderElements()`, `revealModule()`.
- **Details:** Written in ES5-style plain JS (no modules, no arrow functions) for maximum browser compatibility. Dagre layout runs in a Web Worker constructed from an inline Blob. See [Section 9: HTML Report UI](#9-html-report-ui) for full behavior.

#### `src/report/ui/table.js`
- **Purpose:** Renders the "Slowest modules" table with sorting, filtering, and tree expansion.
- **Key functions:** `initTable()` (returns `{ filter, rerender }`).
- **Details:** Shows top N modules ranked by the current sort column. Each row is expandable via chevron to show child imports recursively. Click a row to focus on it in the graph.

#### `src/report/ui/cycles-panel.js`
- **Purpose:** Renders the left sidebar listing all circular dependencies.
- **Key functions:** `initCyclesPanel()`.
- **Details:** Each cycle item shows module count and short names joined by arrows. Click to highlight the cycle in the graph. Copy button copies full absolute paths. "Clear highlight" button at bottom.

#### `src/report/ui/filters.js`
- **Purpose:** Wires the search input to both graph and table filtering.
- **Key functions:** `initFilters()`.
- **Details:** 13 lines. Calls `filterBySearch(cy, query)` and `tableApi.filter(query)` on input events.

#### `src/report/ui/styles.css`
- **Purpose:** Dark theme CSS using CSS custom properties (Catppuccin Mocha palette).
- **Details:** Defines colors, fonts, layout (header, cycles panel, center area with graph + table, resize handle), context menu, tooltips, table styles, and a spinner animation for the layout overlay.

---

## 3. Data Flow

Here is the complete step-by-step trace from CLI invocation to HTML report:

### Step 1: CLI Argument Parsing (`cli.ts`)

```
npx esm-imports-analyzer -o report.html -- node app.js
```

- `parseArgs()` splits on `--`: our args = `['-o', 'report.html']`, command = `['node', 'app.js']`.
- Output path resolved to absolute: `/cwd/report.html`.

### Step 2: Child Process Spawning (`cli.ts`)

- Creates a temp file path: `/tmp/esm-analyzer-<uuid>.json`.
- Determines register script path (checks if running from `dist/` or `src/`).
- Sets environment: `NODE_OPTIONS=--import=<register.ts> <existing NODE_OPTIONS>` and `ESM_ANALYZER_TEMP_FILE=<temp file>`.
- Spawns `node app.js` with `stdio: 'inherit'`.

### Step 3: Loader Hook Registration (`register.ts`)

When the child process starts, Node's `--import` flag causes `register.ts` to execute before the user's entry point:

- Creates shared `records: ImportRecord[]`, `evalStarts: Map<string, number>`, `evalTimes: Map<string, number>`.
- Installs `globalThis.__esm_analyzer_import_done__` callback.
- Calls `module.registerHooks(createHooks(records, evalStarts))` to install resolve + load hooks.
- Registers `beforeExit` and `exit` handlers for `flushData()`.

### Step 4: Import Interception (`hooks.ts`)

As the user's application runs, every `import` triggers the hooks:

**Resolve hook fires:**
1. Records `importStartTime = performance.now()`.
2. Calls `nextResolve()` to get the resolved URL.
3. If the URL is already in `loadedURLs` (cached/circular), pushes an `ImportRecord` immediately (no `totalImportTime` -- it will be merged during flush).
4. Otherwise, pushes to `pendingQueue` with `{ specifier, resolvedURL, parentURL, importStartTime }`.

**Load hook fires:**
1. Calls `nextLoad()` to get the module source and format.
2. Adds URL to `loadedURLs` set.
3. Finds the matching pending resolve by URL, removes it from queue.
4. Stores `evalStarts.set(url, importStartTime)`.
5. Pushes an `ImportRecord` to `records`.
6. If the module is JS (not JSON/WASM):
   - Extracts source as string (from `result.source` or reads from disk for CJS with null source).
   - Appends `;globalThis.__esm_analyzer_import_done__(<url>);` to the source (before any `//# sourceMappingURL` comment).
   - Returns modified source.
7. For non-JS modules (JSON, WASM, builtins): deletes from `evalStarts` (no timing possible).

**Module evaluation callback (`register.ts`):**
When the injected `__esm_analyzer_import_done__(url)` fires:
1. Looks up `evalStarts.get(url)` to find the start timestamp.
2. Computes `totalImportTime = performance.now() - start`.
3. Stores in `evalTimes.set(url, totalImportTime)`.

### Step 5: Data Flush (`register.ts`)

On `beforeExit`/`exit`:
1. `flushData()` iterates all records and sets `record.totalImportTime = evalTimes.get(record.resolvedURL)` for every record matching a URL that has a measured time.
2. Writes `JSON.stringify(records)` to the temp file path.

**Key detail:** All records for the same URL get the same `totalImportTime`, even cached re-imports. This is because `flushData()` iterates all records by URL, not just the first occurrence.

### Step 6: Analysis Pipeline (`cli.ts`)

CLI reads the temp file and runs:
1. `buildTree(records)` -- builds `ModuleNode[]` tree.
2. `detectCycles(records)` -- finds `Cycle[]` via Tarjan's SCC.
3. `groupModules(records)` -- produces `Group[]` with `folderTree` per group.
4. `computeRankedList(records)` -- produces `TimingEntry[]` sorted by time.
5. `computeTotalTime(records)` -- computes total execution span.

Assembles `ReportData` with metadata (command, timestamp, Node version, module count, total time), modules, tree, groups, and cycles.

### Step 7: HTML Report Assembly (`generator.ts`)

1. Reads `template.html`, `styles.css`, `graph.js`, `table.js`, `cycles-panel.js`, `filters.js`.
2. Uses `split/join` substitution to replace each `{{PLACEHOLDER}}` with its content.
3. `{{DATA}}` is replaced with `JSON.stringify(reportData)`.
4. Writes the assembled HTML to the output path.

### Step 8: Browser Rendering (report UI)

When the HTML file is opened:
1. Cytoscape.js loads from unpkg CDN.
2. The inline init script parses the embedded JSON data.
3. `initGraph(data)` creates Cytoscape elements (groups, folders, modules, edges), applies styles, collapses all groups, and runs the initial dagre layout in a Web Worker.
4. `initTable(data, cy)` renders the slowest modules table.
5. `initCyclesPanel(data, cy)` renders the cycles sidebar.
6. `initFilters(cy, tableApi)` wires the search input.
7. The init script sets up expand/collapse/relayout/resize event handlers.

---

## 4. Key Types

All defined in `src/types.ts`:

### `ImportRecord`

```typescript
interface ImportRecord {
  specifier: string;          // Raw import specifier as written in source code (e.g., './b.js', 'lodash-es')
  resolvedURL: string;        // Fully resolved URL (e.g., 'file:///abs/path/b.js', 'node:fs')
  parentURL: string | null;   // resolvedURL of the module that imported this one. null for entry points.
  importStartTime: number;    // performance.now() timestamp when the resolve hook fires
  totalImportTime?: number;   // Wall-clock ms from importStartTime to module eval completion.
                               // undefined for: builtins, JSON, WASM, modules that throw during eval.
                               // Set during flushData() -- all records for the same URL get the same value.
}
```

### `ModuleNode`

```typescript
interface ModuleNode {
  resolvedURL: string;        // Same as ImportRecord.resolvedURL
  specifier: string;          // Raw specifier from the first ImportRecord for this URL
  totalTime: number;          // totalImportTime ?? 0 (0 for modules without timing)
  children: ModuleNode[];     // Direct imports of this module, ordered by importStartTime
  parentURL: string | null;   // Same as ImportRecord.parentURL
}
```

### `Cycle`

```typescript
interface Cycle {
  modules: string[];          // Array of resolvedURLs forming the cycle (in order)
  length: number;             // modules.length -- redundant but convenient
}
```

### `FolderTreeNode`

```typescript
interface FolderTreeNode {
  id: string;                 // For folders: 'ftree::<groupId>::<relativePath>'
                               // For files: the original resolvedURL
  label: string;              // Display label. May be a flattened path like 'src/utils' if intermediate
                               // single-child folders were merged.
  type: 'folder' | 'file';
  moduleURL?: string;         // For files: the resolvedURL. undefined for folders.
  children: FolderTreeNode[]; // Empty for files. Sorted: folders first, then files, alphabetically.
}
```

### `Group`

```typescript
interface Group {
  id: string;                 // Resolved absolute package directory path (e.g., '/abs/path/to/pkg')
                               // Special IDs: 'node-builtins', 'inline-modules', 'ungrouped'
  label: string;              // package.json "name" field, or fallback:
                               //   'Node.js Builtins', 'Inline Modules', 'Ungrouped', or directory name
  packageJsonPath: string;    // Absolute path to the group's package.json. Empty string for virtual groups.
  modules: string[];          // Deduplicated array of resolvedURLs belonging to this group
  isNodeModules: boolean;     // true if the package is inside a node_modules directory
  folderTree?: FolderTreeNode[];  // Hierarchical folder structure. Set by groupModules() for groups
                                    // with a packageJsonPath.
}
```

### `ReportData`

```typescript
interface ReportData {
  metadata: {
    command: string;          // The user's command joined by spaces (e.g., 'node app.js')
    timestamp: string;        // ISO 8601 timestamp of report generation
    nodeVersion: string;      // process.version (e.g., 'v24.0.0')
    totalModules: number;     // Number of unique modules (from computeRankedList().length)
    totalTime: number;        // Total execution span in ms (from computeTotalTime())
  };
  modules: ImportRecord[];    // All raw records (including duplicates for cached imports)
  tree: ModuleNode[];         // Root nodes of the import tree
  groups: Group[];            // Package groups with folder trees
  cycles: Cycle[];            // Detected circular dependencies
}
```

### `TimingEntry` (in `timing.ts`, not exported from `types.ts`)

```typescript
interface TimingEntry {
  resolvedURL: string;
  specifier: string;
  totalTime: number;          // totalImportTime ?? 0
}
```

---

## 5. Timing Model

This is the most novel part of the project. Import time is measured via source code injection.

### What is measured

**Import time** (`totalImportTime`): The wall-clock time from when the resolve hook fires for a module to when that module's evaluation completes. This is an **inclusive** measurement that covers:
- Resolution (URL lookup)
- Loading (fetching source from disk/network)
- Parsing (JS engine parsing the source)
- Recursive dependency resolution and evaluation (all static imports of this module must complete first)
- Top-level code execution in the module
- Top-level `await` suspension time

### How it is measured

#### 1. NODE_OPTIONS injection

The CLI sets `NODE_OPTIONS=--import=<register.ts>` on the child process. This causes `register.ts` to execute before the user's entry point.

#### 2. registerHooks

`register.ts` calls `module.registerHooks(hooks)` (Node 24's synchronous in-thread hooks API). Unlike the older `module.register()`, these hooks run on the main thread and can share state directly via closures.

#### 3. Source injection technique

In the load hook, after `nextLoad()` returns the module's source code, the hook appends:

```js
;globalThis.__esm_analyzer_import_done__("file:///abs/path/module.js");
```

This is appended to the end of the source (or before any trailing `//# sourceMappingURL` comment). The semicolon prefix prevents ASI issues. The URL is `JSON.stringify()`-escaped.

When Node evaluates the module, it first evaluates all the module's static `import` dependencies (recursively), then runs the module's own top-level code, and finally hits the injected callback at the very end.

#### 4. The callback

Defined in `register.ts`:

```typescript
globalThis.__esm_analyzer_import_done__ = (url: string) => {
  const start = evalStarts.get(url);
  if (start !== undefined) {
    evalTimes.set(url, performance.now() - start);
    evalStarts.delete(url);
  }
};
```

`evalStarts` was populated by the load hook with the `importStartTime` from the resolve hook.

#### 5. What is NOT measured

- **Builtins** (`node:` URLs): The load hook receives format `'builtin'` with null source. Cannot inject JS.
- **JSON modules**: Format is `'json'`. Cannot inject JS.
- **WASM modules**: Format is `'wasm'`. Cannot inject JS.
- **Cached/circular imports**: The resolve hook fires but the load hook does not (the module is already in `loadedURLs`). An `ImportRecord` is created with no `totalImportTime`. During `flushData()`, the previously measured `totalImportTime` for that URL is merged into all records, so even cached records get the timing value.
- **Modules that throw during evaluation**: The injected callback at the end of the source never executes.

### Total execution time

`computeTotalTime()` computes the overall span: `max(importStartTime + totalImportTime) - min(importStartTime)` across all records. Only records with defined `totalImportTime` contribute to the max. All records contribute to the min.

---

## 6. Loader Hooks

Defined in `src/loader/hooks.ts`. The `createHooks()` function returns a `RegisterHooksOptions` object with `resolve` and `load` hooks.

### Shared state

- `loadedURLs: Set<string>` -- URLs that have passed through the load hook. Used to detect cached/circular imports in the resolve hook.
- `pendingQueue: PendingResolve[]` -- Resolve records waiting for their matching load. Each entry has `{ specifier, resolvedURL, parentURL, importStartTime }`.

### Resolve hook behavior

```
resolve(specifier, context, nextResolve):
  1. Record importStartTime = performance.now()
  2. Call result = nextResolve(specifier, context)
  3. If loadedURLs.has(result.url):
       -> Module already loaded (cached import or circular back-edge)
       -> Push ImportRecord directly to records (no totalImportTime)
  4. Else:
       -> Push to pendingQueue
  5. Return result
```

The resolve hook is synchronous. It always calls `nextResolve()` first to get the resolved URL before deciding how to handle it.

### Load hook behavior

```
load(url, context, nextLoad):
  1. Call result = nextLoad(url, context)
  2. Add url to loadedURLs
  3. Find matching pending resolve by URL in pendingQueue:
       -> If found: remove from queue, store evalStarts.set(url, importStartTime), push ImportRecord
  4. Determine whether to inject:
       - If format is 'json' or 'wasm': skip injection, delete from evalStarts
       - Else (format is 'module', 'commonjs', or undefined):
           a. Extract source as string:
              - If result.source is non-null: convert to string (TextDecoder for ArrayBuffer/Uint8Array)
              - If result.source is null AND url starts with 'file://': read from disk via readFileSync
              - Otherwise: source is null, skip injection
           b. If source obtained: return { ...result, source: injectCallback(source, url) }
  5. Return result (possibly modified)
```

### Format detection logic

The `format` field from `nextLoad()` tells the hook what kind of module it is:

| Format | Meaning | Source available? | Inject? |
|--------|---------|-------------------|---------|
| `'module'` | ESM | Yes (non-null) | Yes |
| `'commonjs'` | CJS loaded via `import()` | Usually non-null, sometimes null | Yes (read from disk if null) |
| `undefined` | CJS loaded via `require()` | Non-null | Yes |
| `'json'` | JSON module | Yes | No |
| `'wasm'` | WebAssembly | Yes | No |
| `'builtin'` | Node built-in | Null | No |

### CJS null-source fallback

When a CJS module is loaded via `import()`, Node may provide `null` as the source. The load hook handles this by reading the file from disk:

```typescript
if (url.startsWith('file://')) {
  try { source = readFileSync(fileURLToPath(url), 'utf-8'); } catch {}
}
```

This ensures CJS modules imported from ESM still get timing measurement.

### Source map preservation

The `injectCallback()` function checks for a trailing `//# sourceMappingURL` or `//@ sourceMappingURL` comment via regex:

```typescript
const SOURCE_MAP_RE = /(\n\/\/[#@] sourceMappingURL=[^\n]*\s*)$/;
```

If found, the injection is inserted **before** the source map comment (using `String.replace` with a capture group `$1`). Otherwise, the injection is appended to the end.

### Callback injection format

```typescript
function injectCallback(source: string, url: string): string {
  const injection = `\n;globalThis.__esm_analyzer_import_done__(${JSON.stringify(url)});\n`;
  // ...
}
```

- Leading `\n;` prevents ASI issues and ensures the callback starts on a new line (important if the source ends with a `//` comment).
- `JSON.stringify(url)` safely escapes the URL string.

---

## 7. Analysis Pipeline

Five modules run sequentially in `cli.ts` after reading the raw `ImportRecord[]` data.

### 7.1 Tree Builder (`src/analysis/tree-builder.ts`)

**Algorithm:**

1. Index records by `resolvedURL` -- first occurrence wins (subsequent cached imports are ignored).
2. Create a `ModuleNode` for each unique URL with `totalTime = totalImportTime ?? 0`.
3. Sort all nodes by `importStartTime`.
4. Link children to parents: for each node, find its parent by `parentURL` in the node map. If parent not found, treat as root.
5. Return root nodes.

**Properties:**
- Children are ordered by `importStartTime` (load order).
- In a diamond dependency (A->B, A->C, B->D, C->D), D appears only under its first parent (B).
- The tree is a proper tree (each node has at most one parent), not the full DAG. Duplicate edges are recorded in `modules` but the tree only shows first-occurrence parentage.

### 7.2 Cycle Detector (`src/analysis/cycle-detector.ts`)

**Phase 1: Build adjacency list**

Constructs a directed graph `Map<string, Set<string>>` where each node maps to its set of outgoing neighbors. Uses `parentURL -> resolvedURL` edges from all records (not deduplicated).

**Phase 2: Tarjan's Strongly Connected Components (SCC)**

Standard Tarjan's algorithm:
- Maintains a DFS stack, index counter, lowlink values.
- `strongconnect(v)`: sets index/lowlink, pushes to stack, recurses on unvisited neighbors, updates lowlink from stack neighbors, pops SCC when `lowlink == index`.
- Processes all nodes, handling disconnected components.

**Phase 3: Extract individual cycles from each SCC**

For SCCs of size 1: checks for self-loop (node has itself as neighbor). If yes, emits `{ modules: [node], length: 1 }`.

For SCCs of size 2+: Uses DFS from each node in the SCC to find all simple cycles:
- `dfs(start, current, path)`: follows neighbors within the SCC. When `next === start` and `path.length > 0`, records the cycle.
- Tracks visited nodes to avoid redundant exploration.

**Phase 4: Deduplication**

Cycles are deduplicated by sorting their module arrays and joining with `\0` as a key. For duplicate keys, the shorter cycle wins.

**Phase 5: Sort**

Result sorted by cycle length (shortest first).

### 7.3 Grouper (`src/analysis/grouper.ts`)

**Algorithm:**

1. Iterate records, deduplicating by `resolvedURL`.
2. Classify each URL:
   - `node:` prefix -> "Node.js Builtins" group (id: `'node-builtins'`)
   - `data:` prefix -> "Inline Modules" group (id: `'inline-modules'`)
   - `file:` prefix -> walk up directory tree to find `package.json`
   - No `package.json` found -> "Ungrouped" (id: `'ungrouped'`)
3. For `file:` URLs inside `node_modules`: `getNodeModulesPackageRoot()` extracts the package root directly from the path structure instead of walking up. This handles:
   - Regular packages: `/path/node_modules/pkg/` -> package root is `pkg/`
   - Scoped packages: `/path/node_modules/@scope/pkg/` -> package root is `@scope/pkg/`
   - Nested `node_modules`: uses `lastIndexOf('/node_modules/')` to find the innermost one
4. After grouping, calls `buildFolderTree()` for each group that has a `packageJsonPath`.

**Caching:** `packageJsonCache: Map<string, PackageJsonInfo | null>` caches directory-to-package lookups.

**`clearPackageJsonCache()`:** Exported for testing -- clears the cache between test runs.

### 7.4 Folder Tree (`src/analysis/folder-tree.ts`)

**Algorithm:**

1. **Build trie:** For each `file://` URL, compute relative path from package directory. Split into segments and insert into a trie (`RawNode` with `name`, `children: Map`, optional `moduleURL`).

2. **Convert to typed tree:** Walk the trie recursively, creating `FolderTreeNode` objects. Files get their `resolvedURL` as ID. Folders get `ftree::<groupId>::<relativePath>` as ID.

3. **Flatten single-child chains:** The `flattenSingle()` function recursively merges folders that have exactly one child:
   - If a folder has 1 child that is also a folder, merge labels (e.g., `src` + `utils` -> `src/utils`) and continue walking down.
   - If a folder has 1 child that is a file, merge labels (e.g., `src/lib/internal` + `deep.js` -> `src/lib/internal/deep.js`) and return a file node.
   - If a folder has 0 or 2+ children, stop and recursively flatten each child.

4. **Handle virtual root:** The top-level of the trie is a virtual root. If it has 1 child, the flatten logic absorbs it. If the absorbed root had a non-empty label, prefix all children's labels.

**Sorting:** Within each level, folders come before files, then alphabetical by label.

### 7.5 Timing (`src/analysis/timing.ts`)

**`computeRankedList(records)`:**
1. Iterate records, keeping first occurrence per `resolvedURL`.
2. Create `TimingEntry` with `totalTime = totalImportTime ?? 0`.
3. Sort descending by `totalTime`. Equal times preserve insertion order (stable sort).

**`computeTotalTime(records)`:**
1. Find `minStart = min(importStartTime)` across ALL records.
2. Find `maxEnd = max(importStartTime + totalImportTime)` across records that HAVE `totalImportTime`.
3. Return `maxEnd - minStart`. Returns 0 if no records have `totalImportTime`.

---

## 8. Report Generation

### Assembly process (`src/report/generator.ts`)

1. Determine paths: `findProjectRoot()` walks up from `__dirname` to find `package.json`. Then checks if running from `dist/` or `src/`.
2. Read all files: `template.html`, `styles.css`, `graph.js`, `table.js`, `cycles-panel.js`, `filters.js`.
3. Substitute placeholders using `templateReplace()` (split/join):

```
{{STYLES}}        -> contents of styles.css
{{DATA}}          -> JSON.stringify(reportData)
{{GRAPH_JS}}      -> contents of graph.js
{{TABLE_JS}}      -> contents of table.js
{{CYCLES_PANEL_JS}} -> contents of cycles-panel.js
{{FILTERS_JS}}    -> contents of filters.js
```

4. Write assembled HTML to `outputPath`.

### Why split/join instead of String.replace

`String.replace(pattern, replacement)` interprets special `$` patterns in the replacement string:
- `$1`, `$2` -- capture group references
- `$&` -- matched substring
- `` $` `` -- text before match
- `$'` -- text after match

Since the JS files being inlined may contain any of these patterns (they are arbitrary JavaScript), `String.replace` would corrupt them. `split/join` performs literal string substitution with no special interpretation.

### CDN dependencies

The generated HTML loads:
- **Cytoscape.js 3.31.0** via `<script src="https://unpkg.com/cytoscape@3.31.0/dist/cytoscape.min.js">`.
- **dagre 0.7.4** inside a Web Worker via `importScripts("https://unpkg.com/dagre@0.7.4/dist/dagre.js")`.

Both are loaded at runtime when the HTML file is opened in a browser. After first load, browser cache handles subsequent opens.

---

## 9. HTML Report UI

The report is a single-page application with four main areas: header, cycles panel (left), graph (center), and table (bottom).

```
+-------------------------------------------------------------------+
| Header: title | metadata | Search | Expand/Collapse | Re-layout   |
+-------------------------------------------------------------------+
|  Cycles Panel  |              Graph View                          |
|  (left sidebar)|  (Cytoscape.js + dagre in Web Worker)            |
|                |                                                   |
+----------------+---------------------------------------------------+
|  resize handle (drag to resize)                                    |
+-------------------------------------------------------------------+
|                Slowest Modules Table (bottom, resizable)           |
+-------------------------------------------------------------------+
```

### 9.1 Graph

#### Node types

**Group nodes (packages):** Compound/parent nodes in Cytoscape. Round-rectangle shape. Semi-transparent background (`background-opacity: 0.75`, color `#313147`). Contains module and folder nodes as children.

- `node_modules` packages: additional dashed border, slightly darker background (`#282839`).
- **Collapsed state:** Centered label, thicker border (`border-width: 2`, color `#585b70`). Width computed dynamically from label length: `Math.max(80, label.length * 6.5 + 24)`. All children hidden.
- **Expanded state:** Label at top (`text-valign: top`), children visible, acts as a bounding box.
- **Single-module packages:** Never collapse. Always shown expanded.
- **Label format:** `<package-name> (<N> modules)`.

**Folder nodes:** Regular (non-compound) nodes inside a group. Round-rectangle, gray (`#3b3b55`), 80x30px, with label. Created from the group's `folderTree` data.

- Folders disappear when expanded (replaced by their children).
- Folder state tracked in `folderState[folderId]` mapping folder IDs to `{ children, groupId }`.
- Parent mapping tracked in `parentFolderOf[nodeId]` for both files and sub-folders.

**Module nodes:** Uniform 24x24 circles, accent blue (`#89b4fa`), with label below. No time-based coloring or sizing.

- **Builtins** (`node:` prefix): Darker color (`#45475a`), muted label color (`#6c7086`). Always visible (not hidden by any filter).
- Label comes from the folder tree file label if available, otherwise the raw specifier.

#### Edge types

**Real edges:** Taxi-style (orthogonal) curve routing (`curve-style: taxi`, `taxi-direction: downward`, `taxi-turn: 20px`). Thin (1px), muted color (`#585b70`). Triangle arrow at target.

**Meta-edges:** Bezier curves, 2px, slightly brighter (`#7f849c`). Created dynamically when groups/folders are collapsed to show connections between collapsed entities. Label shows import count (e.g., "3 imports"). Auto-rotated text. Removed and recreated on every `refreshEdgeVisibility()` call.

**Cycle-highlighted edges:** Orange (`#fab387`), 3px, bezier, `z-index: 10`. Applied when a cycle is selected from the panel.

#### Meta-edge resolution

`resolveVisibleNode(cy, moduleURL)`: Given a module URL, finds the nearest visible ancestor:
1. Check if the module node itself is visible -> return it.
2. Walk up through `parentFolderOf` chain, checking each folder for visibility.
3. Fall back to the parent group node.

`refreshEdgeVisibility(cy)`: Called after every expand/collapse:
1. Remove all existing `.meta-edge` elements.
2. For each real edge, resolve both endpoints to visible nodes via `resolveVisibleNode()`.
3. If both endpoints resolved to themselves (both visible), show the real edge.
4. If either resolved to a different node, hide the real edge and collect a meta-edge `source||target -> count`.
5. Skip meta-edges where source equals target (intra-group edges in collapsed groups).
6. Create new meta-edge elements.

### 9.2 Selection

#### Click behavior

**Plain click on a node:** Selects only that node. Clears all previous selection.

**Shift/Ctrl/Cmd-click on a node:** Toggles the node in/out of the current selection without affecting other selected nodes.

**Click on empty graph area:** Clears all selection and search. Clears directional highlighting.

#### tapstart save/restore (Cytoscape workaround)

Cytoscape auto-selects the clicked node during its internal tap processing, which runs between `tapstart` and the `tap` event. This would destroy multi-select state.

**Workaround:**
1. On `tapstart`, save current selection: `preTapSelectedIds = { id: true, ... }`.
2. On `tap`, use `setTimeout(fn, 0)` to run AFTER Cytoscape's post-tap processing.
3. In the deferred handler:
   - For plain click: `unselect()` all, `select()` only clicked node.
   - For additive click: restore `preTapSelectedIds`, then toggle the clicked node.
4. Call `applySelectionHighlight(cy)`.

#### Double-click behavior

- **Double-click a package group:** Toggle expand/collapse (disabled for single-module packages).
- **Double-click a folder:** Expand the folder (replace it with its children).
- **Double-click a module:** Zoom to 1.2x centered on the node. No selection change.
- **Double-click empty space:** Clear selection and search, animate fit-to-view with 30px padding.

### 9.3 Directional Highlighting

When nodes are selected, `applySelectionHighlight(cy)` applies CSS classes:

| Class | Color | Applied to |
|-------|-------|-----------|
| `hl-selected` | Purple `#cba6f7` | Selected nodes (3px border) |
| `hl-outgoing` | Blue `#89b4fa` | Outgoing edges and their target nodes |
| `hl-incoming` | Green `#a6e3a1` | Incoming edges and their source nodes |
| `hl-cycle` | Yellow `#f9e2af` | Edges that are part of any cycle, among the highlighted edges |
| `dimmed` | 20% opacity (nodes), 8% opacity (edges) | Everything not highlighted |

**Algorithm:**
1. Clear all highlight classes from all elements.
2. For each selected node:
   - Mark as `hl-selected`.
   - Trace outgoing visible edges: mark edges as `hl-outgoing`, mark target nodes as `hl-outgoing` (unless already `hl-selected`).
   - Trace incoming visible edges: mark edges as `hl-incoming`, mark source nodes as `hl-incoming` (unless already `hl-selected` or `hl-outgoing`).
   - If the node is an expanded group: include all visible children and their internal edges; also trace outgoing/incoming from each child to external nodes.
   - If the node is a group or folder: also follow connected meta-edges.
3. Among highlighted edges, mark those in `cycleEdgeSet` as `hl-cycle`.
4. Dim everything not in the highlighted collection.
5. Undim parent groups of highlighted nodes.

**Precedence:** `hl-selected` > `hl-outgoing` > `hl-incoming`. A node that is both an outgoing target and incoming source from different selections gets `hl-outgoing`.

#### Cycle edge tracking

`cycleEdgeSet: Set<string>` is populated at graph init time from `data.cycles`. For each cycle, for each consecutive pair of modules (including last->first), the edge ID `source->target` is added. These edges get `hl-cycle` highlighting (yellow) when they appear among the highlighted edges during selection.

### 9.4 Expand/Collapse

**Initial state:** All groups collapsed (except single-module packages).

**Expanding a group (`expandGroup`):**
1. Remove group ID from `collapsedGroups` set.
2. Remove `collapsed` CSS class.
3. If the group has a `folderTree`, show only top-level tree children. Otherwise, show all children flat.
4. Call `refreshEdgeVisibility()` and `maybeRelayout()`.
5. Select and highlight the group (unless `suppressAutoSelect` is true).

**Collapsing a group (`collapseGroup`):**
1. Add group ID to `collapsedGroups` set.
2. Add `collapsed` CSS class.
3. Hide ALL children.
4. Reset folder expansion state for this group (clear from `expandedFolders`).
5. Call `refreshEdgeVisibility()` and `maybeRelayout()`.

**Expanding a folder (`expandFolder`):**
1. Look up folder state in `folderState[folderId]`.
2. Add to `expandedFolders` set.
3. Hide the folder node, show its children.
4. Call `refreshEdgeVisibility()` and `maybeRelayout()`.
5. Select newly revealed children (unless `suppressAutoSelect`).

**Folders cannot be individually re-collapsed.** Collapsing the parent group resets all folder expansion.

**Expand all (`expandAll`):**
1. Expand all groups (remove from `collapsedGroups`, remove `collapsed` class).
2. Iteratively expand all visible folder nodes until no more can be expanded.
3. Show any remaining hidden module nodes.
4. Call `refreshEdgeVisibility()`.

**Collapse all (`collapseAll`):**
1. For each group (except single-module packages): add to `collapsedGroups`, add `collapsed` class, hide children.
2. Clear `expandedFolders`.
3. Call `refreshEdgeVisibility()`.

### 9.5 Context Menu

Right-clicking any node shows a floating `div` with four items:

1. **Expand importer files:** Finds all modules that import the right-clicked node (or any module inside it for groups/folders). Reveals them with minimal expansion (`revealModule()` for each). Relayouts. Selects the original node.

2. **Expand imported files:** Same as above but for outgoing edges -- finds all modules imported BY the right-clicked node. Reveals and relayouts.

3. **Copy absolute path:** Copies the filesystem path to clipboard. Strips `file://` prefix for modules. For groups, copies the group ID (package directory). For folders, reconstructs path from the folder ID.

4. **Copy import paths:** For each module URL in the node (recursively for groups/folders), traces the import chain from root using `getImportPath()` (walks `parentByURL` chain). Joins all paths with `\n\n` and copies.

**Clipboard method:** Uses `textarea` + `document.execCommand('copy')` fallback because `navigator.clipboard.writeText()` is unavailable in `file://` context.

**Menu dismissal:** Clicking anywhere (on graph or document) hides the menu.

### 9.6 Table

**Structure:** Title row ("Slowest modules" + count input), header row (Module | Import time | Imports), scrollable body.

**Root rows:** The top N modules (default 20, configurable) selected by the current sort column. Show absolute filesystem path (`file://` prefix stripped). Depth 0.

**Sorting:**
- Click column header to sort. Click again to toggle asc/desc.
- Sort changes which N modules are shown as root rows:
  - Sort by Import time: N modules with highest `totalImportTime`
  - Sort by Imports: N modules with most recursive imports (`countAllChildren`)
  - Sort by Module: N highest by time, then alphabetically sorted
- Sort arrow indicator updates.

**Tree expansion:** Each row with children shows a chevron. Click chevron to expand/collapse child rows. Children are rendered lazily on first expansion. Child rows show the relative import specifier instead of absolute path.

**Click a row (not chevron):** Calls `focusOnNode(cy, resolvedURL)`:
- If the module is already visible in the graph: select + zoom (no relayout).
- If not visible: collapse all -> reveal just enough (expand group + ancestor folders) -> relayout -> select + zoom.
- Highlights the clicked row with a blue left border (`highlighted` class).
- Clears the search input.

**Filtering:** `tableApi.filter(query)` hides/shows top-level rows (depth 0) based on URL or text content match.

### 9.7 Cycles Panel

**Left sidebar, 280px wide.** Header: "Circular Dependencies".

**No cycles detected:** Shows "No circular dependencies detected" message. Hides "Clear highlight" button.

**Cycle items:** Each shows:
- Header: `<N> modules` (orange text) + copy button (visible on hover).
- Body: Short module names joined by arrows (e.g., `a.js -> b.js -> a.js`).

**Click a cycle item:**
1. Mark as active (orange border).
2. Clear search and selection highlight.
3. `suppressAutoSelect = true`.
4. Collapse all groups.
5. Reveal each cycle member via `revealModule()`.
6. Refresh edge visibility.
7. `suppressAutoSelect = false`.
8. Relayout, then on completion:
   - Apply `cycle-highlight` class to cycle nodes (orange border) and cycle edges (orange, 3px, bezier).
   - Animate fit-to-view on cycle nodes + their parent groups with 40px padding.

**Copy button:** Copies full absolute paths: `/abs/path/a.js -> /abs/path/b.js -> /abs/path/a.js`.

**Clear highlight button:** Removes `cycle-highlight` class from all elements. Does NOT collapse or change view.

**Important:** Clicking empty graph space does NOT clear cycle highlight. Only the "Clear highlight" button does. Node selection (purple) takes visual precedence over cycle highlight (orange).

### 9.8 Search

**Input:** Text input in the header bar.

**Graph behavior (`filterBySearch`):**
1. If query is empty: clear all selections and highlighting, return.
2. Check every module node (visible or not) by label and full path (case-insensitive substring).
3. Also check folder nodes by label.
4. For each match: resolve to nearest visible ancestor via `resolveVisibleNode()`.
5. Unselect all nodes, then select all matching visible nodes.
6. Apply directional highlighting.

**Table behavior (`tableApi.filter`):**
- Filters top-level rows only (depth 0) by URL or text content.
- Hides non-matching rows and their child containers.

**Auto-clear triggers:** The search input is automatically cleared (and its `input` event dispatched) when:
- User clicks a node.
- User clicks empty graph space.
- User double-clicks empty graph space.
- A cycle is selected from the panel.
- A table row is clicked (`focusOnNode`).

### 9.9 Layout

**Algorithm:** Dagre (hierarchical DAG, top-to-bottom). Configuration: `rankDir: 'TB'`, `nodeSep: 60`, `edgeSep: 20`, `rankSep: 80`.

**Web Worker execution:**
1. `runLayout(cy, callback)` shows the overlay spinner.
2. Collects visible nodes and edges. Expanded groups are passed as parent nodes (with `width: 0, height: 0`) to dagre.
3. Creates a `Blob` from the `DAGRE_WORKER_SRC` string (dagre loaded via `importScripts` from unpkg CDN).
4. Creates a `Worker` from the blob URL.
5. Posts message with nodes, edges, and layout config.
6. Worker runs `dagre.layout(g)` and posts back positions.
7. On message: batch-updates node positions, fits view with 30px padding, hides overlay, terminates worker.

**Layout overlay:** "Computing layout..." with a CSS spinner animation. Covers the graph area. Uses `opacity` transition to appear/disappear.

**Auto re-layout:** Checkbox in header (default: checked). When enabled, `maybeRelayout()` calls `runLayout()` after every expand/collapse action. Disabled by unchecking.

**Manual re-layout:** "Re-layout" button always available.

### 9.10 Resize Handle

A 4px horizontal bar between the graph and table. Drag to resize:
- `mousedown` on handle sets `isResizing = true`.
- `mousemove` calculates new table height based on cursor position.
- Clamps between 100px and container height minus 200px.
- Calls `cy.resize()` to update the graph viewport.
- `mouseup` clears `isResizing`.

---

## 10. CLI

### Usage

```
esm-imports-analyzer [options] -- <command> [command-args...]

Options:
  --output, -o <path>   Output HTML report path (default: ./esm-imports-report.html)
  --help, -h            Show help
  --version, -v         Show version
```

### Argument parsing (`parseArgs`)

1. Check all args for `--help`/`-h` or `--version`/`-v` before any other processing. If found, print and `process.exit(0)`.
2. Find `--` separator index. If not found, return `null` (triggers error message).
3. Split: `ourArgs = args[0..separator)`, `command = args[separator+1..]`.
4. If `command` is empty, return `null`.
5. Parse `ourArgs`: look for `--output`/`-o` followed by a path. Default output: `resolve('esm-imports-report.html')`.

### NODE_OPTIONS handling

```typescript
const existingNodeOptions = process.env['NODE_OPTIONS'] ?? '';
const nodeOptions = `--import=${registerPath} ${existingNodeOptions}`.trim();
```

The analyzer's `--import` is **prepended** to existing `NODE_OPTIONS`, preserving any user-configured options.

### Register path detection

```typescript
const registerPath = __dirname.includes('dist')
  ? join(projectRoot, 'dist', 'loader', 'register.js')
  : join(projectRoot, 'src', 'loader', 'register.ts');
```

When running from source (development), uses `.ts` file directly. When running from the built package, uses `.js` file in `dist/`.

### Child process

```typescript
const child = spawn(cmd, cmdArgs, {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions, ESM_ANALYZER_TEMP_FILE: tempFile },
});
```

- `stdio: 'inherit'`: child's stdout/stderr are visible in the terminal.
- Waits for `close` event to get exit code.

### Error paths

| Condition | Behavior |
|-----------|----------|
| No `--` separator | Print error + usage, exit 1 |
| No command after `--` | Print error + usage, exit 1 |
| Non-zero child exit | Print warning, still generate report |
| Temp file missing | Print "No import data collected. Is the project using ESM?", exit 1 |
| Temp file empty | Print "No imports were captured. Is the project using ESM?", exit 1 |
| Invalid JSON in temp file | Print "Import data file contains invalid JSON.", exit 1 |
| Command spawn error | Print error message, exit code 1 |

### Temp file cleanup

After reading, the temp file is deleted via `unlinkSync()`. Best-effort (errors ignored).

---

## 11. Build & Package

### package.json configuration

```json
{
  "name": "esm-imports-analyzer",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@10.33.0",
  "bin": { "esm-imports-analyzer": "dist/cli.js" },
  "types": "dist/cli.d.ts",
  "files": ["dist"],
  "devDependencies": {
    "@types/node": "^25.5.0",
    "typescript": "^6.0.2"
  }
}
```

**Zero runtime dependencies.** Cytoscape and dagre are loaded from CDN at report viewing time.

### Build process

```bash
pnpm build
# Equivalent to:
rm -rf dist && tsc && cp -r src/report/ui dist/report/ui && cp src/report/template.html dist/report/template.html
```

1. `rm -rf dist` -- clean previous build.
2. `tsc` -- compiles TypeScript to JavaScript in `dist/`. Configuration:
   - Target: ES2024
   - Module: NodeNext
   - `declaration: true`, `declarationMap: true`, `sourceMap: true`
   - `erasableSyntaxOnly: true` -- only type annotations that can be erased, no enums/namespaces
   - `rewriteRelativeImportExtensions: true` -- rewrites `.ts` imports to `.js` in output
3. `cp -r src/report/ui dist/report/ui` -- copies plain JS/CSS files (not compiled by tsc).
4. `cp src/report/template.html dist/report/template.html` -- copies HTML template.

### What goes in dist/

```
dist/
  cli.js, cli.d.ts, cli.js.map
  types.js, types.d.ts, types.js.map
  loader/
    register.js, register.d.ts, register.js.map
    hooks.js, hooks.d.ts, hooks.js.map
  analysis/
    tree-builder.js, ...
    cycle-detector.js, ...
    grouper.js, ...
    folder-tree.js, ...
    timing.js, ...
  report/
    generator.js, generator.d.ts, generator.js.map
    template.html          (copied from src)
    ui/
      graph.js             (copied from src, not compiled)
      table.js             (copied from src)
      cycles-panel.js      (copied from src)
      filters.js           (copied from src)
      styles.css           (copied from src)
```

### Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `typecheck` | `tsc --noEmit` | Type-check without emitting |
| `build` | `rm -rf dist && tsc && cp ...` | Full build |
| `test` | `node --test test/**/*.test.ts` | Run all tests |
| `test:unit` | `node --test test/unit/**/*.test.ts` | Run unit tests only |
| `test:integration` | `node --test test/integration/**/*.test.ts` | Run integration tests only |
| `prepublishOnly` | `npm run typecheck && npm run build` | Pre-publish check |

---

## 12. Testing Strategy

### Test organization

Tests use Node.js's built-in `node:test` runner. All test files are TypeScript, run natively via Node 24's type stripping.

### Unit tests (`test/unit/`)

| File | Tests | What it covers |
|------|-------|----------------|
| `tree-builder.test.ts` | 9 | Empty input, single root, linear chain, branching, multiple roots, diamond DAG, totalTime computation, child ordering by importStartTime, duplicate handling |
| `tree-builder-edge-cases.test.ts` | 8 | Orphaned nodes, all-roots, deep chain (100 levels), wide tree (100 children), undefined/zero totalImportTime, duplicate records, mixed URL schemes |
| `cycle-detector.test.ts` | 9 | No cycles (DAG), simple 2-node cycle, self-referential import, 3-node cycle, diamond is not a cycle, multiple independent cycles, overlapping cycles, large cycle (15 modules) performance, subgraph-only cycle |
| `grouper.test.ts` | 10 | Node builtins, data URLs, package.json boundaries, node_modules, monorepo packages, single-package, scoped packages, no-name packages, nested package.json skipping, ungrouped fallback |
| `timing.test.ts` | 8 | Sort descending, totalTime computation, single module, deduplication, stable sort, no-time modules rank last, total execution span, empty records |
| `timing-edge-cases.test.ts` | 12 | All-undefined timing, mixed timing, out-of-order records, duplicate URLs, single record, stable sort (100 records), all-undefined computeTotalTime, measured-only max, single record span, non-zero offset, unmeasured earliest start |
| `folder-tree.test.ts` | 11 | Single file, multiple files, one-folder no-flatten, single-child chain to file, single-child chain to multi-child folder, stop at 2+ children, mixed flatten/non-flatten, skip non-file URLs, deterministic IDs, file IDs are URLs, folder IDs have ftree prefix |
| `click-selection-logic.test.ts` | 32 | Plain click (7), shift-click toggle (10), double-click (2), directional highlighting: connected/disconnected/cycle/mixed/empty (13), selection sequences (4) |
| `hooks-injection.test.ts` | 18 | Basic injection (5), URL escaping (3), source map preservation (5), special source content (3), format-based injection decision (8) |
| `import-path-tracing.test.ts` | 8 | Root module, linear chain, cycle protection, file:// stripping, non-file URLs, unknown module, deep chain (10 levels), path formatting |
| `template-replace.test.ts` | 9 | Basic replacement, multiple occurrences, $1/$2 preservation, $& preservation, $`/$' preservation, empty replacement, missing placeholder, JSON data, large values |

### Integration tests (`test/integration/`)

| File | Tests | What it covers |
|------|-------|----------------|
| `loader.test.ts` | 14 | Linear imports, circular deps, deep nesting (21 levels), wide fan-out (51 modules), builtins capture, timing validity, node_modules imports, JSON record structure, totalImportTime for JS modules, top-level await timing (>=90ms), builtins have no totalImportTime, throwing modules, CJS via import, CJS via require |
| `loader-edge-cases.test.ts` | 8 | Dynamic import(), re-exports, mixed ESM->CJS->CJS chains, source map preservation, all records for same URL get same totalImportTime, self-import, deep nesting with timing on all modules, records ordered by importStartTime |
| `report.test.ts` | 8 | Valid HTML structure, embedded JSON data, Cytoscape CDN reference, dagre worker reference, inlined CSS, all modules present, cycles for circular fixture, groups present, output path |
| `cli.test.ts` | 12 | Basic invocation, missing `--` separator, `--help` flag, `--version` flag, `--output` flag, `-o` shorthand, report path in stdout, command with flags after `--`, default output path, non-zero child exit, preserving existing NODE_OPTIONS, child stdout passthrough |

### Performance tests (`test/performance/`)

| File | Tests | What it covers |
|------|-------|----------------|
| `large-graph.test.ts` | 2 | 1000 modules in <2s, 5000 modules in <10s (tree + fan-out topology) |
| `large-graph-with-cycles.test.ts` | 4 | 1000+10 cycles in <2s, 5000+50 cycles in <10s, star graph (999 leaves), chain graph (1000 sequential) |

### Test helper utilities (`test/integration/helpers.ts`)

**`runWithLoader(fixtureEntry)`:** Spawns `node <fixture>` with the loader hooks. Returns `{ records: ImportRecord[], exitCode: number }`. Uses `execFileSync` with 15s timeout.

**`runCli(args)`:** Runs the full CLI with given args. Returns `{ stdout, stderr, exitCode, reportPath }`. Parses "Report generated:" from stdout.

**`createTempOutputPath()`:** Returns a unique temp file path for HTML output.

**`cleanupFile(path)`:** Best-effort delete.

### Fixtures (`test/integration/fixtures/`)

| Fixture | Files | Purpose |
|---------|-------|---------|
| `simple` | `a.js -> b.js -> c.js`, `package.json` | Basic linear import chain |
| `circular` | `a.js <-> b.js -> c.js`, `package.json` | Circular dependency between a and b |
| `deep` | `level-0.js` through `level-20.js`, `package.json` | 21-level deep import chain |
| `wide` | `a.js`, `dep-0.js` through `dep-49.js`, `package.json` | 1 module importing 50 dependencies |
| `builtins` | `a.js`, `package.json` | Imports `node:path` and `node:fs` |
| `slow` | `a.js` (top-level await 100ms), `b.js`, `package.json` | Tests timing of async imports |
| `self-import` | `a.js`, `package.json` | Module imports itself |
| `node-modules` | `a.js`, `node_modules/ms/...`, `package.json` | Importing from node_modules |
| `no-name-pkg` | `a.js`, `package.json` (no "name" field) | Package without a name |
| `monorepo` | `package.json`, `packages/foo/`, `packages/bar/` | Multi-package repository |
| `nested` | `index.js`, `src/...`, `package.json` | Nested directory structure |
| `nested-pkg-json` | `node_modules/fake-pkg/lib/esm/index.js`, nested `package.json` | Tests skipping nested package.json |
| `throwing` | `a.js -> b.js` (b throws) | Module that throws during evaluation |
| `dynamic` | `a.js` (dynamic `import('./b.js')`), `b.js` | Dynamic import capture |
| `mixed-esm-cjs` | `a.js` (ESM), `b.cjs`, `c.cjs` | ESM importing CJS which requires CJS |
| `reexport` | `a.js -> b.js` (re-exports from `c.js`) | Re-export tracing |
| `source-map` | `a.js`, `b.js` (has `//# sourceMappingURL`) | Source map preservation |
| `cjs-require` | `a.cjs` (requires `b.cjs`) | Pure CJS require chain |

### Running tests

```bash
# All tests
pnpm test
# or: node --test test/**/*.test.ts

# Unit tests only
pnpm test:unit

# Integration tests only
pnpm test:integration

# Specific test file
node --test test/unit/timing.test.ts
```

---

## 13. Known Limitations & Workarounds

### Node.js 24+ Required

Uses `module.registerHooks()`, which is only available in Node.js 24+. This is the synchronous in-thread hooks API that replaced the older `module.register()` (which ran hooks in a separate thread).

### ESM Entry Point Required

The project being analyzed must use ESM (`"type": "module"` or `.mjs` entry point). CJS modules imported from ESM are correctly measured (the hooks intercept them).

### Modules That Throw During Evaluation

If a module throws during its top-level code execution, the injected `__esm_analyzer_import_done__` callback at the end of the source never runs. The module will have an `ImportRecord` but no `totalImportTime`.

### Top-Level Await Inflation

Import time includes time spent suspended in top-level `await`. This is technically correct (it represents real wall-clock time the application waits) but can make async modules appear disproportionately slow compared to CPU-bound modules.

### Process Must Exit Cleanly

Data is flushed via `beforeExit` and `exit` event handlers. If the process is killed with `SIGKILL` or crashes in a way that skips these handlers, import data may be lost.

### CDN Dependency

The HTML report loads Cytoscape.js and dagre from unpkg on first open. After browser caching, subsequent opens work offline.

### Cytoscape Auto-Selection Workaround (tapstart/setTimeout)

Cytoscape automatically selects clicked nodes during its internal tap processing, which runs between `tapstart` and `tap` events. This destroys multi-select state for shift-click.

**Workaround:** Save selection on `tapstart`, then in the `tap` handler use `setTimeout(fn, 0)` to run after Cytoscape's processing. Restore the saved state, then apply the intended selection change.

### Source Injection Hack

The timing measurement depends on appending executable JavaScript to module source code. This:
- Cannot work for non-JS module formats (JSON, WASM, builtins).
- Depends on the callback name `__esm_analyzer_import_done__` not being used by the analyzed application (name collision is theoretically possible but extremely unlikely).
- Must correctly handle source maps (inject before the `//# sourceMappingURL` comment).

### CJS Null-Source Disk Read

When CJS modules are loaded via `import()`, Node may provide `null` as the source in the load hook. The hook falls back to reading the file from disk via `readFileSync(fileURLToPath(url))`. This only works for `file://` URLs.

### Clipboard Copy in file:// Context

`navigator.clipboard.writeText()` requires a secure context (HTTPS or localhost). Since the report is opened as a `file://` URL, it's unavailable. The workaround uses `document.execCommand('copy')` with a temporary `<textarea>` element.

### No Individual Folder Re-Collapse

Once a folder is expanded, it cannot be collapsed individually. Only collapsing the parent group resets folder expansion state for that group. This simplifies the UI logic.

### Template $-Substitution Bug Avoidance

The report generator uses `split/join` instead of `String.replace` for template substitution. This avoids `$`-pattern interpretation (`$1`, `$&`, `` $` ``, `$'`) that would corrupt inlined JavaScript containing those patterns.

---

## 14. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Timing model** | Inclusive wall-clock "Import time" via source injection | Measures real-world import cost including resolution, loading, parsing, dependencies, and top-level execution. The only approach that captures total import time without Node.js core API support. |
| **Total time** | `max(importStart + totalImportTime) - min(importStart)` | True execution span. Only measured records contribute to max; all records contribute to min (unmeasured records like builtins still have a start time). |
| **Eval measurement** | Inject `__esm_analyzer_import_done__` callback into module source | Only way to detect when module evaluation completes without a Node.js API. The callback fires after all static imports are resolved and the module's top-level code runs. |
| **Source map preservation** | Insert injected code before `//# sourceMappingURL` | Keeps source maps functional. The regex handles both `#` and `@` forms. |
| **In-thread hooks** | `module.registerHooks()` (Node 24+) | Synchronous, in-thread hooks share state directly via closures. No message passing or serialization needed. Much simpler than the older `module.register()` with separate thread. |
| **Layout algorithm** | Dagre (hierarchical DAG, top-to-bottom) | Clear directional flow for dependency trees. `rankDir: TB` shows imports flowing downward. |
| **Layout execution** | Web Worker | Dagre layout computation can be slow for large graphs. Running in a Worker avoids blocking the main thread and keeps the UI responsive. |
| **Layout spacing** | `nodeSep: 60`, `edgeSep: 20`, `rankSep: 80` | Prevents package compound nodes from overlapping while keeping the graph compact enough to be readable. |
| **Graph library** | Cytoscape.js via CDN | Full-featured graph library with compound node support. CDN loading means no bundling needed; the report is a single HTML file. |
| **Module nodes** | Uniform size/color (24x24 circles, accent blue) | Time-based visual encoding on nodes was removed as it was confusing. The table provides the detailed timing data. Uniform nodes keep the graph clean. |
| **Package opacity** | `background-opacity: 0.75` | Edges behind packages are partially visible, helping users trace connections even when groups are expanded. |
| **Folder grouping** | Auto-flatten single-child folders | Minimizes clicks to reach content. A chain like `src/lib/internal/deep.js` becomes a single label instead of four nested folders. |
| **Folder nodes** | Regular nodes (not compound) | Avoids nested bounding boxes which dagre handles poorly. Folders are simple nodes that disappear when expanded. |
| **Single-module packages** | Never collapse | No point hiding a single node behind a collapsed group. Always shown expanded. |
| **Collapse scope** | Package level only (folders cannot be individually re-collapsed) | Simplifies the state model. Users can expand individual folders within a package but must collapse the whole package to reset. |
| **Meta-edges** | Dynamic creation/removal on every expand/collapse | Shows connections between collapsed entities. Removed and recreated each time to stay in sync with current visibility state. |
| **Selection** | Directional (in=green, out=blue, selected=purple) | Quickly understand dependency direction at a glance. Colors chosen from Catppuccin palette for consistency. |
| **Cycle edges in selection** | Yellow (`#f9e2af`) with higher z-index | Distinct from blue/green directional colors. Signals circular deps within the neighborhood of the selected node. |
| **Cycle panel highlight** | Orange (`#fab387`), collapse-first reveal | Always resets the view for consistent framing. Ensures cycle members are visible even if the graph was in an arbitrary expand/collapse state. |
| **Cycle edges default** | No special styling until a cycle is selected | Reduces visual noise. Cycles are highlighted on demand, not always. |
| **Search** | Highlight (not hide) matching nodes | Users see matches in context of the full graph. Collapsed groups are highlighted if they contain matches. |
| **Search clearing** | Auto-clear on user interaction (click, double-click, cycle select, table row click) | Prevents stale search state from confusing the user. |
| **Table sort = filter** | Different root set per metric | Each column represents a different analytical view. Sorting by "Imports" shows the N most dependency-heavy modules, not just a reordering. |
| **Table root display** | Absolute filesystem path | Clear identification. Child rows show relative specifier for conciseness. |
| **Template substitution** | `split/join` not `String.replace` | Avoids `$`-pattern interpretation that would corrupt inlined JavaScript. |
| **Builtins** | Always visible, grouped as "Node.js Builtins" | Previously had a toggle to show/hide. Changed to always-on for simplicity. |
| **Auto re-layout** | Default on (checkbox in header) | Immediate feedback on expand/collapse. Can be disabled for large graphs where layout is slow. |
| **Clipboard** | `execCommand('copy')` fallback | `navigator.clipboard` unavailable in `file://` context. The textarea approach works everywhere. |
| **node_modules grouping** | Path-based package root detection (`getNodeModulesPackageRoot`) | Directly extracts the package root from the path structure, skipping nested `package.json` files reliably. Handles regular, scoped (`@scope/pkg`), and pnpm layouts. |
| **Context menu items** | Copy path, copy import paths, expand importers, expand imported | Common analysis actions that require multiple manual steps without a context menu. |
| **UI JS style** | ES5-compatible plain JS (no modules, no arrow functions) | Inlined into the HTML report which is opened in any browser. Avoids compatibility issues. |
| **Zero runtime deps** | No npm dependencies | CDN-loaded Cytoscape.js is the only external code, loaded at report viewing time. The CLI itself has no runtime npm dependencies. |

---

## 15. Development Guide

### Prerequisites

- **Node.js 24+** (required for `module.registerHooks()` and native TypeScript type stripping)
- **pnpm 10+** (specified as `packageManager` in `package.json`)

### Setup

```bash
git clone https://github.com/alcuadrado/esm-imports-analyzer.git
cd esm-imports-analyzer
pnpm install
```

### Development workflow

Since Node 24 strips TypeScript types natively, you can run source files directly without building:

```bash
# Run the CLI from source
node src/cli.ts -- node some-app.js

# Run tests directly (no build needed)
pnpm test

# Type-check without emitting
pnpm typecheck
```

### Building

```bash
pnpm build
```

This produces `dist/` with compiled JS, declaration files, source maps, and copied UI assets.

### Running the example project

```bash
# Build the analyzer first
pnpm build

# Install example dependencies
cd examples/tests
pnpm install

# Run the example tests
pnpm test

# Generate an import analysis report
pnpm run analyze
# Opens: examples/tests/esm-imports-report.html
```

The example project imports `lodash-es` (huge dependency graph), `chalk`, `ms`, `semver`, `debug`, has circular dependencies, top-level await, local CJS modules, and Node builtins.

### Testing against real npm projects

You can analyze any ESM-based Node.js project:

```bash
# From the project root (after building)
cd /path/to/some-npm-project
npx /path/to/esm-imports-analyzer -- node app.js

# Or if installed globally/linked
esm-imports-analyzer -- node app.js

# Analyze a test suite
esm-imports-analyzer -- node --test test/**/*.test.js

# Analyze a CLI tool (avoid npx/pnpm after --)
esm-imports-analyzer -- node_modules/.bin/tool compile
```

**Important:** Avoid using `npx`, `pnpm`, `bunx`, etc. after `--`. They are Node.js processes themselves and will be measured. Use `node_modules/.bin/<tool>` or `node <script>` directly.

### Adding a new test fixture

1. Create a new directory under `test/integration/fixtures/<name>/`.
2. Add the module files (`.js`, `.cjs`, etc.).
3. If needed, add a `package.json` with `"type": "module"` and a `"name"` field.
4. Write tests in `test/integration/loader.test.ts` or a new test file that uses `runWithLoader()`.

### Adding a new analysis module

1. Create the module in `src/analysis/`.
2. Export its main function.
3. Import and call it in `src/cli.ts` during the analysis pipeline.
4. If the result needs to be in the report, add a field to `ReportData` in `src/types.ts`.
5. Write unit tests in `test/unit/`.

### Modifying the report UI

1. Edit files in `src/report/ui/` (plain JS/CSS, not TypeScript).
2. No build step needed for development -- the CLI reads these files directly from `src/`.
3. To test: run the CLI to generate a report, open it in a browser.
4. Remember these files are inlined into the HTML at generation time, not served separately.
5. Use ES5-compatible syntax (no arrow functions, no `let`/`const`, no template literals, no destructuring).
