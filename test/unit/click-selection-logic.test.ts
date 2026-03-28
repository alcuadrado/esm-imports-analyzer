import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for the selection logic used in graph.js.
 * Tap selects immediately. Double-tap just zooms (no selection change).
 */

function singleClick(
  clickedId: string,
  currentSelection: string[],
  additive: boolean,
): string[] {
  const wasSelected = currentSelection.includes(clickedId);
  if (additive) {
    return wasSelected
      ? currentSelection.filter(id => id !== clickedId)
      : [...currentSelection, clickedId];
  }
  return [clickedId];
}

describe('single-click selection', () => {
  it('plain click selects only the clicked node', () => {
    assert.deepEqual(singleClick('a', ['b', 'c'], false), ['a']);
  });

  it('plain click on already-selected node keeps only it', () => {
    assert.deepEqual(singleClick('b', ['a', 'b', 'c'], false), ['b']);
  });

  it('plain click with no prior selection selects the node', () => {
    assert.deepEqual(singleClick('a', [], false), ['a']);
  });

  it('shift-click adds unselected node to selection', () => {
    assert.deepEqual(singleClick('c', ['a', 'b'], true), ['a', 'b', 'c']);
  });

  it('shift-click removes already-selected node from selection', () => {
    assert.deepEqual(singleClick('b', ['a', 'b', 'c'], true), ['a', 'c']);
  });

  it('shift-click on the only selected node deselects it', () => {
    assert.deepEqual(singleClick('a', ['a'], true), []);
  });

  it('shift-click with no prior selection selects the node', () => {
    assert.deepEqual(singleClick('a', [], true), ['a']);
  });
});

describe('double-click on module', () => {
  it('does not change selection (tap already selected the node)', () => {
    // User double-clicks node 'a' with nothing selected.
    // First tap: selection becomes ['a'].
    // Second tap + dbltap: selection stays ['a'], zoom fires.
    const afterTap = singleClick('a', [], false);
    assert.deepEqual(afterTap, ['a']);
    // dbltap does NOT modify selection — just zooms
  });

  it('tap during double-click narrows multi-selection, dbltap zooms', () => {
    // User has [a, b, c] selected, double-clicks b.
    // First tap (no shift): selection becomes [b].
    // dbltap: zooms to b.
    const afterTap = singleClick('b', ['a', 'b', 'c'], false);
    assert.deepEqual(afterTap, ['b']);
  });
});
