import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for the import path tracing logic used in graph.js.
 *
 * getImportPath(moduleURL): walks up the parentByURL chain from a module
 * to its root, then reverses to produce "root -> ... -> module".
 * Used by the "Copy import paths" context menu item.
 *
 * getModuleURLsForNode(node): collects all module URLs belonging to a node.
 * For a module node: just its own URL.
 * For a group: all modules in the group (from data.groups).
 * For a folder: all modules recursively in the folder tree.
 */

// Reproduce getImportPath logic from graph.js
function getImportPath(moduleURL: string, parentByURL: Record<string, string | null>): string {
  const chain = [moduleURL];
  let current = moduleURL;
  const visited: Record<string, boolean> = {};
  visited[current] = true;
  while (parentByURL[current]) {
    current = parentByURL[current]!;
    if (visited[current]) break; // cycle protection
    visited[current] = true;
    chain.push(current);
  }
  chain.reverse();
  return chain.map(function (u) {
    return u.startsWith('file://') ? u.slice(7) : u;
  }).join(' -> ');
}

describe('getImportPath', () => {
  it('root module (no parent) returns just its path', () => {
    const result = getImportPath('file:///app/index.js', {
      'file:///app/index.js': null,
    });
    assert.equal(result, '/app/index.js');
  });

  it('linear chain produces correct path', () => {
    const parents: Record<string, string | null> = {
      'file:///a.js': null,
      'file:///b.js': 'file:///a.js',
      'file:///c.js': 'file:///b.js',
    };
    const result = getImportPath('file:///c.js', parents);
    assert.equal(result, '/a.js -> /b.js -> /c.js');
  });

  it('stops at cycle in parent chain (no infinite loop)', () => {
    const parents: Record<string, string | null> = {
      'file:///a.js': 'file:///b.js',
      'file:///b.js': 'file:///a.js',  // cycle
    };
    const result = getImportPath('file:///a.js', parents);
    // Should stop when it revisits a node
    assert.ok(result.includes('/a.js'));
    assert.ok(result.includes('/b.js'));
    // Should not be infinitely long
    assert.ok(result.length < 200);
  });

  it('strips file:// prefix from paths', () => {
    const result = getImportPath('file:///home/user/app.js', {
      'file:///home/user/app.js': null,
    });
    assert.equal(result, '/home/user/app.js');
  });

  it('preserves non-file URLs (node:, data:)', () => {
    const parents: Record<string, string | null> = {
      'file:///a.js': null,
      'node:fs': 'file:///a.js',
    };
    const result = getImportPath('node:fs', parents);
    assert.equal(result, '/a.js -> node:fs');
  });

  it('module not in parentByURL returns just its path', () => {
    const result = getImportPath('file:///unknown.js', {});
    assert.equal(result, '/unknown.js');
  });

  it('deep chain (10 levels)', () => {
    const parents: Record<string, string | null> = {};
    for (let i = 0; i < 10; i++) {
      parents[`file:///level-${i}.js`] = i === 0 ? null : `file:///level-${i - 1}.js`;
    }
    const result = getImportPath('file:///level-9.js', parents);
    const parts = result.split(' -> ');
    assert.equal(parts.length, 10);
    assert.equal(parts[0], '/level-0.js');
    assert.equal(parts[9], '/level-9.js');
  });
});

describe('import path formatting', () => {
  it('multiple paths joined with blank line separator', () => {
    const paths = ['/a.js -> /b.js', '/a.js -> /c.js'];
    const text = paths.join('\n\n');
    assert.equal(text, '/a.js -> /b.js\n\n/a.js -> /c.js');
  });

  it('single path has no separator', () => {
    const paths = ['/a.js -> /b.js'];
    const text = paths.join('\n\n');
    assert.equal(text, '/a.js -> /b.js');
  });
});
