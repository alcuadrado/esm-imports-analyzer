import assert from 'node:assert/strict';
import { register, getPlugin, listPlugins } from '../src/registry.js';

describe('registry (circular deps)', () => {
  it('registers a plugin', () => {
    const plugin = register('test-plugin', { verbose: true });
    assert.equal(plugin.name, 'test-plugin');
    assert.deepEqual(plugin.config, { verbose: true });
  });

  it('retrieves a registered plugin', () => {
    register('foo', {});
    const plugin = getPlugin('foo');
    assert.ok(plugin);
    assert.equal(plugin.name, 'foo');
  });

  it('lists registered plugins', () => {
    register('bar', {});
    const names = listPlugins();
    assert.ok(names.includes('bar'));
  });

  it('resolves cross-plugin dependencies', () => {
    register('dep', { x: 1 });
    const consumer = register('consumer', {});
    const dep = consumer.getDependency('dep');
    assert.ok(dep);
    assert.equal(dep.name, 'dep');
  });
});
