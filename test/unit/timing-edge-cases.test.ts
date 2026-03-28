import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRankedList, computeTotalTime } from '../../src/analysis/timing.ts';
import type { ImportRecord } from '../../src/types.ts';

/**
 * Edge case tests for timing.ts.
 *
 * computeRankedList: deduplicates by URL, sorts by totalImportTime descending.
 *   totalTime = totalImportTime ?? 0
 *
 * computeTotalTime: wall-clock execution span.
 *   Formula: max(importStartTime + totalImportTime) - min(importStartTime)
 *   Only records WITH totalImportTime contribute to max.
 *   All records contribute to min.
 */

function makeRecord(url: string, importStart: number, totalImportTime?: number): ImportRecord {
  return {
    specifier: url,
    resolvedURL: url,
    parentURL: null,
    importStartTime: importStart,
    totalImportTime,
  };
}

describe('computeRankedList edge cases', () => {
  it('all records have undefined totalImportTime → all totalTime 0', () => {
    const records = [
      makeRecord('node:fs', 0),
      makeRecord('node:path', 1),
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked.length, 2);
    for (const entry of ranked) {
      assert.equal(entry.totalTime, 0);
    }
  });

  it('mix of records with and without totalImportTime', () => {
    const records = [
      makeRecord('file:///a.js', 0, 50),
      makeRecord('node:fs', 1),            // no totalImportTime (builtin)
      makeRecord('file:///b.js', 2, 10),
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked[0]!.resolvedURL, 'file:///a.js');  // 50ms
    assert.equal(ranked[1]!.resolvedURL, 'file:///b.js');  // 10ms
    assert.equal(ranked[2]!.resolvedURL, 'node:fs');       // 0ms
  });

  it('records arrive out of order → ranking still correct', () => {
    const records = [
      makeRecord('c', 0, 5),
      makeRecord('a', 0, 100),
      makeRecord('b', 0, 50),
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked[0]!.resolvedURL, 'a');
    assert.equal(ranked[1]!.resolvedURL, 'b');
    assert.equal(ranked[2]!.resolvedURL, 'c');
  });

  it('duplicate URLs with different timing → first wins', () => {
    const records = [
      makeRecord('file:///a.js', 0, 100),
      makeRecord('file:///a.js', 50, 1),  // cached, different time
    ];
    const ranked = computeRankedList(records);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]!.totalTime, 100);
  });

  it('single record', () => {
    const records = [makeRecord('file:///a.js', 0, 42)];
    const ranked = computeRankedList(records);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]!.totalTime, 42);
  });

  it('large number of records preserves stable sort', () => {
    const records: ImportRecord[] = [];
    for (let i = 0; i < 100; i++) {
      records.push(makeRecord(`file:///m${i}.js`, i, 10));  // all same time
    }
    const ranked = computeRankedList(records);
    assert.equal(ranked.length, 100);
    // Stable sort: insertion order preserved for equal times
    assert.equal(ranked[0]!.resolvedURL, 'file:///m0.js');
    assert.equal(ranked[99]!.resolvedURL, 'file:///m99.js');
  });
});

describe('computeTotalTime edge cases', () => {
  it('all records have undefined totalImportTime → returns 0', () => {
    const records = [
      makeRecord('node:fs', 0),
      makeRecord('node:path', 5),
    ];
    assert.equal(computeTotalTime(records), 0);
  });

  it('only measured records contribute to max end', () => {
    const records = [
      makeRecord('file:///a.js', 0, 100),   // end = 0 + 100 = 100
      makeRecord('node:fs', 50),              // no totalImportTime, doesn't affect max
      makeRecord('file:///b.js', 10, 70),    // end = 10 + 70 = 80
    ];
    // max end = 100, min start = 0
    assert.equal(computeTotalTime(records), 100);
  });

  it('single record → total time equals its totalImportTime', () => {
    const records = [makeRecord('file:///a.js', 10, 50)];
    // max(10 + 50) - min(10) = 60 - 10 = 50
    assert.equal(computeTotalTime(records), 50);
  });

  it('records with non-zero start offset', () => {
    const records = [
      makeRecord('file:///a.js', 100, 50),   // end = 150
      makeRecord('file:///b.js', 120, 20),   // end = 140
    ];
    // max(150, 140) - min(100, 120) = 150 - 100 = 50
    assert.equal(computeTotalTime(records), 50);
  });

  it('unmeasured record has earliest start → still contributes to min', () => {
    const records = [
      makeRecord('node:fs', 0),               // earliest start, but no totalImportTime
      makeRecord('file:///a.js', 50, 100),   // end = 150
    ];
    // max(150) - min(0, 50) = 150 - 0 = 150
    assert.equal(computeTotalTime(records), 150);
  });
});
