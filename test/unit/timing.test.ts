import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRankedList, computeTotalTime } from '../../src/analysis/timing.ts';
import { buildTree } from '../../src/analysis/tree-builder.ts';
import type { ImportRecord } from '../../src/types.ts';

function makeRecord(url: string, resolveStart: number, loadEnd: number, parent?: string): ImportRecord {
  return {
    specifier: url,
    resolvedURL: url,
    parentURL: parent ?? null,
    resolveStartTime: resolveStart,
    resolveEndTime: resolveStart + 1,
    loadStartTime: resolveStart + 1,
    loadEndTime: loadEnd,
  };
}

describe('computeRankedList', () => {
  it('sorts by totalTime descending', () => {
    const records = [
      makeRecord('a', 0, 10),
      makeRecord('b', 0, 50),
      makeRecord('c', 0, 30),
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked[0]!.resolvedURL, 'b');
    assert.equal(ranked[1]!.resolvedURL, 'c');
    assert.equal(ranked[2]!.resolvedURL, 'a');
  });

  it('computes totalTime as loadEndTime - resolveStartTime', () => {
    const records = [makeRecord('a', 10, 50)];
    const ranked = computeRankedList(records);
    assert.equal(ranked[0]!.totalTime, 40);
  });

  it('handles single module', () => {
    const records = [makeRecord('a', 0, 5)];
    const ranked = computeRankedList(records);
    assert.equal(ranked.length, 1);
  });

  it('deduplicates by resolvedURL (first occurrence wins)', () => {
    const records = [
      makeRecord('a', 0, 100),
      makeRecord('a', 200, 201), // cached, near-zero
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]!.totalTime, 100);
  });

  it('preserves stable sort for identical times', () => {
    const records = [
      makeRecord('a', 0, 10),
      makeRecord('b', 0, 10),
      makeRecord('c', 0, 10),
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked[0]!.resolvedURL, 'a');
    assert.equal(ranked[1]!.resolvedURL, 'b');
    assert.equal(ranked[2]!.resolvedURL, 'c');
  });

  it('zero-time modules (cached) rank last', () => {
    const records = [
      makeRecord('a', 0, 50),
      makeRecord('b', 0, 0), // zero time (cached)
      makeRecord('c', 0, 30),
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked[ranked.length - 1]!.resolvedURL, 'b');
    assert.equal(ranked[ranked.length - 1]!.totalTime, 0);
  });
});

describe('computeTotalTime', () => {
  it('returns max root time', () => {
    const records = [
      makeRecord('a', 0, 100),
      makeRecord('b', 0, 50),
    ];
    const tree = buildTree(records);
    assert.equal(computeTotalTime(tree), 100);
  });

  it('returns 0 for empty tree', () => {
    assert.equal(computeTotalTime([]), 0);
  });
});
