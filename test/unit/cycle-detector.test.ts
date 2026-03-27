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
});
