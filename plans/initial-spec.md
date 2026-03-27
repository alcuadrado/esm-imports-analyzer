# ESM Imports Analyzer - Technical Specification

## Overview

A CLI tool that analyzes ESM import graphs by injecting a custom loader into any Node.js command. It captures all imports, measures load times, detects circular dependencies, and generates a self-contained HTML report with an interactive graph visualization and timing table.

```bash
npx esm-imports-analyzer [--output path] -- <command-to-run>
```

---

## Decisions Log

| Decision                    | Choice                                     | Rationale                                                                |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| Node.js version             | 24+ only                                   | Stable `register()` hooks API, simplest implementation                   |
| Loader API                  | `--import` with `registerHooks()`          | In-thread hooks (Node 24+), no worker thread, shared closure scope       |
| Static vs dynamic detection | Not tracked                                | `import()` can't be monkey-patched; no reliable detection mechanism          |
| Data collection lifecycle   | Collect until process exit                 | Captures all imports including late dynamic ones                         |
| Timing model                | Total time only                            | No self-time decomposition; avoids parallel import ambiguity             |
| Data transport              | Temp file written on process exit          | Minimal runtime overhead; accept data loss on crash/SIGKILL              |
| Graph library               | Cytoscape.js                               | Native compound nodes, expand/collapse extension, handles 5000+ nodes    |
| Default graph view          | Grouped (collapsed)                        | Expand/collapse interactively; essential for 1000+ node graphs           |
| Grouping strategy           | Package.json boundaries                    | Works for both monorepos and single-package projects                     |
| HTML report                 | Fully self-contained, single file          | Inline all JS/CSS; works offline; shareable                              |
| Report opening              | Manual (print path to stdout)              | Less surprising; `--no-open` not needed                                  |
| Cycle detection UX          | Dedicated panel + graph highlight          | Click a cycle in the panel to highlight its path in the graph            |
| Other loaders               | Ignore; ours registers first               | Avoids loader composition bugs                                           |
| Table view                  | Nested/expandable tree of children         | Each child shows its own total time; recursive expansion                 |
| Display names               | Package name in groups, full path on hover | Clean display, full detail on demand                                     |
| Builtins (fs, path, etc.)   | Track but hide by default                  | Toggle in UI to show; reduces noise                                      |
| Package distribution        | npm with `bin` entry, npx-first            | Standard CLI distribution                                                |
| Language                    | TypeScript (erasable syntax only)          | Node 24 native TS support; no enums, no namespaces, no parameter properties |
| Type-checking & build       | `tsc`                                      | Type-check with `--noEmit`; build to JS with `tsc` for npm publish       |
| Testing                     | Unit + integration                         | Unit test data processing; integration test loader with fixture projects |
| Test framework              | `node:test` + `node:assert/strict`         | Zero dependencies; native Node test runner                               |
| UI style                    | Clean developer tool                       | Dark theme, Chrome DevTools aesthetic                                    |
| CLI parsing                 | `--` separator                             | Standard Unix convention; everything after `--` is the analyzed command  |
| Output path                 | Configurable via `--output` flag           | Default: `./esm-imports-report.html` in CWD; overwrites by default       |
| JSON data                   | Embedded in HTML as `<script>` tag         | One file, extractable; less clutter                                      |
| View linking                | Table -> graph (one-directional)           | Click table row to zoom/highlight in graph                               |

---

## Language: TypeScript with Erasable Syntax

The project is written in TypeScript using **erasable syntax only** — the subset that Node 24 can run natively via `--experimental-strip-types` (enabled by default in Node 24). This means:

**Allowed:**
- Type annotations (`: string`, `: number`, etc.)
- Interfaces and type aliases (`interface Foo {}`, `type Bar = ...`)
- Generics (`<T>`)
- `as` type assertions
- `satisfies` operator
- Optional properties (`foo?: string`)

**Not allowed (not erasable):**
- `enum` (use `as const` objects instead)
- `namespace`
- Parameter properties in constructors (`constructor(private x: number)`)
- `declare` in non-declaration files that affects emit
- Legacy `import x = require(...)` syntax
- `<Type>value` assertion syntax (use `value as Type` instead)

**Development workflow:**
- Run source `.ts` files directly with `node` (Node 24 strips types natively)
- Type-check with `tsc --noEmit`
- Tests run directly against `.ts` source: `node --test test/**/*.test.ts`

**Build for publish:**
- `tsc` compiles to JavaScript in `dist/`
- Published package ships `dist/` (JS only) for compatibility
- `package.json` `bin` points to `dist/cli.js`
- `package.json` `types` points to `dist/cli.d.ts`

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noEmit": false,
    "skipLibCheck": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

Key `compilerOptions` notes:
- `erasableSyntaxOnly: true` — enforces that only erasable syntax is used (tsc will error on enums, namespaces, etc.)
- `verbatimModuleSyntax: true` — requires explicit `import type` for type-only imports (consistent with erasable semantics)
- `rewriteRelativeImportExtensions: true` — (TypeScript 5.7+) rewrites `.ts` → `.js` in compiled output, so source uses real `.ts` extensions (`import { foo } from './foo.ts'`) which Node 24 resolves natively, while `tsc` output uses `.js`
- `module: "NodeNext"` — ESM with Node.js resolution semantics

### package.json scripts

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "test": "node --test test/**/*.test.ts",
    "test:unit": "node --test test/unit/**/*.test.ts",
    "test:integration": "node --test test/integration/**/*.test.ts",
    "prepublishOnly": "npm run typecheck && npm run build"
  }
}
```

---

## Architecture

```
esm-imports-analyzer/
  package.json            # bin: "esm-imports-analyzer" -> dist/cli.js
  tsconfig.json
  src/
    cli.ts                # CLI entry point, arg parsing, spawns child process
    types.ts              # Shared type definitions (ImportRecord, ModuleNode, etc.)
    loader/
      register.ts         # --import entry: calls registerHooks() with resolve + load hooks
      hooks.ts            # resolve + load hook implementations, data collection, temp file write on exit
    analysis/
      tree-builder.ts     # Builds import tree from raw loader data
      cycle-detector.ts   # Finds circular dependencies in the graph
      grouper.ts          # Groups modules by package.json boundaries
      timing.ts           # Computes total times, sorts/ranks
    report/
      generator.ts        # Assembles the self-contained HTML file
      template.html       # HTML shell with embedded CSS/JS placeholders
      ui/
        graph.js          # Cytoscape.js graph initialization and interaction (plain JS, inlined into HTML)
        table.js          # Expandable tree table component (plain JS, inlined into HTML)
        cycles-panel.js   # Circular dependency panel (plain JS, inlined into HTML)
        filters.js        # Builtin toggle, search, grouping controls (plain JS, inlined into HTML)
        styles.css        # Dark theme, developer tool aesthetic
  dist/                   # tsc output (JS + .d.ts + sourcemaps) — published to npm
  test/
    unit/
      tree-builder.test.ts
      cycle-detector.test.ts
      grouper.test.ts
      timing.test.ts
    integration/
      fixtures/           # Small ESM projects for end-to-end tests (plain JS — they're what gets analyzed)
      loader.test.ts      # Tests the loader against fixtures
      report.test.ts      # Tests HTML generation
      cli.test.ts         # Tests full CLI flow
```

**Note on `src/report/ui/`:** These files remain plain JavaScript (not TypeScript) because they are inlined into the generated HTML report and run in the browser, not in Node.js. They have no access to our TypeScript types and are bundled as raw strings.

---

## Component Specifications

### 1. CLI (`src/cli.ts`)

**Responsibilities:**

- Parse arguments using `--` separator convention
- Generate a unique temp file path for data transport
- Set `NODE_OPTIONS` to inject our loader: `--import=<path-to-register.ts>` (in dev, Node 24 runs `.ts` natively; in published package, points to compiled `.js` in `dist/`)
- Set an env var `ESM_ANALYZER_TEMP_FILE` so the loader knows where to write
- Spawn the user's command as a child process, inheriting stdio
- Wait for the child to exit
- Read the temp file, run analysis, generate the HTML report
- Print the report path to stdout
- Clean up the temp file

**CLI interface:**

```
npx esm-imports-analyzer [options] -- <command> [command-args...]

Options:
  --output, -o <path>   Output HTML report path (default: ./esm-imports-report.html)
  --help, -h            Show help
  --version, -v         Show version
```

**Behavior:**

- If no `--` separator is found, print usage and exit with error
- If the child process exits with non-zero, still generate the report (imports collected before crash are valid), but print a warning
- If temp file doesn't exist or is empty after exit, print error explaining no imports were captured

### 2. Loader Registration (`src/loader/register.ts`)

**This file is the `--import` entry point.** It runs before the user's code. Node 24 loads `.ts` files natively (type stripping enabled by default).

**Responsibilities:**

1. Call `module.registerHooks()` to install resolve/load hooks (runs in-thread, not a separate worker)
2. Set up data collection state (import records array)
3. Register `process.on('exit')` handler to write collected data to temp file

**Why `registerHooks()` instead of `register()`:**

`module.registerHooks()` (stable in Node 24) runs hooks **on the same thread** as the application. This means:
- No need for `MessagePort` or `initialize()` — hooks close over shared variables directly
- Simpler architecture with no cross-thread communication

### 3. Loader Hooks (`src/loader/hooks.ts`)

**Runs in the main thread (same thread as application code, via `registerHooks()`).**

**Data collected per import:**

```typescript
interface ImportRecord {
  specifier: string; // The raw import specifier (e.g., "lodash/cloneDeep")
  resolvedURL: string; // Fully resolved file:// URL
  parentURL: string | null; // The module that imported this one (null for entry point)
  resolveStartTime: number; // performance.now() at resolve start
  resolveEndTime: number; // performance.now() at resolve end
  loadStartTime: number; // performance.now() at load start
  loadEndTime: number; // performance.now() at load end
}
```

**Hook implementations:**

`resolve(specifier, context, nextResolve)`:

- Record `resolveStartTime`
- Call `nextResolve(specifier, context)`
- Record `resolveEndTime`
- Store partial record, keyed by resolved URL
- Return the resolved result

`load(url, context, nextLoad)`:

- Record `loadStartTime`
- Call `nextLoad(url, context)`
- Record `loadEndTime`
- Complete the record for this URL
- Append to the collected records array
- Return the loaded result

**Note on timing:** `performance.now()` in the main thread. The `totalTime` for a module is `loadEndTime - resolveStartTime`. This includes the time to resolve + load the module itself AND all of its dependencies (since Node evaluates imports depth-first before returning from `load`).

### 4. Data Transport (integrated into `src/loader/register.ts`)

Since `registerHooks()` runs in-thread, data transport is simple — no cross-thread communication needed.

**Responsibilities:**

- Read the temp file path from `process.env.ESM_ANALYZER_TEMP_FILE`
- On `process.on('exit', ...)`: serialize all collected `ImportRecord[]` to JSON and write synchronously to the temp file using `writeFileSync`
- Use `process.on('beforeExit', ...)` as an additional safety net

**No separate `transport.ts` file needed** — this logic lives directly in `register.ts` since everything runs in the same thread and shares the same closure scope.

**Known limitation:** SIGKILL will lose all data. This is accepted and documented.

### 5. Tree Builder (`src/analysis/tree-builder.ts`)

**Input:** Array of `ImportRecord` objects from the temp file.

**Output:** A tree structure where each node is a module and edges represent "imported by" relationships.

```typescript
interface ModuleNode {
  resolvedURL: string;
  specifier: string;
  totalTime: number; // loadEndTime - resolveStartTime
  children: ModuleNode[]; // Modules this one imported
  parentURL: string | null;
}
```

**Algorithm:**

1. Index all records by `resolvedURL`
2. For each record, find its parent by `parentURL` and add it as a child
3. The root(s) are records with `parentURL === null` (entry points)
4. Handle the case where a module is imported by multiple parents (DAG, not tree): create a reference node that points to the canonical node, include timing from the first import only (subsequent imports of the same module are cached by Node and near-instant)

### 6. Cycle Detector (`src/analysis/cycle-detector.ts`)

**Input:** The module graph (adjacency list form).

**Output:** Array of cycles, each being an ordered array of module URLs forming the cycle.

**Algorithm:** Tarjan's strongly connected components (SCC) algorithm, then extract individual cycles from each SCC with DFS.

```typescript
interface Cycle {
  modules: string[]; // Ordered list of resolved URLs forming the cycle
  length: number; // Number of modules in the cycle
}
```

**Edge case:** Self-referential imports (a module importing itself) should be detected as a cycle of length 1.

### 7. Grouper (`src/analysis/grouper.ts`)

**Input:** Array of module URLs + the filesystem.

**Output:** Grouped modules with a group ID and label.

**Grouping strategy — package.json boundaries:**

1. For each resolved URL, walk up the directory tree until a `package.json` is found
2. The directory containing that `package.json` is the group boundary
3. Group label = the `name` field from `package.json`
4. For `node_modules` packages: this naturally resolves to the package name
5. For first-party code: this groups by the project root (single-package) or by workspace package (monorepo)
6. Cache `package.json` lookups to avoid redundant filesystem reads

```typescript
interface Group {
  id: string; // Hash or normalized path of the package.json directory
  label: string; // package.json "name" field
  packageJsonPath: string;
  modules: string[]; // Resolved URLs belonging to this group
  isNodeModules: boolean;
}
```

**Note:** The grouper runs at report generation time (after the analyzed process exits), so filesystem reads are fine.

### 8. Timing Analysis (`src/analysis/timing.ts`)

**Input:** The import tree.

**Output:** Flat ranked list + tree structure with timing data.

**What we compute:**

- `totalTime`: `loadEndTime - resolveStartTime` for each module (includes all descendants)
- Ranked list: all modules sorted by `totalTime` descending
- Tree structure: preserved parent-child relationships with `totalTime` at each level

**No self-time decomposition.** The user can infer relative cost by expanding the tree: if module A has `totalTime: 100ms` and its child B has `totalTime: 80ms`, then A's own code is ~20ms.

### 9. Report Generator (`src/report/generator.ts`)

**Responsibilities:**

- Read the HTML template
- Inline Cytoscape.js library + extensions (bundled at build time or fetched from node_modules)
- Inline all CSS and JS from `src/report/ui/`
- Embed the analysis JSON data as a `<script type="application/json" id="import-data">` tag
- Write the single self-contained HTML file

**Data embedded in HTML:**

```json
{
  "metadata": {
    "command": "node server.js",
    "timestamp": "2026-03-27T10:30:00Z",
    "nodeVersion": "v24.0.0",
    "totalModules": 1234,
    "totalTime": 2500
  },
  "modules": [
    /* ImportRecord[] */
  ],
  "tree": {
    /* ModuleNode root(s) */
  },
  "groups": [
    /* Group[] */
  ],
  "cycles": [
    /* Cycle[] */
  ]
}
```

### 10. HTML Report UI

#### Layout

```
+------------------------------------------------------------------+
| ESM Imports Analyzer                            [filters] [search]|
+------------------------------------------------------------------+
|                          |                                        |
|   Cycles Panel (left)    |        Graph View (center)             |
|                          |                                        |
|   - Cycle 1 (3 modules)  |   [grouped Cytoscape.js graph]        |
|   - Cycle 2 (5 modules)  |                                        |
|   - ...                  |                                        |
|                          |                                        |
+------------------------------------------------------------------+
|                                                                    |
|   Import Timing Table (bottom)                                     |
|                                                                    |
|   Module                    | Total Time | Imports      |
|   > lodash                  | 150ms      | 23           |
|     > lodash/cloneDeep      |  45ms      |  3           |
|       > lodash/_baseClone   |  30ms      |  7           |
|   > express                 | 890ms      | 156          |
|   ...                                                              |
+------------------------------------------------------------------+
```

#### Graph View (`src/report/ui/graph.js`)

**Library:** Cytoscape.js with extensions:

- `cytoscape-cose-bilkent` — clustered layout algorithm
- `cytoscape-expand-collapse` — interactive group expand/collapse

**Default state:** All groups collapsed. Each group node shows:

- Package name
- Number of modules inside
- Total time for all modules in the group
- Edge count to/from other groups

**Interactions:**

- Double-click a group to expand it (shows individual modules inside)
- Double-click again to collapse
- Hover on a node: tooltip with full resolved path, total time
- Hover on an edge: shows the import specifier
- Click a node: highlight all edges (incoming + outgoing)
- Zoom and pan via mouse/trackpad
- Cycle edges: colored distinctly (e.g., red/orange) when a cycle is selected in the panel

**Edge styling:**

- Default: solid lines
- Cycle edges: red/orange when highlighted

**Node styling:**

- Color intensity based on total time (heatmap: green = fast, yellow = medium, red = slow)
- Size based on number of imports (larger = more dependencies)
- Builtin modules: dimmed/gray (when visible)

#### Cycles Panel (`src/report/ui/cycles-panel.js`)

- Left sidebar, collapsible
- Lists all detected cycles sorted by cycle length (shortest first)
- Each cycle entry shows: number of modules, list of module names
- Clicking a cycle:
  1. Highlights cycle edges in the graph (red/orange)
  2. Zooms the graph to fit the cycle
  3. Expands any groups that contain cycle members
- "Clear highlight" button to reset

#### Import Timing Table (`src/report/ui/table.js`)

- Bottom panel, resizable
- Default: shows root-level imports (entry point's direct dependencies) sorted by total time descending
- Each row: module name (display name), total time (ms), number of child imports
- Expandable rows: click the chevron to show what this module imported, recursively
- Column sorting: click headers to sort by time, name, import count
- Search/filter: text input to filter by module name
- Click a row: highlights the corresponding node in the graph and zooms to it

#### Filters (`src/report/ui/filters.js`)

- **Show builtins** toggle (default: off)
- **Search** text input: filters both graph and table
- **Time threshold** slider: hide modules below N ms (useful for focusing on slow imports)

#### Styles (`src/report/ui/styles.css`)

- Dark theme by default (dark gray backgrounds, light text)
- Monospace font for module paths and timing data
- Sans-serif for UI labels and headers
- Color palette: muted blues, greens, grays; red/orange for warnings/cycles
- Resizable panels (CSS resize or drag handles)
- Responsive: works in any modern browser at any reasonable width

---

## Data Flow

```
1. User runs:
   npx esm-imports-analyzer -- node app.js

2. CLI (cli.ts):
   - Parses args
   - Creates temp file path: /tmp/esm-analyzer-<uuid>.json
   - Sets NODE_OPTIONS="--import=<register.ts>"
   - Sets ESM_ANALYZER_TEMP_FILE=/tmp/esm-analyzer-<uuid>.json
   - Spawns: node app.js (with modified env)
   - Note: Node 24 natively runs .ts files (type stripping)

3. In the child process:
   - register.ts runs first (Node 24 strips types natively):
     a. Calls module.registerHooks() with resolve + load hooks (in-thread, same thread as app)
     b. Registers process.on('exit') handler for data flush
   - hooks run in the same thread as the app:
     a. resolve() + load() hooks fire for every import
     b. Records timing and parent-child relationships for each module
   - The user's app.js runs normally

4. Child process exits:
   - process.on('exit') handler writes ImportRecord[] JSON to temp file (writeFileSync)

5. CLI reads temp file:
   - tree-builder.ts -> builds import tree
   - cycle-detector.ts -> finds cycles
   - grouper.ts -> groups by package.json boundaries (reads filesystem)
   - timing.ts -> computes rankings

6. Report generator:
   - Assembles self-contained HTML with embedded JSON
   - Writes to --output path (default: ./esm-imports-report.html)
   - Prints path to stdout
```

---

## Edge Cases and Error Handling

| Scenario                                | Handling                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| No `--` separator in CLI args           | Print usage, exit 1                                                                                 |
| Child process exits non-zero            | Still generate report (partial data is useful), print warning                                       |
| Child process receives SIGKILL          | Data lost. Print error: "Process was killed, no data collected"                                     |
| Temp file empty/missing after exit      | Print error explaining no imports were captured                                                     |
| Module imported by multiple parents     | Track all parent relationships (DAG). Timing recorded for first import only (subsequent are cached) |
| Self-referential import                 | Detected as cycle of length 1                                                                       |
| Circular imports                        | Normal in ESM (Node handles them). Detect and flag in UI, not an error                              |
| `node:` protocol builtins               | Track but hide by default. Group separately as "Node.js Builtins"                                   |
| `data:` or `blob:` URLs                 | Track with URL as-is. Group as "Inline Modules"                                                     |
| Very large graphs (5000+ modules)       | Cytoscape handles this. Collapsed groups are key. Add "top N" filter for graph if needed            |
| Command uses its own `NODE_OPTIONS`     | Our `--import` is prepended to existing `NODE_OPTIONS` (don't overwrite)                            |
| No imports captured (e.g., CJS project) | Print warning: "No ESM imports detected. Is the project using ESM?"                                 |
| Package.json not found for a module     | Group as "Ungrouped" with the nearest directory as label                                            |

---

## Testing Plan

### Unit Tests

All unit tests use `node:test` with `node:assert/strict`. Test files are `.ts` and run directly via `node --test` (Node 24 strips types natively).

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
```

#### `test/unit/tree-builder.test.ts`

| Test                             | Description                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Single root, linear chain        | A -> B -> C. Verify tree structure and parent/child relationships                   |
| Single root, branching           | A -> B, A -> C. Both children under A                                               |
| Multiple roots                   | Two entry points with separate trees                                                |
| Diamond dependency               | A -> B, A -> C, B -> D, C -> D. D appears under both B and C with proper references |
| Duplicate imports (cached)       | Same module imported twice. Only first import has real timing; second is near-zero  |
| Empty input                      | No records. Returns empty tree                                                      |
| Single module (entry point only) | One record with no parent. Returns tree with one node, no children                  |
| Ordering                         | Children ordered by load start time                                                 |

#### `test/unit/cycle-detector.test.ts`

| Test                        | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| No cycles                   | Simple DAG. Returns empty array                              |
| Simple cycle (A -> B -> A)  | Detects one cycle of length 2                                |
| Self-referential (A -> A)   | Detects cycle of length 1                                    |
| Multiple independent cycles | Two separate cycles in the graph. Both detected              |
| Overlapping cycles          | A -> B -> C -> A and B -> D -> B. All cycles found           |
| Large cycle (10+ modules)   | Performance: should complete in <100ms for a 10-module cycle |
| Cycle in subgraph only      | Main graph is acyclic, but a subtree has a cycle             |
| Diamond (not a cycle)       | A -> B -> D, A -> C -> D. Should NOT be detected as a cycle  |

#### `test/unit/grouper.test.ts`

| Test                            | Description                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| Single package project          | All files group under one package.json name                               |
| Monorepo with workspaces        | Files from `packages/foo/` and `packages/bar/` group separately           |
| node_modules packages           | `node_modules/lodash/index.js` groups under "lodash"                      |
| Scoped packages                 | `node_modules/@scope/pkg/index.js` groups under "@scope/pkg"              |
| Nested node_modules             | `node_modules/a/node_modules/b/` groups "b" separately from top-level "b" |
| No package.json found           | Falls back to "Ungrouped" with directory path                             |
| `node:` builtins                | Group as "Node.js Builtins"                                               |
| `data:` URLs                    | Group as "Inline Modules"                                                 |
| Package.json without name field | Use directory name as label                                               |

#### `test/unit/timing.test.ts`

| Test                                | Description                                            |
| ----------------------------------- | ------------------------------------------------------ |
| Ranked list sorted descending       | Modules sorted by total time, highest first            |
| Total time calculation              | `loadEndTime - resolveStartTime` computed correctly    |
| Zero-time modules (cached)          | Cached re-imports show ~0ms, ranked last               |
| Tree preserves timing at each level | Parent and child both have their own total times       |
| Single module                       | Works with just one module                             |
| Identical times                     | Stable sort (preserve insertion order for equal times) |

### Integration Tests

#### Fixtures (`test/integration/fixtures/`)

Each fixture is a small ESM project with known import characteristics:

```
fixtures/
  simple/                 # A imports B, B imports C (linear chain)
    package.json
    a.js
    b.js
    c.js
  circular/               # A -> B -> C -> A (circular dependency)
    package.json
    a.js
    b.js
    c.js
  deep/                   # 20+ levels deep nesting
    package.json
    level-0.js ... level-20.js
  wide/                   # A imports 50 modules (wide fan-out)
    package.json
    a.js
    dep-0.js ... dep-49.js
  node-modules/           # Uses real node_modules (install via npm)
    package.json          # depends on a small package like "ms"
    a.js
  builtins/               # Imports node:fs, node:path, etc.
    package.json
    a.js
  slow/                   # Module with artificial delay (setTimeout in top-level)
    package.json
    a.js                  # top-level await with 100ms delay
    b.js
  monorepo/               # Simulated monorepo structure
    package.json
    packages/
      foo/
        package.json
        index.js
      bar/
        package.json
        index.js          # imports from foo
  self-import/            # Module that imports itself
    package.json
    a.js
```

#### `test/integration/loader.test.ts`

| Test                           | Fixture                       | Assertions                                                       |
| ------------------------------ | ----------------------------- | ---------------------------------------------------------------- |
| Captures linear imports        | `simple/`                     | 3 modules captured (A, B, C), correct parent-child relationships |
| Captures circular deps         | `circular/`                   | All 3 modules captured, cycle detector finds the cycle           |
| Handles deep nesting           | `deep/`                       | All 21 modules captured with correct chain                       |
| Handles wide fan-out           | `wide/`                       | All 51 modules captured, all children of A                       |
| Captures node_modules          | `node-modules/`               | The dependency package's modules are captured                    |
| Captures builtins              | `builtins/`                   | `node:fs`, `node:path` appear in records                         |
| Records timing data            | `slow/`                       | Module A's total time is >= 100ms                                |
| Produces valid JSON            | `simple/`                     | Temp file contains valid JSON parseable as ImportRecord[]        |
| Non-zero exit code still works | (special fixture that throws) | Report is still generated from collected data                    |

#### `test/integration/report.test.ts`

| Test                              | Description                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| HTML is valid                     | Generated HTML passes basic structure checks (has `<html>`, `<body>`, etc.)        |
| JSON data is embedded             | `<script type="application/json" id="import-data">` exists and contains valid JSON |
| Cytoscape.js is inlined           | HTML contains the Cytoscape library code (no external requests)                    |
| CSS is inlined                    | HTML contains style tags (no external stylesheet links)                            |
| All modules present in data       | Embedded JSON contains all expected modules from fixture                           |
| Groups are computed               | Embedded JSON contains groups array with correct groupings                         |
| Cycles are included               | For circular fixture, embedded JSON contains the cycle                             |
| File is written to specified path | `--output /tmp/test-report.html` writes to that path                               |
| Default output path               | Without `--output`, writes to `./esm-imports-report.html`                          |

#### `test/integration/cli.test.ts`

| Test                            | Description                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Basic invocation                | `npx esm-imports-analyzer -- node fixtures/simple/a.js` succeeds, produces HTML |
| Missing `--` separator          | Prints usage, exits 1                                                           |
| `--output` flag                 | Custom output path works                                                        |
| `--help` flag                   | Prints help, exits 0                                                            |
| `--version` flag                | Prints version, exits 0                                                         |
| Preserves existing NODE_OPTIONS | If `NODE_OPTIONS` already set, our `--import` is prepended                      |
| Child stdout/stderr passthrough | Child's output is visible (not swallowed)                                       |
| Exit code forwarding            | If child exits with code 1, CLI still generates report but warns                |
| Report path printed to stdout   | After generation, the absolute path is printed                                  |
| Command with flags              | `-- node --experimental-vm-modules app.js` passes flags correctly               |

### Performance / Stress Tests

| Test            | Description                                                             |
| --------------- | ----------------------------------------------------------------------- |
| 1000 modules    | Generate a fixture with 1000 modules. Full pipeline completes in <10s   |
| 5000 modules    | Cytoscape grouped view renders in <5s (test in headless browser)        |
| Timing overhead | Compare startup time with and without analyzer. Overhead should be <20% |

### Manual / Visual Testing Checklist

These tests verify the interactive UI and should be run manually in a browser:

- [ ] Graph renders with groups collapsed
- [ ] Double-click group to expand, shows child modules
- [ ] Double-click again to collapse
- [ ] Hover on node shows tooltip (full path, time)
- [ ] Hover on edge shows import specifier
- [ ] Node colors reflect timing (green -> yellow -> red gradient)
- [ ] Click a cycle in the panel -> edges highlight, graph zooms to cycle
- [ ] "Clear highlight" resets cycle highlighting
- [ ] Table shows modules sorted by total time
- [ ] Expand a table row to see child imports
- [ ] Click a table row -> graph zooms to that node
- [ ] Search/filter works in both table and graph
- [ ] "Show builtins" toggle shows/hides builtin modules
- [ ] Time threshold slider filters modules below threshold
- [ ] Panel resizing works (cycles panel, table panel)
- [ ] Dark theme renders correctly
- [ ] Works in Chrome, Firefox, Safari (latest versions)

---

## Dependencies

### Runtime (shipped in the package)

- None for the loader (pure Node.js APIs)

### Bundled into HTML report (inlined at build time)

- `cytoscape` — Graph visualization (~280KB min)
- `cytoscape-cose-bilkent` — Clustered layout (~25KB min)
- `cytoscape-expand-collapse` — Expand/collapse interaction (~15KB min)

### Dev dependencies

- `typescript` — Type-checking (`tsc --noEmit`) and building (`tsc`) to JS for npm publish
- `@types/node` — Node.js type definitions
- `node:test` — Built-in test runner (no external test framework)
- `esbuild` or `rollup` — To bundle the report UI code + libraries into inline-able chunks

---

## Build Process

### TypeScript compilation (for npm publish)

`tsc` compiles `src/**/*.ts` to `dist/**/*.js` + `.d.ts` + sourcemaps. The published npm package contains only the `dist/` output.

```
src/cli.ts          ->  dist/cli.js         (bin entry point)
src/types.ts        ->  dist/types.js       (+ .d.ts)
src/loader/*.ts     ->  dist/loader/*.js
src/analysis/*.ts   ->  dist/analysis/*.js
src/report/*.ts     ->  dist/report/*.js
```

### Development vs Production

- **Development:** Run `.ts` files directly with `node` (Node 24 native type stripping). No build step needed for dev/test.
- **Production (npm publish):** `npm run prepublishOnly` runs `tsc --noEmit` (type-check) then `tsc` (emit JS). Package ships `dist/`.
- **Loader in published package:** The `--import` flag points to `dist/loader/register.js` (compiled). When developing locally, it points to `src/loader/register.ts` (run natively by Node 24).

### Report UI bundling

The report UI code (Cytoscape + extensions + our JS/CSS) needs to be bundled into strings that the report generator can inline into the HTML template.

**Build step:**

1. Bundle `src/report/ui/*.js` + Cytoscape dependencies into a single IIFE JS file
2. Bundle `src/report/ui/styles.css` into a single CSS file
3. The report generator reads these bundled files and inlines them into the HTML template

**Alternative (simpler):** At report generation time, read the files from `node_modules` and `src/report/ui/` directly and concatenate them. No build step needed. Slightly slower report generation but much simpler toolchain.

---

## Resolved Questions

1. **~~`globalThis.import()` hooking~~** — **Resolved.** `import()` is a language syntax form, not a function on `globalThis` — it cannot be monkey-patched. The `resolve` hook context has no `importKind` field. There is no reliable way to distinguish static from dynamic imports. **Decision: drop static/dynamic distinction entirely.** All imports are treated uniformly.

2. **~~`register()` + `initialize()` data passing~~** — **Resolved.** Not needed. We use `module.registerHooks()` which runs in-thread, so hooks close over shared variables directly. The temp file path is read from `process.env.ESM_ANALYZER_TEMP_FILE`.

3. **~~Loader hooks thread and TypeScript~~** — **Resolved.** `module.registerHooks()` runs in the main thread (no separate hooks thread). But even if we used `module.register()`, Node 24 does apply type stripping to the hooks worker thread. `.ts` files work with both APIs. Type stripping is enabled by default since Node v23.6.0.

4. **~~Import specifier extensions~~** — **Resolved.** Use `.ts` extensions in all source imports (`import { foo } from './foo.ts'`). TypeScript 5.7+ `rewriteRelativeImportExtensions: true` in tsconfig rewrites `.ts` → `.js` in compiled output. Node 24 resolves `.ts` extensions natively at dev time.

## Remaining Open Questions

1. **Cytoscape bundle size**: If the inlined report exceeds ~2MB, consider lazy-loading from CDN with a fallback notice, or compressing the inline JS with gzip and decompressing in-browser. Not a concern for now — address if it becomes a problem.

## Resolved Timing Accuracy Question

**Timing accuracy with in-thread hooks** — **Resolved, not a concern.** Benchmarked on Node.js v24.14.1:

- `registerHooks()` passthrough overhead: ~0-4 us per module (indistinguishable from no-hooks baseline)
- 4x `performance.now()` + object creation + array push: ~0.2 us per module (<0.4% of even trivial module loads)
- Hook dispatch latency (gap before our `performance.now()` fires): ~3-5 us — means we slightly **undercount** true load time, not overcount
- Real-world impact on `express` (156 modules, 33ms total): ~0.077ms total instrumentation overhead (0.23%)

**Documentation note to include in the report:** "Timing measurements have approximately 3-5 microseconds of systematic undercount per import due to internal Node.js module resolution overhead. The instrumentation itself adds less than 0.2 microseconds per import. For modules that take more than 0.1ms to load, these overheads are negligible (<1%)."
