import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../src/analysis/tree-builder.ts';
import { detectCycles } from '../../src/analysis/cycle-detector.ts';
import { computeRankedList } from '../../src/analysis/timing.ts';
import type { ImportRecord } from '../../src/types.ts';

/**
 * Performance tests with graphs containing cycles.
 * The existing large-graph.test.ts only generates acyclic graphs.
 * Cycle detection (Tarjan's SCC) should still be fast with cycles present.
 */

function generateRecordsWithCycles(moduleCount: number, cycleCount: number): ImportRecord[] {
  const records: ImportRecord[] = [];
  // Use a tree topology (like the existing perf test) to avoid stack overflow
  // in Tarjan's recursive SCC
  const branchCount = Math.ceil(Math.sqrt(moduleCount));
  const depth = Math.ceil(moduleCount / branchCount);

  records.push({
    specifier: 'root',
    resolvedURL: 'file:///root.js',
    parentURL: null,
    importStartTime: 0,
    totalImportTime: moduleCount * 0.1,
  });

  let id = 1;
  for (let b = 0; b < branchCount && id < moduleCount; b++) {
    let parentURL = 'file:///root.js';
    for (let d = 0; d < depth && id < moduleCount; d++) {
      const url = `file:///mod-${id}.js`;
      records.push({
        specifier: `./mod-${id}.js`,
        resolvedURL: url,
        parentURL,
        importStartTime: id * 0.1,
        totalImportTime: 0.05,
      });
      parentURL = url;
      id++;
    }
  }

  // Add back-edges to create cycles between nearby modules
  for (let c = 0; c < cycleCount; c++) {
    const from = (c * 2 + 2) % (moduleCount - 1) + 1;
    const to = (c * 2 + 1) % (moduleCount - 1) + 1;
    if (from !== to) {
      records.push({
        specifier: `./mod-${to}.js`,
        resolvedURL: `file:///mod-${to}.js`,
        parentURL: `file:///mod-${from}.js`,
        importStartTime: moduleCount * 0.1 + c,
      });
    }
  }

  return records;
}

function generateStarGraph(count: number): ImportRecord[] {
  const records: ImportRecord[] = [{
    specifier: 'root',
    resolvedURL: 'file:///root.js',
    parentURL: null,
    importStartTime: 0,
    totalImportTime: count * 0.1,
  }];
  for (let i = 1; i < count; i++) {
    records.push({
      specifier: `./leaf-${i}.js`,
      resolvedURL: `file:///leaf-${i}.js`,
      parentURL: 'file:///root.js',
      importStartTime: i * 0.1,
      totalImportTime: 0.05,
    });
  }
  return records;
}

function generateChainGraph(count: number): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      specifier: `./step-${i}.js`,
      resolvedURL: `file:///step-${i}.js`,
      parentURL: i === 0 ? null : `file:///step-${i - 1}.js`,
      importStartTime: i * 0.1,
      totalImportTime: 0.05,
    });
  }
  return records;
}

describe('performance with cycles', () => {
  it('1000 modules with 10 cycles in under 2 seconds', () => {
    const records = generateRecordsWithCycles(1000, 10);
    const start = performance.now();

    const tree = buildTree(records);
    const cycles = detectCycles(records);
    const ranked = computeRankedList(records);

    const elapsed = performance.now() - start;
    assert.ok(tree.length > 0, 'Should build tree');
    assert.ok(cycles.length > 0, 'Should detect cycles');
    assert.ok(ranked.length > 0, 'Should rank modules');
    assert.ok(elapsed < 2000, `Should complete in <2s, took ${elapsed.toFixed(0)}ms`);
    console.log(`  1000 modules + 10 cycles: ${elapsed.toFixed(1)}ms, found ${cycles.length} cycles`);
  });

  it('5000 modules with 50 cycles in under 10 seconds', () => {
    const records = generateRecordsWithCycles(5000, 50);
    const start = performance.now();

    const tree = buildTree(records);
    const cycles = detectCycles(records);
    const ranked = computeRankedList(records);

    const elapsed = performance.now() - start;
    assert.ok(tree.length > 0, 'Should build tree');
    assert.ok(cycles.length > 0, 'Should detect cycles');
    assert.ok(ranked.length > 0, 'Should rank modules');
    assert.ok(elapsed < 10000, `Should complete in <10s, took ${elapsed.toFixed(0)}ms`);
    console.log(`  5000 modules + 50 cycles: ${elapsed.toFixed(1)}ms, found ${cycles.length} cycles`);
  });
});

describe('performance with different topologies', () => {
  it('star graph (1 root, 999 leaves) — very wide', () => {
    const records = generateStarGraph(1000);
    const start = performance.now();

    const tree = buildTree(records);
    const cycles = detectCycles(records);

    const elapsed = performance.now() - start;
    assert.equal(tree.length, 1, 'Single root');
    assert.equal(tree[0]!.children.length, 999, 'All leaves under root');
    assert.equal(cycles.length, 0, 'No cycles');
    assert.ok(elapsed < 2000, `Should complete in <2s, took ${elapsed.toFixed(0)}ms`);
    console.log(`  Star graph (1000): ${elapsed.toFixed(1)}ms`);
  });

  it('chain graph (1000 sequential) — very deep', () => {
    const records = generateChainGraph(1000);
    const start = performance.now();

    const tree = buildTree(records);
    const cycles = detectCycles(records);

    const elapsed = performance.now() - start;
    assert.equal(tree.length, 1, 'Single root');
    assert.equal(cycles.length, 0, 'No cycles');
    assert.ok(elapsed < 2000, `Should complete in <2s, took ${elapsed.toFixed(0)}ms`);
    console.log(`  Chain graph (1000): ${elapsed.toFixed(1)}ms`);
  });
});
