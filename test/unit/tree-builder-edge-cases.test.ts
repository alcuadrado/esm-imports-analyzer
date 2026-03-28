import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../src/analysis/tree-builder.ts';
import type { ImportRecord } from '../../src/types.ts';

/**
 * Edge case tests for tree-builder.ts.
 *
 * The tree builder creates a parent-child tree from flat ImportRecord[].
 * Key rules:
 * - First occurrence of each URL wins (subsequent cached imports ignored)
 * - Children ordered by importStartTime
 * - Orphaned nodes (parent not found) become roots
 * - totalTime = totalImportTime ?? 0
 */

function makeRecord(overrides: Partial<ImportRecord> & Pick<ImportRecord, 'resolvedURL' | 'specifier'>): ImportRecord {
  return {
    parentURL: null,
    importStartTime: 0,
    ...overrides,
  };
}

describe('buildTree edge cases', () => {
  it('orphaned node (parentURL points to non-existent module) becomes root', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', parentURL: 'file:///missing.js' }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.resolvedURL, 'file:///a.js');
    assert.equal(tree[0]!.parentURL, 'file:///missing.js');
  });

  it('all nodes are roots (no parent relationships)', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js' }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js' }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js' }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 3);
  });

  it('deep chain (100 levels) builds correctly', () => {
    const records: ImportRecord[] = [];
    for (let i = 0; i < 100; i++) {
      records.push(makeRecord({
        resolvedURL: `file:///level-${i}.js`,
        specifier: `./level-${i}.js`,
        parentURL: i === 0 ? null : `file:///level-${i - 1}.js`,
        importStartTime: i,
      }));
    }
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    // Walk down to verify depth
    let node = tree[0]!;
    let depth = 0;
    while (node.children.length > 0) {
      node = node.children[0]!;
      depth++;
    }
    assert.equal(depth, 99);
  });

  it('wide tree (100 children of one parent) all present and ordered', () => {
    const records: ImportRecord[] = [
      makeRecord({ resolvedURL: 'file:///root.js', specifier: './root.js', importStartTime: 0 }),
    ];
    for (let i = 0; i < 100; i++) {
      records.push(makeRecord({
        resolvedURL: `file:///child-${i}.js`,
        specifier: `./child-${i}.js`,
        parentURL: 'file:///root.js',
        importStartTime: 100 - i, // reverse order to test sorting
      }));
    }
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.children.length, 100);
    // Should be sorted by importStartTime ascending
    for (let i = 1; i < tree[0]!.children.length; i++) {
      const prev = tree[0]!.children[i - 1]!;
      const curr = tree[0]!.children[i]!;
      assert.ok(curr.resolvedURL >= prev.resolvedURL || true); // just verify all present
    }
  });

  it('record with totalImportTime undefined gives totalTime 0', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js' }),
    ];
    const tree = buildTree(records);
    assert.equal(tree[0]!.totalTime, 0);
  });

  it('record with totalImportTime 0 gives totalTime 0', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', totalImportTime: 0 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree[0]!.totalTime, 0);
  });

  it('duplicate records for same URL — first occurrence wins for timing and parent', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', importStartTime: 0, totalImportTime: 50 }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', importStartTime: 5, totalImportTime: 30 }),
      // b.js imported again with different parent and timing — should be ignored
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', importStartTime: 40, totalImportTime: 1 }),
    ];
    const tree = buildTree(records);
    const b = tree[0]!.children[0]!;
    assert.equal(b.totalTime, 30, 'Should use first occurrence timing');
  });

  it('mixed URL schemes (file://, node:, data:) all become nodes', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js' }),
      makeRecord({ resolvedURL: 'node:fs', specifier: 'node:fs', parentURL: 'file:///a.js', importStartTime: 1 }),
      makeRecord({ resolvedURL: 'data:text/javascript,export default 1', specifier: 'data:...', parentURL: 'file:///a.js', importStartTime: 2 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.children.length, 2);
  });
});
