import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runWithLoader } from './helpers.ts';

const fixturesDir = resolve(import.meta.dirname!, 'fixtures');

describe('loader integration', () => {
  it('captures linear imports (simple fixture)', () => {
    const result = runWithLoader(resolve(fixturesDir, 'simple/a.js'));
    assert.ok(result.records.length >= 3, `Expected at least 3 records, got ${result.records.length}`);

    const urls = result.records.map(r => r.resolvedURL);
    const aURL = pathToFileURL(resolve(fixturesDir, 'simple/a.js')).href;
    const bURL = pathToFileURL(resolve(fixturesDir, 'simple/b.js')).href;
    const cURL = pathToFileURL(resolve(fixturesDir, 'simple/c.js')).href;
    assert.ok(urls.includes(aURL), 'Should include a.js');
    assert.ok(urls.includes(bURL), 'Should include b.js');
    assert.ok(urls.includes(cURL), 'Should include c.js');

    // Check parent-child relationships
    const bRecord = result.records.find(r => r.resolvedURL === bURL);
    assert.ok(bRecord);
    assert.equal(bRecord.parentURL, aURL);

    const cRecord = result.records.find(r => r.resolvedURL === cURL);
    assert.ok(cRecord);
    assert.equal(cRecord.parentURL, bURL);
  });

  it('captures circular dependencies', () => {
    const result = runWithLoader(resolve(fixturesDir, 'circular/a.js'));
    assert.ok(result.records.length >= 3);
    const urls = result.records.map(r => r.resolvedURL);
    const aURL = pathToFileURL(resolve(fixturesDir, 'circular/a.js')).href;
    assert.ok(urls.includes(aURL));
  });

  it('handles deep nesting (21 levels)', () => {
    const result = runWithLoader(resolve(fixturesDir, 'deep/level-0.js'));
    assert.ok(result.records.length >= 21, `Expected at least 21 records, got ${result.records.length}`);
  });

  it('handles wide fan-out (51 modules)', () => {
    const result = runWithLoader(resolve(fixturesDir, 'wide/a.js'));
    assert.ok(result.records.length >= 51, `Expected at least 51 records, got ${result.records.length}`);
  });

  it('captures builtin modules', () => {
    const result = runWithLoader(resolve(fixturesDir, 'builtins/a.js'));
    const builtins = result.records.filter(r => r.resolvedURL.startsWith('node:'));
    // Some builtins may already be cached by our loader's own imports (node:fs, node:module)
    // so we check that at least one builtin is captured
    assert.ok(builtins.length >= 1, `Expected at least 1 builtin, got ${builtins.length}`);
    const builtinUrls = builtins.map(r => r.resolvedURL);
    assert.ok(builtinUrls.includes('node:path'), `Expected node:path in builtins, got: ${builtinUrls.join(', ')}`);
  });

  it('records timing data with valid values', () => {
    const result = runWithLoader(resolve(fixturesDir, 'simple/a.js'));
    for (const record of result.records) {
      assert.ok(typeof record.importStartTime === 'number', 'importStartTime should be a number');
      assert.ok(record.importStartTime >= 0, 'importStartTime should be non-negative');
    }
  });

  it('captures node_modules imports', () => {
    const result = runWithLoader(resolve(fixturesDir, 'node-modules/a.js'));
    assert.ok(result.records.length >= 2, `Expected at least 2 records, got ${result.records.length}`);
    // Should capture the ms package
    const msRecord = result.records.find(r => r.resolvedURL.includes('node_modules') && r.resolvedURL.includes('ms'));
    assert.ok(msRecord, 'Should capture ms package import');
  });

  it('produces valid JSON import records', () => {
    const result = runWithLoader(resolve(fixturesDir, 'simple/a.js'));
    for (const record of result.records) {
      assert.ok(typeof record.specifier === 'string');
      assert.ok(typeof record.resolvedURL === 'string');
      assert.ok(typeof record.importStartTime === 'number');
    }
  });

  it('records totalImportTime for JS modules', () => {
    const result = runWithLoader(resolve(fixturesDir, 'simple/a.js'));
    const aURL = pathToFileURL(resolve(fixturesDir, 'simple/a.js')).href;
    const aRecord = result.records.find(r => r.resolvedURL === aURL);
    assert.ok(aRecord);
    assert.ok(typeof aRecord.totalImportTime === 'number', 'totalImportTime should be a number for JS modules');
    assert.ok(aRecord.totalImportTime! >= 0, 'totalImportTime should be non-negative');
  });

  it('records totalImportTime >= 90ms for slow fixture with top-level await', () => {
    const result = runWithLoader(resolve(fixturesDir, 'slow/a.js'));
    const aURL = pathToFileURL(resolve(fixturesDir, 'slow/a.js')).href;
    const aRecord = result.records.find(r => r.resolvedURL === aURL);
    assert.ok(aRecord);
    assert.ok(aRecord.totalImportTime !== undefined, 'totalImportTime should be defined');
    assert.ok(aRecord.totalImportTime! >= 90, `totalImportTime should be >= 90ms, got ${aRecord.totalImportTime}`);
  });

  it('builtin modules have no totalImportTime', () => {
    const result = runWithLoader(resolve(fixturesDir, 'builtins/a.js'));
    const builtins = result.records.filter(r => r.resolvedURL.startsWith('node:'));
    for (const b of builtins) {
      assert.equal(b.totalImportTime, undefined, `builtin ${b.resolvedURL} should not have totalImportTime`);
    }
  });

  it('modules that throw during evaluation have no totalImportTime', () => {
    const result = runWithLoader(resolve(fixturesDir, 'throwing/a.js'));
    // The process will fail, but we should still get records
    const bURL = pathToFileURL(resolve(fixturesDir, 'throwing/b.js')).href;
    const bRecord = result.records.find(r => r.resolvedURL === bURL);
    if (bRecord) {
      assert.equal(bRecord.totalImportTime, undefined,
        'Module that throws should not have totalImportTime');
    }
    // It's also acceptable to have no record at all if the process died before flushing
  });

  it('records totalImportTime for CJS modules imported via ESM import', () => {
    const result = runWithLoader(resolve(fixturesDir, 'node-modules/a.js'));
    const msRecord = result.records.find(r => r.resolvedURL.includes('node_modules') && r.resolvedURL.includes('ms'));
    assert.ok(msRecord, 'Should capture ms package import');
    assert.ok(typeof msRecord.totalImportTime === 'number', 'CJS module via import should have totalImportTime');
    assert.ok(msRecord.totalImportTime! >= 0, 'totalImportTime should be non-negative');
  });

  it('records totalImportTime for CJS modules loaded via require()', () => {
    const result = runWithLoader(resolve(fixturesDir, 'cjs-require/a.cjs'));
    const aURL = pathToFileURL(resolve(fixturesDir, 'cjs-require/a.cjs')).href;
    const bURL = pathToFileURL(resolve(fixturesDir, 'cjs-require/b.cjs')).href;

    const aRecord = result.records.find(r => r.resolvedURL === aURL);
    assert.ok(aRecord, 'Should capture a.cjs');
    assert.ok(typeof aRecord.totalImportTime === 'number', 'CJS module via require should have totalImportTime');

    const bRecord = result.records.find(r => r.resolvedURL === bURL);
    assert.ok(bRecord, 'Should capture b.cjs');
    assert.ok(typeof bRecord.totalImportTime === 'number', 'CJS child module via require should have totalImportTime');
  });
});
