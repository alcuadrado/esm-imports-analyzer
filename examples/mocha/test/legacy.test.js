import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePath, getExtension } = require('../src/legacy.cjs');

describe('legacy CJS module', () => {
  it('resolves paths', () => {
    const result = resolvePath('/home', 'user', 'file.txt');
    assert.equal(result, '/home/user/file.txt');
  });

  it('extracts file extensions', () => {
    assert.equal(getExtension('file.txt'), '.txt');
    assert.equal(getExtension('archive.tar.gz'), '.gz');
    assert.equal(getExtension('noext'), '');
  });
});
