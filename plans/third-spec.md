# ESM Imports Analyzer — Current Spec (March 2026)

This document describes the implemented state of the project. Use it to recover context in a new session.

## What It Does

A CLI tool that injects a loader hook into any Node.js command, captures all ESM imports with timing, and generates a self-contained HTML report with an interactive graph visualization and timing table.

```bash
npx esm-imports-analyzer [--output path] -- <command-to-run>
```

Requires Node.js 24+. Written in erasable-only TypeScript (runs natively with Node 24 type stripping).

---

## Architecture

```
src/
  cli.ts                    # CLI entry point, spawns child process, orchestrates analysis
  types.ts                  # All shared interfaces
  loader/
    register.ts             # --import entry: registerHooks() + process exit flush
    hooks.ts                # resolve + load hooks, timing capture
  analysis/
    tree-builder.ts         # Builds import tree from raw records
    cycle-detector.ts       # Tarjan's SCC for circular dependencies
    grouper.ts              # Groups modules by package.json boundaries
    folder-tree.ts          # Builds hierarchical folder tree within each group
    timing.ts               # Ranked timing list + total execution span
  report/
    generator.ts            # Assembles self-contained HTML
    template.html           # HTML shell with placeholders
    ui/
      graph.js              # Cytoscape.js graph (plain JS, inlined into HTML)
      table.js              # Slowest modules table (plain JS)
      cycles-panel.js       # Cycles sidebar (plain JS)
      filters.js            # Search wiring (plain JS)
      styles.css            # Dark theme CSS
test/
  unit/                     # Tests for each analysis module + folder-tree
  integration/              # Loader, report, CLI tests
    fixtures/               # simple, circular, deep, wide, builtins, slow, monorepo,
                            # self-import, node-modules, no-name-pkg, nested,
                            # nested-pkg-json
  performance/              # 1000 and 5000 module benchmarks
```

**Note:** `src/report/ui/` files are plain JS (not TypeScript) because they run in the browser, inlined into the HTML report.

---

## Data Flow

1. **CLI** parses args, creates temp file path, sets `NODE_OPTIONS=--import=<register.ts>` and `ESM_ANALYZER_TEMP_FILE`, spawns user's command
2. **Loader** (`register.ts`) calls `module.registerHooks()` (in-thread, Node 24). Hooks record resolve+load timing for every import. On process exit, writes `ImportRecord[]` JSON to temp file
3. **CLI** reads temp file, runs analysis pipeline:
   - `buildTree()` -> import tree
   - `detectCycles()` -> circular dependencies (Tarjan's SCC)
   - `groupModules()` -> groups by package.json boundaries + builds `folderTree` per group (deduplicates URLs)
   - `computeRankedList()` / `computeTotalTime()` -> timing stats
4. **Generator** reads template + UI files, uses `split/join` substitution (not `String.replace`, to avoid `$`-pattern issues), embeds data as `<script type="application/json">`, writes single HTML file
5. **HTML report** loads Cytoscape.js from CDN, runs dagre layout in a Web Worker

---

## Key Types (`src/types.ts`)

```typescript
interface ImportRecord {
  specifier: string;        // Raw import specifier
  resolvedURL: string;      // Fully resolved file:// URL
  parentURL: string | null; // Module that imported this one
  resolveStartTime: number; // performance.now() timestamps
  resolveEndTime: number;
  loadStartTime: number;
  loadEndTime: number;
}

interface ModuleNode {
  resolvedURL: string;
  specifier: string;
  totalTime: number;        // (resolveEnd - resolveStart) + (loadEnd - loadStart)
  children: ModuleNode[];
  parentURL: string | null;
}

interface Cycle { modules: string[]; length: number; }

interface FolderTreeNode {
  id: string;               // ftree::<groupId>::<path> for folders, resolvedURL for files
  label: string;            // Display label (may be flattened path like "src/utils")
  type: 'folder' | 'file';
  moduleURL?: string;       // For files: the resolvedURL
  children: FolderTreeNode[];
}

interface Group {
  id: string;               // Resolved package directory path
  label: string;            // package.json "name" field
  packageJsonPath: string;
  modules: string[];        // Unique resolvedURLs in this group (deduplicated)
  isNodeModules: boolean;
  folderTree?: FolderTreeNode[];  // Hierarchical folder structure
}

interface ReportData {
  metadata: { command, timestamp, nodeVersion, totalModules, totalTime };
  modules: ImportRecord[];
  tree: ModuleNode[];
  groups: Group[];
  cycles: Cycle[];
}
```

---

## Timing Model

All timing uses **self-time**, not wall-clock span:

- **Module self-time**: `(resolveEndTime - resolveStartTime) + (loadEndTime - loadStartTime)` — actual time spent resolving + loading this module, excluding time spent on other modules loaded in between
- **Resolve time**: time spent locating the module on disk (filesystem lookups, package.json exports resolution)
- **Load time**: time spent reading and parsing the module source from disk
- **Total execution time** (metadata): `max(loadEndTime) - min(resolveStartTime)` across all records — the full wall-clock span of all module loading
- **Neither captures execution time** — the time a module's top-level code takes to run is not instrumented

---

## Loader Hooks (`src/loader/hooks.ts`)

- Uses `module.registerHooks()` (Node 24 in-thread API)
- `resolve` hook: records timing. If module already loaded (cached/circular), emits record immediately with near-zero load time. Otherwise queues a pending resolve
- `load` hook: matches pending resolve by URL, emits complete record
- Captures circular dependency back-edges (the resolve fires but load doesn't for cached modules)

---

## Analysis Modules

### Tree Builder (`src/analysis/tree-builder.ts`)
- First occurrence of each URL wins (subsequent cached imports ignored)
- Children ordered by `loadStartTime`
- Orphaned nodes (parent not found) become roots
- totalTime = self-time (resolve + load)

### Cycle Detector (`src/analysis/cycle-detector.ts`)
- Tarjan's SCC algorithm
- Extracts individual cycles from each SCC via DFS
- Deduplicates rotations of same cycle
- Sorted by length (shortest first)

### Grouper (`src/analysis/grouper.ts`)
- `node:` URLs -> "Node.js Builtins" group
- `data:` URLs -> "Inline Modules" group
- `file:` URLs -> walks up to find `package.json`, groups by package root
- No `package.json` found -> "Ungrouped"
- **Deduplicates URLs**: each module counted once per group (prevents inflated counts)
- **node_modules handling**: `getNodeModulesPackageRoot()` extracts the correct package root from the path structure (handles regular, scoped `@scope/pkg`, and pnpm `.pnpm` layouts) — skips nested `package.json` files inside packages
- After grouping, calls `buildFolderTree()` for each group with a `packageJsonPath`

### Folder Tree (`src/analysis/folder-tree.ts`)
- Builds a trie from relative file paths within each package
- **Auto-flatten rule:** keep merging while a folder has exactly 1 child (folder or file). Stop when 2+ children found
- Folder IDs: `ftree::<groupId>::<relativePath>`. File IDs: original `resolvedURL`
- Skips non-`file://` URLs

### Timing (`src/analysis/timing.ts`)
- `computeRankedList()`: unique modules sorted by self-time descending
- `computeTotalTime(records)`: `max(loadEndTime) - min(resolveStartTime)` — full execution span

---

## HTML Report UI

### Layout
```
+-------------------------------------------------------------------+
| Header: title | metadata | Search | Expand/Collapse | Re-layout   |
+-------------------------------------------------------------------+
|  Cycles Panel  |              Graph View                          |
|  (left sidebar)|  (Cytoscape.js + dagre in Web Worker)            |
|                |                                                   |
+----------------+---------------------------------------------------+
|                Slowest Modules Table (bottom, resizable)           |
+-------------------------------------------------------------------+
```

### CDN Dependencies
- `cytoscape@3.31.0` — loaded via `<script>` from unpkg
- `dagre@0.7.4` — loaded inside Web Worker via `importScripts()`

### Header
- Title: "ESM Imports Analyzer"
- Metadata: command name, module count (no time display)
- Search input, Expand all / Collapse all / Re-layout buttons, Auto re-layout checkbox

### Graph (`src/report/ui/graph.js`)

**Graph layout:** Dagre (hierarchical DAG, top-to-bottom) computed in a Web Worker. Shows "Computing layout..." overlay with spinner during computation. Config: `nodeSep: 60, edgeSep: 20, rankSep: 80`.

**Node types:**
- **Group nodes** (compound/parent): package bounding boxes, round-rectangle, semi-transparent background (`background-opacity: 0.75`)
  - `node_modules` packages: dashed border
  - Collapsed: centered label, thicker border. Width computed from label length. Expanded: label at top
  - **Single-module packages never collapse** — always shown expanded
- **Folder nodes** (regular, not compound): round-rectangle, gray, inside package bounding box
  - Disappear when expanded, replaced by their children
- **Module nodes** (regular): uniform 24x24 circles, accent blue (`#89b4fa`), no time-based coloring/sizing
  - Builtins: dashed border, muted color. Always visible.

**Edge types:**
- **Real edges**: taxi-style (orthogonal) routing, downward direction
- **Meta-edges**: bezier curves, labeled with import count. Created dynamically when groups/folders are collapsed
- **No default cycle edge styling** — cycle edges look like normal edges until a cycle is selected

**Collapse/Expand behavior:**
- All packages start collapsed (except single-module packages)
- Double-click group -> toggle expand/collapse (disabled for single-module packages)
- Expanding a package shows its top-level `folderTree` children
- Double-click a folder -> folder disappears, its children appear inside the package bounding box
- Folders cannot be individually re-collapsed. Collapsing the package resets all folder expansion
- "Expand all" button: expands all packages and all folders recursively
- "Collapse all" button: collapses everything except single-module packages

**Auto re-layout:** Checkbox (default: checked). When enabled, `runLayout()` is called automatically after every expand/collapse action.

**Meta-edge resolution:** `resolveVisibleNode(cy, moduleURL)` walks up the parent-folder chain to find the nearest visible ancestor. Used by `refreshEdgeVisibility()` which removes old meta-edges, checks each real edge's endpoints, and creates meta-edges between the effective visible nodes.

**Selection highlighting (directional):**
- Click a node to select. Shift/Ctrl/Cmd+click for multi-select
- Selected node: purple border (`#cba6f7`)
- Outgoing edges + targets: blue (`#89b4fa`)
- Incoming edges + sources: green (`#a6e3a1`)
- **Cycle edges in neighborhood: yellow (`#f9e2af`)** — edges that are part of any cycle get yellow highlight with higher z-index when within selection's highlighted edges
- Everything else: dimmed (20% opacity)
- Expanded groups: same directional highlight as collapsed, children + internal edges stay undimmed

**Cycle highlighting:**
- Cycle edges have NO default styling (look like normal edges)
- Selecting a cycle in the panel: collapse all -> reveal just enough for cycle members -> relayout -> apply orange (`#fab387`) highlight to cycle nodes and edges -> zoom to fit (includes parent groups)
- Always collapses and re-expands, even if cycle was already visible
- Node selection (purple) takes precedence over cycle highlight (orange); non-neighbor cycle nodes dim normally
- Clicking empty space does NOT clear cycle highlight — only "Clear highlight" button does
- Clear highlight: collapse all -> clear selections -> relayout -> zoom to fit entire graph

**Auto-highlight suppression:** `suppressAutoSelect` flag prevents `expandGroup`/`collapseGroup`/`expandFolder` from auto-selecting nodes during programmatic operations (`highlightCycle`, `clearHighlights`, `focusOnNode`, `expandImporters`).

**Search (`filterBySearch`):**
- Highlights (not hides) matching nodes by label or full path
- If a match is inside a collapsed group/folder, highlights the collapsed ancestor
- Uses the standard selection highlight system
- Clearing search clears highlight
- **Search is automatically cleared** when user clicks a node, clicks empty space, double-clicks empty space, selects a cycle, or clicks a table row

**Right-click context menu:**
- Right-clicking any node shows a floating menu with:
  1. **Copy absolute path**: copies the filesystem path (strips `file://` prefix). Uses `textarea` + `execCommand('copy')` fallback for `file://` context compatibility
  2. **Expand importers**: finds all modules that import the selected node (or any module inside it for groups/folders), reveals them with minimal expansion, relayouts, then selects the original node
- Menu dismissed by clicking anywhere else

**Double-click empty area:** Clears node selection and search, zooms to fit entire graph. Does NOT clear cycle highlight.

**Tooltips:** Hover on module -> full path + self-time. Hover on folder -> folder path. No edge tooltips.

### Table (`src/report/ui/table.js`)

**Title row:** "Slowest modules" on the left, "Count: [input]" on the right (default 20).

**Columns:** Module | Total Time | Resolve | Load | Imports — all always visible.
- Each column header has a ⓘ tooltip icon explaining the metric
- All time columns right-aligned, monospace font
- No colored bars — just plain numbers

**Sort = filter:** Sorting by any column changes which N modules are shown as root rows:
- Sort by Total Time -> N slowest by self-time
- Sort by Resolve -> N slowest by resolve time
- Sort by Load -> N slowest by load time
- Sort by Imports -> N with most recursive imports
- Sort by Module -> N slowest by time (default set), alphabetically sorted

**Root rows:** Show absolute filesystem path (file:// prefix stripped). Child rows show the relative import specifier.

**Tree behavior:** Each root row is expandable (chevron) showing its imports as children, recursively. Same module may appear as both a root row and nested under another module's children (intentional duplication).

**Click behavior (`focusOnNode`):**
- If the target module is already visible in the graph -> just select + zoom (no relayout)
- If not visible -> collapse all -> reveal just enough (expand group + ancestor folders) -> relayout -> select + zoom

**Search:** Filters top-level rows only (depth 0) by URL or text content.

### Cycles Panel (`src/report/ui/cycles-panel.js`)
- Left sidebar, collapsible
- Lists cycles sorted by length
- Each cycle item has a copy button (clipboard icon, visible on hover) that copies full absolute paths: `/abs/path/a.js -> /abs/path/b.js -> /abs/path/a.js`
- Click cycle -> collapse all -> reveal cycle members -> relayout -> orange highlight -> zoom to fit
- "Clear highlight" button -> collapse all -> clear everything -> relayout -> zoom to fit

### Filters (`src/report/ui/filters.js`)
- Wires search input to `filterBySearch()` (graph) and `tableApi.filter()` (table)

### Styles (`src/report/ui/styles.css`)
- Dark theme (Catppuccin Mocha): `#1e1e2e` primary bg, `#cdd6f4` text
- Color palette: accent blue `#89b4fa`, green `#a6e3a1`, orange `#fab387`, red `#f38ba8`, yellow `#f9e2af`, purple `#cba6f7`
- Monospace font for paths, sans-serif for labels
- Layout overlay with spinner animation
- Resizable panels via drag handle
- Context menu with shadow and hover states

---

## CLI (`src/cli.ts`)

```
esm-imports-analyzer [options] -- <command> [command-args...]

Options:
  --output, -o <path>   Output path (default: ./esm-imports-report.html)
  --help, -h            Show help
  --version, -v         Show version
```

- `--` separator required (prints usage and exits 1 if missing)
- Prepends `--import=<register>` to existing `NODE_OPTIONS` (doesn't overwrite)
- Child process inherits stdio
- Non-zero child exit -> still generates report, prints warning
- Missing/empty temp file -> error explaining no ESM imports captured

---

## Build & Package

```json
{
  "bin": { "esm-imports-analyzer": "dist/cli.js" },
  "files": ["dist"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "rm -rf dist && tsc && cp -r src/report/ui dist/report/ui && cp src/report/template.html dist/report/template.html",
    "test": "node --test test/**/*.test.ts",
    "prepublishOnly": "npm run typecheck && npm run build"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "typescript": "^6.0.2"
  }
}
```

- Zero runtime dependencies (cytoscape loaded from CDN in the report)
- Build: `tsc` + copy UI assets to dist
- Dev: run `.ts` files directly with Node 24

---

## Test Summary

| Suite | Tests | What |
|-------|-------|------|
| unit/tree-builder | 10 | Tree building, dedup, ordering, diamond DAG, self-time |
| unit/cycle-detector | 9 | Tarjan's SCC, self-refs, overlapping, performance |
| unit/grouper | 10 | Package grouping, builtins, monorepo, scoped, ungrouped, nested pkg.json |
| unit/timing | 8 | Ranking, dedup, stable sort, zero-time, execution span |
| unit/folder-tree | 11 | Flatten logic, single-child chains, mixed, IDs |
| integration/loader | 8 | Hook capture for all fixture types |
| integration/report | 8 | HTML structure, embedded data, CDN, CSS |
| integration/cli | 12 | Args, flags, NODE_OPTIONS, exit codes |
| performance | 2 | 1000 and 5000 module benchmarks |
| **Total** | **78** | |

Run all: `node --test test/unit/*.test.ts test/integration/*.test.ts test/performance/*.test.ts`

---

## Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Timing model | Self-time (resolve + load) | Wall-clock span was misleading — included unrelated work |
| Total time | max(loadEnd) - min(resolveStart) | True execution span, not max root time |
| Layout algorithm | Dagre (hierarchical DAG) | Clear top-to-bottom flow for dependency trees |
| Layout execution | Web Worker | Avoids blocking main thread |
| Layout spacing | nodeSep:60 edgeSep:20 rankSep:80 | Prevents package node overlap |
| Graph library | Cytoscape.js via CDN | No bundling needed, works offline after load |
| Module nodes | Uniform size/color (24x24, accent blue) | No time-based visual encoding on nodes |
| Package opacity | 0.75 background-opacity | Edges behind packages visible |
| Folder grouping | Auto-flatten single-child folders | Minimize clicks to reach content |
| Folder nodes | Regular nodes (not compound) | No nested bounding boxes, simpler layout |
| Single-module packages | Never collapse | No point hiding a single node |
| Collapse scope | Package level only | Folders can't be individually re-collapsed |
| Meta-edges | Dynamic creation/removal | Show connections between collapsed entities |
| Selection | Directional (in=green, out=blue, selected=purple) | Quickly understand dependency direction |
| Cycle edges in selection | Yellow (#f9e2af) | Distinct from blue/green, signals circular deps |
| Cycle panel highlight | Orange (#fab387), collapse-first | Always resets view for consistent framing |
| Cycle edges default | No styling until selected | Reduces visual noise |
| Search | Highlight (not hide) | See matches in context of the full graph |
| Search clearing | Auto-clear on user interaction | Prevents stale search state |
| Table sort = filter | Different root set per metric | Each column is a different analytical view |
| Table root display | Absolute path | Clear identification vs relative specifier |
| Template substitution | `split/join` not `String.replace` | Avoid `$` pattern interpretation in JS content |
| Builtins | Always visible, grouped | Were toggle-hidden, changed to always-on |
| Auto re-layout | Default on | Immediate feedback on expand/collapse |
| Clipboard | execCommand fallback | navigator.clipboard unavailable in file:// context |
| node_modules grouping | Path-based package root detection | Skips nested package.json files reliably |
| Context menu | Copy path + Expand importers | Quick access to common analysis actions |
