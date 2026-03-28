import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRankedList, computeTotalTime } from '../../src/analysis/timing.ts';
import type { ImportRecord } from '../../src/types.ts';

function makeRecord(url: string, importStart: number, totalImportTime?: number, parent?: string): ImportRecord {
  return {
    specifier: url,
    resolvedURL: url,
    parentURL: parent ?? null,
    importStartTime: importStart,
    totalImportTime,
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

  it('computes totalTime from totalImportTime', () => {
    const records = [makeRecord('a', 10, 40)];
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
      makeRecord('a', 200), // cached, no totalImportTime
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

  it('modules without totalImportTime rank last', () => {
    const records = [
      makeRecord('a', 0, 50),
      makeRecord('b', 0), // no import time (cached/builtin)
      makeRecord('c', 0, 30),
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked[ranked.length - 1]!.resolvedURL, 'b');
    assert.equal(ranked[ranked.length - 1]!.totalTime, 0);
  });
});

describe('computeTotalTime', () => {
  it('returns total execution span', () => {
    const records = [
      makeRecord('a', 0, 100),
      makeRecord('b', 10, 70),
    ];
    assert.equal(computeTotalTime(records), 100); // max(0+100, 10+70) - min(0, 10) = 100 - 0
  });

  it('returns 0 for empty records', () => {
    assert.equal(computeTotalTime([]), 0);
  });
});
