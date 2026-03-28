import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../src/analysis/tree-builder.ts';
import { detectCycles } from '../../src/analysis/cycle-detector.ts';
import { computeRankedList } from '../../src/analysis/timing.ts';
import type { ImportRecord } from '../../src/types.ts';

function generateRecords(count: number): ImportRecord[] {
  const records: ImportRecord[] = [];
  // Create a tree: root -> fan-out to sqrt(count) branches, each branch has sqrt(count) depth
  const branchCount = Math.ceil(Math.sqrt(count));
  const depth = Math.ceil(count / branchCount);

  records.push({
    specifier: 'root',
    resolvedURL: 'file:///root.js',
    parentURL: null,
    importStartTime: 0,
    totalImportTime: count * 0.1,
  });

  let id = 1;
  for (let b = 0; b < branchCount && id < count; b++) {
    let parentURL = 'file:///root.js';
    for (let d = 0; d < depth && id < count; d++) {
      const url = `file:///mod-${id}.js`;
      const startTime = id * 0.1;
      records.push({
        specifier: `./mod-${id}.js`,
        resolvedURL: url,
        parentURL,
        importStartTime: startTime,
        totalImportTime: 0.05,
      });
      parentURL = url;
      id++;
    }
  }
  return records;
}

describe('performance', () => {
  it('processes 1000 modules in under 2 seconds', () => {
    const records = generateRecords(1000);
    assert.equal(records.length, 1000);

    const start = performance.now();

    const tree = buildTree(records);
    const cycles = detectCycles(records);
    const ranked = computeRankedList(records);

    const elapsed = performance.now() - start;
    assert.ok(tree.length > 0, 'Should build tree');
    assert.equal(cycles.length, 0, 'No cycles in generated data');
    assert.equal(ranked.length, 1000, 'All modules ranked');
    assert.ok(elapsed < 2000, `Should complete in <2s, took ${elapsed.toFixed(0)}ms`);
    console.log(`  1000 modules: ${elapsed.toFixed(1)}ms`);
  });

  it('processes 5000 modules in under 10 seconds', () => {
    const records = generateRecords(5000);
    assert.equal(records.length, 5000);

    const start = performance.now();

    const tree = buildTree(records);
    const cycles = detectCycles(records);
    const ranked = computeRankedList(records);

    const elapsed = performance.now() - start;
    assert.ok(tree.length > 0, 'Should build tree');
    assert.equal(ranked.length, 5000, 'All modules ranked');
    assert.ok(elapsed < 10000, `Should complete in <10s, took ${elapsed.toFixed(0)}ms`);
    console.log(`  5000 modules: ${elapsed.toFixed(1)}ms`);
  });
});
