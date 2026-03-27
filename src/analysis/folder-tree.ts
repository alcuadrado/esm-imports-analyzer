import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FolderTreeNode } from '../types.ts';

interface RawNode {
  name: string;
  children: Map<string, RawNode>;
  moduleURL?: string;
}

function makeRawFolder(name: string): RawNode {
  return { name, children: new Map() };
}

function insertPath(root: RawNode, segments: string[], moduleURL: string): void {
  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (!current.children.has(seg)) {
      current.children.set(seg, makeRawFolder(seg));
    }
    current = current.children.get(seg)!;
  }
  const fileName = segments[segments.length - 1]!;
  current.children.set(fileName, {
    name: fileName,
    children: new Map(),
    moduleURL,
  });
}

function sortNodes(nodes: FolderTreeNode[]): FolderTreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

// Convert a raw trie node into a FolderTreeNode (no flattening yet)
function rawToTree(groupId: string, node: RawNode, relPath: string): FolderTreeNode {
  if (node.moduleURL !== undefined) {
    return {
      id: node.moduleURL,
      label: node.name,
      type: 'file',
      moduleURL: node.moduleURL,
      children: [],
    };
  }

  const children: FolderTreeNode[] = [];
  for (const child of node.children.values()) {
    const childRel = relPath ? relPath + '/' + child.name : child.name;
    children.push(rawToTree(groupId, child, childRel));
  }

  return {
    id: 'ftree::' + groupId + '::' + relPath,
    label: node.name,
    type: 'folder',
    children: sortNodes(children),
  };
}

// Flatten a list of sibling nodes. For each folder that has exactly 1 child,
// merge it with that child (concatenating labels). Repeat until stable.
function flattenChildren(groupId: string, nodes: FolderTreeNode[]): FolderTreeNode[] {
  return sortNodes(nodes.map(node => flattenSingle(groupId, node)));
}

function joinLabel(a: string, b: string): string {
  return a ? a + '/' + b : b;
}

function flattenSingle(groupId: string, node: FolderTreeNode): FolderTreeNode {
  if (node.type === 'file') return node;

  let current = node;
  // Walk down through single-child folders, accumulating the path
  while (current.type === 'folder' && current.children.length === 1) {
    const only = current.children[0]!;
    const merged = joinLabel(current.label, only.label);
    if (only.type === 'file') {
      return { ...only, label: merged };
    }
    // Single folder child: merge labels and continue
    current = {
      ...only,
      label: merged,
      id: 'ftree::' + groupId + '::' + merged,
      children: only.children,
    };
  }

  // current now has 0 or 2+ children — flatten each child recursively
  return {
    ...current,
    children: flattenChildren(groupId, current.children),
  };
}

export function buildFolderTree(groupId: string, packageDir: string, moduleURLs: string[]): FolderTreeNode[] {
  const root = makeRawFolder('');

  for (const url of moduleURLs) {
    if (!url.startsWith('file://')) continue;

    let filePath: string;
    try {
      filePath = fileURLToPath(url);
    } catch {
      continue;
    }

    const rel = relative(packageDir, filePath);
    if (rel.startsWith('..') || rel.startsWith('/')) continue;

    const segments = rel.split('/').filter(s => s.length > 0);
    if (segments.length === 0) continue;

    insertPath(root, segments, url);
  }

  // Convert to typed tree (root is virtual, we take its children)
  const topLevel: FolderTreeNode[] = [];
  for (const child of root.children.values()) {
    topLevel.push(rawToTree(groupId, child, child.name));
  }

  // Treat the virtual root like a folder and apply the same flatten logic:
  // if exactly 1 child, merge through it.
  const virtualRoot: FolderTreeNode = {
    id: '',
    label: '',
    type: 'folder',
    children: sortNodes(topLevel),
  };
  const flattened = flattenSingle(groupId, virtualRoot);

  if (flattened.type === 'file') {
    // Entire package is a single file
    return [flattened];
  }

  // If the virtual root was flattened (label is non-empty), we absorbed
  // intermediate folders. Prefix all children's labels with that path.
  if (flattened.label) {
    return flattened.children.map(child => prefixNode(groupId, flattened.label, child));
  }

  return flattened.children;
}

function prefixNode(groupId: string, prefix: string, node: FolderTreeNode): FolderTreeNode {
  const label = prefix + '/' + node.label;
  if (node.type === 'file') {
    return { ...node, label };
  }
  return {
    ...node,
    label,
    id: 'ftree::' + groupId + '::' + label,
  };
}
