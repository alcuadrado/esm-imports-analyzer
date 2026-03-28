import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../src/config.js';

describe('config (top-level await)', () => {
  it('loads project name', () => {
    const config = getConfig();
    assert.equal(config.name, 'example-project');
  });

  it('loads project version', () => {
    const config = getConfig();
    assert.equal(config.version, '1.0.0');
  });
});
