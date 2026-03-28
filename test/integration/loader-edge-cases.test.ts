import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runWithLoader } from './helpers.ts';

/**
 * Advanced loader integration tests covering edge cases discovered during
 * development. These complement the basic loader.test.ts tests.
 *
 * Key behaviors tested:
 * - Dynamic import() is captured (not just static imports)
 * - Re-exports are traced through intermediate modules
 * - Mixed ESM/CJS chains (ESM → CJS require → CJS) all get timing
 * - Source map comments in source are preserved during injection
 * - Multiple imports of the same module produce correct records
 * - Self-imports produce a record but no totalImportTime (cached)
 */

const fixturesDir = resolve(import.meta.dirname!, 'fixtures');

describe('loader edge cases', () => {
  it('captures dynamic import() calls', () => {
    const result = runWithLoader(resolve(fixturesDir, 'dynamic/a.js'));
    const bURL = pathToFileURL(resolve(fixturesDir, 'dynamic/b.js')).href;
    const bRecord = result.records.find(r => r.resolvedURL === bURL);
    assert.ok(bRecord, 'Should capture dynamically imported module');
    assert.ok(typeof bRecord.totalImportTime === 'number', 'Dynamic import should have totalImportTime');
  });

  it('captures re-exports through intermediate modules', () => {
    const result = runWithLoader(resolve(fixturesDir, 'reexport/a.js'));
    const bURL = pathToFileURL(resolve(fixturesDir, 'reexport/b.js')).href;
    const cURL = pathToFileURL(resolve(fixturesDir, 'reexport/c.js')).href;

    const bRecord = result.records.find(r => r.resolvedURL === bURL);
    const cRecord = result.records.find(r => r.resolvedURL === cURL);
    assert.ok(bRecord, 'Should capture re-exporting module b.js');
    assert.ok(cRecord, 'Should capture source module c.js');
    // c.js is imported by b.js (the re-export triggers an import)
    assert.equal(cRecord.parentURL, bURL, 'c.js parent should be b.js');
  });

  it('captures mixed ESM → CJS require → CJS chain with timing', () => {
    const result = runWithLoader(resolve(fixturesDir, 'mixed-esm-cjs/a.js'));
    const aURL = pathToFileURL(resolve(fixturesDir, 'mixed-esm-cjs/a.js')).href;
    const bURL = pathToFileURL(resolve(fixturesDir, 'mixed-esm-cjs/b.cjs')).href;
    const cURL = pathToFileURL(resolve(fixturesDir, 'mixed-esm-cjs/c.cjs')).href;

    const aRecord = result.records.find(r => r.resolvedURL === aURL);
    const bRecord = result.records.find(r => r.resolvedURL === bURL);
    const cRecord = result.records.find(r => r.resolvedURL === cURL);

    assert.ok(aRecord, 'ESM entry should be captured');
    assert.ok(bRecord, 'CJS module imported via ESM should be captured');
    assert.ok(cRecord, 'CJS module required by another CJS should be captured');

    // All should have timing since we inject into all JS sources
    assert.ok(typeof aRecord.totalImportTime === 'number', 'ESM module should have totalImportTime');
    assert.ok(typeof bRecord.totalImportTime === 'number', 'CJS via import() should have totalImportTime');
    assert.ok(typeof cRecord.totalImportTime === 'number', 'CJS via require() should have totalImportTime');
  });

  it('does not break modules with source map comments', () => {
    const result = runWithLoader(resolve(fixturesDir, 'source-map/a.js'));
    // If source map handling is broken, the module would fail to load
    assert.ok(result.records.length >= 2, 'Should capture both modules');
    assert.equal(result.exitCode, 0, 'Process should exit cleanly (source map not broken)');

    const bURL = pathToFileURL(resolve(fixturesDir, 'source-map/b.js')).href;
    const bRecord = result.records.find(r => r.resolvedURL === bURL);
    assert.ok(bRecord, 'Module with source map should be captured');
    assert.ok(typeof bRecord.totalImportTime === 'number', 'Module with source map should have totalImportTime');
  });

  it('all records for a URL get the same totalImportTime (merged during flush)', () => {
    // When a module is imported multiple times (e.g., circular deps), the resolve hook
    // creates separate records for each occurrence. During flush, evalTimes is merged
    // by URL into ALL records — so cached re-imports also get totalImportTime.
    // This is because flushData() iterates all records and sets totalImportTime by URL.
    const result = runWithLoader(resolve(fixturesDir, 'circular/a.js'));

    const byURL = new Map<string, typeof result.records>();
    for (const r of result.records) {
      if (!byURL.has(r.resolvedURL)) byURL.set(r.resolvedURL, []);
      byURL.get(r.resolvedURL)!.push(r);
    }

    for (const [url, records] of byURL) {
      if (records.length > 1 && records[0]!.totalImportTime !== undefined) {
        // All records for this URL should have the same totalImportTime
        const time = records[0]!.totalImportTime;
        for (const r of records) {
          assert.equal(r.totalImportTime, time,
            `All records for ${url} should have the same totalImportTime`);
        }
      }
    }
  });

  it('self-import produces multiple records with same totalImportTime', () => {
    const result = runWithLoader(resolve(fixturesDir, 'self-import/a.js'));
    const aURL = pathToFileURL(resolve(fixturesDir, 'self-import/a.js')).href;
    const aRecords = result.records.filter(r => r.resolvedURL === aURL);

    // Should have at least 2 records: the initial load and the self-import
    assert.ok(aRecords.length >= 2, `Expected at least 2 records for self-import, got ${aRecords.length}`);

    // All should have the same totalImportTime (merged by URL during flush)
    const withTime = aRecords.filter(r => r.totalImportTime !== undefined);
    assert.ok(withTime.length >= 1, 'At least one record should have totalImportTime');
    if (withTime.length > 1) {
      const time = withTime[0]!.totalImportTime;
      for (const r of withTime) {
        assert.equal(r.totalImportTime, time, 'All records should have same totalImportTime');
      }
    }
  });

  it('handles deep nesting (21 levels) with timing on all modules', () => {
    const result = runWithLoader(resolve(fixturesDir, 'deep/level-0.js'));
    // Every module should get totalImportTime (they're all ESM)
    const fileModules = result.records.filter(r =>
      r.resolvedURL.startsWith('file://') &&
      r.totalImportTime !== undefined
    );
    // Deduplicate by URL — each unique file:// module should have timing
    const uniqueWithTime = new Set(fileModules.map(r => r.resolvedURL));
    assert.ok(uniqueWithTime.size >= 21, `Expected at least 21 unique modules with timing, got ${uniqueWithTime.size}`);
  });

  it('records arrive ordered by importStartTime', () => {
    const result = runWithLoader(resolve(fixturesDir, 'simple/a.js'));
    // First-occurrence records should have monotonically increasing importStartTime
    const seen = new Set<string>();
    const firstOccurrences = result.records.filter(r => {
      if (seen.has(r.resolvedURL)) return false;
      seen.add(r.resolvedURL);
      return true;
    });

    for (let i = 1; i < firstOccurrences.length; i++) {
      assert.ok(
        firstOccurrences[i]!.importStartTime >= firstOccurrences[i - 1]!.importStartTime,
        `Record ${i} should have importStartTime >= record ${i-1}`
      );
    }
  });
});
