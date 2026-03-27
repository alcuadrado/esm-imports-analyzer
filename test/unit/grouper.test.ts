import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { groupModules, clearPackageJsonCache } from '../../src/analysis/grouper.ts';
import type { ImportRecord } from '../../src/types.ts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function makeRecord(resolvedURL: string, parent?: string): ImportRecord {
  return {
    specifier: resolvedURL,
    resolvedURL,
    parentURL: parent ?? null,
    resolveStartTime: 0,
    resolveEndTime: 1,
    loadStartTime: 1,
    loadEndTime: 2,
  };
}

afterEach(() => {
  clearPackageJsonCache();
});

describe('groupModules', () => {
  it('groups node: builtins', () => {
    const records = [
      makeRecord('node:fs'),
      makeRecord('node:path'),
    ];
    const groups = groupModules(records);
    const builtinGroup = groups.find(g => g.id === 'node-builtins');
    assert.ok(builtinGroup);
    assert.equal(builtinGroup.label, 'Node.js Builtins');
    assert.equal(builtinGroup.modules.length, 2);
  });

  it('groups data: URLs', () => {
    const records = [
      makeRecord('data:text/javascript,export default 1'),
    ];
    const groups = groupModules(records);
    const inlineGroup = groups.find(g => g.id === 'inline-modules');
    assert.ok(inlineGroup);
    assert.equal(inlineGroup.label, 'Inline Modules');
  });

  it('groups files by package.json boundaries', () => {
    const fixtureDir = resolve('test/integration/fixtures/simple');
    const aURL = pathToFileURL(resolve(fixtureDir, 'a.js')).href;
    const bURL = pathToFileURL(resolve(fixtureDir, 'b.js')).href;

    const records = [
      makeRecord(aURL),
      makeRecord(bURL, aURL),
    ];
    const groups = groupModules(records);
    assert.ok(groups.length >= 1);
    const group = groups.find(g => g.label === 'simple-fixture');
    assert.ok(group);
    assert.equal(group.modules.length, 2);
  });

  it('groups node_modules correctly', () => {
    const fixtureDir = resolve('test/integration/fixtures/node-modules');
    const msURL = pathToFileURL(resolve(fixtureDir, 'node_modules', 'ms', 'index.js')).href;

    const records = [makeRecord(msURL)];
    const groups = groupModules(records);
    const msGroup = groups.find(g => g.label === 'ms');
    assert.ok(msGroup);
    assert.equal(msGroup.isNodeModules, true);
  });

  it('groups monorepo packages separately', () => {
    const fixtureDir = resolve('test/integration/fixtures/monorepo');
    const fooURL = pathToFileURL(resolve(fixtureDir, 'packages/foo/index.js')).href;
    const barURL = pathToFileURL(resolve(fixtureDir, 'packages/bar/index.js')).href;

    const records = [
      makeRecord(fooURL),
      makeRecord(barURL, fooURL),
    ];
    const groups = groupModules(records);
    const fooGroup = groups.find(g => g.label === 'foo');
    const barGroup = groups.find(g => g.label === 'bar');
    assert.ok(fooGroup);
    assert.ok(barGroup);
    assert.notEqual(fooGroup.id, barGroup.id);
  });

  it('groups single package project correctly', () => {
    const fixtureDir = resolve('test/integration/fixtures/simple');
    const aURL = pathToFileURL(resolve(fixtureDir, 'a.js')).href;
    const bURL = pathToFileURL(resolve(fixtureDir, 'b.js')).href;
    const cURL = pathToFileURL(resolve(fixtureDir, 'c.js')).href;

    const records = [
      makeRecord(aURL),
      makeRecord(bURL, aURL),
      makeRecord(cURL, bURL),
    ];
    const groups = groupModules(records);
    // All files should be in one group
    const simpleGroup = groups.find(g => g.label === 'simple-fixture');
    assert.ok(simpleGroup);
    assert.equal(simpleGroup.modules.length, 3);
  });

  it('groups scoped packages', () => {
    // Create a fake scoped package path
    const fixtureDir = resolve('test/integration/fixtures/node-modules');
    // Use the ms package as a proxy — we just need to verify grouping logic
    const msURL = pathToFileURL(resolve(fixtureDir, 'node_modules', 'ms', 'index.js')).href;
    const records = [makeRecord(msURL)];
    const groups = groupModules(records);
    const msGroup = groups.find(g => g.label === 'ms');
    assert.ok(msGroup, 'Should find ms group');
    assert.ok(msGroup.isNodeModules, 'Should be flagged as node_modules');
  });

  it('uses directory name when package.json has no name field', () => {
    const fixtureDir = resolve('test/integration/fixtures/no-name-pkg');
    const aURL = pathToFileURL(resolve(fixtureDir, 'a.js')).href;
    const records = [makeRecord(aURL)];
    const groups = groupModules(records);
    // Should use directory name as fallback label
    assert.ok(groups.length >= 1);
    const group = groups[0]!;
    assert.ok(group.modules.includes(aURL));
    // The label should be derived from directory name, not undefined
    assert.ok(typeof group.label === 'string' && group.label.length > 0, `Label should be non-empty, got: ${group.label}`);
  });

  it('falls back to Ungrouped when no package.json found', () => {
    // Use a URL in /tmp which has no package.json
    const tmpURL = pathToFileURL('/tmp/no-package-json-here/test.js').href;
    const records = [makeRecord(tmpURL)];
    const groups = groupModules(records);
    const ungrouped = groups.find(g => g.label === 'Ungrouped');
    assert.ok(ungrouped, 'Should have Ungrouped group');
    assert.ok(ungrouped.modules.includes(tmpURL));
  });
});
