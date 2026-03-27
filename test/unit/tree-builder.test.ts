import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../src/analysis/tree-builder.ts';
import type { ImportRecord } from '../../src/types.ts';

function makeRecord(overrides: Partial<ImportRecord> & Pick<ImportRecord, 'resolvedURL' | 'specifier'>): ImportRecord {
  return {
    parentURL: null,
    resolveStartTime: 0,
    resolveEndTime: 1,
    loadStartTime: 1,
    loadEndTime: 2,
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
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', resolveStartTime: 0, loadEndTime: 30 }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', resolveStartTime: 5, loadStartTime: 6, loadEndTime: 20 }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js', parentURL: 'file:///b.js', resolveStartTime: 10, loadStartTime: 11, loadEndTime: 15 }),
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
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', loadStartTime: 2 }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js', parentURL: 'file:///a.js', loadStartTime: 3 }),
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
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', resolveStartTime: 0, loadEndTime: 50 }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', resolveStartTime: 5, loadStartTime: 6, loadEndTime: 30 }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js', parentURL: 'file:///a.js', resolveStartTime: 31, loadStartTime: 32, loadEndTime: 45 }),
      makeRecord({ resolvedURL: 'file:///d.js', specifier: './d.js', parentURL: 'file:///b.js', resolveStartTime: 10, loadStartTime: 11, loadEndTime: 20 }),
      // D imported again by C — this is a duplicate, first occurrence wins
      makeRecord({ resolvedURL: 'file:///d.js', specifier: './d.js', parentURL: 'file:///c.js', resolveStartTime: 35, loadStartTime: 36, loadEndTime: 36 }),
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
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js', resolveStartTime: 10, loadEndTime: 50 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree[0]!.totalTime, 40);
  });

  it('orders children by load start time', () => {
    const records = [
      makeRecord({ resolvedURL: 'file:///a.js', specifier: './a.js' }),
      makeRecord({ resolvedURL: 'file:///c.js', specifier: './c.js', parentURL: 'file:///a.js', loadStartTime: 10 }),
      makeRecord({ resolvedURL: 'file:///b.js', specifier: './b.js', parentURL: 'file:///a.js', loadStartTime: 5 }),
    ];
    const tree = buildTree(records);
    assert.equal(tree[0]!.children[0]!.resolvedURL, 'file:///b.js');
    assert.equal(tree[0]!.children[1]!.resolvedURL, 'file:///c.js');
  });
});
