import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFolderTree } from '../../src/analysis/folder-tree.ts';
import type { FolderTreeNode } from '../../src/types.ts';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

function makeURL(packageDir: string, relPath: string): string {
  return pathToFileURL(join(packageDir, relPath)).href;
}

const PKG = '/test/my-app';
const GID = PKG;

describe('buildFolderTree', () => {
  it('single file at root', () => {
    const urls = [makeURL(PKG, 'index.js')];
    const tree = buildFolderTree(GID, PKG, urls);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.type, 'file');
    assert.equal(tree[0]!.label, 'index.js');
    assert.equal(tree[0]!.moduleURL, urls[0]);
  });

  it('multiple files at root', () => {
    const urls = [makeURL(PKG, 'a.js'), makeURL(PKG, 'b.js')];
    const tree = buildFolderTree(GID, PKG, urls);
    assert.equal(tree.length, 2);
    assert.ok(tree.every(n => n.type === 'file'));
  });

  it('files in one folder — no flatten (2 children)', () => {
    const urls = [makeURL(PKG, 'src/a.js'), makeURL(PKG, 'src/b.js')];
    const tree = buildFolderTree(GID, PKG, urls);
    // src/ has 2 children → no flatten at root (root has 1 child src/, but src has 2 → flatten root→src)
    // Root has 1 child (src/) → flatten. src/ has 2 children → stop.
    // Result: src/a.js and src/b.js
    assert.equal(tree.length, 2);
    assert.equal(tree[0]!.type, 'file');
    assert.ok(tree[0]!.label === 'src/a.js' || tree[0]!.label === 'src/b.js');
  });

  it('auto-flatten single-child chain ending in file', () => {
    // src/lib/internal/deep.js — each level has 1 child
    const urls = [makeURL(PKG, 'src/lib/internal/deep.js')];
    const tree = buildFolderTree(GID, PKG, urls);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.type, 'file');
    assert.equal(tree[0]!.label, 'src/lib/internal/deep.js');
  });

  it('auto-flatten single-child chain ending in folder with 2+ children', () => {
    // src/ (only child) → utils/ has math.js + string.js
    const urls = [
      makeURL(PKG, 'src/utils/math.js'),
      makeURL(PKG, 'src/utils/string.js'),
    ];
    const tree = buildFolderTree(GID, PKG, urls);
    // root → src (1 child: utils) → flatten → src/utils (2 children) → stop
    assert.equal(tree.length, 2);
    assert.ok(tree.every(n => n.type === 'file'));
    const labels = tree.map(n => n.label).sort();
    assert.deepStrictEqual(labels, ['src/utils/math.js', 'src/utils/string.js']);
  });

  it('stops flattening when folder has 2+ children', () => {
    // src/ has index.js + utils/ (2 children)
    const urls = [
      makeURL(PKG, 'src/index.js'),
      makeURL(PKG, 'src/utils/math.js'),
    ];
    const tree = buildFolderTree(GID, PKG, urls);
    // root → src (1 child? No, root has 1 child src/. src/ has 2 children) → flatten root→src
    // Result: src/index.js (file) + src/utils (folder with 1 child math.js → flatten to src/utils/math.js)
    assert.equal(tree.length, 2);
    const file = tree.find(n => n.type === 'file' && n.label === 'src/index.js');
    assert.ok(file, 'Should have src/index.js file');
    // utils/ has 1 child (math.js) → flatten to file
    const mathFile = tree.find(n => n.type === 'file' && n.label === 'src/utils/math.js');
    assert.ok(mathFile, 'Should flatten src/utils/ to src/utils/math.js');
  });

  it('mixed flatten and non-flatten', () => {
    // Original example from spec:
    // src/ is only child of root → flatten
    // src/ has: index.ts, utils/ (with math.js, string.js), routes/ (with api/users.js)
    const urls = [
      makeURL(PKG, 'src/index.ts'),
      makeURL(PKG, 'src/utils/math.js'),
      makeURL(PKG, 'src/utils/string.js'),
      makeURL(PKG, 'src/routes/api/users.js'),
    ];
    const tree = buildFolderTree(GID, PKG, urls);
    // root has 1 child (src/) → flatten
    // src/ has 3 children: index.ts, utils/, routes/ → stop
    // Result: src/index.ts, [src/utils], [src/routes]
    // src/utils has 2 children → stays as folder
    // src/routes has 1 child (api/) → flatten → src/routes/api has 1 child (users.js) → flatten
    // So src/routes → src/routes/api/users.js (file)

    const labels = tree.map(n => n.label).sort();
    assert.ok(labels.includes('src/index.ts'));
    assert.ok(labels.includes('src/routes/api/users.js'));

    const utilsFolder = tree.find(n => n.type === 'folder' && n.label === 'src/utils');
    assert.ok(utilsFolder, 'src/utils should be a folder (2 children)');
    assert.equal(utilsFolder.children.length, 2);
  });

  it('skips non-file URLs', () => {
    const urls = ['node:fs', 'node:path', 'data:text/javascript,export default 1'];
    const tree = buildFolderTree(GID, PKG, urls);
    assert.equal(tree.length, 0);
  });

  it('generates deterministic folder IDs', () => {
    const urls = [
      makeURL(PKG, 'src/utils/math.js'),
      makeURL(PKG, 'src/utils/string.js'),
    ];
    const tree1 = buildFolderTree(GID, PKG, urls);
    const tree2 = buildFolderTree(GID, PKG, urls);
    assert.deepStrictEqual(tree1, tree2);
  });

  it('file IDs are the original module URLs', () => {
    const url = makeURL(PKG, 'index.js');
    const tree = buildFolderTree(GID, PKG, [url]);
    assert.equal(tree[0]!.id, url);
  });

  it('folder IDs start with ftree:: prefix', () => {
    const urls = [
      makeURL(PKG, 'src/a.js'),
      makeURL(PKG, 'src/b.js'),
    ];
    const tree = buildFolderTree(GID, PKG, urls);
    // After flattening, these are files, but if we have a non-flatten case:
    const urls2 = [
      makeURL(PKG, 'lib/a.js'),
      makeURL(PKG, 'lib/b.js'),
      makeURL(PKG, 'src/c.js'),
    ];
    const tree2 = buildFolderTree(GID, PKG, urls2);
    const folder = tree2.find(n => n.type === 'folder');
    assert.ok(folder, 'Should have a folder');
    assert.ok(folder.id.startsWith('ftree::'), `Folder ID should start with ftree::, got ${folder.id}`);
  });
});
