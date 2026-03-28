import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCompatible, bumpPatch, parseVersion } from '../src/version.js';

describe('version (semver CJS)', () => {
  it('checks semver compatibility', () => {
    assert.ok(isCompatible('1.2.3', '^1.0.0'));
    assert.ok(!isCompatible('2.0.0', '^1.0.0'));
  });

  it('bumps patch version', () => {
    assert.equal(bumpPatch('1.2.3'), '1.2.4');
  });

  it('parses version components', () => {
    const v = parseVersion('3.14.1');
    assert.deepEqual(v, { major: 3, minor: 14, patch: 1 });
  });

  it('returns null for invalid version', () => {
    assert.equal(parseVersion('not-a-version'), null);
  });
});
