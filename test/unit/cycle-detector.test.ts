import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectCycles } from '../../src/analysis/cycle-detector.ts';
import type { ImportRecord } from '../../src/types.ts';

function makeRecord(resolved: string, parent: string | null, specifier?: string): ImportRecord {
  return {
    specifier: specifier ?? resolved,
    resolvedURL: resolved,
    parentURL: parent,
    resolveStartTime: 0,
    resolveEndTime: 1,
    loadStartTime: 1,
    loadEndTime: 2,
  };
}

describe('detectCycles', () => {
  it('returns empty for no cycles (simple DAG)', () => {
    const records = [
      makeRecord('a', null),
      makeRecord('b', 'a'),
      makeRecord('c', 'b'),
    ];
    const cycles = detectCycles(records);
    assert.equal(cycles.length, 0);
  });

  it('detects simple cycle A -> B -> A', () => {
    const records = [
      makeRecord('a', null),
      makeRecord('b', 'a'),
      makeRecord('a', 'b'), // back edge
    ];
    const cycles = detectCycles(records);
    assert.ok(cycles.length >= 1);
    const cycle = cycles.find(c => c.length === 2);
    assert.ok(cycle);
    assert.ok(cycle.modules.includes('a'));
    assert.ok(cycle.modules.includes('b'));
  });

  it('detects self-referential import (A -> A)', () => {
    const records = [
      makeRecord('a', null),
      makeRecord('a', 'a'), // self-import
    ];
    const cycles = detectCycles(records);
    assert.ok(cycles.length >= 1);
    const selfCycle = cycles.find(c => c.length === 1);
    assert.ok(selfCycle);
    assert.deepStrictEqual(selfCycle.modules, ['a']);
  });

  it('detects A -> B -> C -> A cycle', () => {
    const records = [
      makeRecord('a', null),
      makeRecord('b', 'a'),
      makeRecord('c', 'b'),
      makeRecord('a', 'c'), // back edge
    ];
    const cycles = detectCycles(records);
    assert.ok(cycles.length >= 1);
    const cycle = cycles.find(c => c.length === 3);
    assert.ok(cycle);
  });

  it('does not detect diamond as cycle', () => {
    const records = [
      makeRecord('a', null),
      makeRecord('b', 'a'),
      makeRecord('c', 'a'),
      makeRecord('d', 'b'),
      makeRecord('d', 'c'),
    ];
    const cycles = detectCycles(records);
    assert.equal(cycles.length, 0);
  });

  it('detects multiple independent cycles', () => {
    const records = [
      makeRecord('a', null),
      makeRecord('b', 'a'),
      makeRecord('a', 'b'), // cycle 1
      makeRecord('c', null),
      makeRecord('d', 'c'),
      makeRecord('c', 'd'), // cycle 2
    ];
    const cycles = detectCycles(records);
    assert.ok(cycles.length >= 2);
  });

  it('detects overlapping cycles', () => {
    // A -> B -> C -> A and B -> D -> B
    const records = [
      makeRecord('a', null),
      makeRecord('b', 'a'),
      makeRecord('c', 'b'),
      makeRecord('a', 'c'), // back-edge: C -> A
      makeRecord('d', 'b'),
      makeRecord('b', 'd'), // back-edge: D -> B
    ];
    const cycles = detectCycles(records);
    assert.ok(cycles.length >= 2, `Expected at least 2 cycles, got ${cycles.length}`);
  });

  it('handles large cycle (10+ modules) efficiently', () => {
    // Create a 15-module cycle: m0 -> m1 -> ... -> m14 -> m0
    const records: ImportRecord[] = [];
    for (let i = 0; i < 15; i++) {
      records.push(makeRecord(`m${i}`, i === 0 ? null : `m${i - 1}`));
    }
    records.push(makeRecord('m0', 'm14')); // back-edge

    const start = performance.now();
    const cycles = detectCycles(records);
    const elapsed = performance.now() - start;

    assert.ok(cycles.length >= 1, 'Should detect at least one cycle');
    assert.ok(elapsed < 100, `Should complete in <100ms, took ${elapsed.toFixed(1)}ms`);
  });

  it('detects cycle in subgraph only', () => {
    // Main: a -> b -> c (acyclic). Subtree of c: d -> e -> d (cycle)
    const records = [
      makeRecord('a', null),
      makeRecord('b', 'a'),
      makeRecord('c', 'b'),
      makeRecord('d', 'c'),
      makeRecord('e', 'd'),
      makeRecord('d', 'e'), // back-edge in subgraph
    ];
    const cycles = detectCycles(records);
    assert.ok(cycles.length >= 1);
    const cycle = cycles.find(c => c.modules.includes('d') && c.modules.includes('e'));
    assert.ok(cycle, 'Should detect the d-e cycle');
  });
});
