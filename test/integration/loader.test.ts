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

  it('records timing data with positive values', () => {
    const result = runWithLoader(resolve(fixturesDir, 'simple/a.js'));
    for (const record of result.records) {
      assert.ok(record.resolveEndTime >= record.resolveStartTime, 'resolveEndTime should be >= resolveStartTime');
      assert.ok(record.loadEndTime >= record.loadStartTime, 'loadEndTime should be >= loadStartTime');
      assert.ok(record.loadEndTime >= record.resolveStartTime, 'loadEndTime should be >= resolveStartTime');
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
      assert.ok(typeof record.resolveStartTime === 'number');
      assert.ok(typeof record.resolveEndTime === 'number');
      assert.ok(typeof record.loadStartTime === 'number');
      assert.ok(typeof record.loadEndTime === 'number');
    }
  });
});
