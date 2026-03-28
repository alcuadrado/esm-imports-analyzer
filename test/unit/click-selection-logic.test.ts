import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * These tests verify the selection logic used in graph.js for
 * single-click, shift-click, and double-click interactions.
 *
 * Cytoscape auto-selection is disabled via unselectify(), so
 * selection only changes through our handlers.
 */

interface SelectionResult {
  selected: string[];
}

// Reproduces the single-click (tap) logic from graph.js
function singleClick(
  clickedId: string,
  currentSelection: string[],
  additive: boolean,
): SelectionResult {
  const wasSelected = currentSelection.includes(clickedId);
  if (additive) {
    if (wasSelected) {
      return { selected: currentSelection.filter(id => id !== clickedId) };
    } else {
      return { selected: [...currentSelection, clickedId] };
    }
  } else {
    return { selected: [clickedId] };
  }
}

// Reproduces the double-click (dbltap) logic from graph.js for module nodes.
// Since Cytoscape auto-selection is disabled, the selection at dbltap time
// is exactly what it was before the double-click started.
function doubleClickModule(
  clickedId: string,
  currentSelection: string[],
): SelectionResult {
  const isSelected = currentSelection.includes(clickedId);

  if (currentSelection.length > 0 && !isSelected) {
    // Node not in selection — replace with just this node
    return { selected: [clickedId] };
  } else if (currentSelection.length === 0) {
    // Nothing selected — select this node
    return { selected: [clickedId] };
  } else {
    // Node is in the selection — keep full selection, just zoom
    return { selected: currentSelection };
  }
}

describe('single-click selection', () => {
  it('plain click selects only the clicked node', () => {
    const result = singleClick('a', ['b', 'c'], false);
    assert.deepEqual(result.selected, ['a']);
  });

  it('plain click on already-selected node keeps only it', () => {
    const result = singleClick('b', ['a', 'b', 'c'], false);
    assert.deepEqual(result.selected, ['b']);
  });

  it('plain click with no prior selection selects the node', () => {
    const result = singleClick('a', [], false);
    assert.deepEqual(result.selected, ['a']);
  });

  it('shift-click adds unselected node to selection', () => {
    const result = singleClick('c', ['a', 'b'], true);
    assert.deepEqual(result.selected, ['a', 'b', 'c']);
  });

  it('shift-click removes already-selected node from selection', () => {
    const result = singleClick('b', ['a', 'b', 'c'], true);
    assert.deepEqual(result.selected, ['a', 'c']);
  });

  it('shift-click on the only selected node deselects it', () => {
    const result = singleClick('a', ['a'], true);
    assert.deepEqual(result.selected, []);
  });

  it('shift-click with no prior selection selects the node', () => {
    const result = singleClick('a', [], true);
    assert.deepEqual(result.selected, ['a']);
  });
});

describe('double-click module selection', () => {
  it('double-click on node in multi-selection preserves full selection', () => {
    const result = doubleClickModule('b', ['a', 'b', 'c']);
    assert.deepEqual(result.selected, ['a', 'b', 'c']);
  });

  it('double-click on the only selected node keeps it selected', () => {
    const result = doubleClickModule('a', ['a']);
    assert.deepEqual(result.selected, ['a']);
  });

  it('double-click on node NOT in multi-selection replaces selection', () => {
    const result = doubleClickModule('d', ['a', 'b', 'c']);
    assert.deepEqual(result.selected, ['d']);
  });

  it('double-click with no prior selection selects the node', () => {
    const result = doubleClickModule('a', []);
    assert.deepEqual(result.selected, ['a']);
  });
});

describe('single-click then double-click sequence', () => {
  it('shift-click to build selection, then double-click member preserves all', () => {
    // Click A, shift-click B, shift-click C, double-click B
    let sel = singleClick('a', [], false).selected;          // ['a']
    sel = singleClick('b', sel, true).selected;              // ['a', 'b']
    sel = singleClick('c', sel, true).selected;              // ['a', 'b', 'c']
    // Double-click fires — tap timer is cancelled, selection unchanged
    const result = doubleClickModule('b', sel);
    assert.deepEqual(result.selected, ['a', 'b', 'c']);
  });

  it('shift-click to build selection, then double-click non-member replaces', () => {
    let sel = singleClick('a', [], false).selected;          // ['a']
    sel = singleClick('b', sel, true).selected;              // ['a', 'b']
    const result = doubleClickModule('c', sel);
    assert.deepEqual(result.selected, ['c']);
  });

  it('shift-click to toggle off, then double-click remaining', () => {
    let sel = singleClick('a', [], false).selected;          // ['a']
    sel = singleClick('b', sel, true).selected;              // ['a', 'b']
    sel = singleClick('a', sel, true).selected;              // ['b'] (a toggled off)
    const result = doubleClickModule('b', sel);
    assert.deepEqual(result.selected, ['b']);
  });
});
