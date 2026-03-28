import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * These tests verify the selection logic used in graph.js for
 * single-click, shift-click, and double-click interactions.
 * The logic is extracted here as pure functions to test edge cases.
 */

interface SelectionResult {
  selected: string[];  // node IDs that should be selected after the action
}

// Reproduces the single-click (tap) logic from graph.js
function singleClick(
  clickedId: string,
  currentSelection: string[],
  additive: boolean,
): SelectionResult {
  const wasSelected = currentSelection.includes(clickedId);
  if (additive) {
    // Shift/Ctrl/Cmd-click: toggle the clicked node
    if (wasSelected) {
      return { selected: currentSelection.filter(id => id !== clickedId) };
    } else {
      return { selected: [...currentSelection, clickedId] };
    }
  } else {
    // Plain click: select only this node
    return { selected: [clickedId] };
  }
}

// Reproduces the double-click (dbltap) logic from graph.js for module nodes
function doubleClickModule(
  clickedId: string,
  preClickSelection: string[],
): SelectionResult {
  // First: restore the selection from before the double-click started
  const wasInSelection = preClickSelection.includes(clickedId);

  if (!wasInSelection && preClickSelection.length > 0) {
    // Node not in previous selection — replace with just this node
    return { selected: [clickedId] };
  } else if (preClickSelection.length === 0) {
    // Nothing was selected — select this node
    return { selected: [clickedId] };
  } else {
    // Node was in the selection — keep the full selection unchanged
    return { selected: preClickSelection };
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

  it('uses pre-click selection, not current (handles Cytoscape auto-select)', () => {
    // Simulates: nodes a,b,c selected, user double-clicks d.
    // Cytoscape auto-selects d on first click (changing current selection),
    // but we saved [a,b,c] on tapstart. Double-click logic uses the saved state.
    const preClickSelection = ['a', 'b', 'c'];
    const result = doubleClickModule('d', preClickSelection);
    assert.deepEqual(result.selected, ['d']);
  });

  it('preserves selection when double-clicking member of selection (Cytoscape auto-select scenario)', () => {
    // Simulates: nodes a,b selected, user double-clicks b.
    // Cytoscape auto-selects b on first click (unselecting a),
    // but we saved [a,b] on tapstart. Double-click restores [a,b].
    const preClickSelection = ['a', 'b'];
    const result = doubleClickModule('b', preClickSelection);
    assert.deepEqual(result.selected, ['a', 'b']);
  });
});
