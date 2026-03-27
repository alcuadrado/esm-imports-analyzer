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
    timing.ts               # Ranked timing list
  report/
    generator.ts            # Assembles self-contained HTML
    template.html           # HTML shell with placeholders
    ui/
      graph.js              # Cytoscape.js graph (plain JS, inlined into HTML)
      table.js              # Import tree table (plain JS)
      cycles-panel.js       # Cycles sidebar (plain JS)
      filters.js            # Search wiring (plain JS)
      styles.css            # Dark theme CSS
test/
  unit/                     # Tests for each analysis module + folder-tree
  integration/              # Loader, report, CLI tests
    fixtures/               # simple, circular, deep, wide, builtins, slow, monorepo,
                            # self-import, node-modules, no-name-pkg, nested
  performance/              # 1000 and 5000 module benchmarks
```

**Note:** `src/report/ui/` files are plain JS (not TypeScript) because they run in the browser, inlined into the HTML report.

---

## Data Flow

1. **CLI** parses args, creates temp file path, sets `NODE_OPTIONS=--import=<register.ts>` and `ESM_ANALYZER_TEMP_FILE`, spawns user's command
2. **Loader** (`register.ts`) calls `module.registerHooks()` (in-thread, Node 24). Hooks record resolve+load timing for every import. On process exit, writes `ImportRecord[]` JSON to temp file
3. **CLI** reads temp file, runs analysis pipeline:
   - `buildTree()` → import tree
   - `detectCycles()` → circular dependencies (Tarjan's SCC)
   - `groupModules()` → groups by package.json boundaries + builds `folderTree` per group
   - `computeRankedList()` / `computeTotalTime()` → timing stats
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
  totalTime: number;        // loadEndTime - resolveStartTime
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
  modules: string[];        // All resolvedURLs in this group
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

### Cycle Detector (`src/analysis/cycle-detector.ts`)
- Tarjan's SCC algorithm
- Extracts individual cycles from each SCC via DFS
- Deduplicates rotations of same cycle
- Sorted by length (shortest first)

### Grouper (`src/analysis/grouper.ts`)
- `node:` URLs → "Node.js Builtins" group
- `data:` URLs → "Inline Modules" group
- `file:` URLs → walks up to find `package.json`, groups by package root
- No `package.json` found → "Ungrouped"
- After grouping, calls `buildFolderTree()` for each group with a `packageJsonPath`

### Folder Tree (`src/analysis/folder-tree.ts`)
- Builds a trie from relative file paths within each package
- **Auto-flatten rule:** keep merging while a folder has exactly 1 child (folder or file). Stop when 2+ children found
- Examples:
  - `src/` is only child → flatten. `src/` has 3 children → show: `src/index.ts`, `[src/utils]`, `[src/routes]`
  - `src/lib/internal/deep.ts` every level has 1 child → flatten to: `src/lib/internal/deep.ts`
- Folder IDs: `ftree::<groupId>::<relativePath>`. File IDs: original `resolvedURL`
- Skips non-`file://` URLs

### Timing (`src/analysis/timing.ts`)
- `computeRankedList()`: unique modules sorted by totalTime descending
- `computeTotalTime()`: max root node time

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
|                Import Timing Table (bottom, resizable)             |
+-------------------------------------------------------------------+
```

### CDN Dependencies
- `cytoscape@3.31.0` — loaded via `<script>` from unpkg
- `dagre@0.7.4` — loaded inside Web Worker via `importScripts()`

### Graph (`src/report/ui/graph.js`)

**Graph layout:** Dagre (hierarchical DAG, top-to-bottom) computed in a Web Worker to avoid blocking the main thread. Shows "Computing layout..." overlay with spinner during computation.

**Node types:**
- **Group nodes** (compound/parent): package bounding boxes, round-rectangle, dark background
  - `node_modules` packages: dashed border
  - Collapsed: centered label, thicker border. Expanded: label at top
- **Folder nodes** (regular, not compound): round-rectangle, gray, inside package bounding box
  - Disappear when expanded, replaced by their children
- **Module nodes** (regular): circles sized and colored by timing (green→yellow→red)
  - Builtins: dashed border, muted color. Always visible.

**Edge types:**
- **Real edges**: taxi-style (orthogonal) routing, downward direction
- **Meta-edges**: bezier curves, labeled with import count (e.g. "3 imports"). Created dynamically when groups/folders are collapsed to represent aggregated connections
- **Cycle edges**: orange color

**Collapse/Expand behavior:**
- All packages start collapsed
- Double-click group → toggle expand/collapse
- Expanding a package shows its top-level `folderTree` children (folders + files after auto-flattening)
- Double-click a folder → folder disappears, its children appear inside the package bounding box
- Folders cannot be individually re-collapsed. Collapsing the package resets all folder expansion
- "Expand all" button: expands all packages and all folders recursively
- "Collapse all" button: collapses everything, resets folder state

**Auto re-layout:** Checkbox (default: checked). When enabled, `runLayout()` is called automatically after every expand/collapse action. Can be unchecked for large graphs.

**Meta-edge resolution:** `resolveVisibleNode(cy, moduleURL)` walks up the parent-folder chain to find the nearest visible ancestor. Used by `refreshEdgeVisibility()` which removes old meta-edges, checks each real edge's endpoints, and creates meta-edges between the effective visible nodes.

**Selection highlighting (directional):**
- Click a node to select. Shift/Ctrl/Cmd+click for multi-select
- Selected node: white border
- Outgoing edges + targets: blue (`#89b4fa`)
- Incoming edges + sources: green (`#a6e3a1`)
- Everything else: dimmed (20% opacity)
- Expanded groups: same directional highlight as collapsed (traces edges from children to external nodes), children + internal edges stay undimmed
- Folder nodes receive meta-edges → selection highlight follows them

**Auto-highlight after actions:**
- Collapsing a package → selects the collapsed package node
- Expanding a package → selects the expanded package node
- Expanding a folder → selects all newly revealed children

**Search (`filterBySearch`):**
- Highlights (not hides) matching nodes by label or full path
- If a match is inside a collapsed group/folder, highlights the collapsed ancestor
- Uses the standard selection highlight system
- Clearing search clears highlight

**Tooltips:** Hover on module → full path + time. Hover on folder → folder path. Hover on edge → import specifier.

### Table (`src/report/ui/table.js`)

Shows the import tree as a nested, expandable table:
- Root level: entry point's direct imports **plus the 20 slowest modules promoted to root level**
  - Computes 20 slowest unique modules (all types: file://, node:, data:)
  - Modules already natural roots count toward the 20; remaining are promoted
  - Promoted files appear identically to natural roots (same look, same expandable subtree)
  - Promoted files are also still visible as children when expanding their natural parent (intentional duplication)
  - If there are more than 20 natural roots, all are displayed
- All root rows sorted together by current sort column (default: time desc)
- Each row: module specifier, total time (with color bar), child import count
- Chevron to expand children (lazy-rendered on first click)
- Sortable columns: name, time, imports
- Click a row → `focusOnNode()` in graph:
  - If target module is already visible → select + zoom (no relayout)
  - If not visible → collapse all → reveal just enough (expand group + ancestor folders) → relayout → select + zoom
- Search filters top-level rows only (depth 0)

### Cycles Panel (`src/report/ui/cycles-panel.js`)
- Left sidebar, collapsible
- Lists cycles sorted by length
- Click cycle → reveals all cycle members (expands groups/folders), highlights nodes + edges in red/orange
- "Clear highlight" button

### Filters (`src/report/ui/filters.js`)
- Wires search input to `filterBySearch()` (graph) and `tableApi.filter()` (table)

### Styles (`src/report/ui/styles.css`)
- Dark theme (Catppuccin-inspired): `#1e1e2e` primary bg, `#cdd6f4` text
- Monospace font for paths, sans-serif for labels
- Layout overlay with spinner animation
- Resizable panels via drag handle

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
- Non-zero child exit → still generates report, prints warning
- Missing/empty temp file → error explaining no ESM imports captured

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
| unit/tree-builder | 10 | Tree building, dedup, ordering, diamond DAG |
| unit/cycle-detector | 9 | Tarjan's SCC, self-refs, overlapping, performance |
| unit/grouper | 9 | Package grouping, builtins, monorepo, scoped, ungrouped |
| unit/timing | 8 | Ranking, dedup, stable sort, zero-time |
| unit/folder-tree | 11 | Flatten logic, single-child chains, mixed, IDs |
| integration/loader | 8 | Hook capture for all fixture types |
| integration/report | 8 | HTML structure, embedded data, CDN, CSS |
| integration/cli | 10 | Args, flags, NODE_OPTIONS, exit codes |
| performance | 2 | 1000 and 5000 module benchmarks |
| **Total** | **75** | |

Run all: `node --test test/unit/*.test.ts test/integration/*.test.ts test/performance/*.test.ts`

---

## Pending / Not Yet Implemented

(None at present.)

---

## Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Layout algorithm | Dagre (hierarchical DAG) | Clear top-to-bottom flow for dependency trees |
| Layout execution | Web Worker | Avoids blocking main thread |
| Graph library | Cytoscape.js via CDN | No bundling needed, works offline after load |
| Folder grouping | Auto-flatten single-child folders | Minimize clicks to reach content |
| Folder nodes | Regular nodes (not compound) | No nested bounding boxes, simpler layout |
| Collapse scope | Package level only | Folders can't be individually re-collapsed |
| Meta-edges | Dynamic creation/removal | Show connections between collapsed entities |
| Selection | Directional (in=green, out=blue) | Quickly understand dependency direction |
| Search | Highlight (not hide) | See matches in context of the full graph |
| Template substitution | `split/join` not `String.replace` | Avoid `$` pattern interpretation in JS content |
| Builtins | Always visible, grouped | Were toggle-hidden, changed to always-on |
| Auto re-layout | Default on | Immediate feedback on expand/collapse |
