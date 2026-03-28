import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for the click selection logic in graph.js.
 *
 * The graph has three node types: modules, groups (packages), and folders.
 * All are selectable. Selection drives directional edge highlighting.
 *
 * Implementation detail: Cytoscape auto-selects on click before our handler.
 * We save state on tapstart and restore it in tap, so tests use pre-tap state.
 */

// --- Selection logic (mirrors graph.js tap handler) ---

function tapSelect(
  clickedId: string,
  preTapSelection: string[],
  additive: boolean,
): string[] {
  // Restore pre-tap state first (undo Cytoscape auto-select)
  const selection = new Set(preTapSelection);
  const wasSelected = selection.has(clickedId);

  if (additive) {
    // Shift/Ctrl/Cmd-click: toggle
    if (wasSelected) {
      selection.delete(clickedId);
    } else {
      selection.add(clickedId);
    }
  } else {
    // Plain click: select only this node
    selection.clear();
    selection.add(clickedId);
  }

  return [...selection];
}

// --- Highlight logic (simplified model of applySelectionHighlight) ---

interface GraphEdge {
  source: string;
  target: string;
  isCycle?: boolean;
}

interface HighlightResult {
  selected: string[];    // hl-selected
  outgoing: string[];    // hl-outgoing (nodes)
  incoming: string[];    // hl-incoming (nodes)
  cycle: string[];       // hl-cycle (edge ids)
  dimmed: string[];      // everything else
}

function computeHighlight(
  selectedIds: string[],
  allNodeIds: string[],
  edges: GraphEdge[],
): HighlightResult {
  const selectedSet = new Set(selectedIds);
  const outgoing = new Set<string>();
  const incoming = new Set<string>();
  const cycleEdges = new Set<string>();
  const highlighted = new Set(selectedIds);

  for (const sel of selectedIds) {
    // Outgoing: edges from selected → target
    for (const e of edges) {
      if (e.source === sel) {
        highlighted.add(e.target);
        if (!selectedSet.has(e.target)) outgoing.add(e.target);
        if (e.isCycle) cycleEdges.add(e.source + '->' + e.target);
      }
      // Incoming: edges from source → selected
      if (e.target === sel) {
        highlighted.add(e.source);
        if (!selectedSet.has(e.source) && !outgoing.has(e.source)) incoming.add(e.source);
        if (e.isCycle) cycleEdges.add(e.source + '->' + e.target);
      }
    }
  }

  const dimmed = allNodeIds.filter(id => !highlighted.has(id));

  return {
    selected: selectedIds,
    outgoing: [...outgoing].sort(),
    incoming: [...incoming].sort(),
    cycle: [...cycleEdges].sort(),
    dimmed: dimmed.sort(),
  };
}

// ================================================================
// PLAIN CLICK TESTS
// ================================================================

describe('plain click selection', () => {
  it('selects only the clicked node (module)', () => {
    assert.deepEqual(tapSelect('mod-a', [], false), ['mod-a']);
  });

  it('replaces existing selection with clicked node', () => {
    assert.deepEqual(tapSelect('mod-b', ['mod-a', 'mod-c'], false), ['mod-b']);
  });

  it('clicking already-selected node keeps only it', () => {
    assert.deepEqual(tapSelect('mod-a', ['mod-a', 'mod-b'], false), ['mod-a']);
  });

  it('works on group nodes', () => {
    assert.deepEqual(tapSelect('group-pkg', ['mod-a'], false), ['group-pkg']);
  });

  it('works on folder nodes', () => {
    assert.deepEqual(tapSelect('folder-src', ['mod-a', 'group-pkg'], false), ['folder-src']);
  });

  it('clicking module when group is selected replaces', () => {
    assert.deepEqual(tapSelect('mod-a', ['group-pkg'], false), ['mod-a']);
  });

  it('clicking group when module is selected replaces', () => {
    assert.deepEqual(tapSelect('group-pkg', ['mod-a'], false), ['group-pkg']);
  });
});

// ================================================================
// SHIFT-CLICK TESTS
// ================================================================

describe('shift-click selection (toggle)', () => {
  it('adds unselected module to empty selection', () => {
    assert.deepEqual(tapSelect('mod-a', [], true), ['mod-a']);
  });

  it('adds unselected module to existing selection', () => {
    const result = tapSelect('mod-c', ['mod-a', 'mod-b'], true);
    assert.deepEqual(result.sort(), ['mod-a', 'mod-b', 'mod-c']);
  });

  it('removes already-selected module from selection', () => {
    const result = tapSelect('mod-b', ['mod-a', 'mod-b', 'mod-c'], true);
    assert.deepEqual(result.sort(), ['mod-a', 'mod-c']);
  });

  it('deselects the only selected node', () => {
    assert.deepEqual(tapSelect('mod-a', ['mod-a'], true), []);
  });

  it('adds group to module selection (mixed types)', () => {
    const result = tapSelect('group-pkg', ['mod-a', 'mod-b'], true);
    assert.deepEqual(result.sort(), ['group-pkg', 'mod-a', 'mod-b']);
  });

  it('adds folder to module selection (mixed types)', () => {
    const result = tapSelect('folder-src', ['mod-a'], true);
    assert.deepEqual(result.sort(), ['folder-src', 'mod-a']);
  });

  it('removes group from mixed selection', () => {
    const result = tapSelect('group-pkg', ['mod-a', 'group-pkg', 'folder-src'], true);
    assert.deepEqual(result.sort(), ['folder-src', 'mod-a']);
  });

  it('builds up selection one at a time', () => {
    let sel = tapSelect('mod-a', [], true);             // ['mod-a']
    sel = tapSelect('mod-b', sel, true);                 // ['mod-a', 'mod-b']
    sel = tapSelect('mod-c', sel, true);                 // ['mod-a', 'mod-b', 'mod-c']
    assert.deepEqual(sel.sort(), ['mod-a', 'mod-b', 'mod-c']);
  });

  it('toggles off then on again', () => {
    let sel = tapSelect('mod-a', [], true);              // ['mod-a']
    sel = tapSelect('mod-b', sel, true);                 // ['mod-a', 'mod-b']
    sel = tapSelect('mod-a', sel, true);                 // ['mod-b'] (toggled off)
    sel = tapSelect('mod-a', sel, true);                 // ['mod-a', 'mod-b'] (toggled on)
    assert.deepEqual(sel.sort(), ['mod-a', 'mod-b']);
  });

  it('mixed node types: module + group + folder', () => {
    let sel = tapSelect('mod-a', [], true);
    sel = tapSelect('group-pkg', sel, true);
    sel = tapSelect('folder-src', sel, true);
    assert.deepEqual(sel.sort(), ['folder-src', 'group-pkg', 'mod-a']);
  });
});

// ================================================================
// DOUBLE-CLICK TESTS
// ================================================================

describe('double-click on module (zoom only)', () => {
  it('tap selects node, dbltap just zooms (no further selection change)', () => {
    // Double-click fires: tap, tap, dbltap. Our tap runs, then dbltap zooms.
    const afterTap = tapSelect('mod-a', [], false);
    assert.deepEqual(afterTap, ['mod-a']);
    // dbltap: no selection logic, just cy.animate
  });

  it('double-click with prior selection: tap narrows to clicked node', () => {
    const afterTap = tapSelect('mod-b', ['mod-a', 'mod-b', 'mod-c'], false);
    assert.deepEqual(afterTap, ['mod-b']);
    // dbltap: zooms to mod-b
  });
});

// ================================================================
// HIGHLIGHT TESTS (directional edges)
// ================================================================

describe('highlight: connected modules', () => {
  // Graph: A -> B -> C
  const nodes = ['A', 'B', 'C'];
  const edges: GraphEdge[] = [
    { source: 'A', target: 'B' },
    { source: 'B', target: 'C' },
  ];

  it('selecting middle node shows incoming and outgoing', () => {
    const h = computeHighlight(['B'], nodes, edges);
    assert.deepEqual(h.selected, ['B']);
    assert.deepEqual(h.outgoing, ['C']);
    assert.deepEqual(h.incoming, ['A']);
    assert.deepEqual(h.dimmed, []);
  });

  it('selecting root node shows only outgoing', () => {
    const h = computeHighlight(['A'], nodes, edges);
    assert.deepEqual(h.selected, ['A']);
    assert.deepEqual(h.outgoing, ['B']);
    assert.deepEqual(h.incoming, []);
    assert.deepEqual(h.dimmed, ['C']);
  });

  it('selecting leaf node shows only incoming', () => {
    const h = computeHighlight(['C'], nodes, edges);
    assert.deepEqual(h.selected, ['C']);
    assert.deepEqual(h.outgoing, []);
    assert.deepEqual(h.incoming, ['B']);
    assert.deepEqual(h.dimmed, ['A']);
  });

  it('selecting both ends highlights entire chain', () => {
    const h = computeHighlight(['A', 'C'], nodes, edges);
    assert.deepEqual(h.selected, ['A', 'C']);
    assert.deepEqual(h.outgoing, ['B']);  // A -> B
    assert.deepEqual(h.incoming, []);      // B already outgoing
    assert.deepEqual(h.dimmed, []);
  });
});

describe('highlight: disconnected modules', () => {
  // Graph: A -> B, C (isolated), D -> E
  const nodes = ['A', 'B', 'C', 'D', 'E'];
  const edges: GraphEdge[] = [
    { source: 'A', target: 'B' },
    { source: 'D', target: 'E' },
  ];

  it('selecting A dims unconnected nodes', () => {
    const h = computeHighlight(['A'], nodes, edges);
    assert.deepEqual(h.outgoing, ['B']);
    assert.deepEqual(h.dimmed, ['C', 'D', 'E']);
  });

  it('selecting isolated node C dims everything else', () => {
    const h = computeHighlight(['C'], nodes, edges);
    assert.deepEqual(h.outgoing, []);
    assert.deepEqual(h.incoming, []);
    assert.deepEqual(h.dimmed, ['A', 'B', 'D', 'E']);
  });

  it('selecting nodes from different clusters highlights both', () => {
    const h = computeHighlight(['A', 'D'], nodes, edges);
    assert.deepEqual(h.selected, ['A', 'D']);
    assert.deepEqual(h.outgoing.sort(), ['B', 'E']);
    assert.deepEqual(h.dimmed, ['C']);
  });

  it('selecting all connected nodes leaves only C dimmed', () => {
    const h = computeHighlight(['A', 'B'], nodes, edges);
    assert.deepEqual(h.dimmed, ['C', 'D', 'E']);
  });
});

describe('highlight: cycle edges', () => {
  // Graph: A -> B -> C -> A (cycle)
  const nodes = ['A', 'B', 'C'];
  const edges: GraphEdge[] = [
    { source: 'A', target: 'B', isCycle: false },
    { source: 'B', target: 'C', isCycle: false },
    { source: 'C', target: 'A', isCycle: true },
  ];

  it('selecting A highlights cycle back-edge from C', () => {
    const h = computeHighlight(['A'], nodes, edges);
    assert.deepEqual(h.cycle, ['C->A']);
    assert.deepEqual(h.incoming, ['C']);
    assert.deepEqual(h.outgoing, ['B']);
  });

  it('selecting C highlights cycle back-edge to A', () => {
    const h = computeHighlight(['C'], nodes, edges);
    assert.deepEqual(h.cycle, ['C->A']);
    assert.deepEqual(h.outgoing, ['A']);
    assert.deepEqual(h.incoming, ['B']);
  });

  it('no cycle edges highlighted when selecting unrelated node', () => {
    // Add isolated node
    const nodesWithD = [...nodes, 'D'];
    const h = computeHighlight(['D'], nodesWithD, edges);
    assert.deepEqual(h.cycle, []);
  });
});

describe('highlight: mixed node types (group + module)', () => {
  // Simplified: group-pkg contains mod-a, mod-b. External mod-c -> mod-a.
  const nodes = ['group-pkg', 'mod-a', 'mod-b', 'mod-c'];
  const edges: GraphEdge[] = [
    { source: 'mod-c', target: 'mod-a' },
    { source: 'mod-a', target: 'mod-b' },
  ];

  it('selecting a group node traces its edges', () => {
    const h = computeHighlight(['group-pkg'], nodes, edges);
    // group-pkg has no direct edges in this model, so nothing highlighted
    assert.deepEqual(h.selected, ['group-pkg']);
    assert.deepEqual(h.dimmed, ['mod-a', 'mod-b', 'mod-c']);
  });

  it('selecting module inside group highlights its connections', () => {
    const h = computeHighlight(['mod-a'], nodes, edges);
    assert.deepEqual(h.outgoing, ['mod-b']);
    assert.deepEqual(h.incoming, ['mod-c']);
    assert.deepEqual(h.dimmed, ['group-pkg']);
  });

  it('selecting group + external module', () => {
    const h = computeHighlight(['group-pkg', 'mod-c'], nodes, edges);
    assert.deepEqual(h.outgoing, ['mod-a']);
    assert.deepEqual(h.dimmed, ['mod-b']);
  });
});

describe('highlight: empty selection', () => {
  const nodes = ['A', 'B', 'C'];
  const edges: GraphEdge[] = [{ source: 'A', target: 'B' }];

  it('no selection means nothing highlighted, nothing dimmed', () => {
    const h = computeHighlight([], nodes, edges);
    assert.deepEqual(h.selected, []);
    assert.deepEqual(h.outgoing, []);
    assert.deepEqual(h.incoming, []);
    assert.deepEqual(h.dimmed, ['A', 'B', 'C']);
  });
});

// ================================================================
// SEQUENCES (click + shift-click + highlight)
// ================================================================

describe('selection sequences with highlighting', () => {
  // Graph: A -> B -> C, D (isolated)
  const nodes = ['A', 'B', 'C', 'D'];
  const edges: GraphEdge[] = [
    { source: 'A', target: 'B' },
    { source: 'B', target: 'C' },
  ];

  it('click A, shift-click C: highlights full chain', () => {
    let sel = tapSelect('A', [], false);
    sel = tapSelect('C', sel, true);
    const h = computeHighlight(sel, nodes, edges);
    assert.deepEqual(h.selected.sort(), ['A', 'C']);
    assert.deepEqual(h.outgoing, ['B']); // A -> B
    assert.deepEqual(h.dimmed, ['D']);
  });

  it('click A, shift-click D: two disconnected nodes, B and C dimmed', () => {
    let sel = tapSelect('A', [], false);
    sel = tapSelect('D', sel, true);
    const h = computeHighlight(sel, nodes, edges);
    assert.deepEqual(h.selected.sort(), ['A', 'D']);
    assert.deepEqual(h.outgoing, ['B']);
    assert.deepEqual(h.dimmed, ['C']);
  });

  it('build selection then remove: click A, +B, +C, -B', () => {
    let sel = tapSelect('A', [], false);
    sel = tapSelect('B', sel, true);
    sel = tapSelect('C', sel, true);
    sel = tapSelect('B', sel, true);   // toggle off
    const h = computeHighlight(sel, nodes, edges);
    assert.deepEqual(h.selected.sort(), ['A', 'C']);
    assert.deepEqual(h.outgoing, ['B']);
    assert.deepEqual(h.dimmed, ['D']);
  });

  it('plain click after shift-selection resets to single node', () => {
    let sel = tapSelect('A', [], false);
    sel = tapSelect('B', sel, true);
    sel = tapSelect('C', sel, true);
    sel = tapSelect('D', sel, false);   // plain click resets
    const h = computeHighlight(sel, nodes, edges);
    assert.deepEqual(h.selected, ['D']);
    assert.deepEqual(h.dimmed, ['A', 'B', 'C']);
  });
});
