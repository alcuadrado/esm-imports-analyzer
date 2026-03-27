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
});
