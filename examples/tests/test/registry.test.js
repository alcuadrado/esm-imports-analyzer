import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register, getPlugin, listPlugins } from '../src/registry.js';

describe('registry (circular deps)', () => {
  it('registers and retrieves a plugin', () => {
    const plugin = register('auth', { secret: 'abc' });
    assert.equal(plugin.name, 'auth');
    assert.equal(getPlugin('auth'), plugin);
  });

  it('lists registered plugins', () => {
    register('logging', {});
    assert.ok(listPlugins().includes('logging'));
  });

  it('resolves cross-plugin dependencies', () => {
    register('db', { host: 'localhost' });
    const api = register('api', {});
    const db = api.getDependency('db');
    assert.ok(db);
    assert.equal(db.name, 'db');
  });
});
