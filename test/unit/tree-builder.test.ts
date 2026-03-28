import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../src/analysis/tree-builder.ts';
import type { ImportRecord } from '../../src/types.ts';

function makeRecord(overrides: Partial<ImportRecord> & Pick<ImportRecord, 'resolvedURL' | 'specifier'>): ImportRecord {
  return {
    parentURL: null,
    importStartTime: 0,
    ...overrides,
  };
}

describe('buildTree', () => {
  it('returns empty array for empty input', () => {
    const tree = buildTree([]);
    assert.deepStrictEqual(tree, []);
  });

  it('builds a single root node', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js' }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.resolvedURL, 'file:///a.js');
    assert.equal(tree[0]!.children.length, 0);
  });

  it('builds a linear chain A -> B -> C', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', importStartTime: 0, totalImportTime: 30 }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', importStartTime: 5, totalImportTime: 15 }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js', parentURL: 'file:///b.js', importStartTime: 10, totalImportTime: 5 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.resolvedURL, 'file:///a.js');
    assert.equal(tree[0]!.children.length, 1);
    assert.equal(tree[0]!.children[0]!.resolvedURL, 'file:///b.js');
    assert.equal(tree[0]!.children[0]!.children.length, 1);
    assert.equal(tree[0]!.children[0]!.children[0]!.resolvedURL, 'file:///c.js');
  });

  it('builds branching: A -> B, A -> C', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js' }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', importStartTime: 2 }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js', parentURL: 'file:///a.js', importStartTime: 3 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.children.length, 2);
  });

  it('handles multiple roots', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js' }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js' }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 2);
  });

  it('handles diamond dependency (DAG)', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', importStartTime: 0, totalImportTime: 50 }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', importStartTime: 5, totalImportTime: 25 }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js', parentURL: 'file:///a.js', importStartTime: 31, totalImportTime: 14 }),
      makeRecord({ resolvedURL: 'file:///d.js', specifier: './d.js', parentURL: 'file:///b.js', importStartTime: 10, totalImportTime: 10 }),
      // D imported again by C — this is a duplicate, first occurrence wins
      makeRecord({ resolvedURL: 'file:///d.js', specifier: './d.js', parentURL: 'file:///c.js', importStartTime: 35 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    // D should be under B (first parent), not duplicated
    const b = tree[0]!.children.find(c => c.resolvedURL === 'file:///b.js');
    assert.ok(b);
    assert.equal(b.children.length, 1);
    assert.equal(b.children[0]!.resolvedURL, 'file:///d.js');
  });

  it('computes totalTime correctly', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', totalImportTime: 40 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree[0]!.totalTime, 40);
  });

  it('orders children by import start time', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js' }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js', parentURL: 'file:///a.js', importStartTime: 10 }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', importStartTime: 5 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree[0]!.children[0]!.resolvedURL, 'file:///b.js');
    assert.equal(tree[0]!.children[1]!.resolvedURL, 'file:///c.js');
  });

  it('handles duplicate imports (cached) — first occurrence wins', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', importStartTime: 0, totalImportTime: 100 }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', importStartTime: 5, totalImportTime: 45 }),
      // Same module imported again (cached, no totalImportTime)
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', importStartTime: 60 }),
    ];
    const tree = buildTree(records);
    // b should appear once under a with real timing from first import
    assert.equal(tree[0]!.children.length, 1);
    assert.equal(tree[0]!.children[0]!.totalTime, 45);
  });

  it('handles single module (entry point only)', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///entry.js', specifier: './entry.js' }),
    ];
    const tree = buildTree(records);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.children.length, 0);
    assert.equal(tree[0]!.resolvedURL, 'file:///entry.js');
  });
});
