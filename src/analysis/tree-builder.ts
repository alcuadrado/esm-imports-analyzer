import type { ImportRecord, ModuleNode } from '../types.ts';

export function buildTree(records: ImportRecord[]): ModuleNode[] {
  if (records.length === 0) return [];

  // Index records by resolvedURL — first occurrence wins (subsequent are cached)
  const recordByURL = new Map<string, ImportRecord>();
  for (const record of records) {
    if (!recordByURL.has(record.resolvedURL)) {
      recordByURL.set(record.resolvedURL, record);
    }
  }

  // Build nodes
  const nodeByURL = new Map<string, ModuleNode>();
  for (const [url, record] of recordByURL) {
    nodeByURL.set(url, {
      resolvedURL: url,
      specifier: record.specifier,
      totalTime: record.loadEndTime - record.resolveStartTime,
      children: [],
      parentURL: record.parentURL,
    });
  }

  // Link children to parents, collect roots
  const roots: ModuleNode[] = [];
  // Sort by loadStartTime so children are ordered by load order
  const sortedNodes = [...nodeByURL.values()].sort((a, b) => {
    const aRec = recordByURL.get(a.resolvedURL)!;
    const bRec = recordByURL.get(b.resolvedURL)!;
    return aRec.loadStartTime - bRec.loadStartTime;
  });

  for (const node of sortedNodes) {
    if (node.parentURL === null) {
      roots.push(node);
    } else {
      const parent = nodeByURL.get(node.parentURL);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not found — treat as root
        roots.push(node);
      }
    }
  }

  return roots;
}
